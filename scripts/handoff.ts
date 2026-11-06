/**
 * Writes handoff/eon_work.js and handoff/eon_work.py from handoff/eon_work.ts,
 * so the three never drift. Run: npm run handoff. A test fails if they differ.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import * as work from "../handoff/eon_work.ts";

const dir = fileURLToPath(new URL("../handoff/", import.meta.url));

export function renderJs(): string {
  const ts = readFileSync(`${dir}eon_work.ts`, "utf8");
  const js = stripTypeScriptTypes(ts, { mode: "strip" })
    // Collapse the blank lines left where type-only declarations were removed.
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  return js.replace("./eon_work.ts", "./eon_work.js").replace("This file models", "Generated from eon_work.ts by scripts/handoff.ts. This file models");
}

function py(value: unknown, indent = ""): string {
  const next = `${indent}    `;
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((v) => `${next}${py(v, next)},`).join("\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${py(v, next)},`).join("\n")}\n${indent}}`;
}

const DATA = ["REPO", "HEAD", "EXERCISE", "PRODUCT", "PARENT", "URL", "ROLES", "RULES", "COMMITS", "FILES", "API", "PAGES", "SCENARIO", "CHECKS", "LEDGER", "WORK"] as const;

export function renderPy(): string {
  const w = work as unknown as Record<string, unknown>;
  const body = DATA.map((name) => `${name} = ${py(w[name])}`).join("\n\n");
  return `"""Handoff of the E(O)N™ MIL exercise backend.

Generated from eon_work.ts by scripts/handoff.ts. Do not edit by hand.

    from eon_work import brief, WORK, API, RULES

    print(brief())

This is a record of what was written. It is not the running service.
It models no signal, no jamming, no weapon and no real location.
"""

${body}

NOT_DONE = [item["name"] for item in WORK if not item["done"]]


def brief() -> str:
    """One page of text. Print this, or hand the string to another model."""
    lines = [
        f"{PRODUCT} exercise backend. Exercise {EXERCISE}. Inside {PARENT}.",
        REPO,
        URL,
        f"HEAD {HEAD}.",
        "",
        RULES["whatItIs"],
        "Simulation only. Not for operational use. No signal is modelled. Synthetic emitters only.",
        "Private ledger. No data sale.",
        "",
        "Done:",
        *[f"- [{'yes' if item['done'] else 'no'}] {item['name']}. {item['detail']}" for item in WORK],
        "",
        "HTTP:",
        *[f"- {route['method']} {route['path']}" for route in API],
        "",
        "Roles: operator and team lead. An operator requests. Only the team lead orders.",
    ]
    return "\\n".join(lines)


if __name__ == "__main__":
    print(brief())
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(`${dir}eon_work.js`, renderJs());
  writeFileSync(`${dir}eon_work.py`, renderPy());
  console.log("Wrote handoff/eon_work.js and handoff/eon_work.py.");
}
