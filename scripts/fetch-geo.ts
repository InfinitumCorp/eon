/**
 * Download the pinned v2fly geoip.dat and geosite.dat (dlc.dat) files.
 *
 * Checksums are compared to data/geo.lock.json and to the official .sha256sum
 * asset. A mismatch deletes nothing already verified and writes no new file.
 * The datasets land in data/geo/, which is gitignored. Loyalsoldier and
 * sing-box builds are rejected: only the two v2fly release URLs are allowed.
 *
 * Run: npm run geo:fetch
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 64 * 1024 * 1024;

const SPEC = {
  geoip: { filename: "geoip.dat", asset: "geoip.dat", license: "CC-BY-SA-4.0", repo: "v2fly/geoip" },
  geosite: { filename: "geosite.dat", asset: "dlc.dat", license: "MIT", repo: "v2fly/domain-list-community" },
} as const;

export type DatasetId = keyof typeof SPEC;

export interface GeoLockEntry {
  id: DatasetId;
  tag: string;
  asset: string;
  filename: string;
  url: string;
  sha256sumUrl: string;
  sha256: string;
  license: string;
}

export interface GeoLock {
  version: 1;
  datasets: GeoLockEntry[];
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Refuse any URL that is not an https v2fly geoip or domain-list-community release asset. */
export function assertV2flyReleaseUrl(url: string, entry: { id: DatasetId; tag: string; asset: string }, kind: "asset" | "sha256sum"): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${entry.id}: ${kind} URL is not a URL`);
  }
  const spec = SPEC[entry.id];
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`${entry.id}: ${kind} URL must be https with no credentials`);
  if (parsed.hostname !== "github.com") throw new Error(`${entry.id}: ${kind} URL must be a github.com v2fly release`);
  const expected = `/${spec.repo}/releases/download/${entry.tag}/${kind === "asset" ? spec.asset : `${spec.asset}.sha256sum`}`;
  if (parsed.pathname !== expected) throw new Error(`${entry.id}: ${kind} URL is not ${expected}`);
}

export function readLock(json: unknown): GeoLock {
  if (!isRecord(json) || json.version !== 1 || !Array.isArray(json.datasets)) throw new Error("geo lockfile must be version 1 with a datasets array");
  if (json.datasets.length !== 2) throw new Error("geo lockfile must list geoip and geosite");
  const datasets = json.datasets.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`geo lockfile dataset ${index} is not an object`);
    const id = raw.id;
    if (id !== "geoip" && id !== "geosite") throw new Error(`geo lockfile dataset ${index} is not geoip or geosite`);
    const spec = SPEC[id];
    const tag = raw.tag;
    const sha = raw.sha256;
    const url = raw.url;
    const sha256sumUrl = raw.sha256sumUrl;
    if (typeof tag !== "string" || !/^[0-9]{8,20}$/.test(tag)) throw new Error(`${id}: release tag is missing`);
    if (typeof sha !== "string" || !/^[0-9a-fA-F]{64}$/.test(sha)) throw new Error(`${id}: lockfile sha256 must be 64 hex characters`);
    if (raw.asset !== spec.asset || raw.filename !== spec.filename) throw new Error(`${id}: asset must be ${spec.asset} saved as ${spec.filename}`);
    if (raw.license !== spec.license) throw new Error(`${id}: license must be ${spec.license}`);
    if (typeof url !== "string" || typeof sha256sumUrl !== "string") throw new Error(`${id}: url and sha256sumUrl are required`);
    const entry: GeoLockEntry = { id, tag, asset: spec.asset, filename: spec.filename, url, sha256sumUrl, sha256: sha.toLowerCase(), license: spec.license };
    assertV2flyReleaseUrl(entry.url, entry, "asset");
    assertV2flyReleaseUrl(entry.sha256sumUrl, entry, "sha256sum");
    return entry;
  });
  if (datasets[0].id !== "geoip" || datasets[1].id !== "geosite") throw new Error("geo lockfile order is geoip then geosite");
  return { version: 1, datasets };
}

/** Parse an official `sha256sum` asset. The filename, when present, must be the release asset. */
export function parseSha256Sum(text: string, asset: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) throw new Error(`official sha256sum for ${asset} should be one line`);
  const match = /^([0-9a-fA-F]{64})(?:\s+\*?(\S+))?$/.exec(lines[0]);
  if (!match) throw new Error(`official sha256sum for ${asset} is not a SHA-256 line`);
  if (match[2] && match[2] !== asset) throw new Error(`official sha256sum names ${match[2]}, expected ${asset}`);
  return match[1].toLowerCase();
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(url: string, fetcher: Fetcher): Promise<Uint8Array> {
  const response = await fetcher(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed ${response.status} for ${url}`);
  if (response.url && !response.url.startsWith("https:")) throw new Error(`refusing a non-https response for ${url}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error(`download exceeds ${MAX_BYTES} bytes for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error(`download exceeds ${MAX_BYTES} bytes for ${url}`);
  return bytes;
}

/**
 * Download every locked dataset into destDir. Throws on the first checksum
 * mismatch and does not write that file. Earlier datasets that already
 * matched stay as they were written.
 */
export async function fetchDatasets(lock: GeoLock, destDir: string, fetcher: Fetcher = fetch, log: (line: string) => void = console.log): Promise<void> {
  await mkdir(destDir, { recursive: true });
  for (const entry of lock.datasets) {
    const official = parseSha256Sum(new TextDecoder().decode(await download(entry.sha256sumUrl, fetcher)), entry.asset);
    if (official !== entry.sha256) {
      throw new Error(`${entry.id}: official ${entry.asset}.sha256sum ${official} does not match lockfile ${entry.sha256}`);
    }
    const bytes = await download(entry.url, fetcher);
    const actual = sha256(bytes);
    if (actual !== entry.sha256) {
      throw new Error(`${entry.id}: downloaded ${entry.asset} sha256 ${actual} does not match lockfile ${entry.sha256}`);
    }
    const dest = path.resolve(destDir, entry.filename);
    if (path.dirname(dest) !== path.resolve(destDir)) throw new Error(`${entry.id}: refusing to write outside the data directory`);
    await writeFile(dest, bytes);
    log(`${entry.id}: wrote ${entry.filename} (${bytes.byteLength} bytes) sha256 ${actual} tag ${entry.tag}`);
  }
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const lock = readLock(JSON.parse(await readFile(path.join(root, "data", "geo.lock.json"), "utf8")));
  await fetchDatasets(lock, path.join(root, "data", "geo"));
}

const entry = process.argv[1];
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
