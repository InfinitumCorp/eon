import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderJs, renderPy } from "../scripts/handoff.ts";
import { Exercise, MemoryStore } from "../src/lib/eon/exercise.ts";
import { handleEonRequest } from "../src/lib/eon/http.ts";
import * as ts from "./eon_work.ts";

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const read = (f: string) => readFileSync(here(f), "utf8").replace(/\r\n/g, "\n");

test("the JavaScript and Python records are generated from the TypeScript one (run npm run handoff)", () => {
  assert.equal(read("eon_work.js"), renderJs().replace(/\r\n/g, "\n"));
  assert.equal(read("eon_work.py"), renderPy());
});

test("the JavaScript record exports the same data and brief", async () => {
  const js = await import("./eon_work.js");
  for (const name of ["REPO", "HEAD", "ROLES", "RULES", "COMMITS", "API", "SCENARIO", "CHECKS", "WORK", "NOT_DONE"]) {
    assert.deepEqual(js[name], (ts as Record<string, unknown>)[name], name);
  }
  assert.equal(js.brief(), ts.brief());
});

test("the Python record prints the same brief", { skip: !python() && "no Python on this machine" }, () => {
  const run = spawnSync(python()!, ["-I", "-X", "utf8", here("eon_work.py")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.replace(/\r\n/g, "\n").replace(/\n$/, ""), ts.brief());
});

test("every route in the record exists, and the record lists every documented route", async () => {
  const documented = [...readFileSync(here("../src/lib/eon/http.ts"), "utf8").matchAll(/^ \* (GET|POST) +(\/api\/eon\/[a-z]+)/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(ts.API.map((r) => `${r.method} ${r.path}`).sort(), [...new Set(documented)].sort());
  const exercise = new Exercise(new MemoryStore());
  for (const r of ts.API) {
    const splat = r.path.replace("/api/eon/", "");
    const res = await handleEonRequest(
      new Request(`http://x${r.path}?role=teamlead&unit=eon-1`, r.method === "POST" ? { method: "POST", body: "{}" } : undefined),
      splat,
      exercise,
    );
    assert.notEqual(res.status, 404, `${r.method} ${r.path}`);
  }
});

test("HEAD is a recorded commit and the integrity weights match the service", async () => {
  assert.ok(ts.COMMITS.some((c) => c.sha === ts.HEAD));
  const { CHECKS } = await import("../src/lib/eon/integrity.ts");
  assert.deepEqual(
    ts.CHECKS.map((c) => [c.check, c.weight]),
    CHECKS.map((c) => [c.check, c.weight]),
  );
});

function python(): string | null {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["-I", "-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return null;
}
