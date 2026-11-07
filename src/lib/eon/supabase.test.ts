import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { EonExercise, resetTeamLeadCache } from "../../worker.ts";
import { Exercise, MemoryStore, type Scheduler } from "./exercise.ts";
import { CLOCK_LIMIT_TICKS } from "./scenario.ts";
import { resetAccessCache } from "./access.ts";
import { EonDb, type RunRecord, supabaseConfig, TeamLeadCache } from "./supabase.ts";

const URL_OK = "https://ivqiskeziohbbtkcvlun.supabase.co";
const KEY = "test-service-role-key";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/** A fake PostgREST: records calls, answers team_leads from `leads`. */
function fakeSupabase(leads: string[] = [], fail = false) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    if (fail) return new Response("down", { status: 503 });
    if (url.includes("/team_leads")) return Response.json(leads.map((email) => ({ email })));
    return new Response(null, { status: 201 });
  };
  return { calls, fetcher };
}

const noClock: Scheduler = { async set() {}, async clear() {} };

test("config needs both URL and key, and only accepts a supabase.co project URL", () => {
  assert.equal(supabaseConfig({}), null);
  assert.equal(supabaseConfig({ SUPABASE_URL: URL_OK }), null);
  assert.equal(supabaseConfig({ SUPABASE_URL: "http://evil.example", SUPABASE_SERVICE_ROLE_KEY: KEY }), null);
  assert.deepEqual(supabaseConfig({ SUPABASE_URL: `${URL_OK}/`, SUPABASE_SERVICE_ROLE_KEY: KEY }), { url: URL_OK, serviceKey: KEY });
});

test("every request targets the eon schema with the service-role key", async () => {
  const { calls, fetcher } = fakeSupabase(["Lead@Example.com"]);
  const db = new EonDb({ url: URL_OK, serviceKey: KEY }, fetcher);
  assert.deepEqual(await db.teamLeads(), ["lead@example.com"]);
  const c = calls[0];
  assert.equal(c.url, `${URL_OK}/rest/v1/team_leads?select=email&active=eq.true`);
  assert.equal(c.headers.get("accept-profile"), "eon");
  assert.equal(c.headers.get("content-profile"), "eon");
  assert.equal(c.headers.get("apikey"), KEY);
  assert.equal(c.headers.get("authorization"), `Bearer ${KEY}`);
});

test("the roster cache serves the last good list when Supabase fails, and never widens access", async () => {
  const good = fakeSupabase(["a@x.io"]);
  const cache = new TeamLeadCache(60_000);
  assert.deepEqual(await cache.get(new EonDb({ url: URL_OK, serviceKey: KEY }, good.fetcher), 0), ["a@x.io"]);
  assert.equal(good.calls.length, 1);
  assert.deepEqual(await cache.get(new EonDb({ url: URL_OK, serviceKey: KEY }, good.fetcher), 30_000), ["a@x.io"], "cached");
  assert.equal(good.calls.length, 1);
  const down = fakeSupabase([], true);
  assert.deepEqual(await cache.get(new EonDb({ url: URL_OK, serviceKey: KEY }, down.fetcher), 120_000), ["a@x.io"], "stale but not empty");
  assert.deepEqual(await new TeamLeadCache().get(new EonDb({ url: URL_OK, serviceKey: KEY }, down.fetcher)), [], "no list, no leads");
});

test("reset archives the run that ended: timing, ticks and ledger head, no picture data", async () => {
  const exercise = new Exercise(new MemoryStore(), 7, noClock);
  let t = Date.parse("2026-11-07T10:00:00Z");
  exercise.now = () => t;
  const runs: RunRecord[] = [];
  exercise.archive = async (r) => {
    runs.push(r);
  };
  await exercise.act({ op: "sweep", role: "operator" });
  t += 60_000;
  await exercise.act({ op: "sweep", role: "teamlead" });
  const head = await exercise.read((eon) => eon.ledger.head);
  await exercise.act({ op: "reset", role: "teamlead", by: "lead@example.com" });
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.deepEqual(Object.keys(run).sort(), ["ended_at", "ended_by", "exercise", "ledger_head", "ledger_length", "ledger_ok", "reason", "started_at", "ticks"]);
  assert.equal(run.reason, "reset");
  assert.equal(run.ticks, 2);
  assert.equal(run.ledger_head, head);
  assert.match(run.ledger_head, /^[0-9a-f]{64}$/);
  assert.equal(run.ledger_ok, true);
  assert.equal(run.started_at, "2026-11-07T10:00:00.000Z");
  assert.equal(run.ended_at, "2026-11-07T10:01:00.000Z");
  assert.equal(run.ended_by, "lead@example.com");

  await exercise.act({ op: "reset", role: "teamlead" });
  assert.equal(runs.length, 1, "resetting an empty exercise archives nothing");
});

test("the run's start time survives a restart, and an archive failure never blocks reset", async () => {
  const store = new MemoryStore();
  const first = new Exercise(store, 7, noClock);
  first.now = () => Date.parse("2026-11-07T09:00:00Z");
  await first.act({ op: "sweep", role: "operator" });
  const again = new Exercise(store, 7, noClock);
  const runs: RunRecord[] = [];
  again.archive = async (r) => {
    runs.push(r);
    throw new Error("Supabase down");
  };
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const r = await again.act({ op: "reset", role: "teamlead" });
    assert.equal(r.status, 200);
  } finally {
    console.error = original;
  }
  assert.equal(runs[0].started_at, "2026-11-07T09:00:00.000Z");
  assert.equal(errors.length, 1);
  assert.equal(await again.read((eon) => eon.tick), 0);
});

test("the clock's limit archives the run with no person named", async () => {
  const exercise = new Exercise(new MemoryStore(), 7, noClock);
  const runs: RunRecord[] = [];
  exercise.archive = async (r) => {
    runs.push(r);
  };
  await exercise.act({ op: "clock", role: "teamlead", on: true });
  for (let i = 0; i < CLOCK_LIMIT_TICKS + 2; i++) await exercise.tick();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].reason, "limit");
  assert.equal(runs[0].ticks, CLOCK_LIMIT_TICKS);
  assert.equal(runs[0].ended_by, null);
});

test("Worker: the Supabase roster clears a team lead TEAM_LEADS does not name", async () => {
  resetTeamLeadCache();
  resetAccessCache();
  const { calls, fetcher } = fakeSupabase(["second.lead@example.com"]);
  // Clearance only applies with Access on, so sign real test tokens against a stub key set.
  const { generateKeyPair, signJwt } = await accessKit();
  const keys = await generateKeyPair();
  const env = {
    ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    ACCESS_AUD: "aud-1",
    TEAM_LEADS: "first.lead@example.com",
    SUPABASE_URL: URL_OK,
    SUPABASE_SERVICE_ROLE_KEY: KEY,
    SUPABASE_FETCH: fetcher,
    ACCESS_CERTS: keys.certs,
  };
  const ask = async (email: string) => {
    const token = await signJwt(keys, { email, aud: ["aud-1"], iss: "https://team.cloudflareaccess.com" });
    const res = await worker.fetch(new Request("http://x/api/eon/picture?role=operator", { headers: { "cf-access-jwt-assertion": token } }), env);
    return ((await res.json()) as { clearance: string }).clearance;
  };
  assert.equal(await ask("first.lead@example.com"), "teamlead", "TEAM_LEADS still works, without a Supabase call");
  assert.equal(calls.length, 0);
  assert.equal(await ask("Second.Lead@example.com"), "teamlead");
  assert.equal(await ask("someone@example.com"), "operator");
  assert.equal(calls.length, 1, "roster fetched once and cached");
  resetTeamLeadCache();
});

test("Durable Object: with Supabase configured, reset posts the run to eon.exercise_runs", async () => {
  const { calls, fetcher } = fakeSupabase();
  const map = new Map<string, unknown>();
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
    async setAlarm() {},
    async deleteAlarm() {},
  };
  const object = new EonExercise({ storage }, { SUPABASE_URL: URL_OK, SUPABASE_SERVICE_ROLE_KEY: KEY, SUPABASE_FETCH: fetcher });
  const post = (path: string, body: unknown) => object.fetch(new Request(`http://x/api/eon/${path}`, { method: "POST", body: JSON.stringify(body) }));
  await post("sweep", { role: "operator" });
  assert.equal((await post("reset", { role: "teamlead" })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${URL_OK}/rest/v1/exercise_runs`);
  assert.equal(calls[0].method, "POST");
  assert.equal((calls[0].body as RunRecord).reason, "reset");
  assert.equal((calls[0].body as RunRecord).ticks, 1);
});

/** Minimal RS256 Access token kit, matching what access.ts verifies. */
async function accessKit() {
  const b64url = (bytes: ArrayBuffer | Uint8Array) =>
    Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
  async function generateKeyPair() {
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    return { pair, certs: async () => ({ keys: [jwk] }) };
  }
  async function signJwt(keys: { pair: CryptoKeyPair }, claims: Record<string, unknown>) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })));
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ iat: now, nbf: now - 5, exp: now + 300, ...claims })));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.pair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${b64url(sig)}`;
  }
  return { generateKeyPair, signJwt };
}
