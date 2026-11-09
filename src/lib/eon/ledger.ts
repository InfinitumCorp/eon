import type { LedgerEntry } from "./types.ts";

/**
 * Private, permissioned chain of custody for the exercise
 * (the Firmament Network™ MIL role on the product page).
 * Each entry is SHA-256 hash-chained and Ed25519-signed by this instance.
 * Nothing here is written to a public network.
 */
export const GENESIS = "0".repeat(64);

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unhex(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

type Body = Omit<LedgerEntry, "hash" | "signature">;

function bodyOf(e: Body): string {
  const { seq, prevHash, timestamp, type, actor, subject, payload } = e;
  return canonicalize({ seq, prevHash, timestamp, type, actor, subject, payload });
}

export interface VerifyResult {
  ok: boolean;
  length: number;
  brokenAt?: number;
}

/** Check a run of entries: sequence, hash chain, each hash, each signature. */
export async function verifyEntries(entries: readonly LedgerEntry[], publicKey: CryptoKey): Promise<VerifyResult> {
  let prev = GENESIS;
  for (const [i, e] of entries.entries()) {
    const broken = { ok: false, length: entries.length, brokenAt: i };
    if (e.seq !== i || e.prevHash !== prev) return broken;
    if (typeof e.signature !== "string" || !/^[0-9a-f]{128}$/.test(e.signature)) return broken;
    const hash = await sha256Hex(bodyOf(e));
    if (hash !== e.hash) return broken;
    const good = await crypto.subtle.verify({ name: "Ed25519" }, publicKey, unhex(e.signature), enc.encode(hash));
    if (!good) return broken;
    prev = e.hash;
  }
  return { ok: true, length: entries.length };
}

/** What GET /api/eon/ledger returns: everything needed to check the chain without E(O)N. */
export interface LedgerExport {
  head: string;
  entries: LedgerEntry[];
  /** Raw Ed25519 public key, hex. */
  publicKey: string;
}

/**
 * Verify an exported ledger offline, against the public key it carries. Also
 * checks that the stated head is the last entry's hash.
 */
export async function verifyExport(exp: LedgerExport): Promise<VerifyResult & { head?: string }> {
  if (!exp || !Array.isArray(exp.entries) || typeof exp.publicKey !== "string" || !/^[0-9a-f]{64}$/.test(exp.publicKey)) {
    return { ok: false, length: 0, brokenAt: 0 };
  }
  const key = await crypto.subtle.importKey("raw", unhex(exp.publicKey), { name: "Ed25519" }, false, ["verify"]);
  const r = await verifyEntries(exp.entries, key);
  if (!r.ok) return r;
  const head = exp.entries.at(-1)?.hash ?? GENESIS;
  if (exp.head !== head) return { ok: false, length: exp.entries.length, brokenAt: exp.entries.length };
  return { ...r, head };
}

export class Ledger {
  readonly entries: LedgerEntry[] = [];
  private readonly keys: CryptoKeyPair;

  private constructor(keys: CryptoKeyPair) {
    this.keys = keys;
  }

  static async create(): Promise<Ledger> {
    const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
    return new Ledger(keys);
  }

  /**
   * Raw Ed25519 public key, hex. The key belongs to this running instance: a
   * restart replays the log and re-signs with a new key, while the hash chain
   * stays the same.
   */
  async publicKeyHex(): Promise<string> {
    return hex((await crypto.subtle.exportKey("raw", this.keys.publicKey)) as ArrayBuffer);
  }

  get head(): string {
    return this.entries.at(-1)?.hash ?? GENESIS;
  }

  async append(input: { timestamp: string; type: string; actor: string; subject: string; payload: Record<string, unknown> }) {
    const body: Body = { seq: this.entries.length, prevHash: this.head, ...input };
    const canonical = bodyOf(body);
    const hash = await sha256Hex(canonical);
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, this.keys.privateKey, enc.encode(hash));
    const entry: LedgerEntry = { ...body, hash, signature: hex(sig) };
    this.entries.push(entry);
    return entry;
  }

  verify(): Promise<VerifyResult> {
    return verifyEntries(this.entries, this.keys.publicKey);
  }
}
