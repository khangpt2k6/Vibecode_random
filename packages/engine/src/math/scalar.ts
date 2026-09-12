export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential smoothing.
 *  `halfLife` is the time in seconds for the gap to halve. */
export const damp = (a: number, b: number, halfLife: number, dt: number): number =>
  b + (a - b) * Math.pow(2, -dt / halfLife);

export const inverseLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : (v - a) / (b - a);

export const remap = (
  v: number,
  inLo: number,
  inHi: number,
  outLo: number,
  outHi: number,
): number => lerp(outLo, outHi, inverseLerp(inLo, inHi, v));

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Shortest signed angular delta from a to b, in radians. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
