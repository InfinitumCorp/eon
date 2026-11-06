import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../../worker.ts";
import { type AccessJwk, resetAccessCache, verifyAccessJwt } from "./access.ts";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-eon";
const cfg = { teamDomain: TEAM, aud: AUD };

const enc = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

async function keypair(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid } as AccessJwk;
  return { kid, privateKey: pair.privateKey, jwk };
}

const signer = await keypair("k1");
const stranger = await keypair("k1");

async function token(claims: Record<string, unknown>, key = signer) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${enc({ alg: "RS256", kid: key.kid, typ: "JWT" })}.${enc({ iss: `https://${TEAM}`, aud: [AUD], exp: now + 600, iat: now, nbf: now, ...claims })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(body));
  return `${body}.${Buffer.from(sig).toString("base64url")}`;
}

function certs(keys: AccessJwk[]) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return { keys };
  };
  return { fetcher, calls };
}

test("Access tokens: a good one names the person; forged, expired or misaddressed ones are refused", async () => {
  resetAccessCache();
  const { fetcher, calls } = certs([signer.jwk]);
  const ok = await verifyAccessJwt(await token({ email: "lead@example.com" }), cfg, fetcher);
  assert.deepEqual(ok, { ok: true, email: "lead@example.com" });
  assert.deepEqual(calls, [`https://${TEAM}/cdn-cgi/access/certs`]);

  const refuse = async (t: string, pattern: RegExp) => {
    const r = await verifyAccessJwt(t, cfg, fetcher);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, pattern);
  };
  await refuse(await token({ email: "x@example.com" }, stranger), /signature/);
  await refuse(await token({ email: "x@example.com", aud: ["other-app"] }), /another application/);
  await refuse(await token({ email: "x@example.com", iss: "https://evil.cloudflareaccess.com" }), /issuer/);
  await refuse(await token({ email: "x@example.com", exp: Math.floor(Date.now() / 1000) - 5 }), /expired/);
  await refuse(await token({}), /names no one/);
  await refuse("not.a.jwt", /Malformed/);
  const [h, p] = (await token({ email: "x@example.com" })).split(".");
  await refuse(`${h}.${enc({ iss: `https://${TEAM}`, aud: [AUD], exp: 9e9, email: "admin@example.com" })}.${(await token({})).split(".")[2]}`, /signature/);
  assert.ok(h && p);
  assert.equal(calls.length, 1, "keys are cached");

  const svc = await verifyAccessJwt(await token({ common_name: "ci-bot" }), cfg, fetcher);
  assert.deepEqual(svc, { ok: true, email: "service:ci-bot" });
});

test("Access tokens: an unknown key id triggers one refetch, for key rotation", async () => {
  resetAccessCache();
  const rotated = await keypair("k2");
  let keys: AccessJwk[] = [signer.jwk];
  let fetches = 0;
  const fetcher = async () => {
    fetches += 1;
    return { keys };
  };
  assert.equal((await verifyAccessJwt(await token({ email: "a@example.com" }), cfg, fetcher)).ok, true);
  keys = [signer.jwk, rotated.jwk];
  assert.equal((await verifyAccessJwt(await token({ email: "a@example.com" }, rotated), cfg, fetcher)).ok, true);
  assert.equal(fetches, 2);
});

test("the Worker names the signed-in person on the ledger and engagements, and ignores a forged name", async () => {
  resetAccessCache();
  const { fetcher } = certs([signer.jwk]);
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_CERTS: fetcher, TEAM_LEADS: " Lead@Example.com , other@example.com" };
  const as = async (email: string) => ({ "cf-access-jwt-assertion": await token({ email }), "content-type": "application/json" });
  const post = async (path: string, body: unknown, headers: Record<string, string>) =>
    worker.fetch(new Request(`http://x/api/eon/${path}`, { method: "POST", headers, body: JSON.stringify(body) }), env);

  // No token, or a bad one: refused before anything runs.
  assert.equal((await worker.fetch(new Request("http://x/api/eon/health"), env)).status, 403);
  assert.equal((await worker.fetch(new Request("http://x/"), env)).status, 403);
  const forgedOnly = { "cf-access-jwt-assertion": await token({ email: "x@example.com" }, stranger) };
  assert.equal((await worker.fetch(new Request("http://x/api/eon/health", { headers: forgedOnly }), env)).status, 403);

  const op = await as("op@example.com");
  const lead = await as("lead@example.com");
  assert.equal((await post("reset", { role: "teamlead" }, lead)).status, 200);
  for (let i = 0; i < 3; i++) assert.equal((await post("sweep", { role: "operator" }, op)).status, 200);
  // A client-sent person header must not override the verified one.
  const req = await (await post("engagements", { role: "operator", track: "T2440", method: "disrupt" }, { ...op, "x-eon-person": "lead@example.com" })).json();
  assert.equal(req.data.requestedByPerson, "op@example.com");
  const ordered = await (await post("decisions", { role: "teamlead", engagementId: req.data.id, decision: "approve" }, lead)).json();
  assert.equal(ordered.data.decidedBy, "lead@example.com");

  const pic = await (await worker.fetch(new Request("http://x/api/eon/picture?role=teamlead", { headers: lead }), env)).json();
  assert.equal(pic.viewer, "lead@example.com");
  const ledger = await (await worker.fetch(new Request("http://x/api/eon/ledger?role=teamlead", { headers: lead }), env)).json();
  const eng = ledger.entries.filter((e: { type: string }) => e.type === "engagement");
  assert.deepEqual(
    eng.map((e: { actor: string; payload: { status: string; by?: string } }) => [e.actor, e.payload.status, e.payload.by ?? null]),
    [
      ["operator", "requested", "op@example.com"],
      ["teamlead", "ordered", "lead@example.com"],
    ],
  );
  const sweeps = ledger.entries.filter((e: { type: string; actor: string }) => e.type === "sweep" || e.actor === "eon-1");
  assert.ok(sweeps.every((e: { actor: string; payload: { by?: string } }) => e.actor === "operator" || !e.payload.by), "unit entries are not attributed to a person");
});

test("without Access configured, no one is named and a client cannot name themselves", async () => {
  const res = await worker.fetch(
    new Request("http://x/api/eon/picture?role=operator", { headers: { "x-eon-person": "lead@example.com" } }),
    {},
  );
  assert.equal((await res.json()).viewer, null);
});

test("the person is kept in the action log, so a replay attributes the same decisions", async () => {
  const { Exercise, MemoryStore } = await import("./exercise.ts");
  const store = new MemoryStore();
  const first = new Exercise(store);
  for (let i = 0; i < 3; i++) await first.act({ op: "sweep", role: "operator", by: "op@example.com" });
  await first.act({ op: "engage", role: "teamlead", track: "T2440", method: "disrupt", by: "lead@example.com" });
  const head = await first.read((eon) => eon.ledger.head);
  const again = new Exercise(store);
  const [replayedHead, entry] = await again.read((eon) => [eon.ledger.head, eon.ledger.entries.findLast((e) => e.type === "engagement")!] as const);
  assert.equal(replayedHead, head);
  assert.equal(entry.payload.by, "lead@example.com");
});

test("roles are locked to sign-ins: only TEAM_LEADS may act as team lead", async () => {
  resetAccessCache();
  const { fetcher } = certs([signer.jwk]);
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_CERTS: fetcher, TEAM_LEADS: "lead@example.com" };
  const as = async (email: string, extra: Record<string, string> = {}) => ({
    "cf-access-jwt-assertion": await token({ email }),
    "content-type": "application/json",
    ...extra,
  });
  const get = async (path: string, headers: Record<string, string>) => worker.fetch(new Request(`http://x/api/eon/${path}`, { headers }), env);
  const post = async (path: string, body: unknown, headers: Record<string, string>) =>
    worker.fetch(new Request(`http://x/api/eon/${path}`, { method: "POST", headers, body: JSON.stringify(body) }), env);

  const op = await as("op@example.com");
  const forged = await as("op@example.com", { "x-eon-clearance": "teamlead" });
  const lead = await as("LEAD@example.com");

  for (const h of [op, forged]) {
    assert.equal((await get("picture?role=teamlead", h)).status, 403);
    assert.equal((await get("ledger?role=teamlead", h)).status, 403);
    assert.equal((await get("report?role=teamlead", h)).status, 403);
    const r = await post("reset", { role: "teamlead" }, h);
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /not cleared as team lead/);
    assert.equal((await post("emcon", { role: "teamlead", unitId: "eon-1", profile: "silent" }, h)).status, 403);
  }
  const opPic = await (await get("picture?role=operator", op)).json();
  assert.equal(opPic.clearance, "operator");
  assert.equal((await post("sweep", { role: "operator" }, op)).status, 200, "operators still operate");

  const leadPic = await (await get("picture?role=teamlead", lead)).json();
  assert.equal(leadPic.clearance, "teamlead", "email match ignores case");
  assert.equal((await post("reset", { role: "teamlead" }, lead)).status, 200);

  // No list: with Access on, no one is team lead.
  const none = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_CERTS: fetcher };
  const res = await worker.fetch(new Request("http://x/api/eon/picture?role=teamlead", { headers: lead }), none);
  assert.equal(res.status, 403);
});

test("without Access, roles stay open and a client cannot send itself a clearance", async () => {
  const res = await worker.fetch(new Request("http://x/api/eon/picture?role=teamlead", { headers: { "x-eon-clearance": "operator" } }), {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).clearance, null);
});
