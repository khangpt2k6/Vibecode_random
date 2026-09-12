import type { ShapeBatch } from '@stackmon/engine';
import { PALETTE, TYPE_COLORS, shade, type TypeId } from './palette.js';

/**
 * Technology marks.
 *
 * Each creature gets a small vector emblem drawn from primitives - no image
 * assets, so they stay sharp at every zoom and can be recoloured per state.
 *
 * These are deliberately *evocations*, not reproductions. A Docker whale
 * drawn from four rounded shapes reads as Docker at 24 pixels without being
 * a copy of anyone's trademark, and at that size a faithful logo would be an
 * illegible smudge anyway. The goal is that a developer glances at a building
 * and knows what it is.
 *
 * Every icon draws inside a circle of radius `r` centred on (cx, cy).
 */

export type IconFn = (b: ShapeBatch, cx: number, cy: number, r: number, tint: number) => void;

// ---------------------------------------------------------------- helpers

const rect = (
  b: ShapeBatch, cx: number, cy: number, w: number, h: number, c: number, a = 1,
) => b.rect(cx - w / 2, cy - h / 2, w, h, c, a, 0);

/** Regular polygon with `n` sides, rotated by `rot`. */
function ngon(
  b: ShapeBatch, cx: number, cy: number, radius: number, n: number, rot: number, c: number, a = 1,
): void {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = rot + (i / n) * Math.PI * 2;
    pts.push(cx + Math.cos(t) * radius, cy + Math.sin(t) * radius);
  }
  b.polygon(pts, c, a, 0);
}

/** An arc drawn as a thick polyline. */
function arc(
  b: ShapeBatch, cx: number, cy: number, radius: number,
  from: number, to: number, width: number, c: number, a = 1, steps = 12,
): void {
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    pts.push(cx + Math.cos(t) * radius, cy + Math.sin(t) * radius);
  }
  b.polyline(pts, width, c, a, 0);
}

// ------------------------------------------------------------------ icons

/** Docker: a blunt whale carrying stacked containers. */
const docker: IconFn = (b, cx, cy, r, tint) => {
  const body = tint;
  const box = shade(tint, 0.45);
  // container stack
  const bw = r * 0.26;
  for (let i = 0; i < 3; i++) {
    rect(b, cx - r * 0.42 + i * bw * 1.25, cy - r * 0.18, bw, bw, box);
  }
  rect(b, cx - r * 0.42 + bw * 1.25, cy - r * 0.18 - bw * 1.2, bw, bw, box);
  // hull
  b.polygon(
    [
      cx - r * 0.72, cy + r * 0.08,
      cx + r * 0.62, cy + r * 0.08,
      cx + r * 0.5, cy + r * 0.5,
      cx - r * 0.5, cy + r * 0.5,
    ],
    body,
  );
  // tail flick
  b.polygon(
    [cx + r * 0.58, cy + r * 0.05, cx + r * 0.92, cy - r * 0.22, cx + r * 0.86, cy + r * 0.16],
    body,
  );
  b.circle(cx - r * 0.34, cy + r * 0.02, r * 0.07, PALETTE.wall, 1, 0, 8);
};

/** Kubernetes: a seven-sided helm with spokes. */
const kubernetes: IconFn = (b, cx, cy, r, tint) => {
  ngon(b, cx, cy, r * 0.82, 7, -Math.PI / 2, tint);
  ngon(b, cx, cy, r * 0.6, 7, -Math.PI / 2, shade(tint, 0.35));
  for (let i = 0; i < 7; i++) {
    const t = -Math.PI / 2 + (i / 7) * Math.PI * 2;
    b.line(cx, cy, cx + Math.cos(t) * r * 0.58, cy + Math.sin(t) * r * 0.58, r * 0.09, tint);
  }
  b.circle(cx, cy, r * 0.2, tint, 1, 0, 10);
};

/** Kafka: three broker nodes joined into a triangle, the log running through. */
const kafka: IconFn = (b, cx, cy, r, tint) => {
  const nodes: Array<[number, number]> = [
    [cx, cy - r * 0.62],
    [cx - r * 0.6, cy + r * 0.42],
    [cx + r * 0.6, cy + r * 0.42],
  ];
  for (let i = 0; i < 3; i++) {
    const a = nodes[i]!;
    const c = nodes[(i + 1) % 3]!;
    b.line(a[0], a[1], c[0], c[1], r * 0.1, shade(tint, -0.2));
  }
  b.circle(cx, cy, r * 0.2, shade(tint, 0.3), 1, 0, 10);
  for (const [x, y] of nodes) {
    b.circle(x, y, r * 0.26, tint, 1, 0, 12);
    b.circle(x, y, r * 0.12, PALETTE.wall, 1, 0, 8);
  }
};

/** PostgreSQL: an elephant head in profile. */
const postgres: IconFn = (b, cx, cy, r, tint) => {
  b.blob(cx, cy - r * 0.08, r * 0.72, r * 0.66, 1.2, tint, 1, 0, 16);
  // ear
  b.blob(cx - r * 0.42, cy - r * 0.12, r * 0.32, r * 0.42, 3.4, shade(tint, -0.22), 1, 0, 12);
  // trunk
  b.polyline(
    [
      cx + r * 0.16, cy + r * 0.22,
      cx + r * 0.3, cy + r * 0.6,
      cx + r * 0.08, cy + r * 0.86,
    ],
    r * 0.2, tint,
  );
  b.circle(cx + r * 0.24, cy - r * 0.26, r * 0.1, PALETTE.wall, 1, 0, 8);
  // tusk
  b.line(cx + r * 0.34, cy + r * 0.3, cx + r * 0.6, cy + r * 0.52, r * 0.08, PALETTE.wall);
};

/** Redis: a stack of database layers, which is exactly what the mark is. */
const redis: IconFn = (b, cx, cy, r, tint) => {
  for (let i = 2; i >= 0; i--) {
    const y = cy + r * 0.34 - i * r * 0.34;
    const c = i === 2 ? shade(tint, 0.25) : shade(tint, -0.1 * i);
    b.quad(
      cx, y - r * 0.3,
      cx + r * 0.78, y,
      cx, y + r * 0.3,
      cx - r * 0.78, y,
      c,
    );
  }
};

/** CPython: two interlocking snake bodies. */
const python: IconFn = (b, cx, cy, r, tint) => {
  const blue = tint;
  const yellow = PALETTE.flowerYellow;
  // upper-left body
  b.polygon(
    [
      cx - r * 0.55, cy - r * 0.72,
      cx + r * 0.1, cy - r * 0.72,
      cx + r * 0.1, cy - r * 0.12,
      cx - r * 0.1, cy - r * 0.12,
      cx - r * 0.1, cy + r * 0.1,
      cx - r * 0.55, cy + r * 0.1,
    ],
    blue,
  );
  // lower-right body
  b.polygon(
    [
      cx + r * 0.55, cy + r * 0.72,
      cx - r * 0.1, cy + r * 0.72,
      cx - r * 0.1, cy + r * 0.12,
      cx + r * 0.1, cy + r * 0.12,
      cx + r * 0.1, cy - r * 0.1,
      cx + r * 0.55, cy - r * 0.1,
    ],
    yellow,
  );
  b.circle(cx - r * 0.36, cy - r * 0.52, r * 0.08, PALETTE.wall, 1, 0, 6);
  b.circle(cx + r * 0.36, cy + r * 0.52, r * 0.08, PALETTE.ink, 1, 0, 6);
};

/** Node.js: the hexagon. */
const node: IconFn = (b, cx, cy, r, tint) => {
  ngon(b, cx, cy, r * 0.85, 6, Math.PI / 2, tint);
  ngon(b, cx, cy, r * 0.6, 6, Math.PI / 2, shade(tint, 0.4));
  b.polyline(
    [cx - r * 0.22, cy + r * 0.3, cx - r * 0.22, cy - r * 0.3, cx + r * 0.22, cy + r * 0.3, cx + r * 0.22, cy - r * 0.3],
    r * 0.12, shade(tint, -0.3),
  );
};

/** Go: speed lines behind a rounded body. */
const golang: IconFn = (b, cx, cy, r, tint) => {
  for (let i = -1; i <= 1; i++) {
    b.line(
      cx - r * 0.95, cy + i * r * 0.3,
      cx - r * 0.3, cy + i * r * 0.3,
      r * 0.12, shade(tint, 0.3),
    );
  }
  b.blob(cx + r * 0.22, cy, r * 0.58, r * 0.62, 2.1, tint, 1, 0, 14);
  b.circle(cx + r * 0.06, cy - r * 0.2, r * 0.12, PALETTE.wall, 1, 0, 8);
  b.circle(cx + r * 0.44, cy - r * 0.2, r * 0.12, PALETTE.wall, 1, 0, 8);
};

/** nginx: the angular N. */
const nginx: IconFn = (b, cx, cy, r, tint) => {
  ngon(b, cx, cy, r * 0.88, 6, 0, shade(tint, -0.15));
  b.polyline(
    [
      cx - r * 0.3, cy + r * 0.4,
      cx - r * 0.3, cy - r * 0.4,
      cx + r * 0.3, cy + r * 0.4,
      cx + r * 0.3, cy - r * 0.4,
    ],
    r * 0.16, PALETTE.wall,
  );
};

/** Elasticsearch: four arcs around a gap, the stylised search ring. */
const elasticsearch: IconFn = (b, cx, cy, r, tint) => {
  const colors = [PALETTE.typeIntel, PALETTE.typeCache, PALETTE.typeInfra, tint];
  for (let i = 0; i < 4; i++) {
    const from = (i / 4) * Math.PI * 2 + 0.16;
    arc(b, cx, cy, r * 0.72, from, from + Math.PI * 0.42, r * 0.2, colors[i]!);
  }
  b.circle(cx, cy, r * 0.22, shade(tint, 0.2), 1, 0, 10);
};

/** Spark: a flame. */
const spark: IconFn = (b, cx, cy, r, tint) => {
  b.polygon(
    [
      cx, cy - r * 0.9,
      cx + r * 0.55, cy - r * 0.05,
      cx + r * 0.3, cy + r * 0.72,
      cx - r * 0.3, cy + r * 0.72,
      cx - r * 0.55, cy - r * 0.05,
    ],
    tint,
  );
  b.polygon(
    [cx, cy - r * 0.4, cx + r * 0.26, cy + r * 0.12, cx, cy + r * 0.55, cx - r * 0.26, cy + r * 0.12],
    shade(tint, 0.5),
  );
};

/** ClickHouse: columnar bars. The mark is the storage model. */
const clickhouse: IconFn = (b, cx, cy, r, tint) => {
  const heights = [1.0, 0.72, 1.0, 0.55];
  for (let i = 0; i < 4; i++) {
    const h = r * 1.5 * heights[i]!;
    b.rect(cx - r * 0.72 + i * r * 0.4, cy + r * 0.75 - h, r * 0.26, h, tint, 1, 0);
  }
  b.rect(cx - r * 0.8, cy + r * 0.78, r * 1.6, r * 0.16, shade(tint, -0.3), 1, 0);
};

/** MongoDB: the leaf. */
const mongo: IconFn = (b, cx, cy, r, tint) => {
  b.polygon(
    [
      cx, cy - r * 0.9,
      cx + r * 0.46, cy - r * 0.1,
      cx + r * 0.2, cy + r * 0.62,
      cx - r * 0.2, cy + r * 0.62,
      cx - r * 0.46, cy - r * 0.1,
    ],
    tint,
  );
  b.line(cx, cy - r * 0.85, cx, cy + r * 0.85, r * 0.1, shade(tint, -0.35));
};

/** RabbitMQ: a rabbit head. */
const rabbitmq: IconFn = (b, cx, cy, r, tint) => {
  b.blob(cx, cy + r * 0.22, r * 0.55, r * 0.48, 1.1, tint, 1, 0, 14);
  for (const dx of [-0.28, 0.28]) {
    b.blob(cx + r * dx, cy - r * 0.48, r * 0.16, r * 0.44, 2 + dx, tint, 1, 0, 10);
    b.blob(cx + r * dx, cy - r * 0.46, r * 0.08, r * 0.3, 3 + dx, PALETTE.flowerPink, 1, 0, 8);
  }
  b.circle(cx - r * 0.2, cy + r * 0.14, r * 0.08, PALETTE.wall, 1, 0, 6);
  b.circle(cx + r * 0.2, cy + r * 0.14, r * 0.08, PALETTE.wall, 1, 0, 6);
};

/** JVM: a coffee cup with steam. */
const jvm: IconFn = (b, cx, cy, r, tint) => {
  for (let i = -1; i <= 1; i++) {
    b.polyline(
      [
        cx + i * r * 0.26, cy - r * 0.3,
        cx + i * r * 0.26 + r * 0.12, cy - r * 0.56,
        cx + i * r * 0.26 - r * 0.06, cy - r * 0.82,
      ],
      r * 0.09, shade(tint, 0.3),
    );
  }
  b.polygon(
    [
      cx - r * 0.5, cy - r * 0.12,
      cx + r * 0.42, cy - r * 0.12,
      cx + r * 0.28, cy + r * 0.6,
      cx - r * 0.36, cy + r * 0.6,
    ],
    tint,
  );
  arc(b, cx + r * 0.52, cy + r * 0.12, r * 0.24, -Math.PI * 0.5, Math.PI * 0.5, r * 0.1, tint);
  b.rect(cx - r * 0.62, cy - r * 0.22, r * 1.2, r * 0.14, shade(tint, -0.28), 1, 0);
};

/** SQLite: a feather. */
const sqlite: IconFn = (b, cx, cy, r, tint) => {
  b.polygon(
    [
      cx + r * 0.55, cy - r * 0.8,
      cx + r * 0.2, cy + r * 0.2,
      cx - r * 0.5, cy + r * 0.75,
      cx - r * 0.18, cy - r * 0.15,
    ],
    tint,
  );
  b.line(cx + r * 0.5, cy - r * 0.75, cx - r * 0.55, cy + r * 0.82, r * 0.08, shade(tint, -0.4));
};

/** NATS: a fast swoosh. */
const nats: IconFn = (b, cx, cy, r, tint) => {
  b.polygon(
    [cx - r * 0.85, cy + r * 0.3, cx + r * 0.3, cy - r * 0.6, cx + r * 0.05, cy - r * 0.05],
    tint,
  );
  b.polygon(
    [cx + r * 0.85, cy - r * 0.3, cx - r * 0.3, cy + r * 0.6, cx - r * 0.05, cy + r * 0.05],
    shade(tint, 0.25),
  );
};

/** Pulsar: concentric rings radiating from a core. */
const pulsar: IconFn = (b, cx, cy, r, tint) => {
  b.ring(cx, cy, r * 0.88, r * 0.1, shade(tint, -0.15), 0.6, 0, 22);
  b.ring(cx, cy, r * 0.58, r * 0.11, shade(tint, 0.1), 0.85, 0, 20);
  b.circle(cx, cy, r * 0.26, shade(tint, 0.35), 1, 0, 12);
};

/** MySQL: a dolphin arc. */
const mysql: IconFn = (b, cx, cy, r, tint) => {
  b.polygon(
    [
      cx - r * 0.8, cy + r * 0.5,
      cx - r * 0.1, cy - r * 0.6,
      cx + r * 0.55, cy - r * 0.2,
      cx + r * 0.2, cy + r * 0.5,
    ],
    tint,
  );
  b.polygon(
    [cx + r * 0.5, cy - r * 0.25, cx + r * 0.9, cy - r * 0.66, cx + r * 0.82, cy + r * 0.05],
    shade(tint, -0.2),
  );
  b.circle(cx - r * 0.06, cy - r * 0.34, r * 0.08, PALETTE.wall, 1, 0, 6);
};

/** Memcached: a slab grid. */
const memcached: IconFn = (b, cx, cy, r, tint) => {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const lit = (row + col) % 2 === 0;
      b.rect(
        cx - r * 0.75 + col * r * 0.52,
        cy - r * 0.75 + row * r * 0.52,
        r * 0.4, r * 0.4,
        lit ? tint : shade(tint, -0.3), 1, 0,
      );
    }
  }
};

/** Varnish: a bold V. */
const varnish: IconFn = (b, cx, cy, r, tint) => {
  b.polyline(
    [cx - r * 0.62, cy - r * 0.62, cx, cy + r * 0.66, cx + r * 0.62, cy - r * 0.62],
    r * 0.24, tint,
  );
};

/** Caffeine: a coffee bean. */
const caffeine: IconFn = (b, cx, cy, r, tint) => {
  b.blob(cx, cy, r * 0.62, r * 0.8, 0.6, tint, 1, 0, 16);
  b.polyline(
    [cx - r * 0.18, cy - r * 0.62, cx + r * 0.14, cy, cx - r * 0.18, cy + r * 0.62],
    r * 0.12, shade(tint, -0.4),
  );
};

/** Milvus: a cluster of vectors pointing at a centroid. */
const milvus: IconFn = (b, cx, cy, r, tint) => {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = cx + Math.cos(a) * r * 0.8;
    const y = cy + Math.sin(a) * r * 0.8;
    b.line(x, y, cx, cy, r * 0.07, shade(tint, -0.2), 0.8);
    b.circle(x, y, r * 0.13, i % 2 === 0 ? tint : shade(tint, 0.3), 1, 0, 8);
  }
  b.circle(cx, cy, r * 0.24, shade(tint, 0.4), 1, 0, 12);
};

/** Envoy: a hexagonal proxy with traffic passing through. */
const envoy: IconFn = (b, cx, cy, r, tint) => {
  ngon(b, cx, cy, r * 0.85, 6, 0, shade(tint, -0.15));
  ngon(b, cx, cy, r * 0.55, 6, 0, PALETTE.wall);
  b.line(cx - r * 0.95, cy, cx + r * 0.95, cy, r * 0.12, tint);
  b.circle(cx, cy, r * 0.2, tint, 1, 0, 10);
};

// ------------------------------------------------------------- dispatch

const ICONS: Record<string, IconFn> = {
  docker,
  kubernetes,
  kafka,
  postgres,
  redis,
  cpython: python,
  node,
  golang,
  nginx,
  elasticsearch,
  spark,
  clickhouse,
  mongo,
  rabbitmq,
  jvm,
  sqlite,
  nats,
  pulsar,
  mysql,
  memcached,
  varnish,
  caffeine,
  milvus,
  envoy,
};

/**
 * Fallback for a creature with no bespoke mark yet.
 *
 * A ringed polygon whose side count comes from the type, so it is at least
 * consistent and type-identifiable rather than a blank box. New content can
 * ship before its art does.
 */
const fallback: IconFn = (b, cx, cy, r, tint) => {
  ngon(b, cx, cy, r * 0.82, 6, 0, shade(tint, -0.1));
  ngon(b, cx, cy, r * 0.5, 6, 0, shade(tint, 0.4));
};

export function drawIcon(
  b: ShapeBatch,
  creatureId: string,
  cx: number,
  cy: number,
  r: number,
  type: TypeId,
): void {
  const fn = ICONS[creatureId] ?? fallback;
  fn(b, cx, cy, r, TYPE_COLORS[type]);
}

export const hasIcon = (creatureId: string): boolean => creatureId in ICONS;

/** A round badge with the mark on it, for signposts and roster tiles. */
export function drawIconBadge(
  b: ShapeBatch,
  creatureId: string,
  cx: number,
  cy: number,
  r: number,
  type: TypeId,
): void {
  b.circle(cx, cy + r * 0.1, r, PALETTE.uiShadow, 0.2, 0, 20);
  b.circle(cx, cy, r, PALETTE.uiPanel, 1, 0, 22);
  b.ring(cx, cy, r, r * 0.11, TYPE_COLORS[type], 1, 0, 24);
  drawIcon(b, creatureId, cx, cy, r * 0.62, type);
}
