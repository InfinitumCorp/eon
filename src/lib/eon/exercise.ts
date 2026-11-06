import { Eon } from "./service.ts";
import type { EngagementMethod, Profile, Role, ScanMode } from "./types.ts";

/**
 * Every change to the exercise is an action. The exercise is deterministic from
 * its seed, so the ordered action log is the whole state: replaying it rebuilds
 * the same picture after a restart or an eviction.
 */
export type Action = (
  | { op: "sweep"; role: Role }
  | { op: "emcon"; role: Role; unitId: string; profile: Profile }
  | { op: "ack"; role: Role; alertId: string }
  | { op: "engage"; role: Role; track: string; method: EngagementMethod }
  | { op: "decide"; role: Role; engagementId: string; decision: "approve" | "reject"; note?: string }
  | { op: "scan"; role: Role; unitId: string; mode: ScanMode }
  | { op: "battery"; role: Role; unitId: string }
  | { op: "quarantine"; role: Role; unitId: string; on: boolean }
  | { op: "reset"; role: Role }
) & {
  /** Signed-in person (Cloudflare Access) behind the action. Kept in the log so replay attributes it again. */
  by?: string;
};

export interface Outcome {
  status: number;
  body: unknown;
}

/** Run one action against an exercise and map it to an HTTP status. */
export async function applyAction(eon: Eon, a: Action): Promise<Outcome> {
  eon.person = a.by ?? null;
  try {
    return await run(eon, a);
  } finally {
    eon.person = null;
  }
}

async function run(eon: Eon, a: Action): Promise<Outcome> {
  switch (a.op) {
    case "sweep": {
      const r = await eon.sweep(a.role);
      return { status: 200, body: r };
    }
    case "emcon": {
      const r = await eon.setProfile(a.role, a.unitId, a.profile);
      return { status: r.ok ? 200 : a.role === "teamlead" ? 404 : 403, body: r };
    }
    case "ack": {
      const r = await eon.ack(a.role, a.alertId);
      return { status: r.ok ? 200 : 404, body: r };
    }
    case "engage": {
      const r = await eon.engage(a.role, a.track, a.method);
      return { status: r.ok ? 200 : 409, body: r };
    }
    case "decide": {
      const r = await eon.decide(a.role, a.engagementId, a.decision, a.note);
      return { status: r.ok ? 200 : a.role === "teamlead" ? 409 : 403, body: r };
    }
    case "scan": {
      const r = await eon.setScan(a.role, a.unitId, a.mode);
      return { status: r.ok ? 200 : 409, body: r };
    }
    case "battery": {
      const r = await eon.swapBattery(a.role, a.unitId);
      return { status: r.ok ? 200 : 404, body: r };
    }
    case "quarantine": {
      const r = await eon.quarantine(a.role, a.unitId, a.on);
      return { status: r.ok ? 200 : a.role === "teamlead" ? 404 : 403, body: r };
    }
    case "reset":
      throw new Error("Reset is handled by the exercise, not applied.");
  }
}

/** Where the action log lives: memory for local runs, Durable Object storage on Cloudflare. */
export interface ActionStore {
  load(): Promise<Action[]>;
  append(seq: number, action: Action): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryStore implements ActionStore {
  readonly log: Action[] = [];
  async load() {
    return [...this.log];
  }
  async append(seq: number, action: Action) {
    this.log[seq] = action;
  }
  async clear() {
    this.log.length = 0;
  }
}

/** Minimal slice of Durable Object storage this needs. */
export interface DurableStorageLike {
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  deleteAll(): Promise<void>;
}

const key = (seq: number) => `a:${String(seq).padStart(9, "0")}`;

export class DurableStore implements ActionStore {
  private readonly storage: DurableStorageLike;
  constructor(storage: DurableStorageLike) {
    this.storage = storage;
  }
  async load() {
    const entries = await this.storage.list<Action>({ prefix: "a:" });
    return [...entries.keys()].sort().map((k) => entries.get(k) as Action);
  }
  async append(seq: number, action: Action) {
    await this.storage.put(key(seq), action);
  }
  async clear() {
    await this.storage.deleteAll();
  }
}

/**
 * One shared exercise. Requests run one at a time so the log order is the
 * order the exercise saw them, which keeps replay exact.
 */
export class Exercise {
  private readonly store: ActionStore;
  private readonly seed: number;
  private eon: Eon | null = null;
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();
  /** Actions replayed the last time the exercise was rebuilt from storage. */
  replayed = 0;

  constructor(store: ActionStore, seed = 7) {
    this.store = store;
    this.seed = seed;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async ready(): Promise<Eon> {
    if (this.eon) return this.eon;
    const log = await this.store.load();
    const eon = await Eon.create(this.seed);
    for (const action of log) await applyAction(eon, action);
    this.eon = eon;
    this.seq = log.length;
    this.replayed = log.length;
    return eon;
  }

  read<T>(fn: (eon: Eon) => Promise<T> | T): Promise<T> {
    return this.serial(async () => fn(await this.ready()));
  }

  act(action: Action): Promise<Outcome> {
    return this.serial(async () => {
      if (action.op === "reset") {
        if (action.role !== "teamlead") return { status: 403, body: { ok: false, error: "Only the team lead resets the exercise." } };
        await this.store.clear();
        this.eon = await Eon.create(this.seed);
        this.seq = 0;
        this.replayed = 0;
        return { status: 200, body: { ok: true, tick: 0 } };
      }
      const eon = await this.ready();
      const outcome = await applyAction(eon, action);
      try {
        await this.store.append(this.seq, action);
        this.seq += 1;
      } catch (error) {
        // Memory is now ahead of storage: drop it so the next request rebuilds from the log.
        this.eon = null;
        throw error;
      }
      return outcome;
    });
  }
}
