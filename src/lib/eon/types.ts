/** Exercise grid position in metres. x grows east, y grows north. */
export interface Point {
  x: number;
  y: number;
}

/** Exercise clearances, not accounts. */
export type Role = "operator" | "teamlead";

/** Emission-control profile worn by a unit. */
export type Profile = "normal" | "reduced" | "silent";

/** Receiver scan plan. Wide listens every tick; economy halves revisit and drain. */
export type ScanMode = "wide" | "economy";

export type EmitterClass =
  | "voice-radio"
  | "data-link"
  | "drone-control"
  | "drone-video"
  | "search-radar"
  | "wideband-noise"
  | "unknown";

/** Signal features the on-device classifier works from. */
export interface Features {
  bandwidthKHz: number;
  hopRateHz: number;
  dutyCycle: number;
  pulsed: boolean;
  /** 0 = structured signal, 1 = noise-like. */
  flatness: number;
}

/** Ground truth for a synthetic emitter. Never sent to the picture. */
export interface EmitterTruth {
  id: string;
  cls: EmitterClass;
  pos: Point;
  freqMHz: number;
  eirpDbm: number;
  features: Features;
  /** Emitters on the same airframe share a platform id. */
  platform?: string;
  /** Active from tick `from` (inclusive) to tick `to` (exclusive). */
  from: number;
  to: number;
}

export interface LinkPath {
  id: string;
  label: string;
  freqMHz: number;
  /** Half-width of the channel in MHz. */
  halfWidthMHz: number;
}

export type LinkStatus = "clear" | "degraded" | "jammed";

export interface LinkState {
  pathId: string;
  pathLabel: string;
  sinrDb: number;
  status: LinkStatus;
  noiseRiseDb: number;
}

export type NavStatus = "assured" | "spoofed";

export interface NavState {
  status: NavStatus;
  source: "gnss" | "inertial";
  /** Distance between GNSS and inertial positions, metres. */
  disagreementM: number;
}

/** Friend-or-foe call for a track. Only drone links are called hostile. */
export type Affiliation = "friendly" | "hostile" | "unknown";

export interface Detection {
  id: string;
  tick: number;
  unitId: string;
  callsign: string;
  track: string;
  freqMHz: number;
  rssiDbm: number;
  bearingDeg: number;
  cls: EmitterClass;
  confidence: number;
  affiliation: Affiliation;
  /** Position the unit reported when it took the bearing. */
  from: Point;
}

export interface Fix {
  track: string;
  cls: EmitterClass;
  affiliation: Affiliation;
  tick: number;
  pos: Point;
  /** Semi-major axis of the 95% error ellipse, metres. */
  errorM: number;
  bearings: number;
}

export type AlertKind = "drone" | "jamming" | "gnss" | "radar" | "engagement" | "power";

export type EngagementMethod = "disrupt" | "handoff";

export type EngagementStatus = "requested" | "rejected" | "ordered" | "effective" | "intercepted";

/**
 * A counter-drone engagement. An operator may request one; only the team lead
 * orders it, and only against a located, hostile drone track. The outcome is
 * recorded as an exercise result, not modelled as a signal.
 */
export interface Engagement {
  id: string;
  track: string;
  method: EngagementMethod;
  status: EngagementStatus;
  requestedBy: Role;
  tick: number;
  outcomeTick: number | null;
  text: string;
}

export interface Alert {
  id: string;
  tick: number;
  kind: AlertKind;
  unitId: string | null;
  text: string;
  acked: boolean;
}

export interface UnitView {
  id: string;
  callsign: string;
  pos: Point;
  profile: Profile;
  /** Range at which this unit's own emissions could be picked up, km. 0 when silent. */
  detectableKm: number;
  link: LinkState;
  nav: NavState;
  held: number;
  scan: ScanMode;
  /** Set when power management chose the scan mode rather than a person. */
  scanAuto: boolean;
  batteryPct: number;
  /** Hours left at the current scan mode and profile. */
  enduranceH: number;
}

export interface EmitterScore {
  emitter: string;
  cls: EmitterClass;
  track: string | null;
  activeFrom: number;
  detectedTick: number | null;
  /** Ticks from first emission to first shared detection. */
  latencyTicks: number | null;
  classifiedAs: EmitterClass | null;
  classifiedRight: boolean;
  affiliation: Affiliation | null;
  fixMissM: number | null;
  fixErrorM: number | null;
  insideEllipse: boolean | null;
}

/** Exercise control's scoring of the team against ground truth. */
export interface Report {
  exercise: string;
  ticks: number;
  summary: {
    emittersDetected: string;
    classifiedRight: string;
    fixesInsideEllipse: string;
    medianFixMissM: number | null;
    linkAvailabilityPct: number;
    hostileDronesWarned: string;
    engagements: { ordered: number; refused: number; effective: number; intercepted: number };
    friendlyEngaged: number;
    spoofDetectedAfterTicks: number | null;
  };
  emitters: EmitterScore[];
  links: { unitId: string; callsign: string; clear: number; degraded: number; jammed: number; switches: number }[];
  lessons: string[];
}

export interface LedgerEntry {
  seq: number;
  prevHash: string;
  timestamp: string;
  type: string;
  actor: string;
  subject: string;
  payload: Record<string, unknown>;
  hash: string;
  signature: string;
}

export interface Picture {
  exercise: string;
  role: Role;
  tick: number;
  time: string;
  units: UnitView[];
  detections: Detection[];
  fixes: Fix[];
  alerts: Alert[];
  engagements: Engagement[];
  ledgerOk: boolean;
  ledgerLength: number;
  ledgerHead: string;
  ledger: LedgerEntry[];
}

export interface Result<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}
