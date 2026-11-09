/**
 * The Worker's link to the shared Infinitum Corp Supabase project, `eon` schema.
 *
 * Only two things live there: the team-lead roster and a record of each
 * finished run (timing, tick count, ledger head hash). The exercise picture and
 * its signed ledger stay in the Durable Object; no MIL picture data is sent.
 *
 * The service-role key is a Worker secret and never reaches the browser.
 * Without SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY nothing here runs and the
 * Worker behaves as before (TEAM_LEADS only, no archive).
 */

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** One finished exercise run, as stored in eon.exercise_runs. */
export interface RunRecord {
  exercise: string;
  /** Wall-clock time of the run's first action, ISO 8601; null if unknown. */
  started_at: string | null;
  ended_at: string;
  reason: "reset" | "limit";
  ticks: number;
  ledger_length: number;
  ledger_head: string;
  ledger_ok: boolean;
  /** Signed-in person who ended it; null when the clock's limit did. */
  ended_by: string | null;
}

export function supabaseConfig(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) return null;
  return { url, serviceKey };
}

export class EonDb {
  private readonly cfg: SupabaseConfig;
  private readonly fetcher: Fetcher;

  constructor(cfg: SupabaseConfig, fetcher: Fetcher = (input, init) => fetch(input, init)) {
    this.cfg = cfg;
    this.fetcher = fetcher;
  }

  private async rest(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.cfg.serviceKey);
    headers.set("authorization", `Bearer ${this.cfg.serviceKey}`);
    // PostgREST picks the schema from these; the `eon` schema must be exposed in the project's API settings.
    headers.set("accept-profile", "eon");
    headers.set("content-profile", "eon");
    const res = await this.fetcher(`${this.cfg.url}/rest/v1/${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status}`);
    return res;
  }

  /** Lower-cased emails of active team leads. */
  async teamLeads(): Promise<string[]> {
    const res = await this.rest("team_leads?select=email&active=eq.true");
    const rows = (await res.json()) as Array<{ email?: unknown }>;
    return rows.map((r) => (typeof r.email === "string" ? r.email.trim().toLowerCase() : "")).filter(Boolean);
  }

  async archiveRun(run: RunRecord): Promise<void> {
    await this.rest("exercise_runs", {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(run),
    });
  }
}

/**
 * Team-lead roster cached for a minute so every request does not hit Supabase.
 * A failed lookup keeps the last good list (or none) and never widens access.
 */
export class TeamLeadCache {
  private leads: string[] | null = null;
  private at = 0;
  private readonly ttlMs: number;

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
  }

  async get(db: EonDb, now = Date.now()): Promise<string[]> {
    if (this.leads && now - this.at < this.ttlMs) return this.leads;
    try {
      this.leads = await db.teamLeads();
      this.at = now;
    } catch {
      // Keep serving the last good roster; retry on the next request after a short pause.
      this.at = now - this.ttlMs + 5_000;
    }
    return this.leads ?? [];
  }
}
