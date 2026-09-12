import type { ShapeBatch } from '@stackmon/engine';
import { PALETTE, TYPE_COLORS, shade, type TypeId } from './palette.js';
import { box, cone, footprint, ovoid, prism, slab, sphere } from './solids.js';

/**
 * Creature sprites.
 *
 * Every creature is a chunky solid form of the technology it represents:
 * Redis is a stack of red discs, Docker is a whale carrying containers,
 * Postgres is a blue elephant, ClickHouse is a row of columns. Then it gets
 * eyes, and eyes are what turn a diagram into a character.
 *
 * The bodies share one pose contract - a ground point, a scale, a facing, and
 * the bob and squash of the current animation frame - so the wander and
 * battle code never knows which body it is animating. Adding a technology
 * means adding one function to the table at the bottom of this file.
 */

export interface CreatureVisual {
  creatureId: string;
  type: TypeId;
  /** World pixels, the point the creature stands on. */
  x: number;
  y: number;
  /** Overall size. 1 is a wild creature; the player's are a little larger. */
  scale: number;
  /** Seconds, for the idle bob and blink. Offset per creature. */
  phase: number;
  /** -1 facing left, 1 facing right. */
  facing: -1 | 1;
  /** 0 idle, 1 walking. Drives the bounce and the foot swing. */
  moving: number;
}

/** Everything a body function needs, computed once per draw. */
interface Pose {
  x: number;
  /** Ground point, already lifted by the hop. */
  y: number;
  /** Base unit: about the radius of a small body. */
  s: number;
  color: number;
  facing: -1 | 1;
  /** Vertical squash from the hop, around 1. */
  squash: number;
  t: number;
  blinking: boolean;
}

type BodyFn = (b: ShapeBatch, p: Pose) => void;

export function drawCreature(b: ShapeBatch, c: CreatureVisual, time: number): void {
  const t = time + c.phase;
  const hop = c.moving > 0 ? Math.abs(Math.sin(t * 7)) * 3 * c.scale : Math.sin(t * 2) * 0.9 * c.scale;
  const squash = c.moving > 0 ? 1 - Math.abs(Math.sin(t * 7)) * 0.08 : 1 + Math.sin(t * 2) * 0.03;
  const cycle = (t * 0.5 + c.phase) % 1;

  const pose: Pose = {
    x: c.x,
    y: c.y - hop,
    s: 12 * c.scale,
    color: TYPE_COLORS[c.type],
    facing: c.facing,
    squash,
    t,
    blinking: cycle > 0.955,
  };

  // The shadow stays on the ground and shrinks as the body rises.
  footprint(b, c.x, c.y, pose.s * 1.15 * (1 - hop * 0.03), 0.3);

  const body = BODIES[c.creatureId] ?? BODIES.default!;
  body(b, pose);
}

// ------------------------------------------------------------------ face

/**
 * Two eyes with pupils, and an optional mouth.
 *
 * Wide-set and low is the entire cuteness formula. The same two dots placed
 * high and close together read as menacing without anything else changing.
 */
function eyes(
  b: ShapeBatch, p: Pose, cx: number, cy: number, spread: number, size: number, mouth = true,
): void {
  const lean = p.facing * size * 0.35;
  for (const side of [-1, 1] as const) {
    const ex = cx + side * spread + lean;
    if (p.blinking) {
      b.rect(ex - size * 0.9, cy - 1, size * 1.8, 2, PALETTE.ink, 1, 0);
      continue;
    }
    b.ellipse(ex, cy, size, size * 1.15, PALETTE.wall, 1, 0, 12);
    b.ellipse(ex + lean * 0.4, cy + size * 0.1, size * 0.55, size * 0.7, PALETTE.ink, 1, 0, 10);
    b.circle(ex + lean * 0.4 - size * 0.2, cy - size * 0.25, size * 0.2, PALETTE.sparkle, 1, 0, 6);
  }
  if (mouth) {
    const mx = cx + lean;
    const my = cy + size * 1.5;
    b.polyline([mx - size * 0.7, my, mx, my + size * 0.35, mx + size * 0.7, my], 1.5, PALETTE.ink, 0.7, 0);
  }
}

/** Little feet under a body, swinging when the creature walks. */
function feet(b: ShapeBatch, p: Pose, width: number, color: number): void {
  const swing = Math.sin(p.t * 7) * 2.5;
  for (const side of [-1, 1] as const) {
    b.ellipse(p.x + side * width + swing * side * 0.5, p.y - 1, p.s * 0.32, p.s * 0.18, shade(color, -0.4), 1, 0, 10);
  }
}

// --------------------------------------------------------------- bodies

/** Redis: the disc stack that is its mark, with a face on the top disc. */
const redis: BodyFn = (b, p) => {
  const r = p.s * 1.25;
  const h = p.s * 0.55 * p.squash;
  feet(b, p, r * 0.6, p.color);
  for (let i = 0; i < 3; i++) {
    slab(b, p.x, p.y - i * h * 1.15, r * (1 - i * 0.04), h, i === 1 ? shade(p.color, -0.08) : p.color);
  }
  eyes(b, p, p.x, p.y - h * 3.1, r * 0.34, p.s * 0.28);
};

/** Memcached: four cubes in a grid. Simple, because it is. */
const memcached: BodyFn = (b, p) => {
  const c = p.s * 0.62;
  const h = p.s * 1.05 * p.squash;
  feet(b, p, c * 1.4, p.color);
  box(b, p.x - c, p.y - c * 0.5, c, c, h, shade(p.color, -0.06));
  box(b, p.x + c, p.y - c * 0.5, c, c, h, p.color);
  box(b, p.x, p.y + c * 0.5, c, c, h, shade(p.color, 0.05));
  eyes(b, p, p.x, p.y - h * 0.55, c * 0.55, p.s * 0.24);
};

/** Varnish: a body with a great V of horns. */
const varnish: BodyFn = (b, p) => {
  const r = p.s * 1.2;
  feet(b, p, r * 0.55, p.color);
  for (const side of [-1, 1] as const) {
    b.polygon(
      [
        p.x + side * r * 0.25, p.y - r * 1.4,
        p.x + side * r * 1.25, p.y - r * 2.7,
        p.x + side * r * 0.75, p.y - r * 1.2,
      ],
      shade(p.color, side < 0 ? -0.3 : -0.08), 1, 0,
    );
  }
  ovoid(b, p.x, p.y - r * 0.95, r, r * 0.95 * p.squash, p.color);
  eyes(b, p, p.x, p.y - r * 1.05, r * 0.36, p.s * 0.3);
};

/** Caffeine: a coffee bean with the seam down the middle. */
const caffeine: BodyFn = (b, p) => {
  const r = p.s * 1.1;
  feet(b, p, r * 0.5, PALETTE.trunkDeep);
  ovoid(b, p.x, p.y - r * 1.05, r * 0.85, r * 1.15 * p.squash, PALETTE.trunk);
  b.polyline(
    [p.x - r * 0.15, p.y - r * 2.0, p.x + r * 0.12, p.y - r * 1.05, p.x - r * 0.15, p.y - r * 0.15],
    r * 0.14, shade(PALETTE.trunkDeep, -0.3), 1, 0,
  );
  eyes(b, p, p.x, p.y - r * 1.25, r * 0.36, p.s * 0.26);
};

/** Postgres: a blue elephant. Ears first, then body, then trunk in front. */
const postgres: BodyFn = (b, p) => {
  const r = p.s * 1.3;
  feet(b, p, r * 0.6, p.color);
  for (const side of [-1, 1] as const) {
    ovoid(b, p.x + side * r * 0.95, p.y - r * 1.25, r * 0.42, r * 0.6, shade(p.color, -0.12));
  }
  ovoid(b, p.x, p.y - r * 0.95, r, r * 0.98 * p.squash, p.color);
  // Trunk curls down and forward.
  const tx = p.x + p.facing * r * 0.15;
  b.polyline(
    [tx, p.y - r * 0.85, tx + p.facing * r * 0.15, p.y - r * 0.35, tx - p.facing * r * 0.1, p.y - r * 0.02],
    r * 0.28, shade(p.color, -0.05), 1, 0,
  );
  for (const side of [-1, 1] as const) {
    b.line(p.x + side * r * 0.42, p.y - r * 0.55, p.x + side * r * 0.62, p.y - r * 0.2, r * 0.13, PALETTE.wall, 1, 0);
  }
  eyes(b, p, p.x, p.y - r * 1.2, r * 0.4, p.s * 0.26, false);
};

/** MySQL: a dolphin, arched, with a fin. */
const mysql: BodyFn = (b, p) => {
  const r = p.s * 1.2;
  const f = p.facing;
  feet(b, p, r * 0.5, p.color);
  b.triangle(p.x - f * r * 0.1, p.y - r * 1.5, p.x + f * r * 0.15, p.y - r * 2.35, p.x + f * r * 0.5, p.y - r * 1.55, shade(p.color, -0.18), 1, 0);
  ovoid(b, p.x, p.y - r * 0.9, r * 1.15, r * 0.82 * p.squash, p.color);
  // Tail flukes behind.
  b.polygon(
    [p.x - f * r * 1.0, p.y - r * 0.95, p.x - f * r * 1.7, p.y - r * 1.5, p.x - f * r * 1.55, p.y - r * 0.55],
    shade(p.color, -0.22), 1, 0,
  );
  b.ellipse(p.x + f * r * 0.2, p.y - r * 0.55, r * 0.55, r * 0.28, PALETTE.wall, 0.9, 0, 12);
  eyes(b, p, p.x + f * r * 0.35, p.y - r * 1.05, r * 0.25, p.s * 0.24);
};

/** Mongo: a leaf standing on its stem. */
const mongo: BodyFn = (b, p) => {
  const r = p.s * 1.2;
  feet(b, p, r * 0.45, p.color);
  b.polygon(
    [p.x, p.y - r * 2.6, p.x + r * 0.95, p.y - r * 1.3, p.x + r * 0.4, p.y, p.x - r * 0.4, p.y, p.x - r * 0.95, p.y - r * 1.3],
    shade(p.color, -0.28), 1, 0,
  );
  b.polygon(
    [p.x - r * 0.05, p.y - r * 2.5, p.x + r * 0.8, p.y - r * 1.3, p.x + r * 0.3, p.y - r * 0.1, p.x - r * 0.35, p.y - r * 0.1, p.x - r * 0.85, p.y - r * 1.3],
    p.color, 1, 0,
  );
  b.line(p.x, p.y - r * 2.3, p.x, p.y - r * 0.2, r * 0.1, shade(p.color, -0.35), 1, 0);
  eyes(b, p, p.x, p.y - r * 1.25, r * 0.35, p.s * 0.26);
};

/** SQLite: a feather, leaning into the wind. */
const sqlite: BodyFn = (b, p) => {
  const r = p.s * 1.15;
  const f = p.facing;
  feet(b, p, r * 0.4, p.color);
  b.polygon(
    [p.x - f * r * 0.3, p.y, p.x + f * r * 0.9, p.y - r * 1.4, p.x + f * r * 0.5, p.y - r * 2.7, p.x - f * r * 0.6, p.y - r * 1.5],
    shade(p.color, -0.22), 1, 0,
  );
  b.polygon(
    [p.x - f * r * 0.2, p.y - r * 0.1, p.x + f * r * 0.7, p.y - r * 1.4, p.x + f * r * 0.4, p.y - r * 2.5, p.x - f * r * 0.45, p.y - r * 1.5],
    p.color, 1, 0,
  );
  b.line(p.x - f * r * 0.25, p.y, p.x + f * r * 0.5, p.y - r * 2.5, r * 0.1, PALETTE.wall, 0.8, 0);
  eyes(b, p, p.x + f * r * 0.1, p.y - r * 1.35, r * 0.3, p.s * 0.24);
};

/** Kafka: three brokers in a triangle, joined, with the log at the centre. */
const kafka: BodyFn = (b, p) => {
  const r = p.s * 0.72;
  const R = p.s * 1.15;
  const nodes: Array<[number, number]> = [
    [p.x, p.y - R * 2.15],
    [p.x - R, p.y - R * 0.9],
    [p.x + R, p.y - R * 0.9],
  ];
  feet(b, p, R * 0.8, p.color);
  for (let i = 0; i < 3; i++) {
    const a = nodes[i]!;
    const c = nodes[(i + 1) % 3]!;
    b.line(a[0], a[1], c[0], c[1], r * 0.32, shade(p.color, -0.3), 1, 0);
  }
  sphere(b, p.x, p.y - R * 1.3, r * 0.6, shade(p.color, 0.3));
  sphere(b, nodes[0]![0], nodes[0]![1], r * 0.85, p.color);
  sphere(b, nodes[1]![0], nodes[1]![1], r, p.color);
  sphere(b, nodes[2]![0], nodes[2]![1], r, p.color);
  eyes(b, p, p.x, p.y - R * 0.75, r * 0.45, p.s * 0.22);
};

/** RabbitMQ: round body, two very tall ears. */
const rabbitmq: BodyFn = (b, p) => {
  const r = p.s * 1.15;
  feet(b, p, r * 0.5, p.color);
  for (const side of [-1, 1] as const) {
    const wag = Math.sin(p.t * 3 + side) * r * 0.08;
    ovoid(b, p.x + side * r * 0.45 + wag, p.y - r * 2.55, r * 0.3, r * 0.85, p.color);
    b.ellipse(p.x + side * r * 0.45 + wag, p.y - r * 2.5, r * 0.14, r * 0.55, PALETTE.flowerPink, 1, 0, 10);
  }
  ovoid(b, p.x, p.y - r * 0.95, r * 0.95, r * 0.95 * p.squash, p.color);
  b.ellipse(p.x, p.y - r * 0.55, r * 0.45, r * 0.3, PALETTE.wall, 0.9, 0, 12);
  eyes(b, p, p.x, p.y - r * 1.15, r * 0.36, p.s * 0.27);
  // Buck teeth.
  b.rect(p.x - r * 0.12, p.y - r * 0.45, r * 0.1, r * 0.16, PALETTE.wall, 1, 0);
  b.rect(p.x + r * 0.02, p.y - r * 0.45, r * 0.1, r * 0.16, PALETTE.wall, 1, 0);
};

/** Pulsar: a core with rings around it. */
const pulsar: BodyFn = (b, p) => {
  const r = p.s * 1.2;
  const cy = p.y - r * 1.15;
  feet(b, p, r * 0.5, p.color);
  const pulse = 1 + Math.sin(p.t * 3) * 0.06;
  b.ring(p.x, cy, r * 1.45 * pulse, r * 0.16, shade(p.color, -0.18), 0.85, 0, 26);
  b.ring(p.x, cy, r * 1.05 * pulse, r * 0.18, shade(p.color, 0.05), 1, 0, 24);
  sphere(b, p.x, cy, r * 0.62, shade(p.color, 0.2));
  eyes(b, p, p.x, cy - r * 0.02, r * 0.26, p.s * 0.22);
};

/** NATS: an arrowhead, always leaning forward. */
const nats: BodyFn = (b, p) => {
  const r = p.s * 1.2;
  const f = p.facing;
  feet(b, p, r * 0.5, p.color);
  b.polygon(
    [p.x - f * r * 1.2, p.y - r * 0.2, p.x + f * r * 1.3, p.y - r * 1.1, p.x - f * r * 1.2, p.y - r * 2.0, p.x - f * r * 0.6, p.y - r * 1.1],
    shade(p.color, -0.25), 1, 0,
  );
  b.polygon(
    [p.x - f * r * 1.0, p.y - r * 0.35, p.x + f * r * 1.05, p.y - r * 1.1, p.x - f * r * 1.0, p.y - r * 1.85, p.x - f * r * 0.45, p.y - r * 1.1],
    p.color, 1, 0,
  );
  eyes(b, p, p.x + f * r * 0.15, p.y - r * 1.15, r * 0.25, p.s * 0.22);
};

/** JVM: a coffee cup, steaming. */
const jvm: BodyFn = (b, p) => {
  const r = p.s * 1.05;
  const h = p.s * 1.7 * p.squash;
  feet(b, p, r * 0.55, p.color);
  slab(b, p.x, p.y, r, h, p.color);
  // Handle.
  b.ring(p.x + r * 1.15, p.y - h * 0.55, r * 0.42, r * 0.16, shade(p.color, -0.1), 1, 0, 16, -Math.PI * 0.5, Math.PI);
  // Coffee surface.
  b.ellipse(p.x, p.y - h, r * 0.8, r * 0.4, PALETTE.trunkDeep, 1, 0, 18);
  for (let i = -1; i <= 1; i++) {
    const rise = (p.t * 0.6 + i * 0.33) % 1;
    b.circle(p.x + i * r * 0.35 + Math.sin(rise * 6) * 3, p.y - h - r * 0.4 - rise * 22, 3 + rise * 3, PALETTE.cloud, (1 - rise) * 0.6, 0, 8);
  }
  eyes(b, p, p.x, p.y - h * 0.5, r * 0.36, p.s * 0.26);
};

/** CPython: a coil of alternating blue and yellow segments, head raised. */
const cpython: BodyFn = (b, p) => {
  const r = p.s * 0.55;
  const segs: Array<[number, number, number]> = [
    [-1.6, 0.0, 0],
    [-0.8, -0.35, 1],
    [0.0, -0.5, 0],
    [0.8, -0.35, 1],
    [1.5, 0.0, 0],
    [1.9, -0.7, 1],
  ];
  for (const [dx, dy, c] of segs) {
    sphere(b, p.x + p.facing * dx * p.s, p.y + dy * p.s - r, r, c === 0 ? p.color : PALETTE.flowerYellow, 14);
  }
  // Head.
  const hx = p.x + p.facing * 2.0 * p.s;
  const hy = p.y - r * 3.6;
  sphere(b, hx, hy, r * 1.25, p.color, 16);
  eyes(b, p, hx, hy - r * 0.2, r * 0.5, p.s * 0.2);
  b.line(hx + p.facing * r * 1.1, hy + r * 0.6, hx + p.facing * r * 1.9, hy + r * 0.75, 1.5, PALETTE.flowerPink, 1, 0);
};

/** Node: a hexagonal prism. */
const node: BodyFn = (b, p) => {
  const r = p.s * 1.25;
  const h = p.s * 1.6 * p.squash;
  feet(b, p, r * 0.55, p.color);
  prism(b, p.x, p.y, r, 6, h, p.color);
  eyes(b, p, p.x, p.y - h * 0.5, r * 0.38, p.s * 0.28);
};

/** Go: a gopher - round, huge eyes, two front teeth. */
const golang: BodyFn = (b, p) => {
  const r = p.s * 1.25;
  feet(b, p, r * 0.55, p.color);
  for (const side of [-1, 1] as const) {
    sphere(b, p.x + side * r * 0.85, p.y - r * 2.0, r * 0.3, p.color, 12);
  }
  ovoid(b, p.x, p.y - r * 1.0, r, r * 1.05 * p.squash, p.color);
  b.ellipse(p.x, p.y - r * 0.55, r * 0.5, r * 0.32, PALETTE.wall, 0.95, 0, 12);
  // Big goggle eyes are the gopher's whole face.
  eyes(b, p, p.x, p.y - r * 1.2, r * 0.42, p.s * 0.38, false);
  b.rect(p.x - r * 0.14, p.y - r * 0.5, r * 0.12, r * 0.2, PALETTE.wall, 1, 0);
  b.rect(p.x + r * 0.02, p.y - r * 0.5, r * 0.12, r * 0.2, PALETTE.wall, 1, 0);
  b.ellipse(p.x, p.y - r * 0.72, r * 0.12, r * 0.08, PALETTE.trunkDeep, 1, 0, 8);
};

/** Docker: a whale with containers stacked on its back. */
const docker: BodyFn = (b, p) => {
  const r = p.s * 1.3;
  const f = p.facing;
  feet(b, p, r * 0.6, p.color);
  // Tail behind.
  b.polygon(
    [p.x - f * r * 1.0, p.y - r * 0.7, p.x - f * r * 1.75, p.y - r * 1.35, p.x - f * r * 1.6, p.y - r * 0.4],
    shade(p.color, -0.22), 1, 0,
  );
  ovoid(b, p.x, p.y - r * 0.72, r * 1.25, r * 0.72 * p.squash, p.color);
  b.ellipse(p.x + f * r * 0.1, p.y - r * 0.4, r * 0.75, r * 0.28, PALETTE.wall, 0.9, 0, 14);
  // Containers.
  const c = r * 0.3;
  const top = p.y - r * 1.4;
  for (let i = 0; i < 3; i++) {
    box(b, p.x - r * 0.55 + i * c * 1.75, top, c, c * 0.7, c * 1.3, shade(p.color, 0.25 + i * 0.05));
  }
  box(b, p.x - r * 0.55 + c * 1.75, top - c * 1.3, c, c * 0.7, c * 1.3, shade(p.color, 0.45));
  eyes(b, p, p.x + f * r * 0.55, p.y - r * 0.85, r * 0.16, p.s * 0.2, false);
  // Spout.
  b.circle(p.x - f * r * 0.2, p.y - r * 1.65 - Math.abs(Math.sin(p.t * 2.5)) * 4, 3, PALETTE.waterFoam, 0.8, 0, 8);
};

/** Kubernetes: a heptagonal prism with a wheel on top. */
const kubernetes: BodyFn = (b, p) => {
  const r = p.s * 1.3;
  const h = p.s * 1.1 * p.squash;
  feet(b, p, r * 0.6, p.color);
  prism(b, p.x, p.y, r, 7, h, p.color, -Math.PI / 2);
  const top = p.y - h;
  const spin = p.t * 0.6;
  for (let i = 0; i < 7; i++) {
    const a = spin + (i / 7) * Math.PI * 2;
    b.line(p.x, top, p.x + Math.cos(a) * r * 0.78, top + Math.sin(a) * r * 0.39, 2.4, shade(p.color, -0.32), 1, 0);
  }
  sphere(b, p.x, top, r * 0.34, shade(p.color, 0.2), 12);
  eyes(b, p, p.x, p.y - h * 0.5, r * 0.4, p.s * 0.26);
};

/** nginx: a green block wearing a bold N. */
const nginx: BodyFn = (b, p) => {
  const r = p.s * 1.25;
  const h = p.s * 1.55 * p.squash;
  feet(b, p, r * 0.55, p.color);
  prism(b, p.x, p.y, r, 6, h, p.color, 0);
  const nx = p.x;
  const ny = p.y - h * 0.62;
  b.polyline(
    [nx - r * 0.35, ny + r * 0.28, nx - r * 0.35, ny - r * 0.28, nx + r * 0.35, ny + r * 0.28, nx + r * 0.35, ny - r * 0.28],
    r * 0.16, PALETTE.wall, 1, 0,
  );
  eyes(b, p, p.x, p.y - h - r * 0.05, r * 0.36, p.s * 0.24);
};

/** Envoy: a hexagon with a beam of traffic passing straight through. */
const envoy: BodyFn = (b, p) => {
  const r = p.s * 1.25;
  const h = p.s * 1.4 * p.squash;
  feet(b, p, r * 0.55, p.color);
  prism(b, p.x, p.y, r, 6, h, p.color, 0);
  const flow = (p.t * 1.4) % 1;
  b.line(p.x - r * 1.6, p.y - h * 0.5, p.x + r * 1.6, p.y - h * 0.5, r * 0.14, shade(p.color, -0.35), 0.9, 0);
  b.circle(p.x - r * 1.6 + flow * r * 3.2, p.y - h * 0.5, r * 0.16, PALETTE.wall, 1, 0.6, 8);
  eyes(b, p, p.x, p.y - h * 0.5 - r * 0.32, r * 0.36, p.s * 0.24);
};

/** Elasticsearch: a ring of four coloured arcs, standing up. */
const elasticsearch: BodyFn = (b, p) => {
  const r = p.s * 1.25;
  const cy = p.y - r * 1.25;
  feet(b, p, r * 0.5, p.color);
  const colors = [PALETTE.typeIntel, PALETTE.typeCache, PALETTE.typeInfra, PALETTE.typeData];
  const spin = p.t * 0.8;
  for (let i = 0; i < 4; i++) {
    const from = spin + (i / 4) * Math.PI * 2 + 0.18;
    b.ring(p.x, cy, r * 1.15, r * 0.34, colors[i]!, 1, 0, 24, from, Math.PI * 0.42);
  }
  sphere(b, p.x, cy, r * 0.5, shade(p.color, 0.15), 14);
  eyes(b, p, p.x, cy - r * 0.02, r * 0.22, p.s * 0.2);
};

/** Spark: a flame, flickering. */
const spark: BodyFn = (b, p) => {
  const r = p.s * 1.15;
  const flick = 1 + Math.sin(p.t * 9) * 0.05 + Math.sin(p.t * 13.7) * 0.03;
  feet(b, p, r * 0.5, p.color);
  cone(b, p.x, p.y, r, r * 2.7 * flick * p.squash, p.color);
  cone(b, p.x + r * 0.05, p.y - r * 0.15, r * 0.55, r * 1.55 * flick, PALETTE.flowerYellow);
  eyes(b, p, p.x, p.y - r * 1.1, r * 0.34, p.s * 0.26);
};

/** ClickHouse: a row of columns, because it is a column store. */
const clickhouse: BodyFn = (b, p) => {
  const w = p.s * 0.42;
  const heights = [1.0, 0.7, 1.15, 0.55];
  feet(b, p, w * 3.2, p.color);
  for (let i = 0; i < 4; i++) {
    const h = p.s * 2.4 * heights[i]! * p.squash;
    box(b, p.x - w * 3 + i * w * 2.05, p.y + (i % 2) * 2, w, w * 0.8, h, i === 2 ? shade(p.color, 0.08) : p.color);
  }
  eyes(b, p, p.x + w * 1.1, p.y - p.s * 2.0, w * 0.75, p.s * 0.22);
};

/** Milvus: small vectors orbiting a core. */
const milvus: BodyFn = (b, p) => {
  const r = p.s * 1.15;
  const cy = p.y - r * 1.2;
  feet(b, p, r * 0.5, p.color);
  for (let i = 0; i < 6; i++) {
    const a = p.t * 0.9 + (i / 6) * Math.PI * 2;
    const x = p.x + Math.cos(a) * r * 1.35;
    const y = cy + Math.sin(a) * r * 0.62;
    b.line(x, y, p.x, cy, 1.8, shade(p.color, -0.3), 0.7, 0);
    sphere(b, x, y, r * 0.2, i % 2 === 0 ? p.color : shade(p.color, 0.3), 10);
  }
  sphere(b, p.x, cy, r * 0.62, shade(p.color, 0.1));
  eyes(b, p, p.x, cy - r * 0.02, r * 0.26, p.s * 0.22);
};

/** Anything without a bespoke body: a ball with the family colour. */
const fallback: BodyFn = (b, p) => {
  const r = p.s * 1.2;
  feet(b, p, r * 0.5, p.color);
  ovoid(b, p.x, p.y - r, r, r * p.squash, p.color);
  eyes(b, p, p.x, p.y - r * 1.05, r * 0.36, p.s * 0.28);
};

const BODIES: Record<string, BodyFn> = {
  redis,
  memcached,
  varnish,
  caffeine,
  postgres,
  mysql,
  mongo,
  sqlite,
  kafka,
  rabbitmq,
  pulsar,
  nats,
  jvm,
  cpython,
  node,
  golang,
  docker,
  kubernetes,
  nginx,
  envoy,
  elasticsearch,
  spark,
  clickhouse,
  milvus,
  default: fallback,
};

/**
 * A name plate floating above a creature.
 *
 * Drawn in world space but at a fixed pixel size, so it stays readable when
 * the camera is zoomed out. Text itself is the caller's job - this is the
 * plate it sits on.
 */
export function drawNamePlate(
  b: ShapeBatch, x: number, y: number, width: number, type: TypeId,
): void {
  const w = width + 16;
  b.roundedRect(x - w / 2, y + 1, w, 17, 8, PALETTE.uiShadow, 0.18, 0);
  b.roundedRect(x - w / 2, y - 1, w, 17, 8, PALETTE.uiPanel, 0.96, 0);
  b.roundedRect(x - w / 2, y - 1, 4, 17, 2, TYPE_COLORS[type], 1, 0);
}
