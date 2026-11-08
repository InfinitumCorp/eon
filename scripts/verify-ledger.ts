/**
 * Check an exported E(O)N™ MIL ledger without E(O)N.
 *
 *   node --experimental-strip-types scripts/verify-ledger.ts eon-ledger-tick-12.json
 *
 * The file is what GET /api/eon/ledger?role=teamlead returns (the console's
 * "Download ledger" button saves it). Checks every entry's sequence, hash
 * chain, SHA-256 hash and Ed25519 signature against the public key in the file,
 * and that the stated head is the last hash. Exit code 0 when it verifies.
 */
import { readFileSync } from "node:fs";
import { verifyExport } from "../src/lib/eon/ledger.ts";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node --experimental-strip-types scripts/verify-ledger.ts <ledger.json>");
  process.exit(2);
}

let data: unknown;
try {
  data = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(`Could not read ${path}: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

const r = await verifyExport(data as Parameters<typeof verifyExport>[0]);
if (r.ok) {
  console.log(`Verified: ${r.length} entries, head ${r.head}.`);
} else {
  console.log(`BROKEN at entry ${r.brokenAt} of ${r.length}.`);
  process.exit(1);
}
