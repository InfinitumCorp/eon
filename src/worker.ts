import { CONSOLE_HTML } from "./console.ts";
import { WRIST_HTML } from "./wrist.ts";
import { type DurableStorageLike, DurableStore, Exercise, MemoryStore } from "./lib/eon/exercise.ts";
import { type AccessConfig, type CertFetcher, verifyAccessJwt } from "./lib/eon/access.ts";
import { CLEARANCE_HEADER, handleEonRequest, PERSON_HEADER } from "./lib/eon/http.ts";
import { EXERCISE } from "./lib/eon/scenario.ts";

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface Env {
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
  /** Tests only: where to get Access signing keys. */
  ACCESS_CERTS?: CertFetcher;
}

function accessConfig(env: Env): AccessConfig | null {
  return env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD ? { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD } : null;
}

function clearanceOf(person: string | null, env: Env): "teamlead" | "operator" {
  const leads = (env.TEAM_LEADS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return person && leads.includes(person.toLowerCase()) ? "teamlead" : "operator";
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

  constructor(state: { storage: DurableStorageLike }) {
    this.exercise = new Exercise(new DurableStore(state.storage));
  }

  fetch(request: Request): Promise<Response> {
    const splat = splatOf(new URL(request.url)) ?? "";
    return handleEonRequest(request, splat, this.exercise);
  }
}

/** Local Node runs have no Durable Objects; they keep the log in memory. */
let local: Exercise | null = null;

/**
 * Cloudflare Worker entry for the E(O)N™ MIL exercise.
 * Serves the console at /, the wrist display at /wrist and the API at /api/eon/*.
 */
export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);
    const who = await identify(request, env);
    if (!who.ok) return Response.json({ ok: false, error: who.error }, { status: 403, headers: { "cache-control": "no-store" } });
    const splat = splatOf(url);
    if (splat !== null) {
      // Only the Worker names the person; never pass on a copy the client sent.
      const headers = new Headers(request.headers);
      headers.delete(PERSON_HEADER);
      headers.delete(CLEARANCE_HEADER);
      if (who.person) headers.set(PERSON_HEADER, who.person);
      // With Access on, the role a person may take comes from TEAM_LEADS, not from the request.
      if (accessConfig(env)) headers.set(CLEARANCE_HEADER, clearanceOf(who.person, env));
      const inner = new Request(request, { headers });
      if (env.EXERCISE) return env.EXERCISE.get(env.EXERCISE.idFromName(EXERCISE)).fetch(inner);
      local ??= new Exercise(new MemoryStore());
      return handleEonRequest(inner, splat, local);
    }
    const page = request.method === "GET" ? PAGES[url.pathname] : undefined;
    if (page) return new Response(page, { headers: PAGE_HEADERS });
    return new Response("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
