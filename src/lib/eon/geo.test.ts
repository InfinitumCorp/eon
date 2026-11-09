import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ChecksumMismatch, fetchGeoDatasets, parseGeoLock, parseSha256Sum } from "../../../scripts/fetch-geo.ts";
import { Exercise, MemoryStore } from "./exercise.ts";
import { lookupCategories, lookupCountry, parseGeoIpList, parseGeoSiteList, parseIp, type GeoIpList, type GeoSiteList } from "./geo.ts";
import { DISABLED_GEO, geoRoutingFromEnv, geoRoutingFromLists, infinitumGeoEnabled, openGeoRouting } from "./geo-routing.ts";
import { readGeoSettings, resolveGeoRoutingFlag } from "./geo-settings.ts";
import { repoRoot } from "./root.ts";
import { Eon } from "./service.ts";

const enc = new TextEncoder();

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

function tag(field: number, wire: number): number[] {
  return varint((field << 3) | wire);
}

function bytesField(field: number, data: Uint8Array): number[] {
  return [...tag(field, 2), ...varint(data.length), ...data];
}

function strField(field: number, value: string): number[] {
  return bytesField(field, enc.encode(value));
}

function varField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}

function msg(field: number, inner: number[]): number[] {
  return bytesField(field, Uint8Array.from(inner));
}

function cidr(ip: number[], prefix: number): number[] {
  return [...bytesField(1, Uint8Array.from(ip)), ...varField(2, prefix)];
}

function geoip(code: string, ranges: { ip: number[]; prefix: number }[], reverse = false): number[] {
  return msg(1, [...strField(1, code), ...ranges.flatMap((r) => msg(2, cidr(r.ip, r.prefix))), ...(reverse ? varField(3, 1) : [])]);
}

function domain(type: number | null, value: string): number[] {
  return msg(2, [...(type === null ? [] : varField(1, type)), ...strField(2, value)]);
}

function site(code: string, domains: number[][]): number[] {
  return msg(1, [...strField(1, code), ...domains.flat()]);
}

function ipList(): GeoIpList {
  return parseGeoIpList(
    Uint8Array.from([
      ...geoip("private", [{ ip: [10, 0, 0, 0], prefix: 7 }]),
      ...geoip("us", [{ ip: [10, 1, 2, 0], prefix: 24 }, { ip: [8, 8, 8, 8], prefix: 32 }]),
      ...geoip("zz", [{ ip: [10, 9, 9, 0], prefix: 24 }], true),
      ...geoip("example", [{ ip: [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], prefix: 32 }]),
    ]),
  );
}

function siteList(): GeoSiteList {
  return parseGeoSiteList(
    Uint8Array.from([
      ...site("news", [domain(3, "a.example")]),
      ...site("example", [domain(2, "Example.com")]),
      ...site("ads", [domain(null, "tracker")]),
      ...site("rx", [domain(1, "^cdn\\.tracker\\.test$")]),
      ...site("bad", [domain(1, "("), domain(4, "skipped.example")]),
    ]),
  );
}

test("the lockfile pins the v2fly releases and no other dataset", async () => {
  const lock = parseGeoLock(await readFile(path.join(repoRoot(), "geo", "geo.lock.json"), "utf8"));
  assert.equal(lock.source, "v2fly");
  assert.deepEqual(
    lock.datasets.map((d) => [d.id, d.tag, d.asset, d.file, d.sha256]),
    [
      ["geoip", "202611080027", "geoip.dat", "geoip.dat", "eedb24b3b9fcba27e06b92c0428dab90d9496083091ae4cf39e11387fd99d0e2"],
      ["geosite", "20261108011013", "dlc.dat", "geosite.dat", "dc4192dd1b644a38276ed06136d26e729fa674d25785adb38c87e040e92376b2"],
    ],
  );
  assert.throws(() => parseGeoLock(JSON.stringify({ source: "v2fly", datasets: [{ id: "geoip", url: "https://github.com/Loyalsoldier/geoip/releases/download/x/geoip.dat" }] })), /v2fly/);
});

test("official checksum lines name the asset", () => {
  assert.equal(parseSha256Sum("eedb24b3b9fcba27e06b92c0428dab90d9496083091ae4cf39e11387fd99d0e2  geoip.dat\n", "geoip.dat"), "eedb24b3b9fcba27e06b92c0428dab90d9496083091ae4cf39e11387fd99d0e2");
  assert.equal(parseSha256Sum("DC4192DD1B644A38276ED06136D26E729FA674D25785ADB38C87E040E92376B2 *dlc.dat\n", "dlc.dat"), "dc4192dd1b644a38276ed06136d26e729fa674d25785adb38c87e040e92376b2");
  assert.throws(() => parseSha256Sum("abcd  other.dat\n", "geoip.dat"), ChecksumMismatch);
});

test("fetch writes the datasets only when the official sum and the bytes agree", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "eon-geo-"));
  const geoipBody = Buffer.from("geoip-bytes");
  const geositeBody = Buffer.from("geosite-bytes");
  const geoipSum = createHash("sha256").update(geoipBody).digest("hex");
  const geositeSum = createHash("sha256").update(geositeBody).digest("hex");
  const lock = parseGeoLock(
    JSON.stringify({
      source: "v2fly",
      datasets: [
        {
          id: "geoip",
          file: "geoip.dat",
          asset: "geoip.dat",
          project: "v2fly/geoip",
          tag: "202611080027",
          url: "https://github.com/v2fly/geoip/releases/download/202611080027/geoip.dat",
          sha256Url: "https://github.com/v2fly/geoip/releases/download/202611080027/geoip.dat.sha256sum",
          sha256: geoipSum,
          license: "CC-BY-SA-4.0",
        },
        {
          id: "geosite",
          file: "geosite.dat",
          asset: "dlc.dat",
          project: "v2fly/domain-list-community",
          tag: "20261108011013",
          url: "https://github.com/v2fly/domain-list-community/releases/download/20261108011013/dlc.dat",
          sha256Url: "https://github.com/v2fly/domain-list-community/releases/download/20261108011013/dlc.dat.sha256sum",
          sha256: geositeSum,
          license: "MIT",
        },
      ],
    }),
  );
  const files = new Map<string, Buffer>([
    [lock.datasets[0].sha256Url, Buffer.from(`${geoipSum}  geoip.dat\n`)],
    [lock.datasets[0].url, geoipBody],
    [lock.datasets[1].sha256Url, Buffer.from(`${geositeSum}  dlc.dat\n`)],
    [lock.datasets[1].url, geositeBody],
  ]);
  const fetchImpl = (async (url: string) => {
    const body = files.get(url);
    if (!body) return new Response("missing", { status: 404 });
    return new Response(body);
  }) as typeof fetch;
  const saved = await fetchGeoDatasets({ lock, destDir: dir, fetchImpl });
  assert.deepEqual(saved.map((s) => s.sha256), [geoipSum, geositeSum]);
  assert.equal(await readFile(path.join(dir, "geoip.dat"), "utf8"), "geoip-bytes");
  assert.equal(await readFile(path.join(dir, "geosite.dat"), "utf8"), "geosite-bytes");

  const drifted = { ...lock, datasets: lock.datasets.map((d, i) => (i === 0 ? { ...d, sha256: "ab".repeat(32) } : d)) };
  await assert.rejects(fetchGeoDatasets({ lock: drifted, destDir: dir, fetchImpl }), ChecksumMismatch);

  const corruptFetch = (async (url: string) => {
    if (url === lock.datasets[0].url) return new Response(Buffer.from("tampered"));
    const body = files.get(url);
    return new Response(body ?? "missing", { status: body ? 200 : 404 });
  }) as typeof fetch;
  await assert.rejects(fetchGeoDatasets({ lock, destDir: path.join(dir, "bad"), fetchImpl: corruptFetch }), /Checksum mismatch/);
  await assert.rejects(readFile(path.join(dir, "bad", "geoip.dat.partial")));
  await rm(dir, { recursive: true, force: true });
});

test("synthetic geoip fixtures resolve the longest positive prefix", () => {
  const list = ipList();
  assert.equal(lookupCountry(list, "10.1.2.9"), "us");
  assert.equal(lookupCountry(list, "10.2.0.1"), "private");
  assert.equal(lookupCountry(list, "11.1.1.1"), "private");
  assert.equal(lookupCountry(list, "8.8.8.8"), "us");
  assert.equal(lookupCountry(list, "10.9.9.9"), "private");
  assert.equal(lookupCountry(list, "9.9.9.9"), null);
  assert.equal(lookupCountry(list, "not-an-ip"), null);
  assert.equal(lookupCountry(list, "2001:db8::1"), "example");
  assert.equal(lookupCountry(list, "2001:db9::1"), null);
  assert.deepEqual(parseIp("::ffff:8.8.8.8")?.subarray(12), Uint8Array.from([8, 8, 8, 8]));
});

test("synthetic geosite fixtures map a domain to its categories", () => {
  const list = siteList();
  assert.deepEqual(lookupCategories(list, "a.example"), ["news"]);
  assert.deepEqual(lookupCategories(list, "b.a.example"), []);
  assert.deepEqual(lookupCategories(list, "WWW.Example.com."), ["example"]);
  assert.deepEqual(lookupCategories(list, "https://www.example.com/path"), ["example"]);
  assert.deepEqual(lookupCategories(list, "notexample.com"), []);
  assert.deepEqual(lookupCategories(list, "cdn.tracker.net"), ["ads"]);
  assert.deepEqual(lookupCategories(list, "cdn.tracker.test"), ["ads", "rx"]);
  assert.deepEqual(lookupCategories(list, "skipped.example"), []);
  assert.throws(() => parseGeoIpList(Uint8Array.of(0x80)), /Truncated varint/);
});

test("INFINITUM_GEO_ENABLED defaults off and only an explicit on passes", () => {
  for (const value of [undefined, "", "0", "false", "off", "no", "maybe"]) assert.equal(infinitumGeoEnabled(value), false);
  for (const value of ["1", "true", "TRUE", "on", "yes"]) assert.equal(infinitumGeoEnabled(value), true);
  assert.equal(geoRoutingFromEnv(undefined).enabled, false);
  assert.equal(geoRoutingFromEnv("false").policy({ domain: "cdn.tracker.net" }), null);
  assert.equal(DISABLED_GEO.annotate({ ip: "8.8.8.8" }), null);
  assert.equal(DISABLED_GEO.log({ domain: "example.com" }), null);
});

test("the saved geo-routing toggle defaults off and persists", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "eon-geo-settings-"));
  const file = path.join(dir, "settings.json");
  assert.deepEqual(await readGeoSettings(file), { geoRouting: false });
  assert.deepEqual(await resolveGeoRoutingFlag(["--geo-routing"], file), { geoRouting: true, persisted: true });
  assert.equal((await readGeoSettings(file)).geoRouting, true);
  assert.deepEqual(await resolveGeoRoutingFlag([], file), { geoRouting: true, persisted: false });
  assert.deepEqual(await resolveGeoRoutingFlag(["--no-geo-routing"], file), { geoRouting: false, persisted: true });
  await assert.rejects(resolveGeoRoutingFlag(["--geo-routing", "--no-geo-routing"], file), /either/);
  await rm(dir, { recursive: true, force: true });
});

test("a file-backed router reads the synthetic dat fixtures and stays quiet when they are missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "eon-geo-files-"));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(dir, "geoip.dat"), Uint8Array.from(geoip("us", [{ ip: [1, 2, 3, 0], prefix: 24 }])));
  await writeFile(path.join(dir, "geosite.dat"), Uint8Array.from(site("news", [domain(3, "quiet.example")])));
  const routing = openGeoRouting(dir, { refuseCategories: ["news"] });
  assert.equal(routing.enabled, true);
  assert.equal(routing.policy({}), null);
  assert.equal(routing.policy({ domain: "quiet.example" }), "Cyber geo routing refused quiet.example: category news.");
  assert.equal(routing.annotate({ ip: "1.2.3.4" })?.country, "us");
  const missing = openGeoRouting(path.join(dir, "absent"));
  assert.equal(missing.annotate({ ip: "1.2.3.4" }), null);
  assert.equal(missing.log({ domain: "quiet.example" }), null);
  await rm(dir, { recursive: true, force: true });
});

test("geo routing off leaves the ledger identical, including when a destination is supplied", async () => {
  const plain = await Eon.create(7);
  const off = await Eon.create(7, DISABLED_GEO);
  const on = await Eon.create(7, geoRoutingFromLists(ipList(), siteList(), { refuseCategories: ["ads"] }));
  for (let i = 0; i < 3; i++) {
    await plain.sweep("operator");
    await off.sweep("operator");
    await on.sweep("operator");
  }
  assert.equal(off.ledger.head, plain.ledger.head);
  assert.equal(on.ledger.head, plain.ledger.head, "no destination was supplied, so an enabled router changes nothing");

  const hinted = await Eon.create(7);
  const quiet = await Eon.create(7);
  await hinted.sweep("operator");
  await quiet.sweep("operator");
  const withHint = await hinted.engage("teamlead", "T915", "handoff", { ip: "8.8.8.8", domain: "cdn.tracker.net" });
  const without = await quiet.engage("teamlead", "T915", "handoff");
  assert.equal(withHint.error, without.error);
  assert.equal(hinted.ledger.head, quiet.ledger.head);
  assert.equal(JSON.stringify(hinted.ledger.entries.at(-1)?.payload).includes("geo"), false);
});

test("geo routing on annotates a destination and can refuse it", async () => {
  const routing = geoRoutingFromLists(ipList(), siteList(), { refuseCategories: ["ads"], refuseCountries: ["zz"] });
  const eon = await Eon.create(7, routing);
  for (let i = 0; i < 3; i++) await eon.sweep("operator");
  const refused = await eon.engage("teamlead", "T2440", "disrupt", { ip: "10.1.2.9", domain: "cdn.tracker.net" });
  assert.match(refused.error!, /Cyber geo routing refused cdn\.tracker\.net: category ads\./);
  const entry = eon.ledger.entries.findLast((e) => e.type === "engagement");
  assert.equal(entry?.payload.status, "refused");
  assert.deepEqual(entry?.payload.geo, {
    country: "us",
    categories: ["ads"],
    note: "cyber geo 10.1.2.9 cdn.tracker.net: country us, categories ads",
  });
  assert.equal(routing.log({ ip: "8.8.8.8" }), "cyber geo 8.8.8.8: country us, categories none");
});

test("replaying an engagement with a destination stays identical while geo routing is off", async () => {
  const left = new Exercise(new MemoryStore());
  const right = new Exercise(new MemoryStore());
  await left.act({ op: "sweep", role: "operator" });
  await right.act({ op: "sweep", role: "operator" });
  await left.act({ op: "engage", role: "teamlead", track: "T915", method: "handoff", domain: "cdn.tracker.net", ip: "8.8.8.8" });
  await right.act({ op: "engage", role: "teamlead", track: "T915", method: "handoff" });
  const [a, b] = await Promise.all([left.read((eon) => eon.ledger.head), right.read((eon) => eon.ledger.head)]);
  assert.equal(a, b);
});
