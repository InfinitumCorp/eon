import { readFileSync } from "node:fs";
import path from "node:path";
import { lookupCategories, lookupCountry, parseGeoIpList, parseGeoSiteList, parseIp } from "../src/lib/eon/geo.ts";
import { geoDataDir, readGeoSettings, writeGeoSettings } from "../src/lib/eon/geo-settings.ts";

/**
 * Saved geo-routing toggle. Off by default.
 *   npm run geo-routing -- on|off|status
 *   npm run geo-routing -- lookup <ip-or-domain>
 * The dev server accepts the same choice as a flag: --geo-routing / --no-geo-routing.
 */

const [cmd, query] = process.argv.slice(2);

if (cmd === "on" || cmd === "off") {
  await writeGeoSettings(cmd === "on");
  console.log(`Geo routing ${cmd}. Saved to data/settings.json.`);
} else if (cmd === undefined || cmd === "status") {
  const settings = await readGeoSettings();
  console.log(`Geo routing ${settings.geoRouting ? "on" : "off"}.`);
} else if (cmd === "lookup") {
  const settings = await readGeoSettings();
  if (!settings.geoRouting) {
    console.error("Geo routing is off. Turn it on with: npm run geo-routing -- on");
    process.exitCode = 1;
  } else if (!query) {
    console.error("Usage: npm run geo-routing -- lookup <ip-or-domain>");
    process.exitCode = 1;
  } else {
    const dir = geoDataDir();
    try {
      const ip = parseGeoIpList(readFileSync(path.join(dir, "geoip.dat")));
      const site = parseGeoSiteList(readFileSync(path.join(dir, "geosite.dat")));
      if (parseIp(query)) console.log(lookupCountry(ip, query) ?? "unknown");
      else {
        const categories = lookupCategories(site, query);
        console.log(categories.length ? categories.join(" ") : "none");
      }
    } catch (error) {
      console.error(error instanceof Error ? `${error.message} Run npm run fetch-geo.` : error);
      process.exitCode = 1;
    }
  }
} else {
  console.error("Usage: npm run geo-routing -- on|off|status|lookup <ip-or-domain>");
  process.exitCode = 1;
}
