import {
  DEFAULT_ISO,
  Font,
  ParticleSystem,
  Rng,
  ValueNoise2D,
  drawText,
  gridToScreen,
  screenToGridOnHeightmap,
  type Scene,
  type SceneContext,
} from '@stackmon/engine';
import {
  PALETTE,
  TYPE_COLORS,
  TYPE_IDS,
  faceColors,
  mix,
  shade,
  type TypeId,
} from '../art/palette.js';
import {
  anchorAt,
  drawBush,
  drawFlowers,
  drawGrassTuft,
  drawPathTile,
  drawPine,
  drawRock,
  drawTree,
  drawWaterTile,
  type PropAnchor,
} from '../art/nature.js';
import { drawBuilding, drawMainHall, type BuildingStyle } from '../art/buildings.js';
import { drawIconBadge } from '../art/icons.js';

/**
 * The overworld.
 *
 * A generated island: water, beach, meadow, and highland, densely planted.
 *
 * The density is the point. A world with six trees on it looks generated no
 * matter how good the individual tree is; the same world with four hundred
 * pieces of small scatter looks placed. Everything here is cheap enough to
 * afford that - the whole island is a few thousand triangles in three draw
 * calls - so the budget goes on quantity of detail rather than on fidelity
 * of any single object.
 */

const MAP_SIZE = 44;
const MAX_HEIGHT = 6;

type Terrain = 'water' | 'sand' | 'grass' | 'rock';

interface Tile {
  height: number;
  terrain: Terrain;
  /** Base colour, jittered per tile so large areas are never flat. */
  color: number;
  /** True for a water tile touching land, which gets a foam edge. */
  shore: boolean;
  path: boolean;
}

type PropKind = 'tree' | 'pine' | 'bush' | 'rock' | 'flowers' | 'tuft';

interface Prop {
  kind: PropKind;
  anchor: PropAnchor;
  /** Sort key, so props interleave correctly with terrain and buildings. */
  depth: number;
}

interface Structure {
  gx: number;
  gy: number;
  style: BuildingStyle;
  label: string;
  creatureId: string;
}

const TECH_BY_TYPE: Record<TypeId, Array<[string, string]>> = {
  data: [['postgres', 'POSTGRES'], ['mysql', 'MYSQL'], ['mongo', 'MONGO'], ['sqlite', 'SQLITE']],
  stream: [['kafka', 'KAFKA'], ['rabbitmq', 'RABBITMQ'], ['pulsar', 'PULSAR'], ['nats', 'NATS']],
  runtime: [['jvm', 'JVM'], ['cpython', 'PYTHON'], ['node', 'NODE'], ['golang', 'GO']],
  infra: [['docker', 'DOCKER'], ['kubernetes', 'K8S'], ['nginx', 'NGINX'], ['envoy', 'ENVOY']],
  cache: [
    ['redis', 'REDIS'],
    ['memcached', 'MEMCACHED'],
    ['varnish', 'VARNISH'],
    ['caffeine', 'CAFFEINE'],
  ],
  intel: [
    ['elasticsearch', 'ELASTIC'],
    ['spark', 'SPARK'],
    ['clickhouse', 'CLICKHOUSE'],
    ['milvus', 'MILVUS'],
  ],
};

export class WorldScene implements Scene {
  readonly name = 'world';

  private tiles: Tile[] = [];
  private props: Prop[] = [];
  private structures: Structure[] = [];
  private hallAt = { gx: 0, gy: 0 };

  private font!: Font;
  private fontSmall!: Font;
  private particles!: ParticleSystem;
  private readonly rng = new Rng('stackmon-island-v2');
  private time = 0;

  private hoverGx = -1;
  private hoverGy = -1;

  enter(ctx: SceneContext): void {
    this.font = new Font(ctx.renderer.gl, { size: 17, weight: 700 });
    this.fontSmall = new Font(ctx.renderer.gl, { size: 11, weight: 600 });
    this.particles = new ParticleSystem(this.rng.fork('particles'));

    this.generateTerrain();
    this.carvePaths();
    this.placeStructures();
    this.scatterProps();

    const camera = ctx.renderer.camera;
    const centre = gridToScreen({ gx: MAP_SIZE / 2, gy: MAP_SIZE / 2, h: 1 }, DEFAULT_ISO);
    camera.minZoom = 0.3;
    camera.maxZoom = 2.6;

    const worldW = MAP_SIZE * DEFAULT_ISO.tileW;
    const worldH = MAP_SIZE * DEFAULT_ISO.tileH + MAX_HEIGHT * DEFAULT_ISO.elevation;
    const fit = Math.min(ctx.renderer.ctx.width / worldW, ctx.renderer.ctx.height / worldH) * 1.4;
    camera.snapTo(centre.x, centre.y);
    camera.setZoom(Math.max(camera.minZoom, Math.min(1.1, fit)), true);
    camera.bounds = {
      minX: -worldW / 2 - 160,
      maxX: worldW / 2 + 160,
      minY: -160,
      maxY: worldH + 160,
    };
  }

  exit(): void {
    this.font.dispose();
    this.fontSmall.dispose();
  }

  // ------------------------------------------------------------ generation

  private generateTerrain(): void {
    const shapeNoise = new ValueNoise2D('island-shape-v2');
    const detail = new ValueNoise2D('island-detail-v2');
    const hue = new ValueNoise2D('grass-hue-v2');
    const rocky = new ValueNoise2D('rockiness-v2');
    this.tiles = new Array(MAP_SIZE * MAP_SIZE);

    for (let gy = 0; gy < MAP_SIZE; gy++) {
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        // Radial falloff shapes the island; noise makes the coastline ragged
        // so it does not read as a circle someone drew.
        const dx = (gx / MAP_SIZE - 0.5) * 2;
        const dy = (gy / MAP_SIZE - 0.5) * 2;
        const radial = 1 - Math.min(1, Math.hypot(dx, dy) * 1.12);
        const n = shapeNoise.fbm(gx * 0.075, gy * 0.075, 4);
        const elevation = radial * 0.8 + n * 0.4 - 0.16;

        let terrain: Terrain;
        let height: number;

        if (elevation < 0.05) {
          terrain = 'water';
          height = 0;
        } else if (elevation < 0.12) {
          terrain = 'sand';
          height = 1;
        } else {
          // A gentle curve, so the interior is rolling meadow with a few
          // hills rather than one saturated plateau. The earlier mapping hit
          // its ceiling almost immediately and flattened the whole middle of
          // the island into a single grey slab.
          const ridge = detail.fbm(gx * 0.13, gy * 0.13, 4);
          const h = (elevation - 0.12) * 1.15 + ridge * 0.55;
          height = 1 + Math.round(Math.max(0, Math.min(1, h)) * (MAX_HEIGHT - 1));

          // Rock is its own patchy feature, not simply "anywhere high".
          // Tying it to altitude alone meant every hilltop was bare stone.
          const stone = rocky.fbm(gx * 0.11, gy * 0.11, 3);
          terrain = stone > 0.68 && height >= 3 ? 'rock' : 'grass';
        }

        const jitter = hue.sample(gx * 0.55, gy * 0.55);
        this.tiles[gy * MAP_SIZE + gx] = {
          height,
          terrain,
          color: tileColor(terrain, height, jitter),
          shore: false,
          path: false,
        };
      }
    }

    for (let gy = 0; gy < MAP_SIZE; gy++) {
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        const t = this.tiles[gy * MAP_SIZE + gx]!;
        if (t.terrain !== 'water') continue;
        t.shore =
          this.terrainAt(gx + 1, gy) !== 'water' ||
          this.terrainAt(gx - 1, gy) !== 'water' ||
          this.terrainAt(gx, gy + 1) !== 'water' ||
          this.terrainAt(gx, gy - 1) !== 'water';
      }
    }
  }

  /**
   * Paths across the island.
   *
   * L-shaped runs rather than pathfinding, because the purpose is visual: a
   * path gives the eye a route across the meadow and makes the settlement
   * read as connected rather than as objects dropped on grass.
   */
  private carvePaths(): void {
    const mid = Math.floor(MAP_SIZE / 2);
    this.hallAt = { gx: mid, gy: mid };
    // A short plaza around the hall, and nothing else until structures
    // branch off it. A full-width cross turned a third of the island into
    // bare ground, which read as a construction site rather than a village.
    for (let d = -3; d <= 3; d++) {
      this.markPath(mid + d, mid);
      this.markPath(mid, mid + d);
    }
  }

  private markPath(gx: number, gy: number): void {
    const t = this.tiles[gy * MAP_SIZE + gx];
    if (!t || t.terrain === 'water') return;
    t.path = true;
  }

  private pathTo(gx: number, gy: number): void {
    const mid = Math.floor(MAP_SIZE / 2);
    const stepX = gx > mid ? 1 : -1;
    for (let x = mid; x !== gx; x += stepX) this.markPath(x, gy);
    const stepY = gy > mid ? 1 : -1;
    for (let y = mid; y !== gy; y += stepY) this.markPath(mid, y);
    this.markPath(gx, gy);
  }

  private placeStructures(): void {
    const rng = this.rng.fork('structures-v2');
    const mid = Math.floor(MAP_SIZE / 2);

    const all: Array<[TypeId, string, string]> = [];
    for (const type of TYPE_IDS) {
      for (const [id, label] of TECH_BY_TYPE[type]) all.push([type, id, label]);
    }
    rng.shuffle(all);

    for (const [type, creatureId, label] of all) {
      for (let attempt = 0; attempt < 300; attempt++) {
        const gx = rng.int(4, MAP_SIZE - 5);
        const gy = rng.int(4, MAP_SIZE - 5);
        const t = this.tiles[gy * MAP_SIZE + gx];
        if (!t || t.terrain === 'water' || t.terrain === 'sand') continue;
        if (Math.abs(gx - mid) < 3 && Math.abs(gy - mid) < 3) continue;
        if (this.structures.some((s) => Math.abs(s.gx - gx) + Math.abs(s.gy - gy) < 5)) continue;
        // Needs a flat footprint, or the house floats off its own plinth.
        if (!this.isFlat(gx, gy)) continue;

        this.structures.push({
          gx,
          gy,
          creatureId,
          label,
          style: {
            size: 1,
            storeys: rng.int(1, 2),
            type,
            creatureId,
            seed: rng.range(0, Math.PI * 2),
          },
        });
        this.pathTo(gx, gy);
        break;
      }
    }

    this.structures.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
  }

  private isFlat(gx: number, gy: number): boolean {
    const h = this.heightAt(gx, gy);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.heightAt(gx + dx, gy + dy) !== h) return false;
      }
    }
    return true;
  }

  /**
   * Scatter.
   *
   * Density varies by terrain and by a noise field, so the meadow has thick
   * copses and open clearings rather than an even sprinkle. An even sprinkle
   * is exactly what makes a generated world look generated.
   */
  private scatterProps(): void {
    const rng = this.rng.fork('props-v2');
    const density = new ValueNoise2D('forest-density-v2');
    this.props = [];

    for (let gy = 0; gy < MAP_SIZE; gy++) {
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        const t = this.tiles[gy * MAP_SIZE + gx]!;
        if (t.terrain === 'water' || t.path) continue;
        if (this.nearStructure(gx, gy, 1)) continue;
        if (Math.abs(gx - this.hallAt.gx) <= 2 && Math.abs(gy - this.hallAt.gy) <= 2) continue;

        const forest = density.fbm(gx * 0.09, gy * 0.09, 3);
        const count = this.propCountFor(t, forest, rng);

        for (let i = 0; i < count; i++) {
          const jx = rng.range(-0.33, 0.33);
          const jy = rng.range(-0.33, 0.33);
          this.props.push({
            kind: this.propKindFor(t, forest, rng),
            anchor: anchorAt(
              { gx: gx + jx, gy: gy + jy, h: t.height },
              rng.range(0, Math.PI * 2),
              rng.range(0.72, 1.18),
            ),
            // Props sort within their tile by how far down it they sit, so a
            // bush in front of a tree is drawn after it.
            depth: gx + gy + (jx + jy) * 0.5,
          });
        }
      }
    }

    this.props.sort((a, b) => a.depth - b.depth);
  }

  private propCountFor(t: Tile, forest: number, rng: Rng): number {
    if (t.terrain === 'sand') return rng.chance(0.18) ? 1 : 0;
    if (t.terrain === 'rock') return rng.chance(0.42) ? 1 : 0;
    const p = 0.2 + forest * 0.95;
    if (rng.next() > p) return 0;
    return rng.chance(0.3) ? 2 : 1;
  }

  private propKindFor(t: Tile, forest: number, rng: Rng): PropKind {
    if (t.terrain === 'sand') return rng.chance(0.6) ? 'rock' : 'tuft';
    if (t.terrain === 'rock') return rng.chance(0.6) ? 'rock' : 'pine';
    if (forest > 0.6) {
      return rng.pickWeighted(['tree', 'pine', 'bush'] as const, (k) =>
        k === 'tree' ? 5 : k === 'pine' ? 3 : 2,
      );
    }
    return rng.pickWeighted(['tree', 'bush', 'flowers', 'tuft'] as const, (k) =>
      k === 'tree' ? 2 : k === 'bush' ? 3 : 4,
    );
  }

  private nearStructure(gx: number, gy: number, r: number): boolean {
    return this.structures.some((s) => Math.abs(s.gx - gx) <= r && Math.abs(s.gy - gy) <= r);
  }

  private terrainAt(gx: number, gy: number): Terrain {
    if (gx < 0 || gy < 0 || gx >= MAP_SIZE || gy >= MAP_SIZE) return 'water';
    return this.tiles[gy * MAP_SIZE + gx]!.terrain;
  }

  private heightAt = (gx: number, gy: number): number => {
    if (gx < 0 || gy < 0 || gx >= MAP_SIZE || gy >= MAP_SIZE) return -1;
    return this.tiles[gy * MAP_SIZE + gx]!.height;
  };

  // ---------------------------------------------------------------- update

  update(dt: number, ctx: SceneContext): void {
    this.time += dt;
    const { camera } = ctx.renderer;
    const { input } = ctx;

    const axis = input.axis();
    if (axis.x !== 0 || axis.y !== 0) {
      const speed = 480 / camera.zoom;
      camera.panBy(axis.x * speed * dt, axis.y * speed * dt);
    }
    if (input.pointer.dragging) {
      camera.panBy(-input.pointer.delta.x / camera.zoom, -input.pointer.delta.y / camera.zoom);
    }
    if (input.pointer.wheel !== 0) {
      camera.zoomAt(input.pointer.position, Math.pow(0.999, input.pointer.wheel));
    }

    const world = camera.screenToWorld(input.pointer.position);
    const picked = screenToGridOnHeightmap(world, this.heightAt, MAX_HEIGHT, DEFAULT_ISO);
    this.hoverGx = picked ? picked.gx : -1;
    this.hoverGy = picked ? picked.gy : -1;

    if (input.clicked && picked) {
      const p = gridToScreen({ gx: picked.gx, gy: picked.gy, h: picked.h }, DEFAULT_ISO);
      this.particles.emit({
        x: p.x,
        y: p.y,
        count: 14,
        color: PALETTE.sparkle,
        colorEnd: PALETTE.flowerYellow,
        speedMin: 25,
        speedMax: 90,
        lifeMin: 0.3,
        lifeMax: 0.7,
        sizeMin: 2,
        sizeMax: 4,
        gravity: 130,
        shape: 'spark',
        emissive: 1.1,
      });
    }

    this.particles.update(dt);
  }

  // ---------------------------------------------------------------- render

  render(_alpha: number, ctx: SceneContext): void {
    const r = ctx.renderer;

    r.beginLayer('world');
    this.renderWorld(ctx);
    r.beginLayer('effects');
    this.particles.render(r.shapes);
    r.beginLayer('ui');
    this.renderHud(ctx);
    r.endLayer();
  }

  /**
   * One pass over the island in painter order.
   *
   * Terrain, props, and buildings are interleaved by diagonal rather than
   * drawn in three separate passes, because a tree on tile (5,5) has to come
   * after the terrain of (5,5) and before the terrain of (6,6). Three passes
   * would put every tree either behind every hill or in front of every hill,
   * and both look broken.
   */
  private renderWorld(ctx: SceneContext): void {
    const { shapes, camera } = ctx.renderer;
    const pad = DEFAULT_ISO.tileW * 2 + MAX_HEIGHT * DEFAULT_ISO.elevation + 80;
    const view = camera.visibleBounds(pad);

    let propIndex = 0;
    let structIndex = 0;
    const maxSum = (MAP_SIZE - 1) * 2;

    for (let sum = 0; sum <= maxSum; sum++) {
      const startX = Math.max(0, sum - (MAP_SIZE - 1));
      const endX = Math.min(MAP_SIZE - 1, sum);

      for (let gx = startX; gx <= endX; gx++) {
        const gy = sum - gx;
        const tile = this.tiles[gy * MAP_SIZE + gx]!;
        const screen = gridToScreen({ gx, gy, h: 0 }, DEFAULT_ISO);
        if (
          screen.x < view.minX || screen.x > view.maxX ||
          screen.y < view.minY || screen.y > view.maxY
        ) {
          continue;
        }

        const hovered = gx === this.hoverGx && gy === this.hoverGy;

        if (tile.terrain === 'water') {
          drawWaterTile(shapes, { gx, gy, h: 0 }, this.time, tile.shore);
        } else {
          const base = hovered ? mix(tile.color, PALETTE.sparkle, 0.32) : tile.color;
          const f = faceColors(base);
          shapes.isoBlockFaces(
            { gx, gy, h: 0 }, tile.height, f.top, f.right, f.left, 1, 0, DEFAULT_ISO,
          );
          if (tile.path) drawPathTile(shapes, { gx, gy, h: tile.height }, gx * 7.3 + gy * 3.1);
        }
      }

      while (propIndex < this.props.length && this.props[propIndex]!.depth < sum + 1) {
        this.drawProp(shapes, this.props[propIndex]!);
        propIndex++;
      }
      while (
        structIndex < this.structures.length &&
        this.structures[structIndex]!.gx + this.structures[structIndex]!.gy <= sum
      ) {
        const s = this.structures[structIndex]!;
        const tile = this.tiles[s.gy * MAP_SIZE + s.gx]!;
        drawBuilding(shapes, { gx: s.gx, gy: s.gy, h: tile.height }, s.style, this.time);
        structIndex++;
      }
      if (this.hallAt.gx + this.hallAt.gy === sum) {
        const tile = this.tiles[this.hallAt.gy * MAP_SIZE + this.hallAt.gx]!;
        drawMainHall(
          shapes,
          { gx: this.hallAt.gx, gy: this.hallAt.gy, h: tile.height },
          8,
          this.time,
        );
      }
    }
  }

  private drawProp(shapes: SceneContext['renderer']['shapes'], prop: Prop): void {
    switch (prop.kind) {
      case 'tree':
        drawTree(shapes, prop.anchor);
        break;
      case 'pine':
        drawPine(shapes, prop.anchor);
        break;
      case 'bush':
        drawBush(shapes, prop.anchor);
        break;
      case 'rock':
        drawRock(shapes, prop.anchor);
        break;
      case 'flowers':
        drawFlowers(shapes, prop.anchor);
        break;
      case 'tuft':
        drawGrassTuft(shapes, prop.anchor);
        break;
    }
  }

  // ------------------------------------------------------------------- HUD

  private renderHud(ctx: SceneContext): void {
    const { shapes, quads } = ctx.renderer;
    const { width, height } = ctx.renderer.ctx;

    // Title card
    shapes.roundedRect(14, 14, 236, 48, 13, PALETTE.uiShadow, 0.18, 0);
    shapes.roundedRect(14, 11, 236, 48, 13, PALETTE.uiPanel, 0.97, 0);
    shapes.roundedRect(14, 11, 6, 48, 3, PALETTE.typeInfra, 1, 0);
    drawText(quads, this.font, 'STACKMON', 34, 20, {
      color: PALETTE.ink,
      letterSpacing: 3,
    });
    drawText(quads, this.fontSmall, 'THE DISTRIBUTED REALM', 35, 42, {
      color: PALETTE.inkSoft,
      letterSpacing: 1.6,
    });

    // Family legend
    const legendW = 84 + TYPE_IDS.length * 42;
    const legendY = height - 62;
    shapes.roundedRect(14, legendY + 3, legendW, 50, 14, PALETTE.uiShadow, 0.16, 0);
    shapes.roundedRect(14, legendY, legendW, 50, 14, PALETTE.uiPanel, 0.96, 0);
    drawText(quads, this.fontSmall, 'FAMILIES', 30, legendY + 19, {
      color: PALETTE.inkSoft,
      letterSpacing: 1.4,
    });
    for (let i = 0; i < TYPE_IDS.length; i++) {
      const t = TYPE_IDS[i]!;
      drawIconBadge(shapes, TECH_BY_TYPE[t][0]![0], 104 + i * 42, legendY + 25, 15, t);
    }

    // Hover readout
    if (this.hoverGx >= 0) {
      const tile = this.tiles[this.hoverGy * MAP_SIZE + this.hoverGx]!;
      const struct = this.structures.find((s) => s.gx === this.hoverGx && s.gy === this.hoverGy);
      const title = struct ? struct.label : tile.terrain.toUpperCase();
      const sub = struct
        ? 'Technology outpost'
        : `Elevation ${tile.height}${tile.path ? ' - path' : ''}`;

      const w = Math.max(this.font.measure(title), this.fontSmall.measure(sub)) + 44;
      const x = width / 2 - w / 2;
      shapes.roundedRect(x, height - 75, w, 52, 13, PALETTE.uiShadow, 0.2, 0);
      shapes.roundedRect(x, height - 78, w, 52, 13, PALETTE.uiPanel, 0.97, 0);
      if (struct) shapes.roundedRect(x, height - 78, w, 6, 3, TYPE_COLORS[struct.style.type], 1, 0);
      drawText(quads, this.font, title, width / 2, height - 66, {
        color: PALETTE.ink,
        align: 'center',
        letterSpacing: 1.4,
      });
      drawText(quads, this.fontSmall, sub, width / 2, height - 46, {
        color: PALETTE.inkSoft,
        align: 'center',
      });
    }

    // Diagnostics
    const stats = ctx.renderer.stats();
    const diag = [
      `${stats.drawCalls} draw calls`,
      `${Math.round(stats.triangles)} tris`,
      `${this.props.length} props`,
      `zoom ${ctx.renderer.camera.zoom.toFixed(2)}x`,
    ];
    let dy = height - 26;
    for (let i = diag.length - 1; i >= 0; i--) {
      drawText(quads, this.fontSmall, diag[i]!, width - 18, dy, {
        color: PALETTE.uiPanel,
        alpha: 0.85,
        scale: 0.92,
        align: 'right',
      });
      dy -= 14;
    }

    drawText(
      quads,
      this.fontSmall,
      'WASD or drag to pan     scroll to zoom',
      width / 2,
      22,
      { color: PALETTE.uiPanel, alpha: 0.92, align: 'center', letterSpacing: 1 },
    );
  }
}

/** Per-tile colour: terrain base, shifted by elevation and a noise jitter. */
function tileColor(terrain: Terrain, height: number, jitter: number): number {
  switch (terrain) {
    case 'water':
      return PALETTE.water;
    case 'sand':
      return mix(PALETTE.sand, PALETTE.sandDeep, jitter * 0.55);
    case 'rock':
      return mix(PALETTE.cliff, PALETTE.cliffDeep, jitter * 0.6);
    default: {
      // Higher meadow is paler and yellower, like sun-dried grass.
      const alt = Math.min(1, (height - 1) / (MAX_HEIGHT - 2));
      const base = mix(PALETTE.grass, PALETTE.grassLight, alt * 0.45);
      return shade(mix(base, PALETTE.grassDeep, jitter * 0.5), (jitter - 0.5) * 0.1);
    }
  }
}
