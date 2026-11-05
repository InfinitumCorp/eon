import assert from "node:assert/strict";
import { test } from "node:test";
import { handleEonRequest } from "./http.ts";
import { classify, distance, intersectBearings } from "./rf.ts";
import { Eon, resetEon } from "./service.ts";

async function run(ticks: number, seed = 7) {
  const eon = await Eon.create(seed);
  for (let i = 0; i < ticks; i++) await eon.sweep("operator");
  return eon;
}

test("classifier recognises every scenario class and rejects nonsense", () => {
  assert.equal(classify({ bandwidthKHz: 500, hopRateHz: 100, dutyCycle: 0.5, pulsed: false, flatness: 0.3 }).cls, "drone-control");
  assert.equal(classify({ bandwidthKHz: 10000, hopRateHz: 0, dutyCycle: 1, pulsed: false, flatness: 0.4 }).cls, "drone-video");
  assert.equal(classify({ bandwidthKHz: 20000, hopRateHz: 0, dutyCycle: 1, pulsed: false, flatness: 1 }).cls, "wideband-noise");
  assert.equal(classify({ bandwidthKHz: 1000, hopRateHz: 0, dutyCycle: 0.001, pulsed: true, flatness: 0.1 }).cls, "search-radar");
  assert.equal(classify({ bandwidthKHz: 0.5, hopRateHz: 5000, dutyCycle: 0.05, pulsed: true, flatness: 0.9 }).cls, "unknown");
});

test("bearing intersection recovers a point and refuses parallel lines", () => {
  const target = { x: 2000, y: 3000 };
  const from = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 4000 }];
  const lines = from.map((p) => ({ from: p, bearingDeg: ((Math.atan2(target.x - p.x, target.y - p.y) * 180) / Math.PI + 360) % 360 }));
  const hit = intersectBearings(lines);
  assert.ok(hit);
  assert.ok(distance(hit.pos, target) < 1);
  assert.equal(intersectBearings([{ from: { x: 0, y: 0 }, bearingDeg: 90 }, { from: { x: 0, y: 100 }, bearingDeg: 90 }]), null);
});

test("the team geolocates the drone and the noise source close to truth", async () => {
  const eon = await run(4);
  const truth = eon.truth().emitters;
  const pic = await eon.picture("teamlead");
  const drone = pic.fixes.find((f) => f.cls === "drone-control");
  const noise = pic.fixes.find((f) => f.cls === "wideband-noise");
  assert.ok(drone && noise);
  assert.ok(distance(drone.pos, truth.find((e) => e.id === "em-ctrl")!.pos) < 250, "drone fix within 250 m");
  assert.ok(distance(noise.pos, truth.find((e) => e.id === "em-noise")!.pos) < noise.errorM, "noise fix inside its ellipse");
  for (const fix of pic.fixes) {
    const nearest = Math.min(...truth.map((e) => distance(e.pos, fix.pos)));
    assert.ok(nearest <= fix.errorM * 1.5, `${fix.track} misses by ${Math.round(nearest)} m against ±${fix.errorM} m`);
  }
});

test("each emitter maps to exactly one track", async () => {
  const pic = await (await run(5)).picture("teamlead");
  assert.deepEqual(pic.fixes.map((f) => f.track).sort(), ["T1350", "T150", "T2440", "T3050", "T403", "T5800", "T915"]);
});

test("a counter-drone warning goes to the whole team once, and never for a friendly drone", async () => {
  const eon = await run(4);
  const pic = await eon.picture("operator");
  const drone = pic.alerts.filter((a) => a.kind === "drone");
  assert.equal(drone.length, 2, "hostile control and video links only");
  assert.ok(drone.every((a) => a.unitId === null && a.tick === 2));
  assert.ok(drone.every((a) => !a.text.includes("T915")));
  assert.match(drone.find((a) => a.text.startsWith("Hostile drone control"))!.text, /Bearing \d{3}°.*Fix/);
  assert.equal(pic.fixes.find((f) => f.track === "T915")!.affiliation, "friendly");
  assert.equal(pic.fixes.find((f) => f.track === "T2440")!.affiliation, "hostile");
});

test("counter-drone rules: friendly, unlocated and non-drone tracks are refused", async () => {
  const eon = await run(3);
  assert.match((await eon.engage("teamlead", "T915", "handoff")).error!, /friendly/);
  assert.match((await eon.engage("teamlead", "T150", "disrupt")).error!, /not a drone/);
  assert.match((await eon.engage("teamlead", "T9999", "disrupt")).error!, /No track/);
  const refusals = eon.ledger.entries.filter((e) => e.type === "engagement" && e.payload.status === "refused");
  assert.equal(refusals.length, 3, "every refusal is on the record");
});

test("counter-drone: the operator requests, the team lead orders, the drone goes quiet", async () => {
  const eon = await run(3);
  const req = await eon.engage("operator", "T2440", "disrupt");
  assert.equal(req.data!.status, "requested");
  assert.equal((await eon.decide("operator", req.data!.id, "approve")).ok, false, "operators cannot order");
  const ordered = await eon.decide("teamlead", req.data!.id, "approve");
  assert.equal(ordered.data!.status, "ordered");
  assert.match((await eon.engage("teamlead", "T5800", "handoff")).error!, /already engaged/, "same airframe");

  await eon.sweep("operator");
  const pic = await eon.picture("teamlead");
  assert.equal(pic.engagements.find((e) => e.id === req.data!.id)!.status, "effective");
  const quiet = pic.detections.filter((d) => d.tick === eon.tick && (d.track === "T2440" || d.track === "T5800"));
  assert.equal(quiet.length, 0, "control and video links both stop");
  assert.match((await eon.engage("teamlead", "T5800", "handoff")).error!, /already defeated/, "no second engagement on a defeated airframe");
  await eon.sweep("operator");
  await eon.sweep("operator");
  assert.match((await eon.engage("teamlead", "T5800", "handoff")).error!, /already defeated|not been heard/);
});

test("counter-drone: WARDEN hand-off intercepts after two ticks; a rejection stands", async () => {
  const eon = await run(3);
  const handoff = await eon.engage("teamlead", "T5800", "handoff");
  assert.equal(handoff.data!.outcomeTick, 5);
  await eon.sweep("operator");
  assert.equal((await eon.picture("teamlead")).engagements[0].status, "ordered");
  await eon.sweep("operator");
  assert.equal((await eon.picture("teamlead")).engagements[0].status, "intercepted");

  const other = await run(3);
  const req = await other.engage("operator", "T2440", "disrupt");
  const rejected = await other.decide("teamlead", req.data!.id, "reject", "Friendly patrol in the area.");
  assert.equal(rejected.data!.status, "rejected");
  await other.sweep("operator");
  assert.ok((await other.picture("teamlead")).detections.some((d) => d.tick === other.tick && d.track === "T2440"), "drone still flying");
});

test("a stale fix must be refreshed before engaging", async () => {
  const eon = await Eon.create();
  for (let i = 0; i < 3; i++) await eon.sweep("operator");
  for (const id of ["eon-1", "eon-2", "eon-3", "eon-4"]) await eon.setProfile("teamlead", id, "silent");
  await eon.sweep("operator");
  await eon.sweep("operator");
  assert.match((await eon.engage("teamlead", "T2440", "disrupt")).error!, /not been heard since tick 3/);
});

test("power management drops a tired unit to economy scan and a swap restores it", async () => {
  const eon = await Eon.create();
  await eon.sweep("operator");
  await eon.sweep("operator");
  let ash14 = (await eon.picture("operator")).units.find((u) => u.id === "eon-4")!;
  assert.ok(ash14.batteryPct < 25);
  assert.equal(ash14.scan, "economy");
  assert.equal(ash14.scanAuto, true);
  assert.ok((await eon.picture("operator")).alerts.some((a) => a.kind === "power" && a.unitId === "eon-4"));
  assert.match((await eon.setScan("operator", "eon-4", "wide")).error!, /Swap the battery/);

  const ash11 = (await eon.picture("operator")).units.find((u) => u.id === "eon-1")!;
  const economy = await eon.setScan("operator", "eon-1", "economy");
  assert.ok(economy.data!.enduranceH > ash11.enduranceH, "economy lasts longer");

  ash14 = (await eon.swapBattery("operator", "eon-4")).data!;
  assert.equal(ash14.batteryPct, 100);
  assert.equal(ash14.scan, "wide");
});

test("after-action report scores the team against ground truth", async () => {
  const eon = await run(3);
  const req = await eon.engage("teamlead", "T2440", "disrupt");
  assert.ok(req.ok);
  await eon.engage("teamlead", "T915", "disrupt");
  for (let i = 0; i < 3; i++) await eon.sweep("operator");
  assert.equal(eon.report("operator").ok, false);
  const report = eon.report("teamlead").data!;
  assert.equal(report.summary.emittersDetected, "7/7");
  assert.equal(report.summary.classifiedRight, "7/7");
  assert.equal(report.summary.hostileDronesWarned, "2/2");
  assert.equal(report.summary.friendlyEngaged, 0);
  assert.equal(report.summary.engagements.effective, 1);
  assert.equal(report.summary.engagements.refused, 1);
  assert.equal(report.summary.spoofDetectedAfterTicks, 0);
  assert.ok(report.summary.linkAvailabilityPct >= 90);
  const ctrl = report.emitters.find((e) => e.emitter === "em-ctrl")!;
  assert.equal(ctrl.latencyTicks, 0);
  assert.equal(ctrl.affiliation, "hostile");
  assert.ok(report.lessons.length >= 1);
});

test("jamming moves the most exposed wearer to a clear path and back", async () => {
  const eon = await run(3);
  let pic = await eon.picture("operator");
  const ash12 = pic.units.find((u) => u.id === "eon-2")!;
  assert.equal(ash12.link.pathId, "alternate");
  assert.ok(ash12.link.sinrDb >= 6);
  assert.ok(pic.alerts.some((a) => a.kind === "jamming" && a.unitId === "eon-2" && /Switched to UHF alternate/.test(a.text)));
  assert.ok(pic.units.every((u) => u.link.sinrDb >= 6), "every wearer keeps a usable link");
  for (let i = 0; i < 3; i++) await eon.sweep("operator");
  pic = await eon.picture("operator");
  assert.equal(pic.units.find((u) => u.id === "eon-2")!.link.pathId, "primary");
});

test("GNSS spoofing is caught and the wearer holds on inertial", async () => {
  const eon = await run(4);
  let pic = await eon.picture("operator");
  const ash13 = pic.units.find((u) => u.id === "eon-3")!;
  assert.equal(ash13.nav.status, "spoofed");
  assert.equal(ash13.nav.source, "inertial");
  assert.ok(distance(ash13.pos, { x: 1800, y: 2200 }) < 20, "reported position stays near truth");
  assert.ok(pic.alerts.some((a) => a.kind === "gnss" && a.unitId === "eon-3"));
  for (let i = 0; i < 3; i++) await eon.sweep("operator");
  pic = await eon.picture("operator");
  assert.equal(pic.units.find((u) => u.id === "eon-3")!.nav.status, "assured");
});

test("emission control: only the team lead sets it, silence holds reports, release shares them", async () => {
  const eon = await Eon.create();
  const denied = await eon.setProfile("operator", "eon-1", "silent");
  assert.equal(denied.ok, false);

  const reduced = await eon.setProfile("teamlead", "eon-4", "reduced");
  assert.ok(reduced.ok);
  const normalKm = (await eon.picture("operator")).units.find((u) => u.id === "eon-1")!.detectableKm;
  assert.ok(reduced.data!.detectableKm < normalKm, "reduced power shrinks the signature");

  const silent = await eon.setProfile("teamlead", "eon-1", "silent");
  assert.equal(silent.data!.detectableKm, 0);
  await eon.sweep("operator");
  let pic = await eon.picture("teamlead");
  const held = pic.units.find((u) => u.id === "eon-1")!.held;
  assert.ok(held > 0);
  assert.ok(pic.detections.every((d) => d.unitId !== "eon-1"), "silent wearer shares nothing");

  await eon.setProfile("teamlead", "eon-1", "normal");
  pic = await eon.picture("teamlead");
  assert.equal(pic.units.find((u) => u.id === "eon-1")!.held, 0);
  assert.equal(pic.detections.filter((d) => d.unitId === "eon-1").length, held);
});

test("the custody ledger verifies and catches tampering", async () => {
  const eon = await run(4);
  assert.deepEqual(await eon.verify(), { ok: true, length: eon.ledger.entries.length });
  const types = new Set(eon.ledger.entries.map((e) => e.type));
  for (const t of ["exercise", "detection", "fix", "link", "nav"]) assert.ok(types.has(t), `ledger has ${t}`);
  (eon.ledger.entries[5].payload as Record<string, unknown>).bearingDeg = 0;
  const broken = await eon.verify();
  assert.equal(broken.ok, false);
  assert.equal(broken.brokenAt, 5);
});

test("operators see the chain status but not its entries", async () => {
  const eon = await run(1);
  assert.equal((await eon.picture("operator")).ledger.length, 0);
  assert.ok((await eon.picture("teamlead")).ledger.length > 0);
});

test("the same seed gives the same exercise", async () => {
  const a = await (await run(5, 11)).picture("teamlead");
  const b = await (await run(5, 11)).picture("teamlead");
  assert.deepEqual(a.fixes, b.fixes);
  assert.deepEqual(a.alerts, b.alerts);
});

test("HTTP contract", async () => {
  await resetEon();
  const call = (path: string, init?: RequestInit) => handleEonRequest(new Request(`http://x/api/eon/${path}`, init), path.split("?")[0]);
  const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  const health = await (await call("health")).json();
  assert.equal(health.ok, true);
  assert.equal(health.exercise, "QUIETFIELD");

  assert.equal((await call("picture")).status, 400);
  assert.equal((await post("sweep", { role: "operator" })).status, 200);
  assert.equal((await post("emcon", { role: "operator", unitId: "eon-1", profile: "silent" })).status, 403);
  assert.equal((await post("emcon", { role: "teamlead", unitId: "eon-1", profile: "loud" })).status, 400);
  assert.equal((await post("emcon", { role: "teamlead", unitId: "eon-1", profile: "silent" })).status, 200);

  const pic = await (await call("picture?role=teamlead")).json();
  assert.equal(pic.tick, 1);
  const alertId = pic.alerts[0].id;
  const acked = await (await post("ack", { role: "operator", alertId })).json();
  assert.equal(acked.data.acked, true);

  assert.equal((await post("engagements", { role: "teamlead", track: "T150", method: "disrupt" })).status, 409);
  assert.equal((await post("engagements", { role: "teamlead", track: "T150", method: "attack" })).status, 400);
  assert.equal((await post("scan", { role: "operator", unitId: "eon-2", mode: "economy" })).status, 200);
  assert.equal((await post("battery", { role: "operator", unitId: "eon-2" })).status, 200);
  assert.equal((await call("report?role=operator")).status, 403);
  assert.equal((await call("report?role=teamlead")).status, 200);

  assert.equal((await post("reset", { role: "operator" })).status, 403);
  assert.equal((await post("reset", { role: "teamlead" })).status, 200);
  assert.equal((await (await call("picture?role=operator")).json()).tick, 0);
  assert.equal((await call("nope")).status, 404);
});
