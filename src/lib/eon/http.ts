import { EXERCISE } from "./scenario.ts";
import { getEon, resetEon } from "./service.ts";
import type { Profile, Role } from "./types.ts";

const ROLES = new Set<Role>(["operator", "teamlead"]);
const PROFILES = new Set<Profile>(["normal", "reduced", "silent"]);

class BadRequest extends Error {}

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

/**
 * HTTP contract for the E(O)N™ MIL exercise backend.
 * GET  /api/eon/health
 * GET  /api/eon/picture?role=operator|teamlead
 * GET  /api/eon/ledger?role=teamlead
 * POST /api/eon/sweep  { role }
 * POST /api/eon/emcon  { role, unitId, profile }   team lead only
 * POST /api/eon/ack    { role, alertId }
 * POST /api/eon/engagements { role, track, method: disrupt|handoff }   operator requests, team lead orders
 * POST /api/eon/decisions   { role, engagementId, decision: approve|reject, note? }   team lead only
 * POST /api/eon/scan      { role, unitId, mode: wide|economy }
 * POST /api/eon/battery   { role, unitId }          battery swap
 * GET  /api/eon/report?role=teamlead                after-action report
 * POST /api/eon/reset  { role }                    team lead only
 */
export async function handleEonRequest(request: Request, splat: string): Promise<Response> {
  const path = splat.replace(/^\/+|\/+$/g, "");
  const url = new URL(request.url);
  try {
    const eon = await getEon();
    if (request.method === "GET") {
      if (path === "health" || path === "") {
        const ledger = await eon.verify();
        return json({
          ok: ledger.ok,
          product: "E(O)N™ MIL",
          exercise: EXERCISE,
          tick: eon.tick,
          ledger,
          note: "Simulated exercise. Not for operational use. Counter-drone engagements are recorded decisions; no signal is modelled. Private ledger. No data sale.",
        });
      }
      if (path === "picture") return json(await eon.picture(role(url.searchParams.get("role"))));
      if (path === "report") {
        const result = eon.report(role(url.searchParams.get("role")));
        return json(result, result.ok ? 200 : 403);
      }
      if (path === "ledger") {
        const r = role(url.searchParams.get("role"));
        if (r !== "teamlead") return json({ ok: false, error: "Only the team lead reads the ledger." }, 403);
        const verify = await eon.verify();
        return json({ ok: verify.ok, head: eon.ledger.head, length: verify.length, entries: eon.ledger.entries });
      }
      return json({ ok: false, error: "Not found." }, 404);
    }
    if (request.method !== "POST") return json({ ok: false, error: "Not found." }, 404);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (path === "sweep") return json(await eon.sweep(role(body.role)));
    if (path === "emcon") {
      const r = role(body.role);
      const profile = text(body.profile, "profile") as Profile;
      if (!PROFILES.has(profile)) throw new BadRequest("Profile must be normal, reduced or silent.");
      const result = await eon.setProfile(r, text(body.unitId, "unitId"), profile);
      return json(result, result.ok ? 200 : r === "teamlead" ? 404 : 403);
    }
    if (path === "ack") {
      const result = await eon.ack(role(body.role), text(body.alertId, "alertId"));
      return json(result, result.ok ? 200 : 404);
    }
    if (path === "engagements") {
      const r = role(body.role);
      const method = text(body.method, "method");
      if (method !== "disrupt" && method !== "handoff") throw new BadRequest("Method must be disrupt or handoff.");
      const result = await eon.engage(r, text(body.track, "track"), method);
      return json(result, result.ok ? 200 : 409);
    }
    if (path === "decisions") {
      const r = role(body.role);
      const decision = text(body.decision, "decision");
      if (decision !== "approve" && decision !== "reject") throw new BadRequest("Decision must be approve or reject.");
      const note = typeof body.note === "string" ? body.note.slice(0, 280) : undefined;
      const result = await eon.decide(r, text(body.engagementId, "engagementId"), decision, note);
      return json(result, result.ok ? 200 : r === "teamlead" ? 409 : 403);
    }
    if (path === "scan") {
      const mode = text(body.mode, "mode");
      if (mode !== "wide" && mode !== "economy") throw new BadRequest("Scan must be wide or economy.");
      const result = await eon.setScan(role(body.role), text(body.unitId, "unitId"), mode);
      return json(result, result.ok ? 200 : 409);
    }
    if (path === "battery") {
      const result = await eon.swapBattery(role(body.role), text(body.unitId, "unitId"));
      return json(result, result.ok ? 200 : 404);
    }
    if (path === "reset") {
      if (role(body.role) !== "teamlead") return json({ ok: false, error: "Only the team lead resets the exercise." }, 403);
      const fresh = await resetEon();
      return json({ ok: true, tick: fresh.tick });
    }
    return json({ ok: false, error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof BadRequest) return json({ ok: false, error: error.message }, 400);
    return json({ ok: false, error: error instanceof Error ? error.message : "The exercise backend failed." }, 500);
  }
}
