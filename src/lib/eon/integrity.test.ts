import assert from "node:assert/strict";
import { test } from "node:test";
import { Exercise, MemoryStore } from "./exercise.ts";
import { handleEonRequest } from "./http.ts";
import { bandOf, scoreOf } from "./integrity.ts";
import { Eon } from "./service.ts";

async function run(ticks: number) {
  const eon = await Eon.create(7);
  for (let i = 0; i < ticks; i++) await eon.sweep("operator");
  return eon;
}

const unit = async (eon: Eon, id: string) => (await eon.picture("teamlead")).units.find((u) => u.id === id)!;

test("one health score from the failing checks", () => {
  assert.equal(scoreOf([]), 100);
  assert.equal(scoreOf(["debugger"]), 75);
  assert.equal(bandOf(scoreOf(["debugger"])), "degraded");
  assert.equal(scoreOf(["root", "hooking"]), 25);
  assert.equal(bandOf(25), "compromised");
  assert.equal(scoreOf(["root", "hooking", "emulator", "debugger"]), 0);
  assert.equal(bandOf(90), "healthy");
  assert.equal(bandOf(89), "degraded");
  assert.equal(bandOf(60), "degraded");
  assert.equal(bandOf(59), "compromised");
});

test("a debug session degrades ASH 1-2, raises one alert with a recommendation, and clears", async () => {
  const eon = await run(1);
  const healthy = await unit(eon, "eon-2");
  assert.equal(healthy.health.score, 100);
  assert.deepEqual(healthy.health.checks.map((c) => [c.check, c.ok]), [["root", true], ["hooking", true], ["emulator", true], ["debugger", true]]);

  await eon.sweep("operator");
  const hit = await unit(eon, "eon-2");
  assert.equal(hit.health.score, 75);
  assert.equal(hit.health.band, "degraded");
  const dbg = hit.health.checks.find((c) => c.check === "debugger")!;
  assert.equal(dbg.ok, false);
  assert.equal(dbg.since, 2);
  assert.match(dbg.recommendation!, /Disconnect the debug session/);
  const alerts = (await eon.picture("operator")).alerts.filter((a) => a.kind === "integrity");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].unitId, "eon-2");
  assert.match(alerts[0].text, /ASH 1-2 device integrity: debugger attached .* Health 75\/100, degraded\. Disconnect/);

  await eon.sweep("operator");
  assert.equal((await eon.picture("operator")).alerts.filter((a) => a.kind === "integrity").length, 1, "no repeat while it persists");
  await eon.sweep("operator");
  assert.equal((await unit(eon, "eon-2")).health.score, 100, "clears at tick 4");
});

test("ASH 1-4 is hooked and rooted from tick 5: compromised, with an alert per finding", async () => {
  const eon = await run(5);
  const u = await unit(eon, "eon-4");
  assert.equal(u.health.score, 25);
  assert.equal(u.health.band, "compromised");
  assert.deepEqual(u.health.checks.filter((c) => !c.ok).map((c) => c.check), ["root", "hooking"]);
  const alerts = (await eon.picture("operator")).alerts.filter((a) => a.kind === "integrity" && a.unitId === "eon-4");
  assert.equal(alerts.length, 2);
  assert.ok(alerts.every((a) => /Health 25\/100, compromised/.test(a.text)));
  // The wearer's own wrist shows the newest of them.
  assert.equal(eon.wrist("eon-4").data!.alert!.kind, "integrity");
});

test("only outcomes leave the device: integrity ledger entries carry check, result and score, nothing raw", async () => {
  const eon = await run(5);
  const entries = eon.ledger.entries.filter((e) => e.type === "integrity");
  assert.ok(entries.length >= 3);
  for (const e of entries) assert.deepEqual(Object.keys(e.payload).sort(), ["band", "check", "ok", "score"]);
});

test("quarantine: team lead only; a quarantined device's reports never reach the picture", async () => {
  const eon = await run(5);
  assert.equal((await eon.quarantine("operator", "eon-4", true)).ok, false);
  assert.equal((await eon.quarantine("teamlead", "eon-9", true)).ok, false);
  const q = await eon.quarantine("teamlead", "eon-4", true);
  assert.equal(q.data!.health.quarantined, true);
  await eon.sweep("operator");
  await eon.sweep("operator");
  const pic = await eon.picture("teamlead");
  assert.equal(pic.detections.filter((d) => d.unitId === "eon-4" && d.tick >= 6).length, 0);
  assert.ok(pic.units.find((u) => u.id === "eon-4")!.withheld > 0);
  const quarantineEntry = eon.ledger.entries.find((e) => e.type === "quarantine")!;
  assert.equal(quarantineEntry.actor, "teamlead");
  assert.equal(quarantineEntry.payload.on, true);

  const lessons = (await eon.report("teamlead")).data!.lessons;
  assert.ok(lessons.some((l) => /ASH 1-4 failed its device integrity checks .* for 1 tick while compromised/.test(l)), lessons.join("\n"));
});

test("quarantine changes what is shared, not what the other wearers measure", async () => {
  const a = await run(5);
  const b = await run(5);
  await b.quarantine("teamlead", "eon-4", true);
  await a.sweep("operator");
  await b.sweep("operator");
  const others = async (eon: Eon) =>
    (await eon.picture("teamlead")).detections.filter((d) => d.tick === 6 && d.unitId !== "eon-4").map((d) => [d.unitId, d.track, d.bearingDeg]);
  assert.deepEqual(await others(b), await others(a));
});

test("left unquarantined, the after-action report counts every compromised tick", async () => {
  const eon = await run(8);
  const lessons = (await eon.report("teamlead")).data!.lessons;
  assert.ok(lessons.some((l) => /ASH 1-4 .* for 4 ticks while compromised/.test(l)), lessons.join("\n"));
});

test("HTTP: POST /quarantine", async () => {
  const exercise = new Exercise(new MemoryStore());
  const post = (body: unknown) =>
    handleEonRequest(new Request("http://x/api/eon/quarantine", { method: "POST", body: JSON.stringify(body) }), "quarantine", exercise);
  assert.equal((await post({ role: "teamlead", unitId: "eon-4", on: "yes" })).status, 400);
  assert.equal((await post({ role: "operator", unitId: "eon-4", on: true })).status, 403);
  const ok = await post({ role: "teamlead", unitId: "eon-4", on: true });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.health.quarantined, true);
  // Replayed from the log like every other action.
  const again = new Exercise((exercise as unknown as { store: MemoryStore }).store);
  assert.equal(await again.read(async (eon) => (await eon.picture("teamlead")).units.find((u) => u.id === "eon-4")!.health.quarantined), true);
});
