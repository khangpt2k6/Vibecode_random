/** Plain 2D vector. Mutable-by-choice: every op returns a new object unless
 *  it ends in `Mut`, which writes into `out`. Hot loops use the Mut variants. */
export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const lenSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const len = (a: Vec2): number => Math.sqrt(lenSq(a));

export const distSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const dist = (a: Vec2, b: Vec2): number => Math.sqrt(distSq(a, b));

export const normalize = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

/** Named to avoid colliding with the scalar `lerp` on the barrel export. */
export const lerpVec2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const addMut = (out: Vec2, b: Vec2): Vec2 => {
  out.x += b.x;
  out.y += b.y;
  return out;
};

export const scaleMut = (out: Vec2, s: number): Vec2 => {
  out.x *= s;
  out.y *= s;
  return out;
};

export const copyMut = (out: Vec2, src: Vec2): Vec2 => {
  out.x = src.x;
  out.y = src.y;
  return out;
};

export const equals = (a: Vec2, b: Vec2, eps = 1e-6): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
