import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./root.ts";

/**
 * The saved geo-routing toggle. Missing file means off, which is the default.
 * The file lives under data/ and is gitignored; it is the operator's choice, not source.
 */
export interface GeoSettings {
  geoRouting: boolean;
}

export function geoSettingsPath(root = repoRoot()): string {
  return path.join(root, "data", "settings.json");
}

export function geoDataDir(root = repoRoot()): string {
  return path.join(root, "data", "geo");
}

export async function readGeoSettings(file = geoSettingsPath()): Promise<GeoSettings> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { geoRouting: false };
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Geo routing settings in ${file} are not valid JSON. Expected {"geoRouting": true} or false.`);
  }
  if (!raw || typeof raw !== "object" || typeof (raw as { geoRouting?: unknown }).geoRouting !== "boolean") {
    throw new Error(`Geo routing settings in ${file} must be {"geoRouting": true} or {"geoRouting": false}.`);
  }
  return { geoRouting: (raw as { geoRouting: boolean }).geoRouting };
}

export async function writeGeoSettings(geoRouting: boolean, file = geoSettingsPath()): Promise<GeoSettings> {
  await mkdir(path.dirname(file), { recursive: true });
  const settings = { geoRouting };
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

/**
 * CLI flag for the program. --geo-routing and --no-geo-routing save the toggle.
 * With neither flag, the saved value is kept (off when the file is absent).
 */
export async function resolveGeoRoutingFlag(argv: readonly string[], file = geoSettingsPath()): Promise<{ geoRouting: boolean; persisted: boolean }> {
  const on = argv.includes("--geo-routing");
  const off = argv.includes("--no-geo-routing");
  if (on && off) throw new Error("Use either --geo-routing or --no-geo-routing.");
  if (on || off) {
    await writeGeoSettings(on, file);
    return { geoRouting: on, persisted: true };
  }
  return { geoRouting: (await readGeoSettings(file)).geoRouting, persisted: false };
}
