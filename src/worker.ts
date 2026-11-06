import { CONSOLE_HTML } from "./console.ts";
import { type DurableStorageLike, DurableStore, Exercise, MemoryStore } from "./lib/eon/exercise.ts";
import { handleEonRequest } from "./lib/eon/http.ts";
import { EXERCISE } from "./lib/eon/scenario.ts";

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface Env {
  /** Durable Object holding the one shared exercise. Absent in local Node runs. */
  EXERCISE?: DurableObjectNamespaceLike;
}

const PREFIX = "/api/eon";

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
 * Serves the console at / and the API at /api/eon/*.
 */
export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);
    const splat = splatOf(url);
    if (splat !== null) {
      if (env.EXERCISE) return env.EXERCISE.get(env.EXERCISE.idFromName(EXERCISE)).fetch(request);
      local ??= new Exercise(new MemoryStore());
      return handleEonRequest(request, splat, local);
    }
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(CONSOLE_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    }
    return new Response("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
