/**
 * Device integrity for E(O)N™ MIL wearables.
 *
 * Each wearer's device runs these checks itself and shares only the outcome
 * (pass or fail per check, and one health score). Raw signals such as process
 * lists, file paths or hardware identifiers never leave the device.
 *
 * In this exercise the signals are synthetic and scripted (scenario.ts). On a
 * fielded device the same four checks would read the operating system's own
 * attestation and the app's runtime state.
 */
export type IntegrityCheck = "root" | "debugger" | "hooking" | "emulator";

export type IntegrityBand = "healthy" | "degraded" | "compromised";

export interface CheckSpec {
  check: IntegrityCheck;
  label: string;
  /** Points taken off the 100-point health score when the check fails. */
  weight: number;
  /** What the wearer or team lead should do when it fails. */
  recommendation: string;
}

export const CHECKS: CheckSpec[] = [
  {
    check: "root",
    label: "Rooted or jailbroken OS",
    weight: 40,
    recommendation: "Pull the device from the team picture and reflash it from a trusted image before it is used again.",
  },
  {
    check: "hooking",
    label: "Hooking framework in the app",
    weight: 35,
    recommendation: "Quarantine its reports now, swap the device, and keep it untouched for forensics.",
  },
  {
    check: "emulator",
    label: "Emulated environment",
    weight: 30,
    recommendation: "This is not wearer hardware. Remove it from the team; nothing it reports can be trusted.",
  },
  {
    check: "debugger",
    label: "Debugger attached",
    weight: 25,
    recommendation: "Disconnect the debug session. If no one authorised it, treat the device as tampered and quarantine its reports.",
  },
];

export interface CheckResult {
  check: IntegrityCheck;
  label: string;
  ok: boolean;
  /** Tick the check started failing; null while it passes. */
  since: number | null;
  /** Short on-device finding, e.g. "USB debug session". Never raw device data. */
  finding: string | null;
  recommendation: string | null;
}

export interface DeviceHealth {
  score: number;
  band: IntegrityBand;
  checks: CheckResult[];
  /** Set by the team lead: this device's detections are withheld from the shared picture. */
  quarantined: boolean;
}

export function bandOf(score: number): IntegrityBand {
  return score >= 90 ? "healthy" : score >= 60 ? "degraded" : "compromised";
}

/** One health score from the failing checks. */
export function scoreOf(failing: IntegrityCheck[]): number {
  const lost = CHECKS.filter((c) => failing.includes(c.check)).reduce((sum, c) => sum + c.weight, 0);
  return Math.max(0, 100 - lost);
}
