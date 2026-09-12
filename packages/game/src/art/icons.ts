import type { ShapeBatch } from '@stackmon/engine';
import { brandOf, type Brand } from '@stackmon/content';
import { PALETTE, TYPE_COLORS, shade, type TypeId } from './palette.js';

/**
 * Technology marks.
 *
 * Each drawn from primitives in the technology's own brand colours, so a
 * developer recognises it before reading the label. Redis is that red, Go is
 * that cyan, Python is blue over yellow, Elastic is all four at once.
 *
 * These are deliberately *evocations* rather than reproductions. A Docker
 * whale built from four rounded shapes reads as Docker at twenty pixels
 * without copying anyone's trademark, and at that size a faithful logo would
 * be an illegible smudge anyway. The goal is a developer glancing at a
 * building and knowing what it is.
 *
 * Every icon draws inside a circle of radius `r` centred on (cx, cy).
 */

export type IconFn = (b: ShapeBatch, cx: number, cy: number, r: number, brand: Brand) => void;

// ---------------------------------------------------------------- helpers

const rect = (b: ShapeBatch, cx: number, cy: number, w: number, h: number, c: number, a = 1) =>
  b.rect(cx - w / 2, cy - h / 2, w, h, c, a, 0);

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
  from: number, to: number, width: number, c: number, a = 1, steps = 14,
): void {
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    pts.push(cx + Math.cos(t) * radius, cy + Math.sin(t) * radius);
  }
  b.polyline(pts, width, c, a, 0);
}

const second = (brand: Brand): number => brand.secondary ?? shade(brand.primary, -0.28);
const accent = (brand: Brand): number => brand.accent ?? PALETTE.wall;

// ------------------------------------------------------------------ icons

/** Docker: the blue whale carrying a stack of containers. */
const docker: IconFn = (b, cx, cy, r, brand) => {
  const body = brand.primary;
  const box = accent(brand);
  // container stack, white on blue like the mark
  const bw = r * 0.24;
  for (let i = 0; i < 3; i++) {
    rect(b, cx - r * 0.44 + i * bw * 1.3, cy - r * 0.16, bw, bw, box);
  }
  rect(b, cx - r * 0.44 + bw * 1.3, cy - r * 0.16 - bw * 1.25, bw, bw, box);
  // hull
  b.polygon(
    [cx - r * 0.74, cy + r * 0.1, cx + r * 0.6, cy + r * 0.1, cx + r * 0.48, cy + r * 0.52, cx - r * 0.5, cy + r * 0.52],
    body,
  );
  // tail flick
  b.polygon([cx + r * 0.56, cy + r * 0.06, cx + r * 0.94, cy - r * 0.24, cx + r * 0.86, cy + r * 0.18], body);
  b.circle(cx - r * 0.36, cy + r * 0.04, r * 0.07, box, 1, 0, 8);
};

/** Kubernetes: the blue seven-sided helm. */
const kubernetes: IconFn = (b, cx, cy, r, brand) => {
  ngon(b, cx, cy, r * 0.86, 7, -Math.PI / 2, brand.primary);
  ngon(b, cx, cy, r * 0.64, 7, -Math.PI / 2, second(brand));
  for (let i = 0; i < 7; i++) {
    const t = -Math.PI / 2 + (i / 7) * Math.PI * 2;
    b.line(cx, cy, cx + Math.cos(t) * r * 0.56, cy + Math.sin(t) * r * 0.56, r * 0.11, accent(brand));
  }
  b.circle(cx, cy, r * 0.2, accent(brand), 1, 0, 10);
};

/** Kafka: the near-black mark, three nodes wired into a spine. */
const kafka: IconFn = (b, cx, cy, r, brand) => {
  const nodes: Array<[number, number]> = [
    [cx, cy - r * 0.66],
    [cx - r * 0.52, cy + r * 0.46],
    [cx + r * 0.52, cy + r * 0.16],
  ];
  b.line(nodes[0]![0], nodes[0]![1], nodes[1]![0], nodes[1]![1], r * 0.13, brand.primary);
  b.line(nodes[1]![0], nodes[1]![1], nodes[2]![0], nodes[2]![1], r * 0.13, brand.primary);
  b.line(nodes[0]![0], nodes[0]![1], nodes[2]![0], nodes[2]![1], r * 0.13, second(brand));
  for (const [x, y] of nodes) {
    b.circle(x, y, r * 0.26, brand.primary, 1, 0, 14);
    b.circle(x, y, r * 0.12, accent(brand), 1, 0, 10);
  }
};

/** PostgreSQL: the blue elephant head in profile. */
const postgres: IconFn = (b, cx, cy, r, brand) => {
  b.blob(cx, cy - r * 0.08, r * 0.7, r * 0.64, 1.2, brand.primary, 1, 0, 16);
  b.blob(cx - r * 0.44, cy - r * 0.14, r * 0.3, r * 0.4, 3.4, second(brand), 1, 0, 12);
  b.polyline(
    [cx + r * 0.18, cy + r * 0.2, cx + r * 0.32, cy + r * 0.58, cx + r * 0.08, cy + r * 0.86],
    r * 0.19, brand.primary,
  );
  b.circle(cx + r * 0.26, cy - r * 0.26, r * 0.1, accent(brand), 1, 0, 8);
  b.circle(cx + r * 0.26, cy - r * 0.26, r * 0.05, 0x111111, 1, 0, 6);
  b.line(cx + r * 0.36, cy + r * 0.3, cx + r * 0.62, cy + r * 0.52, r * 0.08, accent(brand));
};

/** Redis: the stacked layers of the red mark. */
const redis: IconFn = (b, cx, cy, r, brand) => {
  for (let i = 2; i >= 0; i--) {
    const y = cy + r * 0.36 - i * r * 0.34;
    const c = i === 2 ? brand.primary : i === 1 ? shade(brand.primary, -0.08) : second(brand);
    b.quad(cx, y - r * 0.3, cx + r * 0.8, y, cx, y + r * 0.3, cx - r * 0.8, y, c);
    if (i === 2) {
      b.polyline(
        [cx - r * 0.34, y - r * 0.02, cx - r * 0.1, y + r * 0.1, cx + r * 0.34, y - r * 0.12],
        r * 0.1, accent(brand), 0.9,
      );
    }
  }
};

/** CPython: the two interlocking snakes, blue over yellow. */
const cpython: IconFn = (b, cx, cy, r, brand) => {
  const blue = brand.primary;
  const yellow = second(brand);
  b.polygon(
    [
      cx - r * 0.58, cy - r * 0.74, cx + r * 0.1, cy - r * 0.74, cx + r * 0.1, cy - r * 0.1,
      cx - r * 0.12, cy - r * 0.1, cx - r * 0.12, cy + r * 0.12, cx - r * 0.58, cy + r * 0.12,
    ],
    blue,
  );
  b.polygon(
    [
      cx + r * 0.58, cy + r * 0.74, cx - r * 0.1, cy + r * 0.74, cx - r * 0.1, cy + r * 0.1,
      cx + r * 0.12, cy + r * 0.1, cx + r * 0.12, cy - r * 0.12, cx + r * 0.58, cy - r * 0.12,
    ],
    yellow,
  );
  b.circle(cx - r * 0.38, cy - r * 0.54, r * 0.08, accent(brand), 1, 0, 6);
  b.circle(cx + r * 0.38, cy + r * 0.54, r * 0.08, 0x333333, 1, 0, 6);
};

/** Node.js: the green hexagon. */
const node: IconFn = (b, cx, cy, r, brand) => {
  ngon(b, cx, cy, r * 0.88, 6, Math.PI / 2, brand.primary);
  ngon(b, cx, cy, r * 0.62, 6, Math.PI / 2, second(brand));
  b.polyline(
    [cx - r * 0.22, cy + r * 0.3, cx - r * 0.22, cy - r * 0.3, cx + r * 0.22, cy + r * 0.3, cx + r * 0.22, cy - r * 0.3],
    r * 0.12, accent(brand),
  );
};

/** Go: the cyan gopher, seen head-on. */
const golang: IconFn = (b, cx, cy, r, brand) => {
  for (const side of [-1, 1] as const) {
    b.circle(cx + side * r * 0.62, cy - r * 0.6, r * 0.2, second(brand), 1, 0, 10);
  }
  b.blob(cx, cy, r * 0.72, r * 0.8, 2.1, brand.primary, 1, 0, 16);
  for (const side of [-1, 1] as const) {
    b.circle(cx + side * r * 0.26, cy - r * 0.16, r * 0.2, accent(brand), 1, 0, 10);
    b.circle(cx + side * r * 0.26, cy - r * 0.16, r * 0.09, 0x222222, 1, 0, 8);
  }
  b.ellipse(cx, cy + r * 0.22, r * 0.13, r * 0.09, 0x222222, 1, 0, 8);
  rect(b, cx - r * 0.09, cy + r * 0.44, r * 0.11, r * 0.2, accent(brand));
  rect(b, cx + r * 0.09, cy + r * 0.44, r * 0.11, r * 0.2, accent(brand));
};

/** nginx: the green angular N. */
const nginx: IconFn = (b, cx, cy, r, brand) => {
  ngon(b, cx, cy, r * 0.9, 6, 0, brand.primary);
  b.polyline(
    [cx - r * 0.3, cy + r * 0.4, cx - r * 0.3, cy - r * 0.4, cx + r * 0.3, cy + r * 0.4, cx + r * 0.3, cy - r * 0.4],
    r * 0.16, accent(brand),
  );
};

/** Elasticsearch: the four-colour ring, which is the whole identity. */
const elasticsearch: IconFn = (b, cx, cy, r, brand) => {
  const colors = [brand.secondary ?? 0xfec514, brand.accent ?? 0xf04e98, brand.primary, 0x1ba9f5];
  for (let i = 0; i < 4; i++) {
    const from = (i / 4) * Math.PI * 2 + 0.16;
    arc(b, cx, cy, r * 0.72, from, from + Math.PI * 0.42, r * 0.21, colors[i]!);
  }
  b.circle(cx, cy, r * 0.2, PALETTE.wall, 1, 0, 10);
};

/** Spark: the orange flame swoosh. */
const spark: IconFn = (b, cx, cy, r, brand) => {
  b.polygon(
    [cx, cy - r * 0.92, cx + r * 0.56, cy - r * 0.04, cx + r * 0.3, cy + r * 0.74, cx - r * 0.3, cy + r * 0.74, cx - r * 0.56, cy - r * 0.04],
    brand.primary,
  );
  b.polygon(
    [cx, cy - r * 0.4, cx + r * 0.27, cy + r * 0.12, cx, cy + r * 0.56, cx - r * 0.27, cy + r * 0.12],
    second(brand),
  );
};

/** ClickHouse: the yellow bars with black caps. The mark IS the data model. */
const clickhouse: IconFn = (b, cx, cy, r, brand) => {
  const heights = [1.0, 0.72, 1.0, 0.55];
  for (let i = 0; i < 4; i++) {
    const h = r * 1.5 * heights[i]!;
    const x = cx - r * 0.74 + i * r * 0.4;
    b.rect(x, cy + r * 0.76 - h, r * 0.26, h, brand.primary, 1, 0);
    b.rect(x, cy + r * 0.76 - h, r * 0.26, r * 0.12, second(brand), 1, 0);
  }
  b.rect(cx - r * 0.82, cy + r * 0.78, r * 1.64, r * 0.16, second(brand), 1, 0);
};

/** MongoDB: the green leaf. */
const mongo: IconFn = (b, cx, cy, r, brand) => {
  b.polygon(
    [cx, cy - r * 0.92, cx + r * 0.46, cy - r * 0.1, cx + r * 0.2, cy + r * 0.64, cx - r * 0.2, cy + r * 0.64, cx - r * 0.46, cy - r * 0.1],
    brand.primary,
  );
  b.polygon(
    [cx, cy - r * 0.92, cx + r * 0.46, cy - r * 0.1, cx + r * 0.2, cy + r * 0.64, cx, cy + r * 0.64],
    second(brand),
  );
  b.line(cx, cy - r * 0.86, cx, cy + r * 0.86, r * 0.09, shade(brand.primary, -0.45));
};

/** RabbitMQ: the orange square with the white rabbit. */
const rabbitmq: IconFn = (b, cx, cy, r, brand) => {
  b.roundedRect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8, r * 0.24, brand.primary, 1, 0);
  const white = accent(brand);
  for (const dx of [-0.26, 0.12]) {
    b.rect(cx + r * dx, cy - r * 0.62, r * 0.17, r * 0.5, white, 1, 0);
  }
  b.rect(cx - r * 0.34, cy - r * 0.16, r * 0.68, r * 0.62, white, 1, 0);
  b.rect(cx + r * 0.02, cy + r * 0.1, r * 0.2, r * 0.2, brand.primary, 1, 0);
};

/** JVM: the blue cup under orange steam. */
const jvm: IconFn = (b, cx, cy, r, brand) => {
  for (let i = -1; i <= 1; i++) {
    b.polyline(
      [cx + i * r * 0.26, cy - r * 0.3, cx + i * r * 0.26 + r * 0.12, cy - r * 0.56, cx + i * r * 0.26 - r * 0.06, cy - r * 0.84],
      r * 0.1, second(brand),
    );
  }
  b.polygon(
    [cx - r * 0.5, cy - r * 0.12, cx + r * 0.42, cy - r * 0.12, cx + r * 0.28, cy + r * 0.6, cx - r * 0.36, cy + r * 0.6],
    brand.primary,
  );
  arc(b, cx + r * 0.52, cy + r * 0.12, r * 0.24, -Math.PI * 0.5, Math.PI * 0.5, r * 0.1, brand.primary);
  b.rect(cx - r * 0.62, cy - r * 0.24, r * 1.2, r * 0.14, shade(brand.primary, -0.3), 1, 0);
};

/** SQLite: the dark blue feather. */
const sqlite: IconFn = (b, cx, cy, r, brand) => {
  b.polygon(
    [cx + r * 0.55, cy - r * 0.8, cx + r * 0.2, cy + r * 0.2, cx - r * 0.5, cy + r * 0.76, cx - r * 0.18, cy - r * 0.14],
    brand.primary,
  );
  b.polygon(
    [cx + r * 0.5, cy - r * 0.72, cx + r * 0.18, cy + r * 0.16, cx - r * 0.16, cy + r * 0.36, cx - r * 0.1, cy - r * 0.12],
    second(brand),
  );
  b.line(cx + r * 0.5, cy - r * 0.76, cx - r * 0.56, cy + r * 0.84, r * 0.07, accent(brand), 0.85);
};

/** NATS: the blue swoosh. */
const nats: IconFn = (b, cx, cy, r, brand) => {
  b.polygon([cx - r * 0.86, cy + r * 0.3, cx + r * 0.3, cy - r * 0.62, cx + r * 0.04, cy - r * 0.04], brand.primary);
  b.polygon([cx + r * 0.86, cy - r * 0.3, cx - r * 0.3, cy + r * 0.62, cx - r * 0.04, cy + r * 0.04], second(brand));
};

/** Pulsar: concentric rings around a bright core. */
const pulsar: IconFn = (b, cx, cy, r, brand) => {
  b.ring(cx, cy, r * 0.88, r * 0.1, second(brand), 0.7, 0, 24);
  b.ring(cx, cy, r * 0.58, r * 0.12, brand.primary, 1, 0, 20);
  b.circle(cx, cy, r * 0.24, accent(brand), 1, 0, 12);
};

/** MySQL: the teal dolphin with an orange flipper. */
const mysql: IconFn = (b, cx, cy, r, brand) => {
  b.polygon(
    [cx - r * 0.82, cy + r * 0.5, cx - r * 0.12, cy - r * 0.62, cx + r * 0.55, cy - r * 0.2, cx + r * 0.2, cy + r * 0.5],
    brand.primary,
  );
  b.polygon([cx + r * 0.48, cy - r * 0.24, cx + r * 0.92, cy - r * 0.68, cx + r * 0.84, cy + r * 0.06], second(brand));
  b.polygon([cx - r * 0.3, cy + r * 0.2, cx + r * 0.06, cy + r * 0.16, cx - r * 0.1, cy + r * 0.6], second(brand));
  b.circle(cx - r * 0.06, cy - r * 0.34, r * 0.09, accent(brand), 1, 0, 8);
};

/** Memcached: the teal slab grid. */
const memcached: IconFn = (b, cx, cy, r, brand) => {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const lit = (row + col) % 2 === 0;
      b.rect(
        cx - r * 0.76 + col * r * 0.53, cy - r * 0.76 + row * r * 0.53,
        r * 0.4, r * 0.4,
        lit ? brand.primary : second(brand), 1, 0,
      );
    }
  }
};

/** Varnish: the red V. */
const varnish: IconFn = (b, cx, cy, r, brand) => {
  b.polyline([cx - r * 0.64, cy - r * 0.6, cx, cy + r * 0.68, cx + r * 0.64, cy - r * 0.6], r * 0.26, brand.primary);
  b.polyline([cx - r * 0.64, cy - r * 0.6, cx, cy + r * 0.68], r * 0.1, second(brand), 0.7);
};

/** Caffeine: the coffee bean. */
const caffeine: IconFn = (b, cx, cy, r, brand) => {
  b.blob(cx, cy, r * 0.62, r * 0.82, 0.6, brand.primary, 1, 0, 16);
  b.polyline([cx - r * 0.18, cy - r * 0.64, cx + r * 0.14, cy, cx - r * 0.18, cy + r * 0.64], r * 0.13, second(brand));
};

/** Milvus: vectors converging on a centroid. */
const milvus: IconFn = (b, cx, cy, r, brand) => {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = cx + Math.cos(a) * r * 0.8;
    const y = cy + Math.sin(a) * r * 0.8;
    b.line(x, y, cx, cy, r * 0.07, second(brand), 0.8);
    b.circle(x, y, r * 0.13, i % 2 === 0 ? brand.primary : second(brand), 1, 0, 8);
  }
  b.circle(cx, cy, r * 0.24, brand.primary, 1, 0, 12);
};

/** Envoy: the purple hexagon with traffic through it. */
const envoy: IconFn = (b, cx, cy, r, brand) => {
  ngon(b, cx, cy, r * 0.86, 6, 0, brand.primary);
  ngon(b, cx, cy, r * 0.56, 6, 0, accent(brand));
  b.line(cx - r * 0.95, cy, cx + r * 0.95, cy, r * 0.13, second(brand));
  b.circle(cx, cy, r * 0.2, brand.primary, 1, 0, 10);
};

// ------------------------------------------------------------- dispatch

const ICONS: Record<string, IconFn> = {
  docker,
  kubernetes,
  kafka,
  postgres,
  redis,
  cpython,
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

/** Fallback so new content can ship before its art does. */
const fallback: IconFn = (b, cx, cy, r, brand) => {
  ngon(b, cx, cy, r * 0.82, 6, 0, brand.primary);
  ngon(b, cx, cy, r * 0.5, 6, 0, second(brand));
};

export function drawIcon(b: ShapeBatch, creatureId: string, cx: number, cy: number, r: number): void {
  (ICONS[creatureId] ?? fallback)(b, cx, cy, r, brandOf(creatureId));
}

export const hasIcon = (creatureId: string): boolean => creatureId in ICONS;

/**
 * A round badge with the mark on it.
 *
 * The ring carries the family colour and the mark carries the brand colour,
 * which is the split that lets one glance answer both "what is it" and "what
 * does it do in a fight".
 */
export function drawIconBadge(
  b: ShapeBatch, creatureId: string, cx: number, cy: number, r: number, type: TypeId,
): void {
  b.circle(cx, cy + r * 0.1, r, PALETTE.uiShadow, 0.2, 0, 20);
  b.circle(cx, cy, r, PALETTE.uiPanel, 1, 0, 22);
  b.ring(cx, cy, r, r * 0.12, TYPE_COLORS[type], 1, 0, 24);
  drawIcon(b, creatureId, cx, cy, r * 0.64);
}
