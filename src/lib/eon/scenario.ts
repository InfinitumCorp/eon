import type { EmitterTruth, LinkPath, Point } from "./types.ts";

/**
 * Exercise QUIETFIELD.
 * Every emitter, unit and signal here is synthetic. Frequencies and signal
 * features are generic placeholders, not a threat library.
 */
export const EXERCISE = "QUIETFIELD";
export const START_MS = Date.parse("2026-11-06T06:00:00Z");
export const TICK_SECONDS = 30;
export const GRID_M = 4000;

/** Receiver sensitivity of the wearable unit, dBm. */
export const SENSITIVITY_DBM = -110;
/** In-band noise floor on the team link, dBm. */
export const NOISE_FLOOR_DBM = -105;
/** Received team-link signal, dBm. */
export const LINK_SIGNAL_DBM = -75;
/** SINR needed to keep a path, dB. */
export const LINK_MIN_SINR_DB = 6;
/** SINR at which a path counts as clear, dB. */
export const LINK_CLEAR_SINR_DB = 12;
/** One-sigma bearing error of the wearable direction finder, degrees. */
export const BEARING_SIGMA_DEG = 3;
/** GNSS and inertial may disagree by this much before GNSS is distrusted, metres. */
export const NAV_TOLERANCE_M = 50;

export const UNITS: { id: string; callsign: string; pos: Point }[] = [
  { id: "eon-1", callsign: "ASH 1-1", pos: { x: 1000, y: 1000 } },
  { id: "eon-2", callsign: "ASH 1-2", pos: { x: 2600, y: 900 } },
  { id: "eon-3", callsign: "ASH 1-3", pos: { x: 1800, y: 2200 } },
  { id: "eon-4", callsign: "ASH 1-4", pos: { x: 3000, y: 2400 } },
];

/** Paths of the ÆTHER™ MIL team link, in order of preference. */
export const LINK_PATHS: LinkPath[] = [
  { id: "primary", label: "L-band primary", freqMHz: 1350, halfWidthMHz: 5 },
  { id: "alternate", label: "UHF alternate", freqMHz: 300, halfWidthMHz: 2 },
  { id: "relay", label: "Relay via DAEMON™ MIL", freqMHz: 4400, halfWidthMHz: 10 },
];

export const EMITTERS: EmitterTruth[] = [
  {
    id: "em-voice",
    cls: "voice-radio",
    pos: { x: 500, y: 3400 },
    freqMHz: 150.25,
    eirpDbm: 37,
    features: { bandwidthKHz: 12.5, hopRateHz: 0, dutyCycle: 0.3, pulsed: false, flatness: 0.2 },
    from: 0,
    to: Infinity,
  },
  {
    id: "em-data",
    cls: "data-link",
    pos: { x: 200, y: 200 },
    freqMHz: 402.5,
    eirpDbm: 33,
    features: { bandwidthKHz: 200, hopRateHz: 0, dutyCycle: 0.6, pulsed: false, flatness: 0.25 },
    from: 0,
    to: Infinity,
  },
  {
    id: "em-radar",
    cls: "search-radar",
    pos: { x: 3800, y: 3800 },
    freqMHz: 3050,
    eirpDbm: 70,
    features: { bandwidthKHz: 1000, hopRateHz: 0, dutyCycle: 0.001, pulsed: true, flatness: 0.1 },
    from: 1,
    to: Infinity,
  },
  {
    id: "em-ctrl",
    cls: "drone-control",
    pos: { x: 3500, y: 1500 },
    freqMHz: 2440,
    eirpDbm: 30,
    features: { bandwidthKHz: 500, hopRateHz: 100, dutyCycle: 0.5, pulsed: false, flatness: 0.3 },
    platform: "uas-1",
    from: 2,
    to: 8,
  },
  {
    id: "em-video",
    cls: "drone-video",
    pos: { x: 3500, y: 1500 },
    freqMHz: 5800,
    eirpDbm: 30,
    features: { bandwidthKHz: 10000, hopRateHz: 0, dutyCycle: 1, pulsed: false, flatness: 0.4 },
    platform: "uas-1",
    from: 2,
    to: 8,
  },
  {
    id: "em-blue",
    cls: "drone-control",
    pos: { x: 1500, y: 1800 },
    freqMHz: 915,
    eirpDbm: 27,
    features: { bandwidthKHz: 500, hopRateHz: 100, dutyCycle: 0.5, pulsed: false, flatness: 0.3 },
    platform: "blue-1",
    from: 1,
    to: Infinity,
  },
  {
    id: "em-noise",
    cls: "wideband-noise",
    pos: { x: 4200, y: 600 },
    freqMHz: 1350,
    eirpDbm: 40,
    features: { bandwidthKHz: 20000, hopRateHz: 0, dutyCycle: 1, pulsed: false, flatness: 1 },
    from: 3,
    to: 6,
  },
];

/**
 * Friendly emitters published to the team through ODIN°.
 * A track inside one of these channels is friendly and is never engaged.
 */
export const FRIENDLY_REGISTRY = [{ freqMHz: 915, halfWidthMHz: 1, label: "DAEMON™ MIL relay drone" }];

/** Ticks from a WARDEN™ hand-off to interception. */
export const WARDEN_TICKS = 2;

/** GNSS spoofing script: the unit's GNSS fix is dragged east while active. */
export const SPOOF = { unitId: "eon-3", from: 4, to: 7, metresPerTick: 150 };

/**
 * Scripted device-integrity findings, as each wearer's own checks would see them.
 * ASH 1-2 has a debug session attached for two ticks (a maintenance cable left in).
 * ASH 1-4 is hooked and rooted from tick 5 and stays compromised.
 */
export const INTEGRITY_EVENTS: { unitId: string; check: "root" | "debugger" | "hooking" | "emulator"; finding: string; from: number; to: number }[] = [
  { unitId: "eon-2", check: "debugger", finding: "USB debug session on the E(O)N app", from: 2, to: 4 },
  { unitId: "eon-4", check: "hooking", finding: "Code-injection framework loaded into the E(O)N app", from: 5, to: Infinity },
  { unitId: "eon-4", check: "root", finding: "Privilege-escalation binary on the system partition", from: 5, to: Infinity },
];

/** Inertial drift per tick since the last trusted GNSS fix, metres. */
export const INERTIAL_DRIFT = { x: 0.8, y: 0.6 };

/** Starting charge per unit, percent. ASH 1-4 starts the exercise on a tired battery. */
export const START_BATTERY: Record<string, number> = { "eon-1": 96, "eon-2": 88, "eon-3": 91, "eon-4": 25.1 };

/** Battery drain per 30 s tick, percent. About 7 h on wide scan and normal profile; about 10 h on economy. */
export const DRAIN = {
  base: 0.02,
  scan: { wide: 0.08, economy: 0.035 },
  tx: { normal: 0.02, reduced: 0.01, silent: 0 },
};

/** Power management moves a unit to economy scan below this charge, percent. */
export const POWER_SAVE_PCT = 25;

/** Own-emission EIRP by profile, dBm. Silent does not transmit. */
export const PROFILE_EIRP: Record<"normal" | "reduced", number> = { normal: 37, reduced: 27 };
