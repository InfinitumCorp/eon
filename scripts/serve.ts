import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { infinitumGeoEnabled } from "../src/lib/eon/geo-routing.ts";
import { geoDataDir, resolveGeoRoutingFlag } from "../src/lib/eon/geo-settings.ts";
import worker from "../src/worker.ts";

/** Local preview: runs the Worker's fetch handler on Node. */
const port = Number(process.env.PORT ?? 8787);
const choice = await resolveGeoRoutingFlag(process.argv.slice(2));
const flagged = process.argv.includes("--geo-routing") || process.argv.includes("--no-geo-routing");
const fromEnv = process.env.INFINITUM_GEO_ENABLED;
// A flag wins and is saved. Otherwise an explicit env value overrides the saved toggle for this process.
const enabled = !flagged && fromEnv != null && fromEnv.trim() !== "" ? infinitumGeoEnabled(fromEnv) : choice.geoRouting;
const geoEnv = enabled ? "true" : "false";

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  const response = await worker.fetch(request, { INFINITUM_GEO_ENABLED: geoEnv });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => {
  const saved = choice.persisted ? " Saved to data/settings.json." : "";
  const ready = existsSync(path.join(geoDataDir(), "geoip.dat")) && existsSync(path.join(geoDataDir(), "geosite.dat"));
  const missing = enabled && !ready ? " Datasets are not downloaded yet; run npm run fetch-geo." : "";
  console.log(`E(O)N™ MIL console on http://localhost:${port}`);
  console.log(`Geo routing ${enabled ? "on" : "off"}.${saved}${missing}`);
});
