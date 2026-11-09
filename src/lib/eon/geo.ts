/**
 * Small reader for v2fly GeoIPList / GeoSiteList (.dat) files.
 * The protobuf messages are the ones Project V publishes. No protobuf library:
 * only the fields those two messages use are decoded.
 *
 * GeoIP country_code and GeoSite country_code are list names (a country, or a
 * domain category such as "category-ads"). reverse_match lists are skipped for
 * "which country is this address" because they mean every address except the
 * listed ones.
 */

export interface Cidr {
  ip: Uint8Array;
  prefix: number;
}

export interface GeoIpEntry {
  code: string;
  cidrs: Cidr[];
  reverse: boolean;
}

export interface GeoIpList {
  entries: GeoIpEntry[];
}

export type DomainMatch = "plain" | "regex" | "domain" | "full";

export interface GeoDomain {
  type: DomainMatch;
  value: string;
}

export interface GeoSiteEntry {
  code: string;
  domains: GeoDomain[];
}

export interface GeoSiteList {
  entries: GeoSiteEntry[];
}

const text = new TextDecoder("utf-8", { fatal: true });

function fail(message: string): never {
  throw new Error(message);
}

function readVarint(buf: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 10; i++) {
    if (offset >= buf.length) fail("Truncated varint in geo dataset.");
    const byte = buf[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) fail("Varint in geo dataset is too large.");
      return { value, offset };
    }
    shift += 7;
  }
  fail("Varint in geo dataset is too long.");
}

/** Walk one protobuf message. Unknown fields are skipped so a new optional field does not break the reader. */
function readMessage(buf: Uint8Array, onField: (field: number, wire: number, value: number | Uint8Array) => void) {
  let offset = 0;
  while (offset < buf.length) {
    const tag = readVarint(buf, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wire = tag.value & 7;
    if (field === 0) fail("Invalid protobuf field in geo dataset.");
    if (wire === 0) {
      const v = readVarint(buf, offset);
      offset = v.offset;
      onField(field, wire, v.value);
    } else if (wire === 2) {
      const len = readVarint(buf, offset);
      offset = len.offset;
      const next = offset + len.value;
      if (len.value < 0 || next > buf.length) fail("Truncated length-delimited field in geo dataset.");
      onField(field, wire, buf.subarray(offset, next));
      offset = next;
    } else if (wire === 5) {
      if (offset + 4 > buf.length) fail("Truncated 32-bit field in geo dataset.");
      offset += 4;
    } else if (wire === 1) {
      if (offset + 8 > buf.length) fail("Truncated 64-bit field in geo dataset.");
      offset += 8;
    } else {
      fail(`Unsupported protobuf wire type ${wire} in geo dataset.`);
    }
  }
}

function asBytes(value: number | Uint8Array): Uint8Array {
  if (typeof value === "number") fail("Expected a length-delimited field in geo dataset.");
  return value;
}

function decode(value: number | Uint8Array): string {
  try {
    return text.decode(asBytes(value));
  } catch {
    fail("Geo dataset string is not valid UTF-8.");
  }
}

const DOMAIN_TYPES: DomainMatch[] = ["plain", "regex", "domain", "full"];

function parseCidr(buf: Uint8Array): Cidr | null {
  let ip: Uint8Array | null = null;
  let prefix: number | null = null;
  readMessage(buf, (field, wire, value) => {
    if (field === 1 && wire === 2) ip = Uint8Array.from(asBytes(value));
    else if (field === 2 && wire === 0 && typeof value === "number") prefix = value;
  });
  if (!ip || (ip.length !== 4 && ip.length !== 16)) return null;
  const bits = ip.length * 8;
  const size = prefix ?? bits;
  if (size < 0 || size > bits) return null;
  return { ip, prefix: size };
}

function parseGeoIp(buf: Uint8Array): GeoIpEntry | null {
  let code = "";
  const cidrs: Cidr[] = [];
  let reverse = false;
  readMessage(buf, (field, wire, value) => {
    if (field === 1 && wire === 2) code = decode(value);
    else if (field === 2 && wire === 2) {
      const cidr = parseCidr(asBytes(value));
      if (cidr) cidrs.push(cidr);
    } else if (field === 3 && wire === 0 && typeof value === "number") reverse = value !== 0;
  });
  if (!code) return null;
  return { code, cidrs, reverse };
}

/** Decode a GeoIPList. Throws if the bytes are not a complete protobuf message. */
export function parseGeoIpList(buf: Uint8Array): GeoIpList {
  const entries: GeoIpEntry[] = [];
  readMessage(buf, (field, wire, value) => {
    if (field === 1 && wire === 2) {
      const entry = parseGeoIp(asBytes(value));
      if (entry) entries.push(entry);
    }
  });
  return { entries };
}

function parseDomainChecked(buf: Uint8Array): GeoDomain | null {
  // Proto3 omits the default enum. Plain is 0, so a missing type is a keyword rule.
  let kind: number | null = null;
  let value = "";
  readMessage(buf, (field, wire, raw) => {
    if (field === 1 && wire === 0 && typeof raw === "number") kind = raw;
    else if (field === 2 && wire === 2) value = decode(raw);
  });
  if (!value) return null;
  if (kind !== null && (kind < 0 || kind > 3)) return null;
  const type = DOMAIN_TYPES[kind ?? 0];
  return { type, value: value.toLowerCase() };
}

function parseGeoSite(buf: Uint8Array): GeoSiteEntry | null {
  let code = "";
  const domains: GeoDomain[] = [];
  readMessage(buf, (field, wire, value) => {
    if (field === 1 && wire === 2) code = decode(value);
    else if (field === 2 && wire === 2) {
      const domain = parseDomainChecked(asBytes(value));
      if (domain) domains.push(domain);
    }
  });
  if (!code) return null;
  return { code, domains };
}

/** Decode a GeoSiteList. Throws if the bytes are not a complete protobuf message. */
export function parseGeoSiteList(buf: Uint8Array): GeoSiteList {
  const entries: GeoSiteEntry[] = [];
  readMessage(buf, (field, wire, value) => {
    if (field === 1 && wire === 2) {
      const entry = parseGeoSite(asBytes(value));
      if (entry) entries.push(entry);
    }
  });
  return { entries };
}

/** IPv4 or IPv6 text to network-order bytes. Null when the text is not an address. */
export function parseIp(input: string): Uint8Array | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) return null;
    s = s.slice(1, -1);
  }
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (s.includes(":")) return parseV6(s);
  return parseV4(s);
}

function parseV4(s: string): Uint8Array | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    if (parts[i].length > 1 && parts[i].startsWith("0")) return null;
    const n = Number(parts[i]);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

function parseV6(s: string): Uint8Array | null {
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const side = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const v4 = parseV4(piece);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
        groups.push(Number.parseInt(piece, 16));
      }
    }
    return groups;
  };
  const left = side(halves[0]);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? groupsToBytes(left) : null;
  const right = side(halves[1]);
  if (!right || left.length + right.length >= 8) return null;
  const groups = [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
  return groupsToBytes(groups);
}

function groupsToBytes(groups: number[]): Uint8Array {
  const out = new Uint8Array(16);
  groups.forEach((group, i) => {
    out[i * 2] = (group >> 8) & 0xff;
    out[i * 2 + 1] = group & 0xff;
  });
  return out;
}

/** Hostname only: lower case, no trailing dot, no scheme. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s || s.length > 253) return null;
  if (s.includes("://")) {
    try {
      s = new URL(s).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  if (s.endsWith(".")) s = s.slice(0, -1);
  if (!s || s.length > 253 || !/^[a-z0-9._-]+$/.test(s)) return null;
  return s;
}

interface V4Rule {
  network: number;
  prefix: number;
  code: string;
}

interface V6Rule {
  network: Uint8Array;
  prefix: number;
  code: string;
}

interface IpIndex {
  v4: Map<number, V4Rule[]>;
  v4Wide: V4Rule[];
  v6: Map<number, V6Rule[]>;
  v6Wide: V6Rule[];
}

const ipIndexes = new WeakMap<GeoIpList, IpIndex>();

function v4mask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function v4int(ip: Uint8Array): number {
  return (((ip[0] << 24) >>> 0) + (ip[1] << 16) + (ip[2] << 8) + ip[3]) >>> 0;
}

function indexGeoIp(list: GeoIpList): IpIndex {
  const cached = ipIndexes.get(list);
  if (cached) return cached;
  const index: IpIndex = { v4: new Map(), v4Wide: [], v6: new Map(), v6Wide: [] };
  for (const entry of list.entries) {
    if (entry.reverse) continue;
    for (const cidr of entry.cidrs) {
      if (cidr.ip.length === 4) {
        const mask = v4mask(cidr.prefix);
        const rule: V4Rule = { network: (v4int(cidr.ip) & mask) >>> 0, prefix: cidr.prefix, code: entry.code };
        if (cidr.prefix >= 8) {
          const bucket = rule.network >>> 24;
          const listFor = index.v4.get(bucket);
          if (listFor) listFor.push(rule);
          else index.v4.set(bucket, [rule]);
        } else index.v4Wide.push(rule);
      } else if (cidr.ip.length === 16) {
        const rule: V6Rule = { network: cidr.ip, prefix: cidr.prefix, code: entry.code };
        if (cidr.prefix >= 8) {
          const bucket = cidr.ip[0];
          const listFor = index.v6.get(bucket);
          if (listFor) listFor.push(rule);
          else index.v6.set(bucket, [rule]);
        } else index.v6Wide.push(rule);
      }
    }
  }
  ipIndexes.set(list, index);
  return index;
}

function v4hit(ip: number, rule: V4Rule): boolean {
  return ((ip & v4mask(rule.prefix)) >>> 0) === rule.network;
}

function v6hit(ip: Uint8Array, rule: V6Rule): boolean {
  const full = Math.floor(rule.prefix / 8);
  for (let i = 0; i < full; i++) if (ip[i] !== rule.network[i]) return false;
  const rem = rule.prefix % 8;
  if (rem === 0) return true;
  const mask = (0xff << (8 - rem)) & 0xff;
  return (ip[full] & mask) === (rule.network[full] & mask);
}

function longest<T extends { prefix: number; code: string }>(rules: T[], hit: (rule: T) => boolean): { code: string; prefix: number } | null {
  let best: T | null = null;
  for (const rule of rules) {
    if (!hit(rule)) continue;
    if (!best || rule.prefix > best.prefix) best = rule;
  }
  return best ? { code: best.code, prefix: best.prefix } : null;
}

function prefer(wide: { code: string; prefix: number } | null, narrow: { code: string; prefix: number } | null): string | null {
  if (!wide) return narrow?.code ?? null;
  if (!narrow) return wide.code;
  return narrow.prefix >= wide.prefix ? narrow.code : wide.code;
}

/** Country (or list) code for an IP, or null when no positive prefix matches. Longest prefix wins. */
export function lookupCountry(list: GeoIpList, ip: string): string | null {
  const bytes = parseIp(ip);
  if (!bytes) return null;
  const index = indexGeoIp(list);
  if (bytes.length === 4) {
    const n = v4int(bytes);
    const bucket = index.v4.get(bytes[0]) ?? [];
    return prefer(longest(index.v4Wide, (rule) => v4hit(n, rule)), longest(bucket, (rule) => v4hit(n, rule)));
  }
  const bucket = index.v6.get(bytes[0]) ?? [];
  return prefer(longest(index.v6Wide, (rule) => v6hit(bytes, rule)), longest(bucket, (rule) => v6hit(bytes, rule)));
}

interface SiteIndex {
  full: Map<string, string[]>;
  domain: Map<string, string[]>;
  plain: { value: string; code: string }[];
  regex: { value: RegExp; code: string }[];
}

const siteIndexes = new WeakMap<GeoSiteList, SiteIndex>();

function addCode(map: Map<string, string[]>, key: string, code: string) {
  const cur = map.get(key);
  if (!cur) map.set(key, [code]);
  else if (!cur.includes(code)) cur.push(code);
}

function indexGeoSite(list: GeoSiteList): SiteIndex {
  const cached = siteIndexes.get(list);
  if (cached) return cached;
  const index: SiteIndex = { full: new Map(), domain: new Map(), plain: [], regex: [] };
  for (const entry of list.entries) {
    for (const domain of entry.domains) {
      if (!domain.value) continue;
      if (domain.type === "full") addCode(index.full, domain.value, entry.code);
      else if (domain.type === "domain") addCode(index.domain, domain.value, entry.code);
      else if (domain.type === "plain") index.plain.push({ value: domain.value, code: entry.code });
      else {
        try {
          index.regex.push({ value: new RegExp(domain.value), code: entry.code });
        } catch {
          // A bad pattern in a fixture does not match anything.
        }
      }
    }
  }
  siteIndexes.set(list, index);
  return index;
}

/**
 * Category list names that contain this domain.
 * full: exact host. domain: the name and its subdomains. plain: substring. regex: the pattern.
 */
export function lookupCategories(list: GeoSiteList, domain: string): string[] {
  const name = normalizeDomain(domain);
  if (!name) return [];
  const index = indexGeoSite(list);
  const found = new Set<string>();
  for (const code of index.full.get(name) ?? []) found.add(code);
  let part = name;
  for (;;) {
    for (const code of index.domain.get(part) ?? []) found.add(code);
    const dot = part.indexOf(".");
    if (dot < 0) break;
    part = part.slice(dot + 1);
  }
  for (const rule of index.plain) if (name.includes(rule.value)) found.add(rule.code);
  for (const rule of index.regex) if (rule.value.test(name)) found.add(rule.code);
  return [...found].sort((a, b) => a.localeCompare(b));
}
