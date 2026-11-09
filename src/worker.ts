import { proxyLabyrinthRequest } from "./labyrinth/index.ts";
import { CONSOLE_HTML } from "./console.ts";
import { WRIST_HTML } from "./wrist.ts";
import { type DurableStorageLike, DurableStore, Exercise, MemoryStore, type Scheduler } from "./lib/eon/exercise.ts";
import { type AccessConfig, type CertFetcher, verifyAccessJwt } from "./lib/eon/access.ts";
import { CLEARANCE_HEADER, handleEonRequest, PERSON_HEADER } from "./lib/eon/http.ts";
import { EXERCISE } from "./lib/eon/scenario.ts";
import { EonDb, type Fetcher, supabaseConfig, TeamLeadCache } from "./lib/eon/supabase.ts";

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface AlarmStorage {
  setAlarm(scheduledTimeMs: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface Env {
  /** Central Cumulus ID Labyrinth endpoint. Never an exercise feed/product token. */
  LBRNTH_ENDPOINT?: string;
  /** Durable Object holding the one shared exercise. Absent in local Node runs. */
  EXERCISE?: DurableObjectNamespaceLike;
  /** Cloudflare Access team domain, e.g. small-band-b1e1.cloudflareaccess.com. With ACCESS_AUD, turns on token checks. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Audience tag of the Access application in front of this Worker. */
  ACCESS_AUD?: string;
  /**
   * Comma-separated emails cleared as team lead. With Access on, everyone else
   * who signs in is an operator; an empty list means no one is team lead.
   */
  TEAM_LEADS?: string;
  /** Shared Infinitum Corp Supabase project URL. With the key below, adds the eon.team_leads roster and the run archive. */
  SUPABASE_URL?: string;
  /** Service-role key, a Worker secret (wrangler secret put). Never sent to the browser. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Tests only: where to get Access signing keys. */
  ACCESS_CERTS?: CertFetcher;
  /** Tests only: how to reach Supabase. */
  SUPABASE_FETCH?: Fetcher;
}

function eonDb(env: Env): EonDb | null {
  const cfg = supabaseConfig(env);
  return cfg ? new EonDb(cfg, env.SUPABASE_FETCH) : null;
}

let leadCache = new TeamLeadCache();

/** Tests only: forget the cached team-lead roster. */
export function resetTeamLeadCache(): void {
  leadCache = new TeamLeadCache();
}

function accessConfig(env: Env): AccessConfig | null {
  return env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD ? { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD } : null;
}

/** Team lead if TEAM_LEADS or the eon.team_leads roster in Supabase names the person. */
async function clearanceOf(person: string | null, env: Env): Promise<"teamlead" | "operator"> {
  if (!person) return "operator";
  const email = person.toLowerCase();
  const leads = (env.TEAM_LEADS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (leads.includes(email)) return "teamlead";
  const db = eonDb(env);
  if (db && (await leadCache.get(db)).includes(email)) return "teamlead";
  return "operator";
}

/**
 * Who is making this request. With Access configured, the Access JWT must
 * verify or the request is refused; without it (local runs) no one is named.
 */
async function identify(request: Request, env: Env): Promise<{ ok: true; person: string | null } | { ok: false; error: string }> {
  const cfg = accessConfig(env);
  if (!cfg) return { ok: true, person: null };
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, error: "Sign in through Cloudflare Access." };
  try {
    const r = await verifyAccessJwt(token, cfg, env.ACCESS_CERTS);
    return r.ok ? { ok: true, person: r.email } : r;
  } catch {
    return { ok: false, error: "Could not check the Access sign-in. Try again." };
  }
}

const PREFIX = "/api/eon";

const PAGES: Record<string, string> = { "/": CONSOLE_HTML, "/wrist": WRIST_HTML };

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function splatOf(url: URL): string | null {
  if (url.pathname === "/health") return "health";
  if (url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`)) return url.pathname.slice(PREFIX.length).replace(/^\//, "");
  return null;
}

/**
 * Durable Object for Exercise QUIETFIELD. Every request for the exercise lands
 * here, so every viewer sees the same picture. The action log lives in this
 * object's storage and is replayed whenever the object starts.
 */
export class EonExercise {
  private readonly exercise: Exercise;

  constructor(state: { storage: DurableStorageLike & AlarmStorage }, env: Env = {}) {
    // The live clock is a Durable Object alarm: it survives restarts and deploys.
    const scheduler: Scheduler = {
      set: (atMs) => state.storage.setAlarm(atMs),
      clear: () => state.storage.deleteAlarm(),
    };
    this.exercise = new Exercise(new DurableStore(state.storage), 7, scheduler);
    const db = eonDb(env);
    if (db) this.exercise.archive = (run) => db.archiveRun(run);
  }

  async alarm(): Promise<void> {
    await this.exercise.tick();
  }

  fetch(request: Request): Promise<Response> {
    const splat = splatOf(new URL(request.url)) ?? "";
    return handleEonRequest(request, splat, this.exercise);
  }
}

/** Local Node runs have no Durable Objects; they keep the log in memory and tick on a timer. */
let local: Exercise | null = null;

function localExercise(): Exercise {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exercise: Exercise = new Exercise(new MemoryStore(), 7, {
    async set(atMs) {
      clearTimeout(timer);
      timer = setTimeout(() => void exercise.tick(), Math.max(0, atMs - Date.now()));
      // Do not hold a Node process open just for the clock.
      (timer as { unref?: () => void }).unref?.();
    },
    async clear() {
      clearTimeout(timer);
    },
  });
  return exercise;
}

/**
 * Cloudflare Worker entry for the E(O)N™ MIL exercise.
 * Serves the console at /, the wrist display at /wrist and the API at /api/eon/*.
 */
export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);
    const who = await identify(request, env);
    if (!who.ok) return Response.json({ ok: false, error: who.error }, { status: 403, headers: { "cache-control": "no-store" } });
    if (url.pathname === "/api/labyrinth") return proxyLabyrinthRequest(request, env.LBRNTH_ENDPOINT, "eon");
    const splat = splatOf(url);
    if (splat !== null) {
      // Only the Worker names the person; never pass on a copy the client sent.
      const headers = new Headers(request.headers);
      headers.delete(PERSON_HEADER);
      headers.delete(CLEARANCE_HEADER);
      if (who.person) headers.set(PERSON_HEADER, who.person);
      // With Access on, the role a person may take comes from TEAM_LEADS, not from the request.
      if (accessConfig(env)) headers.set(CLEARANCE_HEADER, await clearanceOf(who.person, env));
      const inner = new Request(request, { headers });
      if (env.EXERCISE) return env.EXERCISE.get(env.EXERCISE.idFromName(EXERCISE)).fetch(inner);
      if (!local) {
        local = localExercise();
        const db = eonDb(env);
        if (db) local.archive = (run) => db.archiveRun(run);
      }
      return handleEonRequest(inner, splat, local);
    }
    const page = request.method === "GET" ? PAGES[url.pathname] : undefined;
    if (page) return new Response(page, { headers: PAGE_HEADERS });
    return new Response("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
