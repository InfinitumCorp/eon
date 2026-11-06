import { Ledger } from "./ledger.ts";
import { bearingDeg, classify, dbmToMw, distance, intersectBearings, makeRng, mwToDbm, pathLossDb, rangeForLossM } from "./rf.ts";
import {
  BEARING_SIGMA_DEG,
  DRAIN,
  EMITTERS,
  EXERCISE,
  FRIENDLY_REGISTRY,
  INERTIAL_DRIFT,
  LINK_CLEAR_SINR_DB,
  LINK_MIN_SINR_DB,
  LINK_PATHS,
  LINK_SIGNAL_DBM,
  NAV_TOLERANCE_M,
  NOISE_FLOOR_DBM,
  POWER_SAVE_PCT,
  PROFILE_EIRP,
  SENSITIVITY_DBM,
  SPOOF,
  START_BATTERY,
  START_MS,
  TICK_SECONDS,
  UNITS,
  WARDEN_TICKS,
} from "./scenario.ts";
import type {
  Affiliation,
  Alert,
  AlertKind,
  Detection,
  EmitterClass,
  EmitterTruth,
  Engagement,
  EngagementMethod,
  Fix,
  LinkState,
  NavState,
  Picture,
  Point,
  Profile,
  Report,
  Result,
  Role,
  ScanMode,
  UnitView,
} from "./types.ts";

interface UnitState {
  id: string;
  callsign: string;
  truePos: Point;
  reportedPos: Point;
  profile: Profile;
  pathIndex: number;
  link: LinkState;
  nav: NavState;
  trustedPos: Point;
  trustedTick: number;
  held: Detection[];
  jamAlerted: boolean;
  scan: ScanMode;
  scanAuto: boolean;
  battery: number;
  linkTicks: { clear: number; degraded: number; jammed: number };
  switches: number;
}

const CLASS_LABEL: Record<EmitterClass, string> = {
  "voice-radio": "Voice radio",
  "data-link": "Data link",
  "drone-control": "Drone control link",
  "drone-video": "Drone video link",
  "search-radar": "Search radar",
  "wideband-noise": "Wideband noise",
  unknown: "Unknown emitter",
};

const DRONE = new Set<EmitterClass>(["drone-control", "drone-video"]);
/** Minimum classifier confidence before a counter-drone warning goes out. */
const DRONE_CONFIDENCE = 0.6;
/** Jamming is declared when the in-band noise floor rises this much, dB. */
const JAM_RISE_DB = 6;

const round = (n: number, places = 0) => Math.round(n * 10 ** places) / 10 ** places;
const pad3 = (deg: number) => String(Math.round(deg) % 360).padStart(3, "0");
const grid = (p: Point) => `${Math.round(p.x)} E ${Math.round(p.y)} N`;

function overlaps(e: EmitterTruth, freqMHz: number, halfWidthMHz: number) {
  return Math.abs(e.freqMHz - freqMHz) <= halfWidthMHz + e.features.bandwidthKHz / 2000;
}

/**
 * E(O)N™ MIL exercise service.
 * One simulated team of four wearers in Exercise QUIETFIELD:
 * sense the spectrum, protect the team link, control each wearer's
 * signature and share detections into a common picture.
 * Simulation only. Counter-drone engagements are decisions with recorded outcomes;
 * no jamming or other signal is modelled or generated.
 */
export class Eon {
  tick = 0;
  private units: UnitState[];
  private shared: Detection[] = [];
  private fixes = new Map<string, Fix>();
  private alerts: Alert[] = [];
  private alertKeys = new Set<string>();
  private rng: ReturnType<typeof makeRng>;
  private seq = 0;
  private tracks: { id: string; freqMHz: number; emitterId: string }[] = [];
  private engagements: Engagement[] = [];
  /** Platform id -> tick from which it no longer emits. */
  private ended = new Map<string, number>();

  readonly ledger: Ledger;

  private constructor(ledger: Ledger, seed: number) {
    this.ledger = ledger;
    this.rng = makeRng(seed);
    this.units = UNITS.map((u) => ({
      id: u.id,
      callsign: u.callsign,
      truePos: { ...u.pos },
      reportedPos: { ...u.pos },
      profile: "normal",
      pathIndex: 0,
      link: { pathId: LINK_PATHS[0].id, pathLabel: LINK_PATHS[0].label, sinrDb: round(LINK_SIGNAL_DBM - NOISE_FLOOR_DBM, 1), status: "clear", noiseRiseDb: 0 },
      nav: { status: "assured", source: "gnss", disagreementM: 0 },
      trustedPos: { ...u.pos },
      trustedTick: 0,
      held: [],
      jamAlerted: false,
      scan: "wide",
      scanAuto: false,
      battery: START_BATTERY[u.id] ?? 100,
      linkTicks: { clear: 0, degraded: 0, jammed: 0 },
      switches: 0,
    }));
  }

  static async create(seed = 7): Promise<Eon> {
    const eon = new Eon(await Ledger.create(), seed);
    await eon.record("exercise", "control", EXERCISE, { units: UNITS.map((u) => u.id), note: "Simulated exercise. Not for operational use." });
    return eon;
  }

  get time(): string {
    return new Date(START_MS + this.tick * TICK_SECONDS * 1000).toISOString();
  }

  private record(type: string, actor: string, subject: string, payload: Record<string, unknown>) {
    return this.ledger.append({ timestamp: this.time, type, actor, subject, payload });
  }

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private alert(key: string, kind: AlertKind, unitId: string | null, text: string) {
    if (this.alertKeys.has(key)) return null;
    this.alertKeys.add(key);
    const a: Alert = { id: this.nextId("alert"), tick: this.tick, kind, unitId, text, acked: false };
    this.alerts.push(a);
    return a;
  }

  private active(): EmitterTruth[] {
    return EMITTERS.filter((e) => {
      const stop = e.platform ? this.ended.get(e.platform) : undefined;
      return this.tick >= e.from && this.tick < e.to && (stop === undefined || this.tick < stop);
    });
  }

  /** Advance the exercise by one tick. Any role may sweep. */
  async sweep(role: Role): Promise<Result<{ tick: number; alerts: Alert[] }>> {
    if (role !== "operator" && role !== "teamlead") return { ok: false, error: "Unknown role." };
    this.tick += 1;
    const before = this.alerts.length;
    await this.resolveEngagements();
    const emitters = this.active();
    for (const unit of this.units) {
      await this.updateNav(unit);
      await this.updateLink(unit, emitters);
      unit.linkTicks[unit.link.status] += 1;
      // Economy scan revisits every other tick.
      if (unit.battery > 0 && (unit.scan === "wide" || this.tick % 2 === 0)) await this.sense(unit, emitters);
      await this.drain(unit);
    }
    await this.updateFixes();
    await this.warn();
    return { ok: true, data: { tick: this.tick, alerts: this.alerts.slice(before) } };
  }

  /** GNSS against inertial. A large disagreement means GNSS is not trusted. */
  private async updateNav(unit: UnitState) {
    const spoofing = unit.id === SPOOF.unitId && this.tick >= SPOOF.from && this.tick < SPOOF.to;
    const gnss = spoofing ? { x: unit.truePos.x + SPOOF.metresPerTick * (this.tick - SPOOF.from + 1), y: unit.truePos.y } : { ...unit.truePos };
    const elapsed = this.tick - unit.trustedTick;
    const inertial = { x: unit.trustedPos.x + INERTIAL_DRIFT.x * elapsed, y: unit.trustedPos.y + INERTIAL_DRIFT.y * elapsed };
    const disagreementM = round(distance(gnss, inertial), 1);
    const was = unit.nav.status;
    if (disagreementM > NAV_TOLERANCE_M) {
      unit.nav = { status: "spoofed", source: "inertial", disagreementM };
      unit.reportedPos = inertial;
      if (was !== "spoofed") {
        this.alertKeys.delete(`gnss:${unit.id}`);
        this.alert(`gnss:${unit.id}`, "gnss", unit.id, `GNSS spoofing suspected at ${unit.callsign}. GNSS and inertial disagree by ${Math.round(disagreementM)} m. Holding position on inertial.`);
        await this.record("nav", unit.id, unit.callsign, { status: "spoofed", disagreementM, source: "inertial" });
      }
    } else {
      unit.nav = { status: "assured", source: "gnss", disagreementM };
      unit.reportedPos = gnss;
      unit.trustedPos = gnss;
      unit.trustedTick = this.tick;
      if (was === "spoofed") await this.record("nav", unit.id, unit.callsign, { status: "assured", disagreementM, source: "gnss" });
    }
  }

  private pathState(unit: UnitState, index: number, emitters: EmitterTruth[]): LinkState {
    const path = LINK_PATHS[index];
    let interferenceMw = 0;
    for (const e of emitters) {
      if (!overlaps(e, path.freqMHz, path.halfWidthMHz)) continue;
      interferenceMw += dbmToMw(e.eirpDbm - pathLossDb(distance(unit.truePos, e.pos), e.freqMHz));
    }
    const totalDbm = mwToDbm(dbmToMw(NOISE_FLOOR_DBM) + interferenceMw);
    const sinrDb = round(LINK_SIGNAL_DBM - totalDbm, 1);
    const status = sinrDb >= LINK_CLEAR_SINR_DB ? "clear" : sinrDb >= LINK_MIN_SINR_DB ? "degraded" : "jammed";
    return { pathId: path.id, pathLabel: path.label, sinrDb, status, noiseRiseDb: round(totalDbm - NOISE_FLOOR_DBM, 1) };
  }

  /** Electronic protection: detect jamming, then hop to the clearest usable path. */
  private async updateLink(unit: UnitState, emitters: EmitterTruth[]) {
    const states = LINK_PATHS.map((_, i) => this.pathState(unit, i, emitters));
    const current = states[unit.pathIndex];
    let target = unit.pathIndex;
    if (current.sinrDb < LINK_MIN_SINR_DB) {
      const usable = states.findIndex((s) => s.sinrDb >= LINK_MIN_SINR_DB);
      if (usable >= 0) target = usable;
    } else if (unit.pathIndex !== 0 && states[0].sinrDb >= LINK_CLEAR_SINR_DB) {
      target = 0;
    }
    const worst = states.reduce((a, b) => (b.noiseRiseDb > a.noiseRiseDb ? b : a));
    if (worst.noiseRiseDb >= JAM_RISE_DB && !unit.jamAlerted) {
      unit.jamAlerted = true;
      this.alertKeys.delete(`jam:${unit.id}`);
      const action = target !== unit.pathIndex ? ` Switched to ${LINK_PATHS[target].label}.` : ` Holding ${LINK_PATHS[unit.pathIndex].label} at ${current.sinrDb} dB SINR.`;
      this.alert(`jam:${unit.id}`, "jamming", unit.id, `Jamming on ${worst.pathLabel} at ${unit.callsign}: noise floor up ${worst.noiseRiseDb} dB.${action}`);
    } else if (worst.noiseRiseDb < JAM_RISE_DB) {
      unit.jamAlerted = false;
    }
    if (target !== unit.pathIndex) {
      await this.record("link", unit.id, unit.callsign, { from: LINK_PATHS[unit.pathIndex].id, to: LINK_PATHS[target].id, sinrDb: states[target].sinrDb });
      unit.switches += 1;
      unit.pathIndex = target;
    }
    unit.link = states[unit.pathIndex];
  }

  /** Electronic support: listen, classify, take a bearing. */
  private async sense(unit: UnitState, emitters: EmitterTruth[]) {
    for (const e of emitters) {
      const rssi = e.eirpDbm - pathLossDb(distance(unit.truePos, e.pos), e.freqMHz) + this.rng.gauss(1);
      if (rssi < SENSITIVITY_DBM) continue;
      const f = e.features;
      const measured = {
        bandwidthKHz: f.bandwidthKHz * 10 ** this.rng.gauss(0.04),
        hopRateHz: Math.max(0, (1 + f.hopRateHz) * 10 ** this.rng.gauss(0.03) - 1),
        dutyCycle: Math.min(1, Math.max(0, f.dutyCycle + this.rng.gauss(0.03))),
        pulsed: f.pulsed,
        flatness: Math.min(1, Math.max(0, f.flatness + this.rng.gauss(0.04))),
      };
      const { cls, confidence } = classify(measured);
      const freqMHz = round(e.freqMHz + this.rng.gauss(0.01), 2);
      const track = this.trackFor(freqMHz, e.id);
      const detection: Detection = {
        id: this.nextId("det"),
        tick: this.tick,
        unitId: unit.id,
        callsign: unit.callsign,
        track,
        freqMHz,
        rssiDbm: round(rssi, 1),
        bearingDeg: round((bearingDeg(unit.truePos, e.pos) + this.rng.gauss(BEARING_SIGMA_DEG) + 360) % 360, 1),
        cls,
        confidence,
        affiliation: affiliationOf(freqMHz, cls),
        from: { x: round(unit.reportedPos.x, 1), y: round(unit.reportedPos.y, 1) },
      };
      if (unit.profile === "silent") unit.held.push(detection);
      else await this.share(detection);
    }
  }

  /** Associate a measurement with a track by centre frequency (within 0.5 MHz). */
  private trackFor(freqMHz: number, emitterId: string): string {
    const hit = this.tracks.find((t) => Math.abs(t.freqMHz - freqMHz) <= 0.5);
    if (hit) return hit.id;
    let id = `T${Math.round(freqMHz)}`;
    while (this.tracks.some((t) => t.id === id)) id += "'";
    // emitterId stays server-side: exercise control uses it to apply outcomes and score.
    this.tracks.push({ id, freqMHz, emitterId });
    return id;
  }

  private async share(d: Detection) {
    this.shared.push(d);
    await this.record("detection", d.unitId, d.track, {
      id: d.id,
      tick: d.tick,
      cls: d.cls,
      confidence: d.confidence,
      freqMHz: d.freqMHz,
      bearingDeg: d.bearingDeg,
      rssiDbm: d.rssiDbm,
    });
  }

  /** Cooperative geolocation from bearings that reached the shared picture. */
  private async updateFixes() {
    const byTrack = new Map<string, Detection[]>();
    for (const d of this.shared) byTrack.set(d.track, [...(byTrack.get(d.track) ?? []), d]);
    for (const [track, dets] of byTrack) {
      const ticks = [...new Set(dets.map((d) => d.tick))].sort((a, b) => b - a);
      for (const t of ticks) {
        const lines = dets.filter((d) => d.tick === t);
        if (new Set(lines.map((d) => d.unitId)).size < 2) continue;
        const hit = intersectBearings(lines.map((d) => ({ from: d.from, bearingDeg: d.bearingDeg })), BEARING_SIGMA_DEG);
        if (!hit) continue;
        const prev = this.fixes.get(track);
        if (prev && prev.tick === t && prev.bearings === lines.length) break;
        const counts = new Map<EmitterClass, number>();
        for (const d of lines) counts.set(d.cls, (counts.get(d.cls) ?? 0) + 1);
        const cls = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const fix: Fix = { track, cls, affiliation: affiliationOf(lines[0].freqMHz, cls), tick: t, pos: { x: round(hit.pos.x), y: round(hit.pos.y) }, errorM: round(hit.errorM), bearings: lines.length };
        this.fixes.set(track, fix);
        await this.record("fix", "team", track, { ...fix });
        break;
      }
    }
  }

  /** Counter-drone and radar warnings to the whole team. */
  private async warn() {
    const seenNow = this.shared.filter((d) => d.tick === this.tick);
    const tracks = new Set(seenNow.map((d) => d.track));
    for (const track of tracks) {
      const dets = seenNow.filter((d) => d.track === track);
      const best = dets.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      const fix = this.fixes.get(track);
      const where = fix && fix.tick === this.tick ? ` Fix ${grid(fix.pos)} ±${fix.errorM} m.` : "";
      const nearest = dets.reduce((a, b) => (b.rssiDbm > a.rssiDbm ? b : a));
      const bearing = ` Bearing ${pad3(nearest.bearingDeg)}° from ${nearest.callsign}.`;
      if (DRONE.has(best.cls) && best.confidence >= DRONE_CONFIDENCE && best.affiliation === "hostile") {
        this.alert(`drone:${track}`, "drone", null, `Hostile ${CLASS_LABEL[best.cls].toLowerCase()} ${track} (${best.freqMHz} MHz).${bearing}${where}`);
      } else if (best.cls === "search-radar") {
        this.alert(`radar:${track}`, "radar", null, `Search radar ${track} illuminating the team.${bearing}${where}`);
      }
    }
    // A drone track that goes quiet can warn again if it comes back.
    for (const key of [...this.alertKeys]) {
      if (key.startsWith("drone:") && !tracks.has(key.slice(6))) this.alertKeys.delete(key);
    }
  }

  /**
   * Rules-of-engagement checks for a counter-drone engagement.
   * Returns the reason it is refused, or null when it may be ordered.
   */
  private roeCheck(track: string, method: EngagementMethod): string | null {
    const meta = this.tracks.find((t) => t.id === track);
    if (!meta) return `No track ${track}.`;
    const fix = this.fixes.get(track);
    const cls = fix?.cls ?? this.shared.findLast((d) => d.track === track)?.cls;
    if (!cls || !DRONE.has(cls)) return `${track} is not a drone link.`;
    const friendly = FRIENDLY_REGISTRY.find((f) => Math.abs(f.freqMHz - meta.freqMHz) <= f.halfWidthMHz);
    if (friendly) return `${track} is friendly (${friendly.label}). Engagement refused.`;
    if (!fix) return `No fix on ${track}. Locate it before engaging.`;
    const platform = this.platformOf(track);
    const done = this.engagements.find((e) => (e.status === "effective" || e.status === "intercepted") && this.platformOf(e.track) === platform);
    if (done) return `${track} is on an airframe already defeated by ${done.id}.`;
    const lastHeard = Math.max(-1, ...this.shared.filter((d) => d.track === track).map((d) => d.tick));
    if (this.tick - lastHeard > 1) return `${track} has not been heard since tick ${lastHeard}. Sweep again before engaging.`;
    if (this.tick - fix.tick > 1) return `The fix on ${track} is from tick ${fix.tick} and is stale. Sweep again before engaging.`;
    if (method === "disrupt") {
      const halfMHz = (EMITTERS.find((e) => e.id === meta.emitterId)?.features.bandwidthKHz ?? 0) / 2000;
      const protectedBands = [
        ...FRIENDLY_REGISTRY.map((f) => ({ label: f.label, freqMHz: f.freqMHz, halfWidthMHz: f.halfWidthMHz })),
        ...LINK_PATHS.map((p) => ({ label: `team ${p.label}`, freqMHz: p.freqMHz, halfWidthMHz: p.halfWidthMHz })),
      ];
      const hit = protectedBands.find((b) => Math.abs(b.freqMHz - meta.freqMHz) <= b.halfWidthMHz + halfMHz);
      if (hit) return `Disrupting ${track} would reach ${hit.label}. Hand it to DAEMON WARDEN™ instead.`;
    }
    const open = this.engagements.find((e) => e.status === "ordered" && this.platformOf(e.track) === platform);
    if (open) return `${track} is already engaged (${open.id}).`;
    return null;
  }

  private platformOf(track: string): string | undefined {
    const meta = this.tracks.find((t) => t.id === track);
    const e = EMITTERS.find((x) => x.id === meta?.emitterId);
    return e?.platform ?? e?.id;
  }

  /**
   * Counter-drone: an operator requests, the team lead orders.
   * A team lead's request goes straight through the rules check and, if it passes, is ordered.
   */
  async engage(role: Role, track: string, method: EngagementMethod): Promise<Result<Engagement>> {
    if (method !== "disrupt" && method !== "handoff") return { ok: false, error: "Method must be disrupt or handoff." };
    const refused = this.roeCheck(track, method);
    if (refused) {
      await this.record("engagement", role, track, { method, status: "refused", reason: refused });
      return { ok: false, error: refused };
    }
    const engagement: Engagement = {
      id: this.nextId("eng"),
      track,
      method,
      status: "requested",
      requestedBy: role,
      tick: this.tick,
      outcomeTick: null,
      text: `${role === "teamlead" ? "Team lead" : "Operator"} requested ${method === "disrupt" ? "link disruption" : "WARDEN™ hand-off"} on ${track}.`,
    };
    this.engagements.push(engagement);
    await this.record("engagement", role, track, { id: engagement.id, method, status: "requested" });
    if (role === "teamlead") return this.order(engagement);
    this.alert(`req:${engagement.id}`, "engagement", null, `${engagement.text} Awaiting the team lead.`);
    return { ok: true, data: engagement };
  }

  async decide(role: Role, engagementId: string, decision: "approve" | "reject", note?: string): Promise<Result<Engagement>> {
    if (role !== "teamlead") return { ok: false, error: "Only the team lead orders an engagement." };
    const engagement = this.engagements.find((e) => e.id === engagementId);
    if (!engagement) return { ok: false, error: `No engagement ${engagementId}.` };
    if (engagement.status !== "requested") return { ok: false, error: `${engagementId} is already ${engagement.status}.` };
    if (decision === "reject") {
      engagement.status = "rejected";
      engagement.text = `Team lead rejected ${engagement.method} on ${engagement.track}.${note ? ` ${note}` : ""}`;
      await this.record("engagement", role, engagement.track, { id: engagement.id, status: "rejected", note: note ?? null });
      return { ok: true, data: engagement };
    }
    const refused = this.roeCheck(engagement.track, engagement.method);
    if (refused) return { ok: false, error: refused };
    return this.order(engagement);
  }

  private async order(engagement: Engagement): Promise<Result<Engagement>> {
    engagement.status = "ordered";
    engagement.outcomeTick = this.tick + (engagement.method === "disrupt" ? 1 : WARDEN_TICKS);
    engagement.text =
      engagement.method === "disrupt"
        ? `Ordered: disrupt the links of ${engagement.track}.`
        : `Ordered: DAEMON WARDEN™ assigned to ${engagement.track}.`;
    const fix = this.fixes.get(engagement.track);
    await this.record("engagement", "teamlead", engagement.track, {
      id: engagement.id,
      method: engagement.method,
      status: "ordered",
      fix: fix?.pos ?? null,
      outcomeTick: engagement.outcomeTick,
    });
    return { ok: true, data: engagement };
  }

  /** Apply engagement outcomes that fall due this tick. */
  private async resolveEngagements() {
    for (const e of this.engagements) {
      if (e.status !== "ordered" || e.outcomeTick === null || e.outcomeTick > this.tick) continue;
      const platform = this.platformOf(e.track);
      if (platform) this.ended.set(platform, this.tick);
      e.status = e.method === "disrupt" ? "effective" : "intercepted";
      e.text = e.method === "disrupt" ? `${e.track} lost its links and turned back.` : `DAEMON WARDEN™ intercepted ${e.track}.`;
      this.alert(`out:${e.id}`, "engagement", null, e.text);
      await this.record("engagement", "control", e.track, { id: e.id, status: e.status });
    }
  }

  private drainPerTick(unit: UnitState): number {
    return DRAIN.base + DRAIN.scan[unit.scan] + DRAIN.tx[unit.profile];
  }

  /** Power management: drain the battery and drop to economy scan when it runs low. */
  private async drain(unit: UnitState) {
    unit.battery = Math.max(0, unit.battery - this.drainPerTick(unit));
    if (unit.battery < POWER_SAVE_PCT && unit.scan === "wide") {
      unit.scan = "economy";
      unit.scanAuto = true;
      const hours = round(this.enduranceH(unit), 1);
      this.alert(`power:${unit.id}`, "power", unit.id, `${unit.callsign} battery at ${Math.round(unit.battery)}%. Switched to economy scan; about ${hours} h left. Swap the battery to restore wide scan.`);
      await this.record("power", "control", unit.callsign, { unitId: unit.id, batteryPct: round(unit.battery, 1), scan: "economy", auto: true });
    }
  }

  private enduranceH(unit: UnitState): number {
    return (unit.battery / this.drainPerTick(unit)) * (TICK_SECONDS / 3600);
  }

  /** Choose a scan mode. Wide needs at least the power-save threshold. */
  async setScan(role: Role, unitId: string, mode: ScanMode): Promise<Result<UnitView>> {
    const unit = this.units.find((u) => u.id === unitId);
    if (!unit) return { ok: false, error: `No unit ${unitId}.` };
    if (mode !== "wide" && mode !== "economy") return { ok: false, error: "Scan must be wide or economy." };
    if (mode === "wide" && unit.battery < POWER_SAVE_PCT) return { ok: false, error: `${unit.callsign} is at ${Math.round(unit.battery)}%. Swap the battery before wide scan.` };
    unit.scan = mode;
    unit.scanAuto = false;
    await this.record("power", role, unit.callsign, { unitId, scan: mode, auto: false });
    return { ok: true, data: this.view(unit) };
  }

  /** Battery swap: back to full charge and wide scan. */
  async swapBattery(role: Role, unitId: string): Promise<Result<UnitView>> {
    const unit = this.units.find((u) => u.id === unitId);
    if (!unit) return { ok: false, error: `No unit ${unitId}.` };
    unit.battery = 100;
    if (unit.scanAuto) {
      unit.scan = "wide";
      unit.scanAuto = false;
    }
    this.alertKeys.delete(`power:${unit.id}`);
    await this.record("power", role, unit.callsign, { unitId, swap: true, batteryPct: 100, scan: unit.scan });
    return { ok: true, data: this.view(unit) };
  }

  /** After-action report: exercise control scores the shared picture against ground truth. */
  report(role: Role): Result<Report> {
    if (role !== "teamlead") return { ok: false, error: "Only the team lead reads the after-action report." };
    const seen = EMITTERS.filter((e) => e.from <= this.tick && e.from < e.to);
    const emitters = seen.map((e) => {
      const track = this.tracks.find((t) => t.emitterId === e.id)?.id ?? null;
      const dets = track ? this.shared.filter((d) => d.track === track) : [];
      const first = dets.length ? Math.min(...dets.map((d) => d.tick)) : null;
      const counts = new Map<EmitterClass, number>();
      for (const d of dets) counts.set(d.cls, (counts.get(d.cls) ?? 0) + 1);
      const classifiedAs = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const fix = track ? this.fixes.get(track) : undefined;
      const miss = fix ? round(distance(fix.pos, e.pos)) : null;
      return {
        emitter: e.id,
        cls: e.cls,
        track,
        activeFrom: e.from,
        detectedTick: first,
        latencyTicks: first === null ? null : first - e.from,
        classifiedAs,
        classifiedRight: classifiedAs === e.cls,
        affiliation: dets.at(-1)?.affiliation ?? null,
        fixMissM: miss,
        fixErrorM: fix?.errorM ?? null,
        insideEllipse: fix && miss !== null ? miss <= fix.errorM : null,
      };
    });
    const detected = emitters.filter((e) => e.detectedTick !== null);
    const fixed = emitters.filter((e) => e.fixMissM !== null);
    const misses = fixed.map((e) => e.fixMissM as number).sort((a, b) => a - b);
    const median = misses.length ? misses[Math.floor(misses.length / 2)] : null;
    const totalTicks = this.units.reduce((n, u) => n + u.linkTicks.clear + u.linkTicks.degraded + u.linkTicks.jammed, 0);
    const upTicks = this.units.reduce((n, u) => n + u.linkTicks.clear + u.linkTicks.degraded, 0);
    const hostile = seen.filter((e) => DRONE.has(e.cls) && !FRIENDLY_REGISTRY.some((f) => Math.abs(f.freqMHz - e.freqMHz) <= f.halfWidthMHz));
    const warned = hostile.filter((e) => {
      const track = this.tracks.find((t) => t.emitterId === e.id)?.id;
      return track && this.alerts.some((a) => a.kind === "drone" && a.text.includes(` ${track} `));
    });
    const refusals = this.ledger.entries.filter((e) => e.type === "engagement" && e.payload.status === "refused").length;
    const friendlyEngaged = this.engagements.filter((e) => e.status !== "rejected" && affiliationOfTrack(this.tracks, e.track) === "friendly").length;
    const spoofTick = this.alerts.find((a) => a.kind === "gnss")?.tick ?? null;
    const lessons: string[] = [];
    const slow = detected.filter((e) => (e.latencyTicks ?? 0) > 1);
    if (slow.length) lessons.push(`Slow first detection on ${slow.map((e) => e.track).join(", ")}. Check scan plans and economy revisit.`);
    const outside = fixed.filter((e) => e.insideEllipse === false);
    if (outside.length) lessons.push(`Fixes on ${outside.map((e) => e.track).join(", ")} fell outside their stated ellipse. Spread the team for better bearing geometry.`);
    const silent = this.units.filter((u) => u.held.length);
    if (silent.length) lessons.push(`${silent.map((u) => u.callsign).join(", ")} still hold ${silent.reduce((n, u) => n + u.held.length, 0)} unshared detections.`);
    if (hostile.length && warned.length < hostile.length) lessons.push("Not every hostile drone link raised a warning.");
    if (!lessons.length) lessons.push("No gaps found against ground truth.");
    return {
      ok: true,
      data: {
        exercise: EXERCISE,
        ticks: this.tick,
        summary: {
          emittersDetected: `${detected.length}/${emitters.length}`,
          classifiedRight: `${detected.filter((e) => e.classifiedRight).length}/${detected.length}`,
          fixesInsideEllipse: `${fixed.filter((e) => e.insideEllipse).length}/${fixed.length}`,
          medianFixMissM: median,
          linkAvailabilityPct: totalTicks ? round((upTicks / totalTicks) * 100, 1) : 100,
          hostileDronesWarned: `${warned.length}/${hostile.length}`,
          engagements: {
            ordered: this.engagements.filter((e) => ["ordered", "effective", "intercepted"].includes(e.status)).length,
            refused: refusals,
            effective: this.engagements.filter((e) => e.status === "effective").length,
            intercepted: this.engagements.filter((e) => e.status === "intercepted").length,
          },
          friendlyEngaged,
          spoofDetectedAfterTicks: spoofTick === null ? null : spoofTick - SPOOF.from,
        },
        emitters,
        links: this.units.map((u) => ({ unitId: u.id, callsign: u.callsign, ...u.linkTicks, switches: u.switches })),
        lessons,
      },
    };
  }

  /** Signature control. Only the team lead sets profiles. */
  async setProfile(role: Role, unitId: string, profile: Profile): Promise<Result<UnitView>> {
    if (role !== "teamlead") return { ok: false, error: "Only the team lead sets emission control." };
    const unit = this.units.find((u) => u.id === unitId);
    if (!unit) return { ok: false, error: `No unit ${unitId}.` };
    if (!["normal", "reduced", "silent"].includes(profile)) return { ok: false, error: "Profile must be normal, reduced or silent." };
    const from = unit.profile;
    unit.profile = profile;
    await this.record("emcon", role, unit.callsign, { unitId, from, to: profile });
    if (from === "silent" && profile !== "silent" && unit.held.length) {
      const held = unit.held.splice(0);
      for (const d of held) await this.share(d);
      await this.updateFixes();
    }
    return { ok: true, data: this.view(unit) };
  }

  async ack(role: Role, alertId: string): Promise<Result<Alert>> {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert) return { ok: false, error: `No alert ${alertId}.` };
    if (alert.acked) return { ok: true, data: alert };
    alert.acked = true;
    await this.record("ack", role, alert.id, { kind: alert.kind });
    return { ok: true, data: alert };
  }

  private view(u: UnitState): UnitView {
    const path = LINK_PATHS[u.pathIndex];
    const detectableKm = u.profile === "silent" ? 0 : round(rangeForLossM(PROFILE_EIRP[u.profile] - SENSITIVITY_DBM, path.freqMHz) / 1000, 1);
    return {
      id: u.id,
      callsign: u.callsign,
      pos: { x: round(u.reportedPos.x), y: round(u.reportedPos.y) },
      profile: u.profile,
      detectableKm,
      link: u.link,
      nav: u.nav,
      held: u.held.length,
      scan: u.scan,
      scanAuto: u.scanAuto,
      batteryPct: round(u.battery, 1),
      enduranceH: round(this.enduranceH(u), 1),
    };
  }

  async picture(role: Role): Promise<Picture> {
    const verify = await this.ledger.verify();
    const recent = this.shared.filter((d) => d.tick >= this.tick - 2);
    return {
      exercise: EXERCISE,
      role,
      tick: this.tick,
      time: this.time,
      units: this.units.map((u) => this.view(u)),
      detections: recent,
      fixes: [...this.fixes.values()].sort((a, b) => a.track.localeCompare(b.track)),
      alerts: [...this.alerts].reverse(),
      engagements: [...this.engagements].reverse(),
      ledgerOk: verify.ok,
      ledgerLength: verify.length,
      ledgerHead: this.ledger.head,
      // Operators see that the chain holds; the team lead reads it.
      ledger: role === "teamlead" ? this.ledger.entries.slice(-50) : [],
    };
  }

  verify() {
    return this.ledger.verify();
  }

  /** Exercise control only: the ground truth the picture is scored against. */
  truth() {
    return {
      emitters: this.active().map((e) => ({ id: e.id, cls: e.cls, pos: e.pos, freqMHz: e.freqMHz })),
      units: this.units.map((u) => ({ id: u.id, pos: u.truePos })),
    };
  }
}

function affiliationOf(freqMHz: number, cls: EmitterClass): Affiliation {
  if (FRIENDLY_REGISTRY.some((f) => Math.abs(f.freqMHz - freqMHz) <= f.halfWidthMHz)) return "friendly";
  return DRONE.has(cls) ? "hostile" : "unknown";
}

function affiliationOfTrack(tracks: { id: string; freqMHz: number }[], track: string): Affiliation {
  const t = tracks.find((x) => x.id === track);
  return t && FRIENDLY_REGISTRY.some((f) => Math.abs(f.freqMHz - t.freqMHz) <= f.halfWidthMHz) ? "friendly" : "hostile";
}
