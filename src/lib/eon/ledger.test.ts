import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Exercise, MemoryStore } from "./exercise.ts";
import { handleEonRequest } from "./http.ts";
import { type LedgerExport, verifyExport } from "./ledger.ts";

async function exported(): Promise<LedgerExport & Record<string, unknown>> {
  const exercise = new Exercise(new MemoryStore());
  for (let i = 0; i < 3; i++) await exercise.act({ op: "sweep", role: "teamlead" });
  const res = await handleEonRequest(new Request("http://x/api/eon/ledger?role=teamlead"), "ledger", exercise);
  assert.equal(res.status, 200);
  return res.json();
}

test("the ledger export carries its public key and verifies offline", async () => {
  const exp = await exported();
  assert.match(exp.publicKey, /^[0-9a-f]{64}$/);
  assert.equal(exp.tick, 3);
  const r = await verifyExport(exp);
  assert.equal(r.ok, true);
  assert.equal(r.length, exp.entries.length);
  assert.equal(r.head, exp.head);
});

test("any edit to an exported entry is caught at that entry", async () => {
  const exp = await exported();
  const at = Math.floor(exp.entries.length / 2);
  const tampered = structuredClone(exp);
  tampered.entries[at].payload = { ...tampered.entries[at].payload, note: "edited" };
  assert.deepEqual(await verifyExport(tampered), { ok: false, length: exp.entries.length, brokenAt: at });

  const dropped = structuredClone(exp);
  dropped.entries.splice(at, 1);
  assert.equal((await verifyExport(dropped)).brokenAt, at, "a removed entry breaks the chain");

  const truncated = structuredClone(exp);
  truncated.entries.pop();
  assert.equal((await verifyExport(truncated)).ok, false, "a cut-off tail no longer matches the stated head");
});

test("a re-hashed forgery fails without the private key", async () => {
  const exp = await exported();
  const other = await exported();
  const swapped = { ...exp, publicKey: other.publicKey };
  assert.equal((await verifyExport(swapped)).brokenAt, 0, "another instance's key does not verify these signatures");
  assert.equal((await verifyExport({ ...exp, publicKey: "zz" })).ok, false);
  assert.equal((await verifyExport(null as unknown as LedgerExport)).ok, false);
});

test("operators still cannot read the ledger", async () => {
  const exercise = new Exercise(new MemoryStore());
  const res = await handleEonRequest(new Request("http://x/api/eon/ledger?role=operator"), "ledger", exercise);
  assert.equal(res.status, 403);
});

test("scripts/verify-ledger.ts passes a good file and fails a tampered one", async () => {
  const exp = await exported();
  const dir = mkdtempSync(join(tmpdir(), "eon-ledger-"));
  const good = join(dir, "good.json");
  const bad = join(dir, "bad.json");
  writeFileSync(good, JSON.stringify(exp));
  const tampered = structuredClone(exp);
  tampered.entries[1].actor = "someone else";
  writeFileSync(bad, JSON.stringify(tampered));
  const script = new URL("../../../scripts/verify-ledger.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const run = (file: string) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, file], { encoding: "utf8" }) };
    } catch (error) {
      const e = error as { status: number; stdout: string };
      return { code: e.status, out: e.stdout };
    }
  };
  const ok = run(good);
  assert.equal(ok.code, 0);
  assert.match(ok.out, new RegExp(`Verified: ${exp.entries.length} entries`));
  const broken = run(bad);
  assert.equal(broken.code, 1);
  assert.match(broken.out, /BROKEN at entry 1 /);
});
