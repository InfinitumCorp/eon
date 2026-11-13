import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { geoDataDir } from "../src/lib/eon/geo-settings.ts";
import { repoRoot } from "../src/lib/eon/root.ts";

/**
 * Download the pinned v2fly geoip.dat and geosite.dat (the dlc.dat asset)
 * into data/geo. The directory is gitignored. Each file is checked against
 * the official .sha256sum asset and the hash in geo/geo.lock.json.
 * A mismatch deletes the partial download and stops.
 */

export class ChecksumMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChecksumMismatch";
  }
}

export interface GeoDatasetPin {
  id: "geoip" | "geosite";
  file: string;
  asset: string;
  project: string;
  tag: string;
  url: string;
  sha256Url: string;
  sha256: string;
  license: string;
}

export interface GeoLock {
  source: "v2fly";
  datasets: GeoDatasetPin[];
}

const EXPECTED: Record<GeoDatasetPin["id"], { file: string; asset: string; project: string; license: string }> = {
  geoip: { file: "geoip.dat", asset: "geoip.dat", project: "v2fly/geoip", license: "CC-BY-SA-4.0" },
  geosite: { file: "geosite.dat", asset: "dlc.dat", project: "v2fly/domain-list-community", license: "MIT" },
};

const BANNED = /loyalsoldier|sing-box|singbox|sagernet|gpl-3|gplv3/i;

export function parseSha256Sum(text: string, asset: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const named = /^([0-9a-fA-F]{64})\s+\*?(\S+)$/.exec(trimmed);
    if (named && named[2] === asset) return named[1].toLowerCase();
  }
  const only = /^([0-9a-fA-F]{64})$/.exec(text.trim());
  if (only) return only[1].toLowerCase();
  throw new ChecksumMismatch(`Official checksum file has no SHA-256 line for ${asset}.`);
}

export function parseGeoLock(text: string): GeoLock {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("geo/geo.lock.json is not valid JSON.");
  }
  if (!raw || typeof raw !== "object" || (raw as { source?: unknown }).source !== "v2fly" || !Array.isArray((raw as { datasets?: unknown }).datasets)) {
    throw new Error("geo/geo.lock.json must pin v2fly datasets.");
  }
  const datasets = (raw as { datasets: unknown[] }).datasets.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Each geo lock entry must be an object.");
    const pin = item as GeoDatasetPin;
    if (BANNED.test(JSON.stringify(pin))) throw new Error("Refusing a geo dataset outside the pinned v2fly releases.");
    const expect = EXPECTED[pin.id];
    if (!expect) throw new Error(`Unknown geo dataset id ${String(pin.id)}. Only geoip and geosite are pinned.`);
    if (pin.file !== expect.file || pin.asset !== expect.asset || pin.project !== expect.project || pin.license !== expect.license) {
      throw new Error(`Geo dataset ${pin.id} does not match the pinned v2fly file, asset, project or license.`);
    }
    if (!/^https:\/\/github\.com\/v2fly\/[A-Za-z0-9._/-]+$/.test(pin.url) || !pin.url.endsWith(`/${pin.asset}`)) {
      throw new Error(`Geo dataset ${pin.id} URL must be the v2fly GitHub release asset ${pin.asset}.`);
    }
    if (!/^https:\/\/github\.com\/v2fly\/[A-Za-z0-9._/-]+$/.test(pin.sha256Url) || !pin.sha256Url.endsWith(`/${pin.asset}.sha256sum`)) {
      throw new Error(`Geo dataset ${pin.id} must cite the official ${pin.asset}.sha256sum asset.`);
    }
    if (!/^[0-9a-f]{64}$/.test(pin.sha256)) throw new Error(`Geo dataset ${pin.id} SHA-256 is not 64 hex characters.`);
    if (!/^\d{12,}$/.test(pin.tag) || !pin.url.includes(`/download/${pin.tag}/`) || !pin.sha256Url.includes(`/download/${pin.tag}/`)) {
      throw new Error(`Geo dataset ${pin.id} tag is not the release named in its URLs.`);
    }
    return pin;
  });
  const ids = datasets.map((d) => d.id).sort().join(",");
  if (ids !== "geoip,geosite") throw new Error("geo/geo.lock.json must pin exactly geoip and geosite.");
  return { source: "v2fly", datasets };
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

async function getText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed for ${url}: HTTP ${response.status}.`);
  return response.text();
}

async function download(url: string, file: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed for ${url}: HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(file, bytes);
}

export async function fetchGeoDatasets(options: {
  lock: GeoLock;
  destDir: string;
  fetchImpl?: typeof fetch;
}): Promise<{ file: string; sha256: string }[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  await mkdir(options.destDir, { recursive: true });
  const saved: { file: string; sha256: string }[] = [];
  for (const pin of options.lock.datasets) {
    const officialText = await getText(pin.sha256Url, fetchImpl);
    const official = parseSha256Sum(officialText, pin.asset);
    if (official !== pin.sha256) {
      throw new ChecksumMismatch(
        `Official ${pin.asset}.sha256sum does not match geo/geo.lock.json for ${pin.id}: official ${official}, lock ${pin.sha256}.`,
      );
    }
    const partial = path.join(options.destDir, `${pin.file}.partial`);
    const dest = path.join(options.destDir, pin.file);
    try {
      await download(pin.url, partial, fetchImpl);
      const actual = await sha256File(partial);
      if (actual !== official) {
        throw new ChecksumMismatch(`Checksum mismatch for ${pin.file}: downloaded ${actual}, official ${official}.`);
      }
      await rename(partial, dest);
    } catch (error) {
      await unlink(partial).catch(() => undefined);
      throw error;
    }
    saved.push({ file: dest, sha256: official });
  }
  return saved;
}

async function main() {
  const lock = parseGeoLock(await readFile(path.join(repoRoot(), "geo", "geo.lock.json"), "utf8"));
  const saved = await fetchGeoDatasets({ lock, destDir: geoDataDir() });
  for (const file of saved) console.log(`${file.sha256}  ${file.file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
