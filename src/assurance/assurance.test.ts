import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeReport } from "./normalize.ts";
import { handleAssuranceRequest } from "./http.ts";
import worker from "../worker.ts";
import plugin from "../../integrations/openclaw/index.ts";
const row = { "template-id": "lab-header", info: { name: "Header missing", severity: "low" }, "matched-at": "https://user:password@lab.example/private?token=secret", request: "SECRET", response: "SECRET" };
test("Nuclei deduplicates and omits raw traffic, credentials, URL paths and query", () => {
  const out = normalizeReport("nuclei", [row, row]);
  assert.equal(out.findings.length, 1); assert.equal(out.counts.low, 1);
  assert.equal(out.findings[0].asset, "https://lab.example");
  assert.doesNotMatch(JSON.stringify(out), /password|token=|SECRET|\/private/);
});
test("ZAP maps severity and retains review evidence", () => {
  const out = normalizeReport("zap", { site: [{ "@name": "https://lab.example", alerts: [{ pluginid: "1", alert: "Header", riskcode: "3", solution: "Set header" }] }] });
  assert.equal(out.findings[0].severity, "high"); assert.equal(out.findings[0].remediation, "Set header");
});
test("malformed and oversized finding arrays fail closed", () => {
  assert.throws(() => normalizeReport("nuclei", [{}]));
  assert.throws(() => normalizeReport("zap", { site: [{}] }));
  assert.throws(() => normalizeReport("shell", []));
  assert.throws(() => normalizeReport("nuclei", Array(2001).fill(row)), /2,000/);
});
test("HTTP enforces method, content type and streamed size", async () => {
  const url = "https://eon.test/api/assurance/normalize";
  assert.equal((await handleAssuranceRequest(new Request(url))).status, 404);
  assert.equal((await handleAssuranceRequest(new Request(url, { method: "POST", body: "{}" }))).status, 415);
  const large = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(1048577) });
  assert.equal((await handleAssuranceRequest(large)).status, 413);
});
test("assurance routes inherit the existing Access gate", async () => {
  for (const path of ["/assurance", "/api/assurance/catalog", "/api/assurance/normalize"]) {
    const r = await worker.fetch(new Request("https://eon.test" + path), { ACCESS_TEAM_DOMAIN: "team.example", ACCESS_AUD: "aud" });
    assert.equal(r.status, 403);
  }
});
test("worker routes serve page/catalog and normalize reports without persistence", async () => {
  assert.equal((await worker.fetch(new Request("https://eon.test/assurance"))).status, 200);
  const catalog = await (await worker.fetch(new Request("https://eon.test/api/assurance/catalog"))).json() as { tools: unknown[] };
  assert.equal(catalog.tools.length, 10);
  const result = await worker.fetch(new Request("https://eon.test/api/assurance/normalize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "nuclei", report: [row] }) }));
  assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store");
});
test("OpenClaw™ plugin registers only two report-review tools", async () => {
  const tools: any[] = [];
  plugin.register({ registerTool(tool) { tools.push(tool); } });
  assert.deepEqual(tools.map(t => t.name), ["eon_assurance_catalog", "eon_assurance_normalize"]);
  const result = await tools[1].execute("test", { source: "nuclei", reportJson: JSON.stringify([row]) });
  assert.equal(JSON.parse(result.content[0].text).findings.length, 1);
  await assert.rejects(tools[1].execute("test", { source: "nuclei", reportJson: "x".repeat(1048577) }));
});
