import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import worker from "../../worker.ts";
import { fetchDatasets, parseSha256Sum, readLock, sha256, type Fetcher } from "../../../scripts/fetch-geo.ts";
import { annotate, encodeGeoIpList, encodeGeoSiteList, loadGeoData, type EncodedGeoIp, type EncodedGeoSite } from "./geo.ts";
import { geoEnabled, observeRequest, resetGeoCache } from "./geo-hook.ts";

/**
 * Tiny synthetic GeoIPList / GeoSiteList fixtures. These are not the v2fly
 * datasets; those are downloaded by scripts/fetch-geo.ts and are not committed.
 */
const fixtureDir = fileURLToPath(new URL("./fixtures/", import.meta.url));
const lockPath = fileURLToPath(new URL("../../../data/geo.lock.json", import.meta.url));

const GEOIP_SHA = "eedb24b3b9fcba27e06b92c0428dab90d9496083091ae4cf39e11387fd99d0e2";
const GEOSITE_SHA = "dc4192dd1b644a38276ed06136d26e729fa674d25785adb38c87e040e92376b2";

const FIXTURE_IP: EncodedGeoIp[] = [
  {
    country: "US",
    cidrs: [
      { ip: "1.2.3.0", prefix: 24 },
      { ip: "8.8.8.8", prefix: 32 },
      { ip: "10.1.2.0", prefix: 24 },
      { ip: "2001:db8:1::", prefix: 48 },
    ],
  },
  { country: "CN", cidrs: [{ ip: "10.0.0.0", prefix: 8 }] },
  { country: "PRIVATE", cidrs: [{ ip: "192.168.0.0", prefix: 16 }] },
  { country: "EX", inverse: true, cidrs: [{ ip: "203.0.113.0", prefix: 24 }] },
];

const FIXTURE_SITE: EncodedGeoSite[] = [
  { category: "google", domains: [{ type: "domain", value: "google.com" }, { type: "full", value: "mail.google.com" }] },
  { category: "category-ads", domains: [{ type: "plain", value: "doubleclick" }] },
  {
    category: "cn",
    domains: [
      { type: "domain", value: "baidu.com" },
      { type: "regex", value: "^foo-[0-9]+\\.example$" },
    ],
  },
  { category: "example", domains: [{ type: "domain", value: "example.com" }] },
  { category: "exact", domains: [{ type: "full", value: "exact.test" }, { type: "full", value: "www.example.com" }] },
  { category: "attr", domains: [{ type: "domain", value: "attributed.test", attrs: [{ key: "cn", bool: true }] }] },
];

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

test("protobuf round-trip matches a hand-built GeoIPList and GeoSiteList", () => {
  const ip = encodeGeoIpList([{ country: "US", cidrs: [{ ip: "1.2.3.0", prefix: 24 }] }]);
  assert.equal(hex(ip), "0a0e0a02555312080a04010203001018");
  const site = encodeGeoSiteList([{ category: "ex", domains: [{ type: "domain", value: "example.com" }] }]);
  assert.equal(hex(site), "0a150a026578120f0802120b6578616d706c652e636f6d");
  const loaded = loadGeoData(ip, site);
  assert.equal(loaded.countryOf("1.2.3.4"), "US");
  assert.equal(loaded.countryOf("1.2.4.1"), null);
  assert.deepEqual(loaded.categoriesOf("www.example.com"), ["ex"]);
  assert.deepEqual(loaded.categoriesOf("notexample.com"), []);
});

test("unknown protobuf fields are skipped and a short buffer is refused", () => {
  const ip = encodeGeoIpList([{ country: "US", cidrs: [{ ip: "1.2.3.0", prefix: 24 }] }]);
  const withUnknown = Buffer.concat([Buffer.from([0x10, 0x01]), ip]);
  assert.equal(loadGeoData(withUnknown, encodeGeoSiteList([])).countryOf("1.2.3.9"), "US");
  assert.throws(() => loadGeoData(Uint8Array.of(0x0a), encodeGeoSiteList([])), /truncated/);
});

test("synthetic fixtures resolve country by longest prefix and domain by category", async () => {
  const geoip = await readFile(path.join(fixtureDir, "geoip.dat"));
  const geosite = await readFile(path.join(fixtureDir, "geosite.dat"));
  assert.ok(geoip.byteLength < 2048 && geosite.byteLength < 2048, "fixtures stay synthetic");
  assert.deepEqual(geoip, Buffer.from(encodeGeoIpList(FIXTURE_IP)));
  assert.deepEqual(geosite, Buffer.from(encodeGeoSiteList(FIXTURE_SITE)));
  const data = loadGeoData(geoip, geosite);

  assert.equal(data.countryOf("1.2.3.4"), "US");
  assert.equal(data.countryOf("8.8.8.8"), "US");
  assert.equal(data.countryOf("10.1.2.3"), "US");
  assert.equal(data.countryOf("10.9.9.9"), "CN");
  assert.equal(data.countryOf("192.168.1.1"), "PRIVATE");
  assert.equal(data.countryOf("203.0.113.9"), null);
  assert.equal(data.countryOf("198.51.100.1"), "EX");
  assert.equal(data.countryOf("1.2.4.1"), "EX");
  assert.equal(data.countryOf("2001:db8:1::1"), "US");
  assert.equal(data.countryOf("2001:db8:2::1"), null);
  assert.equal(data.countryOf("::ffff:1.2.3.4"), "US");
  assert.equal(data.countryOf("not-an-ip"), null);
  assert.equal(data.countryOf("01.2.3.4"), null);

  assert.deepEqual(data.categoriesOf("www.google.com"), ["google"]);
  assert.deepEqual(data.categoriesOf("GOOGLE.COM"), ["google"]);
  assert.deepEqual(data.categoriesOf("mail.google.com"), ["google"]);
  assert.deepEqual(data.categoriesOf("notgoogle.com"), []);
  assert.deepEqual(data.categoriesOf("ads.doubleclick.net"), ["category-ads"]);
  assert.deepEqual(data.categoriesOf("www.baidu.com"), ["cn"]);
  assert.deepEqual(data.categoriesOf("foo-12.example"), ["cn"]);
  assert.deepEqual(data.categoriesOf("foo-x.example"), []);
  assert.deepEqual(data.categoriesOf("www.example.com"), ["example", "exact"]);
  assert.deepEqual(data.categoriesOf("exact.test"), ["exact"]);
  assert.deepEqual(data.categoriesOf("www.exact.test"), []);
  assert.deepEqual(data.categoriesOf("sub.attributed.test"), ["attr"]);
  assert.deepEqual(data.categoriesOf("1.2.3.4"), []);

  const note = annotate(data, { ip: " 10.9.9.9 ", domain: "WWW.BAIDU.COM." });
  assert.deepEqual(note, { ip: "10.9.9.9", country: "CN", domain: "www.baidu.com", categories: ["cn"], policy: "observe" });
});

test("the geo flag defaults off", () => {
  assert.equal(geoEnabled(undefined), false);
  assert.equal(geoEnabled(""), false);
  assert.equal(geoEnabled("0"), false);
  assert.equal(geoEnabled("false"), false);
  assert.equal(geoEnabled(" yes "), true);
  assert.equal(geoEnabled("ON"), true);
});

test("a disabled hook does not read datasets or change the response", async () => {
  resetGeoCache();
  const logs: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const off = await worker.fetch(new Request("http://exact.test/no-such-geo"));
    const offBody = await off.text();
    assert.equal(off.status, 404);
    assert.equal(logs.length, 0);
    assert.equal(await observeRequest(new Request("http://exact.test/no-such-geo"), { INFINITUM_GEO_DIR: "/this/path/is/not/created" }), null);

    const on = await worker.fetch(new Request("http://exact.test/no-such-geo", { headers: { "cf-connecting-ip": "1.2.3.4" } }), {
      INFINITUM_GEO_ENABLED: "1",
      INFINITUM_GEO_DIR: fixtureDir,
    });
    const onBody = await on.text();
    assert.equal(on.status, off.status);
    assert.equal(onBody, offBody);
    assert.equal(on.headers.get("content-type"), off.headers.get("content-type"));
    const line = JSON.parse(logs.at(-1) ?? "{}");
    assert.equal(line.ok, true);
    assert.equal(line.policy, "observe");
    assert.equal(line.country, "US");
    assert.equal(line.domain, "exact.test");
    assert.deepEqual(line.categories, ["exact"]);
  } finally {
    console.info = original;
    resetGeoCache();
  }
});

test("an enabled hook without datasets still returns the same response", async () => {
  resetGeoCache();
  const logs: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const response = await worker.fetch(new Request("http://exact.test/no-such-geo"), {
      INFINITUM_GEO_ENABLED: "true",
      INFINITUM_GEO_DIR: path.join(fixtureDir, "missing"),
    });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found.");
    const line = JSON.parse(logs.at(-1) ?? "{}");
    assert.equal(line.ok, false);
    assert.equal(line.policy, "observe");
    assert.match(line.error, /data directory/);
  } finally {
    console.info = original;
    resetGeoCache();
  }
});

test("lockfile pins the v2fly releases and no other publisher", async () => {
  const raw = JSON.parse(await readFile(lockPath, "utf8"));
  const lock = readLock(raw);
  assert.deepEqual(
    lock.datasets.map((entry) => entry.url),
    [
      "https://github.com/v2fly/geoip/releases/download/202611080027/geoip.dat",
      "https://github.com/v2fly/domain-list-community/releases/download/20261108011013/dlc.dat",
    ],
  );
  assert.deepEqual(
    lock.datasets.map((entry) => [entry.id, entry.tag, entry.asset, entry.filename, entry.sha256, entry.license]),
    [
      ["geoip", "202611080027", "geoip.dat", "geoip.dat", GEOIP_SHA, "CC-BY-SA-4.0"],
      ["geosite", "20261108011013", "dlc.dat", "geosite.dat", GEOSITE_SHA, "MIT"],
    ],
  );
  assert.equal(parseSha256Sum(`${GEOIP_SHA}  geoip.dat\n`, "geoip.dat"), GEOIP_SHA);
  assert.equal(parseSha256Sum(`${GEOSITE_SHA}  dlc.dat\n`, "dlc.dat"), GEOSITE_SHA);
  assert.throws(() => parseSha256Sum(`${GEOIP_SHA}  other.dat\n`, "geoip.dat"), /expected geoip\.dat/);
  assert.throws(() => readLock({ ...raw, datasets: [{ ...raw.datasets[0], url: "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/download/202611080027/geoip.dat" }, raw.datasets[1]] }), /v2fly/);
  assert.throws(() => readLock({ ...raw, datasets: [raw.datasets[0], { ...raw.datasets[1], url: "https://github.com/SagerNet/sing-box/releases/download/20261108011013/dlc.dat" }] }), /v2fly/);
});

test("fetch writes nothing and stops when a checksum does not match", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "eon-geo-"));
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    if (url.endsWith("geoip.dat.sha256sum")) return new Response(`${"ab".repeat(32)}  geoip.dat\n`);
    throw new Error(`unexpected download ${url}`);
  };
  try {
    const lock = readLock(JSON.parse(await readFile(lockPath, "utf8")));
    await assert.rejects(fetchDatasets(lock, dir, fetcher, () => {}), /official geoip\.dat\.sha256sum .* does not match lockfile/);
    assert.equal(calls.length, 1);
    await assert.rejects(stat(path.join(dir, "geoip.dat")), /ENOENT/);
    await assert.rejects(stat(path.join(dir, "geosite.dat")), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fetch saves dlc.dat as geosite.dat only after both checksums match", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "eon-geo-"));
  const geoip = utf8("geoip-bytes");
  const geosite = utf8("geosite-bytes");
  const sums: Record<string, string> = {
    "https://github.com/v2fly/geoip/releases/download/202611080027/geoip.dat.sha256sum": `${sha256(geoip)}  geoip.dat\n`,
    "https://github.com/v2fly/domain-list-community/releases/download/20261108011013/dlc.dat.sha256sum": `${sha256(geosite)}  dlc.dat\n`,
  };
  const files: Record<string, Uint8Array> = {
    "https://github.com/v2fly/geoip/releases/download/202611080027/geoip.dat": geoip,
    "https://github.com/v2fly/domain-list-community/releases/download/20261108011013/dlc.dat": geosite,
  };
  const fetcher: Fetcher = async (url) => {
    if (sums[url]) return new Response(sums[url]);
    if (files[url]) return new Response(Buffer.from(files[url]));
    throw new Error(`unexpected download ${url}`);
  };
  const raw = JSON.parse(await readFile(lockPath, "utf8"));
  raw.datasets[0].sha256 = sha256(geoip);
  raw.datasets[1].sha256 = sha256(geosite);
  try {
    await fetchDatasets(readLock(raw), dir, fetcher, () => {});
    assert.deepEqual(await readFile(path.join(dir, "geoip.dat")), Buffer.from(geoip));
    assert.deepEqual(await readFile(path.join(dir, "geosite.dat")), Buffer.from(geosite));
    files["https://github.com/v2fly/geoip/releases/download/202611080027/geoip.dat"] = utf8("tampered");
    await assert.rejects(fetchDatasets(readLock(raw), dir, fetcher, () => {}), /downloaded geoip\.dat sha256 .* does not match lockfile/);
    assert.deepEqual(await readFile(path.join(dir, "geoip.dat")), Buffer.from(geoip));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
