import { type Action, Exercise } from "./exercise.ts";
import { EXERCISE } from "./scenario.ts";
import type { Profile, Role } from "./types.ts";

/**
 * Header the Worker sets, after verifying Cloudflare Access, to tell the
 * Durable Object who is acting. The Worker strips any copy a client sends.
 */
export const PERSON_HEADER = "x-eon-person";

/**
 * Header the Worker sets, with Cloudflare Access on, to say which role the
 * signed-in person may take. Absent in local runs, where any role goes.
 */
export const CLEARANCE_HEADER = "x-eon-clearance";

const ROLES = new Set<Role>(["operator", "teamlead"]);
const PROFILES = new Set<Profile>(["normal", "reduced", "silent"]);

class BadRequest extends Error {}
class Forbidden extends Error {}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function role(value: unknown): Role {
  if (typeof value !== "string" || !ROLES.has(value as Role)) throw new BadRequest("Role must be operator or teamlead.");
  return value as Role;
}

function text(value: unknown, field: string, max = 64): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequest(`${field} is required.`);
  return value.trim();
}

/** Turn a POST into an action, or throw BadRequest. Returns null for an unknown path. */
function parseAction(path: string, body: Record<string, unknown>): Action | null {
  const r = role(body.role);
  switch (path) {
    case "sweep":
      return { op: "sweep", role: r };
    case "emcon": {
      const profile = text(body.profile, "profile") as Profile;
      if (!PROFILES.has(profile)) throw new BadRequest("Profile must be normal, reduced or silent.");
      return { op: "emcon", role: r, unitId: text(body.unitId, "unitId"), profile };
    }
    case "ack":
      return { op: "ack", role: r, alertId: text(body.alertId, "alertId") };
    case "engagements": {
      const method = text(body.method, "method");
      if (method !== "disrupt" && method !== "handoff") throw new BadRequest("Method must be disrupt or handoff.");
      return { op: "engage", role: r, track: text(body.track, "track"), method };
    }
    case "decisions": {
      const decision = text(body.decision, "decision");
      if (decision !== "approve" && decision !== "reject") throw new BadRequest("Decision must be approve or reject.");
      const note = typeof body.note === "string" ? body.note.slice(0, 280) : undefined;
      return { op: "decide", role: r, engagementId: text(body.engagementId, "engagementId"), decision, note };
    }
    case "scan": {
      const mode = text(body.mode, "mode");
      if (mode !== "wide" && mode !== "economy") throw new BadRequest("Scan must be wide or economy.");
      return { op: "scan", role: r, unitId: text(body.unitId, "unitId"), mode };
    }
    case "battery":
      return { op: "battery", role: r, unitId: text(body.unitId, "unitId") };
    case "quarantine": {
      if (typeof body.on !== "boolean") throw new BadRequest("on must be true or false.");
      return { op: "quarantine", role: r, unitId: text(body.unitId, "unitId"), on: body.on };
    }
    case "clock": {
      if (typeof body.on !== "boolean") throw new BadRequest("on must be true or false.");
      return { op: "clock", role: r, on: body.on };
    }
    case "reset":
      return { op: "reset", role: r };
    default:
      return null;
  }
}

/**
 * HTTP contract for the E(O)N™ MIL exercise backend.
 * GET  /api/eon/health
 * GET  /api/eon/picture?role=operator|teamlead
 * GET  /api/eon/feed/odin                     read-only feed of emitter fixes for ODIN°™
 * GET  /api/eon/wrist?unit=eon-1                  one wearer's wrist display
 * GET  /api/eon/ledger?role=teamlead
 * GET  /api/eon/report?role=teamlead                after-action report
 * POST /api/eon/sweep       { role }
 * POST /api/eon/emcon       { role, unitId, profile }   team lead only
 * POST /api/eon/ack         { role, alertId }
 * POST /api/eon/engagements { role, track, method: disrupt|handoff }   operator requests, team lead orders
 * POST /api/eon/decisions   { role, engagementId, decision: approve|reject, note? }   team lead only
 * POST /api/eon/scan        { role, unitId, mode: wide|economy }
 * POST /api/eon/battery     { role, unitId }          battery swap
 * POST /api/eon/quarantine  { role, unitId, on }      team lead only: withhold a device's reports
 * POST /api/eon/clock       { role, on }              team lead only: start or stop the live clock
 * POST /api/eon/reset       { role }                  team lead only
 */
export async function handleEonRequest(request: Request, splat: string, exercise: Exercise): Promise<Response> {
  const path = splat.replace(/^\/+|\/+$/g, "");
  const url = new URL(request.url);
  const person = request.headers.get(PERSON_HEADER)?.trim().slice(0, 254) || null;
  const clearance = request.headers.get(CLEARANCE_HEADER) === "teamlead" ? "teamlead" : request.headers.get(CLEARANCE_HEADER) ? "operator" : null;
  const cleared = (r: Role): Role => {
    if (r === "teamlead" && clearance === "operator") throw new Forbidden("Your sign-in is not cleared as team lead.");
    return r;
  };
  try {
    if (request.method === "GET") {
      if (path === "health" || path === "") {
        return json(
          await exercise.read(async (eon) => {
            const ledger = await eon.verify();
            return {
              ok: ledger.ok,
              product: "E(O)N™ MIL",
              exercise: EXERCISE,
              tick: eon.tick,
              ledger,
              note: "Simulated exercise. Not for operational use. Counter-drone engagements are recorded decisions; no signal is modelled. Private ledger. No data sale.",
            };
          }),
        );
      }
      if (path === "picture") {
        const r = cleared(role(url.searchParams.get("role")));
        return json({ ...(await exercise.read((eon) => eon.picture(r))), viewer: person, clearance });
      }
      if (path === "feed/odin") {
        return json(await exercise.read((eon) => eon.odinFeed()));
      }
      if (path === "wrist") {
        const unitId = text(url.searchParams.get("unit"), "unit");
        const result = await exercise.read((eon) => eon.wrist(unitId));
        return json(result, result.ok ? 200 : 404);
      }
      if (path === "report") {
        const r = cleared(role(url.searchParams.get("role")));
        const result = await exercise.read((eon) => eon.report(r));
        return json(result, result.ok ? 200 : 403);
      }
      if (path === "ledger") {
        const r = cleared(role(url.searchParams.get("role")));
        if (r !== "teamlead") return json({ ok: false, error: "Only the team lead reads the ledger." }, 403);
        return json(
          await exercise.read(async (eon) => {
            const verify = await eon.verify();
            return {
              ok: verify.ok,
              product: "E(O)N™ MIL",
              exercise: EXERCISE,
              tick: eon.tick,
              head: eon.ledger.head,
              length: verify.length,
              algorithm: "SHA-256 over canonical JSON, hex; Ed25519 signature over the hash",
              publicKey: await eon.ledger.publicKeyHex(),
              keyNote: "This instance's key. A restart re-signs the replayed log with a new key; the hash chain is unchanged.",
              verify: "node --experimental-strip-types scripts/verify-ledger.ts <this file>",
              entries: eon.ledger.entries,
            };
          }),
        );
      }
      return json({ ok: false, error: "Not found." }, 404);
    }
    if (request.method !== "POST") return json({ ok: false, error: "Not found." }, 404);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseAction(path, body);
    if (!parsed) return json({ ok: false, error: "Not found." }, 404);
    cleared(parsed.role);
    const action: Action = person ? { ...parsed, by: person } : parsed;
    const outcome = await exercise.act(action);
    return json(outcome.body, outcome.status);
  } catch (error) {
    if (error instanceof BadRequest) return json({ ok: false, error: error.message }, 400);
    if (error instanceof Forbidden) return json({ ok: false, error: error.message }, 403);
    return json({ ok: false, error: error instanceof Error ? error.message : "The exercise backend failed." }, 500);
  }
}
