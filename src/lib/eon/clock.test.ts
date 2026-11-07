import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { EonExercise } from "../../worker.ts";
import { Exercise, MemoryStore, type Scheduler } from "./exercise.ts";
import { handleEonRequest } from "./http.ts";
import { CLOCK_LIMIT_TICKS, TICK_SECONDS } from "./scenario.ts";

/** Records what the exercise asked to schedule; nothing fires on its own. */
function fakeScheduler() {
  const calls: Array<number | "clear"> = [];
  const s: Scheduler & { calls: typeof calls; pending: () => number | null } = {
    calls,
    async set(at) {
      calls.push(at);
    },
    async clear() {
      calls.push("clear");
    },
    pending: () => {
      const last = calls.at(-1);
      return typeof last === "number" ? last : null;
    },
  };
  return s;
}

const NOW = 1_800_000_000_000;

function setup() {
  const store = new MemoryStore();
  const scheduler = fakeScheduler();
  const exercise = new Exercise(store, 7, scheduler);
  exercise.now = () => NOW;
  return { store, scheduler, exercise };
}

test("only the team lead starts the clock; starting books the first tick one tick-length out", async () => {
  const { scheduler, exercise } = setup();
  assert.equal((await exercise.act({ op: "clock", role: "operator", on: true })).status, 403);
  assert.deepEqual(scheduler.calls, ["clear"], "a refused start leaves nothing scheduled");
  const r = await exercise.act({ op: "clock", role: "teamlead", on: true });
  assert.equal(r.status, 200);
  assert.equal(scheduler.pending(), NOW + TICK_SECONDS * 1000);
  const clock = await exercise.read(async (eon) => (await eon.picture("operator")).clock);
  assert.deepEqual(clock, { on: true, ticks: 0, limit: CLOCK_LIMIT_TICKS, tickSeconds: TICK_SECONDS, stoppedBy: null });
});

test("each alarm sweeps once and books the next; stopping clears it and a late alarm does nothing", async () => {
  const { scheduler, exercise } = setup();
  await exercise.act({ op: "clock", role: "teamlead", on: true });
  for (let i = 0; i < 3; i++) await exercise.tick();
  assert.equal(await exercise.read((eon) => eon.tick), 3);
  assert.equal(scheduler.pending(), NOW + TICK_SECONDS * 1000);
  assert.equal(await exercise.read((eon) => eon.clock.ticks), 3);

  await exercise.act({ op: "clock", role: "teamlead", on: false });
  assert.equal(scheduler.calls.at(-1), "clear");
  assert.equal(await exercise.tick(), null, "an alarm that fires after a stop is ignored");
  assert.equal(await exercise.read((eon) => eon.tick), 3);
  assert.equal(await exercise.read((eon) => eon.clock.stoppedBy), "teamlead");
});

test("the clock stops itself at the limit, on the ledger, with an alert", async () => {
  const { scheduler, exercise } = setup();
  await exercise.act({ op: "clock", role: "teamlead", on: true });
  for (let i = 0; i < CLOCK_LIMIT_TICKS + 3; i++) await exercise.tick();
  const state = await exercise.read(async (eon) => ({
    tick: eon.tick,
    clock: eon.clock,
    alert: (await eon.picture("operator")).alerts.find((a) => a.kind === "clock"),
    entry: eon.ledger.entries.findLast((e) => e.type === "clock"),
  }));
  assert.equal(state.tick, CLOCK_LIMIT_TICKS, "no sweeps past the limit");
  assert.equal(state.clock.on, false);
  assert.equal(state.clock.stoppedBy, "limit");
  assert.match(state.alert!.text, new RegExp(`stopped after ${CLOCK_LIMIT_TICKS} ticks`));
  assert.equal(state.entry!.actor, "control");
  assert.equal(state.entry!.payload.reason, "limit");
  assert.equal(scheduler.calls.at(-1), "clear");
});

test("a restart replays the clock: same tick, still running, same ledger head", async () => {
  const { store, exercise } = setup();
  await exercise.act({ op: "clock", role: "teamlead", on: true });
  for (let i = 0; i < 4; i++) await exercise.tick();
  const head = await exercise.read((eon) => eon.ledger.head);
  const again = new Exercise(store, 7, fakeScheduler());
  const replayed = await again.read((eon) => ({ tick: eon.tick, on: eon.clock.on, ticks: eon.clock.ticks, head: eon.ledger.head }));
  assert.deepEqual(replayed, { tick: 4, on: true, ticks: 4, head });
});

test("reset stops the clock and clears the alarm", async () => {
  const { scheduler, exercise } = setup();
  await exercise.act({ op: "clock", role: "teamlead", on: true });
  await exercise.tick();
  await exercise.act({ op: "reset", role: "teamlead" });
  assert.equal(scheduler.calls.at(-1), "clear");
  assert.equal(await exercise.read((eon) => eon.clock.on), false);
  assert.equal(await exercise.tick(), null);
});

test("HTTP: POST /clock validates its body; the Durable Object's alarm drives the clock", async () => {
  const { exercise } = setup();
  const post = (body: unknown) => handleEonRequest(new Request("http://x/api/eon/clock", { method: "POST", body: JSON.stringify(body) }), "clock", exercise);
  assert.equal((await post({ role: "teamlead", on: "yes" })).status, 400);
  assert.equal((await post({ role: "teamlead", on: true })).status, 200);

  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    async list<T>({ prefix }: { prefix: string }) {
      return new Map([...map].filter(([k]) => k.startsWith(prefix))) as Map<string, T>;
    },
    async put<T>(k: string, v: T) {
      map.set(k, v);
    },
    async deleteAll() {
      map.clear();
    },
    async setAlarm(at: number) {
      alarm = at;
    },
    async deleteAlarm() {
      alarm = null;
    },
  };
  const object = new EonExercise({ storage });
  const env = { EXERCISE: { idFromName: (n: string) => n, get: () => ({ fetch: (r: Request) => object.fetch(r) }) } };
  const start = await worker.fetch(
    new Request("http://x/api/eon/clock", { method: "POST", body: JSON.stringify({ role: "teamlead", on: true }) }),
    env,
  );
  assert.equal(start.status, 200);
  assert.ok(alarm && alarm > Date.now(), "an alarm is booked");
  await object.alarm();
  await object.alarm();
  const health = await (await worker.fetch(new Request("http://x/health"), env)).json();
  assert.equal(health.tick, 2);
});
