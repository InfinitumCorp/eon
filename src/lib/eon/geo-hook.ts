/**
 * Opt-in cyber annotation for an inbound request.
 *
 * INFINITUM_GEO_ENABLED defaults off. When it is off this module returns
 * without reading datasets and without logging, and the request is handled
 * exactly as before. When it is on, the connecting IP is labelled with a
 * country and the host with geosite categories. The policy is observe: the
 * annotation is written to the log and never allows or refuses the request.
 */
import { annotate, loadGeoData, normalizeDomain, parseIp, type GeoAnnotation, type GeoData } from "./geo.ts";

export interface GeoHookEnv {
  INFINITUM_GEO_ENABLED?: string;
  /** Directory that holds geoip.dat and geosite.dat. Defaults to data/geo. */
  INFINITUM_GEO_DIR?: string;
}

const ON = new Set(["1", "true", "on", "yes"]);

export function geoEnabled(flag: string | undefined): boolean {
  if (flag === undefined) return false;
  return ON.has(flag.trim().toLowerCase());
}

export function clientIp(request: Request): string | null {
  const raw = request.headers.get("cf-connecting-ip");
  if (!raw) return null;
  const ip = raw.trim();
  return parseIp(ip) ? ip : null;
}

export function requestDomain(request: Request): string | null {
  try {
    return normalizeDomain(new URL(request.url).hostname);
  } catch {
    return null;
  }
}

let cache: { dir: string; data: GeoData } | null = null;
let inflight: { dir: string; promise: Promise<GeoData> } | null = null;

/** Tests only: drop a dataset cached by an earlier request. */
export function resetGeoCache(): void {
  cache = null;
  inflight = null;
}

async function readDatasets(dir: string): Promise<GeoData> {
  const path = await import("node:path");
  const { readFile } = await import("node:fs/promises");
  const root = path.resolve(dir);
  const files = ["geoip.dat", "geosite.dat"] as const;
  const paths = files.map((name) => {
    const file = path.resolve(root, name);
    if (path.dirname(file) !== root) throw new Error("geo dataset path escapes the data directory");
    return file;
  });
  try {
    const [geoip, geosite] = await Promise.all(paths.map((file) => readFile(file)));
    return loadGeoData(geoip, geosite);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("geo datasets are not in the data directory; run npm run geo:fetch");
    }
    throw error;
  }
}

function datasetsFor(dir: string): Promise<GeoData> {
  if (cache?.dir === dir) return Promise.resolve(cache.data);
  if (inflight?.dir === dir) return inflight.promise;
  const promise = readDatasets(dir).then(
    (data) => {
      cache = { dir, data };
      inflight = null;
      return data;
    },
    (error: unknown) => {
      inflight = null;
      throw error;
    },
  );
  inflight = { dir, promise };
  return promise;
}

/**
 * Annotate this request when geo is enabled. Returns null when it is off, or
 * when the datasets cannot be read. A failure here is logged and swallowed so
 * the exercise response stays the same.
 */
export async function observeRequest(request: Request, env: GeoHookEnv = {}): Promise<GeoAnnotation | null> {
  if (!geoEnabled(env.INFINITUM_GEO_ENABLED)) return null;
  const dir = env.INFINITUM_GEO_DIR?.trim() || "data/geo";
  try {
    const data = await datasetsFor(dir);
    const annotation = annotate(data, { ip: clientIp(request), domain: requestDomain(request) });
    console.info(JSON.stringify({ product: "eon", kind: "geo", ok: true, ...annotation }));
    return annotation;
  } catch (error) {
    const message = error instanceof Error ? error.message : "geo datasets unavailable";
    console.info(JSON.stringify({ product: "eon", kind: "geo", ok: false, policy: "observe", error: message }));
    return null;
  }
}
