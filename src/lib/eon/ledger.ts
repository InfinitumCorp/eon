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

  async verify(): Promise<{ ok: boolean; length: number; brokenAt?: number }> {
    let prev = GENESIS;
    for (const [i, e] of this.entries.entries()) {
      if (e.seq !== i || e.prevHash !== prev) return { ok: false, length: this.entries.length, brokenAt: i };
      const hash = await sha256Hex(bodyOf(e));
      if (hash !== e.hash) return { ok: false, length: this.entries.length, brokenAt: i };
      const good = await crypto.subtle.verify({ name: "Ed25519" }, this.keys.publicKey, unhex(e.signature), enc.encode(hash));
      if (!good) return { ok: false, length: this.entries.length, brokenAt: i };
      prev = e.hash;
    }
    return { ok: true, length: this.entries.length };
  }
}
