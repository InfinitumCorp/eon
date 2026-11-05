import type { EmitterClass, Features, Point } from "./types.ts";

/**
 * Log-distance path loss: free space to 100 m, then exponent 3.5.
 * A rough ground-level model for the exercise, not a propagation tool.
 */
export function pathLossDb(distanceM: number, freqMHz: number): number {
  const d = Math.max(distanceM, 1);
  const fspl100 = 20 * Math.log10(100) + 20 * Math.log10(freqMHz) - 27.55;
  if (d <= 100) return 20 * Math.log10(d) + 20 * Math.log10(freqMHz) - 27.55;
  return fspl100 + 35 * Math.log10(d / 100);
}

/** Range at which an emission falls to the given sensitivity, metres. */
export function rangeForLossM(maxLossDb: number, freqMHz: number): number {
  const fspl100 = 40 + 20 * Math.log10(freqMHz) - 27.55;
  if (maxLossDb <= fspl100) return 10 ** ((maxLossDb - 20 * Math.log10(freqMHz) + 27.55) / 20);
  return 100 * 10 ** ((maxLossDb - fspl100) / 35);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Bearing from a to b in degrees clockwise from grid north, 0–360. */
export function bearingDeg(a: Point, b: Point): number {
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function dbmToMw(dbm: number): number {
  return 10 ** (dbm / 10);
}

export function mwToDbm(mw: number): number {
  return 10 * Math.log10(mw);
}

/** Deterministic PRNG (mulberry32) with a Gaussian helper. */
export function makeRng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (sigma = 1) => {
    const u = Math.max(next(), 1e-12);
    const v = next();
    return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

/** Class centroids for the on-device classifier. */
const CENTROIDS: { cls: EmitterClass; f: Features }[] = [
  { cls: "voice-radio", f: { bandwidthKHz: 12.5, hopRateHz: 0, dutyCycle: 0.3, pulsed: false, flatness: 0.2 } },
  { cls: "data-link", f: { bandwidthKHz: 200, hopRateHz: 0, dutyCycle: 0.6, pulsed: false, flatness: 0.25 } },
  { cls: "drone-control", f: { bandwidthKHz: 500, hopRateHz: 100, dutyCycle: 0.5, pulsed: false, flatness: 0.3 } },
  { cls: "drone-video", f: { bandwidthKHz: 10000, hopRateHz: 0, dutyCycle: 1, pulsed: false, flatness: 0.4 } },
  { cls: "search-radar", f: { bandwidthKHz: 1000, hopRateHz: 0, dutyCycle: 0.001, pulsed: true, flatness: 0.1 } },
  { cls: "wideband-noise", f: { bandwidthKHz: 20000, hopRateHz: 0, dutyCycle: 1, pulsed: false, flatness: 1 } },
];

function vector(f: Features): number[] {
  return [
    Math.log10(Math.max(f.bandwidthKHz, 0.1)),
    Math.log10(1 + Math.max(f.hopRateHz, 0)),
    f.dutyCycle,
    f.pulsed ? 1 : 0,
    f.flatness,
  ];
}

/** Anything farther than this from every centroid is reported as unknown. */
const UNKNOWN_DISTANCE = 0.6;

/**
 * Nearest-centroid classifier with a softmax confidence.
 * Stands in for the on-device model in the exercise.
 */
export function classify(f: Features): { cls: EmitterClass; confidence: number } {
  const v = vector(f);
  const scored = CENTROIDS.map(({ cls, f: c }) => {
    const w = vector(c);
    const d = Math.sqrt(v.reduce((sum, x, i) => sum + (x - w[i]) ** 2, 0));
    return { cls, d };
  }).sort((a, b) => a.d - b.d);
  const best = scored[0];
  if (best.d > UNKNOWN_DISTANCE) return { cls: "unknown", confidence: 0 };
  const weights = scored.map((s) => Math.exp(-(s.d ** 2) / 0.02));
  const total = weights.reduce((a, b) => a + b, 0);
  return { cls: best.cls, confidence: Math.round((weights[0] / total) * 100) / 100 };
}

/**
 * Weighted least-squares intersection of bearing lines.
 * Each line is weighted by 1 / (range x bearing sigma)^2, so far, uncertain
 * bearings count for less; ranges are re-estimated over a few passes.
 * errorM is the semi-major axis of the 95% error ellipse from that model.
 * Returns null when the geometry is too close to parallel to fix.
 */
export function intersectBearings(
  lines: { from: Point; bearingDeg: number }[],
  sigmaDeg = 3,
): { pos: Point; errorM: number } | null {
  if (lines.length < 2) return null;
  const sigma = (sigmaDeg * Math.PI) / 180;
  const normals = lines.map(({ from, bearingDeg: deg }) => {
    const t = (deg * Math.PI) / 180;
    // Direction is (sin t, cos t); the normal is (cos t, -sin t).
    return { n: { x: Math.cos(t), y: -Math.sin(t) }, from };
  });
  let est: Point | null = null;
  let inv = { a: 0, b: 0, c: 0 };
  for (let pass = 0; pass < 4; pass++) {
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let b1 = 0;
    let b2 = 0;
    for (const { n, from } of normals) {
      const range = est ? Math.max(distance(from, est), 100) : 1;
      const w = est ? 1 / (range * sigma) ** 2 : 1;
      a11 += w * n.x * n.x;
      a12 += w * n.x * n.y;
      a22 += w * n.y * n.y;
      const k = n.x * from.x + n.y * from.y;
      b1 += w * n.x * k;
      b2 += w * n.y * k;
    }
    const det = a11 * a22 - a12 * a12;
    // Conditioning check on the normalised matrix: sin^2 of the spread of bearings.
    if (det / ((a11 + a22) ** 2 / 4) < 0.01) return null;
    est = { x: (a22 * b1 - a12 * b2) / det, y: (a11 * b2 - a12 * b1) / det };
    inv = { a: a22 / det, b: -a12 / det, c: a11 / det };
  }
  const lambdaMax = (inv.a + inv.c) / 2 + Math.sqrt(((inv.a - inv.c) / 2) ** 2 + inv.b ** 2);
  return { pos: est!, errorM: 2.45 * Math.sqrt(lambdaMax) };
}
