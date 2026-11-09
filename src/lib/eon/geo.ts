/**
 * Loader for v2ray GeoIPList and GeoSiteList (.dat) files.
 *
 * The bytes are the protobuf messages published by v2fly (geoip.dat and
 * dlc.dat). This reader understands only those messages, so the product does
 * not take a protobuf dependency. IP geolocation is longest-prefix. A domain
 * is reported in every list whose plain, regex, root-domain or full rule
 * matches. inverse_match on a GeoIP entry excludes its CIDRs.
 */

const text = new TextDecoder("utf-8", { fatal: true });
const utf8 = new TextEncoder();

export type DomainRule = "plain" | "regex" | "domain" | "full";

export interface EncodedCidr {
  ip: string;
  prefix: number;
}

export interface EncodedGeoIp {
  country: string;
  cidrs: EncodedCidr[];
  /** Proto field inverse_match. The entry matches addresses outside its CIDRs. */
  inverse?: boolean;
}

export interface EncodedAttribute {
  key: string;
  bool: boolean;
}

export interface EncodedDomain {
  type: DomainRule;
  value: string;
  attrs?: EncodedAttribute[];
}

export interface EncodedGeoSite {
  category: string;
  domains: EncodedDomain[];
}

interface Cursor {
  buf: Uint8Array;
  pos: number;
  end: number;
}

interface Cidr {
  ip: Uint8Array;
  prefix: number;
}

interface IndexedCidr extends Cidr {
  country: string;
  order: number;
}

interface InverseEntry {
  country: string;
  order: number;
  v4: Cidr[];
  v6: Cidr[];
}

interface FamilyIndex {
  wide: IndexedCidr[];
  buckets: IndexedCidr[][];
}

interface IpIndex {
  v4: FamilyIndex;
  v6: FamilyIndex;
  inverse: InverseEntry[];
}

interface SiteIndex {
  order: Map<string, number>;
  full: Map<string, string[]>;
  root: Map<string, string[]>;
  plain: { value: string; category: string }[];
  regex: { re: RegExp; category: string }[];
}

const DOMAIN_TYPE: Record<DomainRule, number> = { plain: 0, regex: 1, domain: 2, full: 3 };

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function encodeVarint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("varint out of range");
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Uint8Array.from(out);
}

function tag(field: number, wire: number): Uint8Array {
  return encodeVarint(field * 8 + wire);
}

function fieldBytes(field: number, data: Uint8Array): Uint8Array {
  return concat([tag(field, 2), encodeVarint(data.length), data]);
}

function fieldString(field: number, value: string): Uint8Array {
  return fieldBytes(field, utf8.encode(value));
}

function fieldVarint(field: number, value: number): Uint8Array {
  return concat([tag(field, 0), encodeVarint(value)]);
}

function encodeCidr(cidr: EncodedCidr): Uint8Array {
  const ip = parseIp(cidr.ip);
  if (!ip) throw new Error(`geoip cidr address ${cidr.ip}`);
  if (!Number.isInteger(cidr.prefix) || cidr.prefix < 0 || cidr.prefix > ip.length * 8) throw new Error(`geoip cidr prefix ${cidr.prefix}`);
  return concat([fieldBytes(1, ip), fieldVarint(2, cidr.prefix)]);
}

function encodeGeoIp(entry: EncodedGeoIp): Uint8Array {
  if (!entry.country) throw new Error("geoip country code is empty");
  const parts = [fieldString(1, entry.country)];
  for (const cidr of entry.cidrs) parts.push(fieldBytes(2, encodeCidr(cidr)));
  if (entry.inverse) parts.push(fieldVarint(3, 1));
  return concat(parts);
}

function encodeDomain(domain: EncodedDomain): Uint8Array {
  const type = DOMAIN_TYPE[domain.type];
  const parts: Uint8Array[] = [];
  if (type !== 0) parts.push(fieldVarint(1, type));
  parts.push(fieldString(2, domain.value));
  for (const attr of domain.attrs ?? []) {
    parts.push(fieldBytes(3, concat([fieldString(1, attr.key), fieldVarint(2, attr.bool ? 1 : 0)])));
  }
  return concat(parts);
}

function encodeGeoSite(entry: EncodedGeoSite): Uint8Array {
  if (!entry.category) throw new Error("geosite category is empty");
  const parts = [fieldString(1, entry.category)];
  for (const domain of entry.domains) parts.push(fieldBytes(2, encodeDomain(domain)));
  return concat(parts);
}

/** Synthetic GeoIPList bytes for tests. Not used for the published datasets. */
export function encodeGeoIpList(entries: EncodedGeoIp[]): Uint8Array {
  return concat(entries.map((entry) => fieldBytes(1, encodeGeoIp(entry))));
}

/** Synthetic GeoSiteList bytes for tests. Not used for the published datasets. */
export function encodeGeoSiteList(entries: EncodedGeoSite[]): Uint8Array {
  return concat(entries.map((entry) => fieldBytes(1, encodeGeoSite(entry))));
}

function cursor(buf: Uint8Array): Cursor {
  return { buf, pos: 0, end: buf.length };
}

function readVarint(c: Cursor): number {
  let value = 0;
  let shift = 0;
  while (shift <= 49) {
    if (c.pos >= c.end) throw new Error("truncated varint");
    const byte = c.buf[c.pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) throw new Error("varint exceeds safe integer range");
      return value;
    }
    shift += 7;
  }
  throw new Error("varint too long");
}

function readSpan(c: Cursor): { start: number; end: number } {
  const len = readVarint(c);
  const start = c.pos;
  const end = start + len;
  if (end > c.end) throw new Error("truncated length-delimited field");
  c.pos = end;
  return { start, end };
}

function readBytes(c: Cursor): Uint8Array {
  const span = readSpan(c);
  return c.buf.subarray(span.start, span.end);
}

function readString(c: Cursor): string {
  return text.decode(readBytes(c));
}

function skip(c: Cursor, wire: number) {
  if (wire === 0) readVarint(c);
  else if (wire === 1) {
    if (c.pos + 8 > c.end) throw new Error("truncated fixed64");
    c.pos += 8;
  } else if (wire === 2) readSpan(c);
  else if (wire === 5) {
    if (c.pos + 4 > c.end) throw new Error("truncated fixed32");
    c.pos += 4;
  } else throw new Error(`unsupported wire type ${wire}`);
}

function parseNested(c: Cursor, span: { start: number; end: number }, parse: (c: Cursor) => void) {
  const savedPos = c.pos;
  const savedEnd = c.end;
  c.pos = span.start;
  c.end = span.end;
  parse(c);
  c.pos = savedPos;
  c.end = savedEnd;
}

function parseCidr(c: Cursor): Cidr {
  let ip = new Uint8Array();
  let prefix = 0;
  let sawIp = false;
  while (c.pos < c.end) {
    const key = readVarint(c);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1 && wire === 2) {
      ip = Uint8Array.from(readBytes(c));
      sawIp = true;
    } else if (field === 2 && wire === 0) prefix = readVarint(c);
    else skip(c, wire);
  }
  if (!sawIp || (ip.length !== 4 && ip.length !== 16)) throw new Error(`geoip cidr address length ${ip.length}`);
  if (prefix > ip.length * 8) throw new Error(`geoip cidr prefix ${prefix}`);
  return { ip, prefix };
}

interface GeoIpEntry {
  country: string;
  inverse: boolean;
  cidrs: Cidr[];
  order: number;
}

function parseGeoIp(c: Cursor): GeoIpEntry {
  let country = "";
  const cidrs: Cidr[] = [];
  let inverse = false;
  while (c.pos < c.end) {
    const key = readVarint(c);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1 && wire === 2) country = readString(c);
    else if (field === 2 && wire === 2) {
      const span = readSpan(c);
      parseNested(c, span, (inner) => cidrs.push(parseCidr(inner)));
    } else if (field === 3 && wire === 0) inverse = readVarint(c) !== 0;
    else skip(c, wire);
  }
  return { country, inverse, cidrs, order: 0 };
}

function parseGeoIpList(buf: Uint8Array): GeoIpEntry[] {
  const c = cursor(buf);
  const entries: GeoIpEntry[] = [];
  while (c.pos < c.end) {
    const key = readVarint(c);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1 && wire === 2) {
      const span = readSpan(c);
      parseNested(c, span, (inner) => {
        const entry = parseGeoIp(inner);
        if (entry.country) {
          entry.order = entries.length;
          entries.push(entry);
        }
      });
    } else skip(c, wire);
  }
  return entries;
}

function parseDomain(c: Cursor): { type: number; value: string } {
  let type = 0;
  let value = "";
  while (c.pos < c.end) {
    const key = readVarint(c);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1 && wire === 0) type = readVarint(c);
    else if (field === 2 && wire === 2) value = readString(c);
    else skip(c, wire);
  }
  return { type, value };
}

interface GeoSiteEntry {
  category: string;
  domains: { type: number; value: string }[];
}

function parseGeoSite(c: Cursor): GeoSiteEntry {
  let category = "";
  const domains: { type: number; value: string }[] = [];
  while (c.pos < c.end) {
    const key = readVarint(c);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1 && wire === 2) category = readString(c);
    else if (field === 2 && wire === 2) {
      const span = readSpan(c);
      parseNested(c, span, (inner) => domains.push(parseDomain(inner)));
    } else skip(c, wire);
  }
  return { category, domains };
}

function parseGeoSiteList(buf: Uint8Array): GeoSiteEntry[] {
  const c = cursor(buf);
  const entries: GeoSiteEntry[] = [];
  while (c.pos < c.end) {
    const key = readVarint(c);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1 && wire === 2) {
      const span = readSpan(c);
      parseNested(c, span, (inner) => {
        const entry = parseGeoSite(inner);
        if (entry.category) entries.push(entry);
      });
    } else skip(c, wire);
  }
  return entries;
}

function family(): FamilyIndex {
  const buckets: IndexedCidr[][] = [];
  for (let i = 0; i < 256; i++) buckets.push([]);
  return { wide: [], buckets };
}

function contains(ip: Uint8Array, cidr: Cidr): boolean {
  if (ip.length !== cidr.ip.length) return false;
  const bytes = cidr.prefix >> 3;
  const rest = cidr.prefix & 7;
  for (let i = 0; i < bytes; i++) if (ip[i] !== cidr.ip[i]) return false;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return (ip[bytes] & mask) === (cidr.ip[bytes] & mask);
}

function indexGeoIp(entries: GeoIpEntry[]): IpIndex {
  const ips: IpIndex = { v4: family(), v6: family(), inverse: [] };
  for (const entry of entries) {
    if (entry.inverse) {
      ips.inverse.push({
        country: entry.country,
        order: entry.order,
        v4: entry.cidrs.filter((cidr) => cidr.ip.length === 4),
        v6: entry.cidrs.filter((cidr) => cidr.ip.length === 16),
      });
      continue;
    }
    for (const cidr of entry.cidrs) {
      const indexed: IndexedCidr = { ip: cidr.ip, prefix: cidr.prefix, country: entry.country, order: entry.order };
      const dest = cidr.ip.length === 4 ? ips.v4 : ips.v6;
      if (cidr.prefix < 8) dest.wide.push(indexed);
      else dest.buckets[cidr.ip[0]].push(indexed);
    }
  }
  return ips;
}

function remember(map: Map<string, string[]>, key: string, category: string) {
  const list = map.get(key);
  if (!list) map.set(key, [category]);
  else if (!list.includes(category)) list.push(category);
}

function indexGeoSite(entries: GeoSiteEntry[]): SiteIndex {
  const sites: SiteIndex = { order: new Map(), full: new Map(), root: new Map(), plain: [], regex: [] };
  for (const entry of entries) {
    if (!sites.order.has(entry.category)) sites.order.set(entry.category, sites.order.size);
    for (const domain of entry.domains) {
      const value = domain.value.trim();
      if (!value) continue;
      if (domain.type === 1) {
        if (value.length > 1024) continue;
        try {
          sites.regex.push({ re: new RegExp(value), category: entry.category });
        } catch {
          // A rule that is not a JavaScript regular expression cannot be applied.
        }
        continue;
      }
      const key = value.toLowerCase();
      if (domain.type === 3) remember(sites.full, key, entry.category);
      else if (domain.type === 2) remember(sites.root, key.startsWith(".") ? key.slice(1) : key, entry.category);
      else if (domain.type === 0) sites.plain.push({ value: key, category: entry.category });
    }
  }
  return sites;
}

function bestPositive(ip: Uint8Array, index: FamilyIndex): IndexedCidr | null {
  let best: IndexedCidr | null = null;
  const consider = (cidr: IndexedCidr) => {
    if (!contains(ip, cidr)) return;
    if (!best || cidr.prefix > best.prefix || (cidr.prefix === best.prefix && cidr.order < best.order)) best = cidr;
  };
  for (const cidr of index.buckets[ip[0]]) consider(cidr);
  for (const cidr of index.wide) consider(cidr);
  return best;
}

function lookupIp(ip: Uint8Array, index: IpIndex): string | null {
  const positive = bestPositive(ip, ip.length === 4 ? index.v4 : index.v6);
  if (positive) return positive.country;
  for (const entry of index.inverse) {
    const cidrs = ip.length === 4 ? entry.v4 : entry.v6;
    if (cidrs.length === 0) continue;
    if (!cidrs.some((cidr) => contains(ip, cidr))) return entry.country;
  }
  return null;
}

function mappedV4(ip: Uint8Array): Uint8Array | null {
  if (ip.length !== 16) return null;
  for (let i = 0; i < 10; i++) if (ip[i] !== 0) return null;
  if (ip[10] !== 0xff || ip[11] !== 0xff) return null;
  return ip.subarray(12);
}

/** Parse an IPv4 or IPv6 address. Returns null when the text is not one. */
export function parseIp(input: string): Uint8Array | null {
  const s = input.trim();
  if (!s || s.length > 64) return null;
  if (s.includes(":")) return parseIpv6(s);
  if (s.includes(".")) return parseIpv4(s);
  return null;
}

function parseIpv4(s: string): Uint8Array | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^(0|[1-9]\d{0,2})$/.test(parts[i])) return null;
    const n = Number(parts[i]);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

function parseIpv6(input: string): Uint8Array | null {
  let str = input.trim();
  if (str.startsWith("[") && str.endsWith("]")) str = str.slice(1, -1);
  const zone = str.indexOf("%");
  if (zone >= 0) str = str.slice(0, zone);
  if (str.includes(".")) {
    const last = str.lastIndexOf(":");
    if (last < 0) return null;
    const v4 = parseIpv4(str.slice(last + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    str = `${str.slice(0, last + 1)}${hi}:${lo}`;
  }
  const halves = str.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const nums: number[] = [];
    for (const part of side.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      nums.push(Number.parseInt(part, 16));
    }
    return nums;
  };
  const left = parseSide(halves[0]);
  if (!left) return null;
  let groups: number[];
  if (halves.length === 1) groups = left;
  else {
    const right = parseSide(halves[1]);
    if (!right || left.length + right.length > 7) return null;
    groups = left.concat(Array<number>(8 - left.length - right.length).fill(0), right);
  }
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = groups[i] >> 8;
    out[i * 2 + 1] = groups[i] & 0xff;
  }
  return out;
}

/** Hostname used for a geosite lookup. Addresses and empty labels are not domains. */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  let domain = value.trim().toLowerCase();
  if (domain.endsWith(".")) domain = domain.slice(0, -1);
  if (!domain || domain.length > 253 || parseIp(domain)) return null;
  const labels = domain.split(".");
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  }
  return domain;
}

function categoriesOfIndex(domain: string, sites: SiteIndex): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const add = (categories: readonly string[] | undefined) => {
    if (!categories) return;
    for (const category of categories) {
      if (seen.has(category)) continue;
      seen.add(category);
      found.push(category);
    }
  };
  add(sites.full.get(domain));
  let rest = domain;
  while (rest) {
    add(sites.root.get(rest));
    const dot = rest.indexOf(".");
    if (dot < 0) break;
    rest = rest.slice(dot + 1);
  }
  for (const rule of sites.plain) if (rule.value && domain.includes(rule.value)) add([rule.category]);
  for (const rule of sites.regex) if (rule.re.test(domain)) add([rule.category]);
  found.sort((a, b) => (sites.order.get(a) ?? 0) - (sites.order.get(b) ?? 0));
  return found;
}

/** Country and category lookups over one geoip.dat and one geosite.dat. */
export class GeoData {
  private readonly ips: IpIndex;
  private readonly sites: SiteIndex;

  constructor(ips: IpIndex, sites: SiteIndex) {
    this.ips = ips;
    this.sites = sites;
  }

  /** ISO-style country code from the dataset, or null when the address is not listed. */
  countryOf(ip: string): string | null {
    const parsed = parseIp(ip);
    if (!parsed) return null;
    const direct = lookupIp(parsed, this.ips);
    if (direct) return direct;
    if (parsed.length === 16) {
      const v4 = mappedV4(parsed);
      if (v4) return lookupIp(v4, this.ips);
    }
    return null;
  }

  /** Geosite list names that contain this domain, in file order. */
  categoriesOf(domain: string): string[] {
    const normalized = normalizeDomain(domain);
    if (!normalized) return [];
    return categoriesOfIndex(normalized, this.sites);
  }
}

export function loadGeoData(geoip: Uint8Array, geosite: Uint8Array): GeoData {
  return new GeoData(indexGeoIp(parseGeoIpList(geoip)), indexGeoSite(parseGeoSiteList(geosite)));
}

export interface GeoAnnotation {
  ip: string | null;
  country: string | null;
  domain: string | null;
  categories: string[];
  /** Observe-only: recorded for cyber review, never an allow or a refusal. */
  policy: "observe";
}

/** Label one address and one domain. The result does not change an access decision. */
export function annotate(data: GeoData, input: { ip?: string | null; domain?: string | null }): GeoAnnotation {
  const ip = input.ip && parseIp(input.ip) ? input.ip.trim() : null;
  const domain = normalizeDomain(input.domain);
  return {
    ip,
    country: ip ? data.countryOf(ip) : null,
    domain,
    categories: domain ? data.categoriesOf(domain) : [],
    policy: "observe",
  };
}
