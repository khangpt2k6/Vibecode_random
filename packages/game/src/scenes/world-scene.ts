import {
  DEFAULT_ISO,
  Font,
  ParticleSystem,
  Rng,
  ValueNoise2D,
  drawText,
  gridToScreen,
  screenToGridOnHeightmap,
  shadeRgb,
  type Scene,
  type SceneContext,
} from '@stackmon/engine';
import { PALETTE, TYPES, TYPE_IDS, typeFill, type TypeId } from '../art/palette.js';

/**
 * The overworld.
 *
 * At this milestone it is a proving ground for the renderer rather than a
 * game: generated terrain, a handful of structures, hover picking, camera
 * control, and the particle and text layers, all running through the real
 * frame graph. Everything here is meant to be replaced by real world
 * streaming, but the visual language it establishes is not.
 */

const MAP_SIZE = 48;
const MAX_HEIGHT = 5;

/** Terrain colour by elevation, index 0 being the void floor. */
const TERRAIN_RAMP = [
  PALETTE.voidMid,
  PALETTE.terrainBase,
  PALETTE.terrainLow,
  PALETTE.terrainMid,
  PALETTE.terrainHigh,
  PALETTE.terrainPeak,
];

interface Tile {
  height: number;
  color: number;
  /** 0 for plain ground, 1 for a lit circuit trace running through it. */
  trace: number;
}

interface Structure {
  gx: number;
  gy: number;
  height: number;
  type: TypeId;
  label: string;
  /** Phase offset so identical structures do not pulse in lockstep. */
  phase: number;
}

export class WorldScene implements Scene {
  readonly name = 'world';

  private tiles: Tile[] = [];
  private structures: Structure[] = [];
  private font!: Font;
  private particles!: ParticleSystem;
  private rng = new Rng('stackmon-overworld-v1');
  private time = 0;

  private hoverGx = -1;
  private hoverGy = -1;

  enter(ctx: SceneContext): void {
    this.font = new Font(ctx.renderer.gl, { size: 13, weight: 600 });
    this.particles = new ParticleSystem(this.rng.fork('particles'));

    this.generateTerrain();
    this.placeStructures();

    const camera = ctx.renderer.camera;
    const centre = gridToScreen({ gx: MAP_SIZE / 2, gy: MAP_SIZE / 2, h: 0 }, DEFAULT_ISO);
    camera.minZoom = 0.28;
    camera.maxZoom = 3;

    // Fit the whole island on entry. An isometric map of N tiles is N*tileW
    // wide and N*tileH tall in world pixels, so the zoom that frames it is
    // whichever axis runs out first, with a margin so it does not touch the
    // screen edges.
    const worldW = MAP_SIZE * DEFAULT_ISO.tileW;
    const worldH = MAP_SIZE * DEFAULT_ISO.tileH + MAX_HEIGHT * DEFAULT_ISO.elevation;
    const fit = Math.min(
      ctx.renderer.ctx.width / worldW,
      ctx.renderer.ctx.height / worldH,
    ) * 0.92;
    camera.snapTo(centre.x, centre.y);
    camera.setZoom(Math.max(camera.minZoom, fit), true);

    camera.bounds = {
      minX: -worldW / 2 - 200,
      maxX: worldW / 2 + 200,
      minY: -200,
      maxY: worldH + 200,
    };
  }

  exit(): void {
    this.font.dispose();
  }

  private generateTerrain(): void {
    const noise = new ValueNoise2D('terrain-v1');
    const detail = new ValueNoise2D('detail-v1');
    this.tiles = new Array(MAP_SIZE * MAP_SIZE);

    for (let gy = 0; gy < MAP_SIZE; gy++) {
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        const n = noise.fbm(gx * 0.055, gy * 0.055, 4);

        // Pull the edges down so the island reads as a platform floating in
        // the void rather than a slab clipped by the screen.
        const dx = (gx / MAP_SIZE - 0.5) * 2;
        const dy = (gy / MAP_SIZE - 0.5) * 2;
        const edge = 1 - Math.min(1, Math.hypot(dx, dy) * 1.05);
        const shaped = n * 0.65 + edge * 0.55;

        const height = Math.max(0, Math.min(MAX_HEIGHT, Math.round(shaped * MAX_HEIGHT)));

        // Circuit traces: thin ridges of the detail noise, lit up. They give
        // the ground somewhere for the eye to travel instead of reading as
        // undifferentiated terrain.
        const d = detail.fbm(gx * 0.14, gy * 0.14, 3);
        const trace = d > 0.545 && d < 0.558 && height > 0 ? 1 : 0;

        // Ramp the colour by elevation rather than shading one base tone, so
        // the plateaus separate tonally instead of all reading as one mass.
        const base = TERRAIN_RAMP[Math.min(TERRAIN_RAMP.length - 1, height)]!;

        this.tiles[gy * MAP_SIZE + gx] = { height, color: base, trace };
      }
    }
  }

  private placeStructures(): void {
    const rng = this.rng.fork('structures');
    const names: Record<TypeId, string[]> = {
      data: ['POSTGRES', 'MYSQL', 'MONGO'],
      stream: ['KAFKA', 'RABBITMQ', 'PULSAR'],
      runtime: ['JVM', 'CPYTHON', 'NODE'],
      infra: ['DOCKER', 'K8S', 'NGINX'],
      cache: ['REDIS', 'MEMCACHED', 'VARNISH'],
      intel: ['ELASTIC', 'SPARK', 'CLICKHOUSE'],
    };

    let attempts = 0;
    while (this.structures.length < 22 && attempts < 800) {
      attempts++;
      const gx = rng.int(3, MAP_SIZE - 4);
      const gy = rng.int(3, MAP_SIZE - 4);
      const tile = this.tiles[gy * MAP_SIZE + gx];
      if (!tile || tile.height < 2) continue;
      // Keep them apart so the skyline has gaps to read silhouettes against.
      if (this.structures.some((s) => Math.abs(s.gx - gx) + Math.abs(s.gy - gy) < 5)) continue;

      const type = rng.pick(TYPE_IDS);
      this.structures.push({
        gx,
        gy,
        height: rng.int(2, 5),
        type,
        label: rng.pick(names[type]),
        phase: rng.range(0, Math.PI * 2),
      });
    }
    this.structures.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
  }

  private heightAt = (gx: number, gy: number): number => {
    if (gx < 0 || gy < 0 || gx >= MAP_SIZE || gy >= MAP_SIZE) return -1;
    return this.tiles[gy * MAP_SIZE + gx]!.height;
  };

  update(dt: number, ctx: SceneContext): void {
    this.time += dt;
    const { camera } = ctx.renderer;
    const { input } = ctx;

    // --- camera ---
    const axis = input.axis();
    if (axis.x !== 0 || axis.y !== 0) {
      const speed = 520 / camera.zoom;
      camera.panBy(axis.x * speed * dt, axis.y * speed * dt);
    }
    if (input.pointer.dragging) {
      camera.panBy(-input.pointer.delta.x / camera.zoom, -input.pointer.delta.y / camera.zoom);
    }
    if (input.pointer.wheel !== 0) {
      camera.zoomAt(input.pointer.position, Math.pow(0.999, input.pointer.wheel));
    }

    // --- hover pick ---
    const world = camera.screenToWorld(input.pointer.position);
    const picked = screenToGridOnHeightmap(world, this.heightAt, MAX_HEIGHT, DEFAULT_ISO);
    this.hoverGx = picked ? picked.gx : -1;
    this.hoverGy = picked ? picked.gy : -1;

    // --- click feedback ---
    if (input.clicked && picked) {
      const p = gridToScreen({ gx: picked.gx + 0.5, gy: picked.gy + 0.5, h: picked.h }, DEFAULT_ISO);
      this.particles.emit({
        x: p.x,
        y: p.y,
        count: 26,
        color: PALETTE.glowCyan,
        colorEnd: PALETTE.typeData,
        speedMin: 30,
        speedMax: 190,
        lifeMin: 0.25,
        lifeMax: 0.75,
        sizeMin: 2,
        sizeMax: 5,
        gravity: 220,
        shape: 'streak',
        emissive: 2.2,
      });
      ctx.renderer.camera.shake(0.12);
    }

    // --- ambient emission from structures ---
    if (this.rng.chance(dt * 7)) {
      const s = this.rng.pick(this.structures);
      const p = gridToScreen({ gx: s.gx + 0.5, gy: s.gy + 0.5, h: s.height }, DEFAULT_ISO);
      this.particles.emit({
        x: p.x,
        y: p.y - 6,
        count: 1,
        color: TYPES[s.type].color,
        speedMin: 8,
        speedMax: 26,
        angle: -Math.PI / 2,
        spread: 0.7,
        lifeMin: 1.2,
        lifeMax: 2.4,
        sizeMin: 2,
        sizeMax: 3.5,
        drag: 0.85,
        gravity: -14,
        shape: 'spark',
        emissive: 2.6,
      });
    }

    this.particles.update(dt);
  }

  render(_alpha: number, ctx: SceneContext): void {
    const r = ctx.renderer;
    const { shapes } = r;

    r.beginLayer('world');
    this.renderTerrain(ctx);
    this.renderStructures(ctx);
    r.beginLayer('effects');
    this.particles.render(shapes);
    r.beginLayer('ui');
    this.renderHud(ctx);
    r.endLayer();
  }

  private renderTerrain(ctx: SceneContext): void {
    const { shapes, camera } = ctx.renderer;
    const view = camera.visibleBounds(DEFAULT_ISO.tileW * 2 + MAX_HEIGHT * DEFAULT_ISO.elevation);

    // Painter order for an isometric grid is simply increasing (gx + gy), so
    // walking diagonals gives a correct back-to-front sort with no sorting.
    for (let sum = 0; sum <= (MAP_SIZE - 1) * 2; sum++) {
      const startX = Math.max(0, sum - (MAP_SIZE - 1));
      const endX = Math.min(MAP_SIZE - 1, sum);
      for (let gx = startX; gx <= endX; gx++) {
        const gy = sum - gx;
        const tile = this.tiles[gy * MAP_SIZE + gx]!;
        if (tile.height === 0) continue;

        const screen = gridToScreen({ gx, gy, h: 0 }, DEFAULT_ISO);
        if (
          screen.x < view.minX || screen.x > view.maxX ||
          screen.y < view.minY || screen.y > view.maxY
        ) {
          continue;
        }

        const hovered = gx === this.hoverGx && gy === this.hoverGy;
        const color = hovered ? shadeRgb(tile.color, 1.9) : tile.color;

        shapes.isoBlock({ gx, gy, h: 0 }, tile.height, color, 1, 0, DEFAULT_ISO);

        if (tile.trace) {
          // A lit seam across the top face, running with the diagonal.
          const top = gridToScreen({ gx, gy, h: tile.height }, DEFAULT_ISO);
          shapes.line(
            top.x - DEFAULT_ISO.tileW * 0.5, top.y,
            top.x + DEFAULT_ISO.tileW * 0.5, top.y,
            1.6, PALETTE.glowCyan, 0.55, 1.3,
          );
        }

        if (hovered) {
          shapes.isoBlockTrim(
            { gx, gy, h: 0 }, tile.height, 2.5, PALETTE.glowCyan, 1, 3, DEFAULT_ISO,
          );
        }
      }
    }
  }

  /**
   * Light bands wrapping the two visible faces of a tower.
   *
   * Deliberately not `isoBlockTrim`: tracing the full diamond at every floor
   * draws the two hidden edges too, and a stack of complete outlines reads as
   * a pile of rings rather than as a building with lit floors. Only the front
   * two edges are ever visible on an isometric block, so only those are drawn.
   */
  private drawFaceBands(
    base: { gx: number; gy: number; h: number },
    lift: number,
    inset: number,
    color: number,
    alpha: number,
    emissive: number,
    shapes: SceneContext['renderer']['shapes'],
  ): void {
    const c = gridToScreen(base, DEFAULT_ISO);
    const hw = DEFAULT_ISO.tileW * 0.5 - inset;
    const hh = DEFAULT_ISO.tileH * 0.5 - inset * 0.5;
    shapes.line(c.x - hw, c.y - lift, c.x, c.y + hh - lift, 1.4, color, alpha, emissive);
    shapes.line(c.x, c.y + hh - lift, c.x + hw, c.y - lift, 1.4, color, alpha, emissive * 1.25);
  }

  private renderStructures(ctx: SceneContext): void {
    const { shapes, quads } = ctx.renderer;
    const iso = DEFAULT_ISO;

    for (const s of this.structures) {
      const tile = this.tiles[s.gy * MAP_SIZE + s.gx]!;
      const base = { gx: s.gx, gy: s.gy, h: tile.height };
      const color = TYPES[s.type].color;
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 1.5 + s.phase);

      // Plinth: a short, wide, unlit slab. Towers that rise straight out of
      // the ground look pasted on; a base course grounds them.
      shapes.isoBlock(base, 0.4, PALETTE.panelDark, 1, 0, iso, 3);

      // Body, inset so the plinth shows as a ledge around it.
      const bodyBase = { gx: s.gx, gy: s.gy, h: tile.height + 0.4 };
      shapes.isoBlock(bodyBase, s.height, typeFill(s.type), 1, 0.05, iso, 9);

      // Lit floors up the two visible faces.
      const floors = Math.max(2, Math.round(s.height * 1.6));
      for (let i = 1; i <= floors; i++) {
        const t = i / (floors + 1);
        this.drawFaceBands(
          bodyBase,
          t * s.height * iso.elevation,
          9,
          color,
          0.30 + 0.22 * pulse,
          0.9 + pulse * 0.5,
          shapes,
        );
      }

      // Roof: a bright cap plus the full outline. This is the one place the
      // complete diamond belongs, because it terminates the silhouette.
      const roof = { gx: s.gx, gy: s.gy, h: tile.height + 0.4 + s.height };
      shapes.isoTile(roof, color, 0.85, 1.5 + pulse * 0.8, iso, 9);
      shapes.isoTileOutline(roof, 1.6, color, 1, 2.2 + pulse, iso);

      // Mast and beacon.
      const top = gridToScreen(roof, iso);
      const mastH = 12 + s.height * 2;
      shapes.line(top.x, top.y, top.x, top.y - mastH, 1.4, PALETTE.steelLight, 0.9, 0.2);
      shapes.circle(top.x, top.y - mastH, 2.2 + pulse * 1.4, color, 1, 3.0, 10);
      shapes.ring(top.x, top.y - mastH, 7 + pulse * 6, 1, color, 0.30 * pulse, 1.8, 18);

      // Label plate.
      const label = s.label;
      const width = this.font.measure(label) * 0.8;
      const lx = top.x;
      const ly = top.y - mastH - 26;
      shapes.rect(lx - width / 2 - 6, ly - 3, width + 12, 16, PALETTE.voidDeep, 0.8, 0);
      shapes.line(lx - width / 2 - 6, ly + 13, lx + width / 2 + 6, ly + 13, 1.2, color, 0.85, 1.5);
      drawText(quads, this.font, label, lx, ly, {
        scale: 0.8,
        color,
        align: 'center',
        emissive: 1.2,
        letterSpacing: 1.1,
      });
    }
  }

  private renderHud(ctx: SceneContext): void {
    const { shapes, quads } = ctx.renderer;
    const { width, height } = ctx.renderer.ctx;
    const stats = ctx.renderer.stats();
    const loopStats = { fps: 0 };
    void loopStats;

    // Top bar
    shapes.rect(0, 0, width, 42, PALETTE.voidDeep, 0.82, 0);
    shapes.line(0, 42, width, 42, 1, PALETTE.steel, 0.8, 0.6);
    drawText(quads, this.font, 'STACKMON', 18, 13, {
      color: PALETTE.glowCyan,
      emissive: 1.8,
      letterSpacing: 3.5,
      scale: 1.05,
    });
    drawText(quads, this.font, 'THE DISTRIBUTED REALM', 132, 15, {
      color: PALETTE.inkFaint,
      scale: 0.78,
      letterSpacing: 2,
    });

    // Type legend, bottom left
    let ly = height - 26;
    for (let i = TYPE_IDS.length - 1; i >= 0; i--) {
      const t = TYPES[TYPE_IDS[i]!];
      shapes.rect(18, ly + 1, 9, 9, t.color, 1, 1.8);
      drawText(quads, this.font, t.label, 34, ly - 1, {
        color: PALETTE.inkDim,
        scale: 0.76,
        letterSpacing: 1.4,
      });
      ly -= 16;
    }

    // Diagnostics, bottom right
    const diag = [
      `${stats.drawCalls} draw calls`,
      `${Math.round(stats.triangles)} tris`,
      `${this.particles.liveCount} particles`,
      `zoom ${ctx.renderer.camera.zoom.toFixed(2)}x`,
    ];
    let dy = height - 26;
    for (let i = diag.length - 1; i >= 0; i--) {
      drawText(quads, this.font, diag[i]!, width - 18, dy, {
        color: PALETTE.inkFaint,
        scale: 0.72,
        align: 'right',
      });
      dy -= 14;
    }

    // Hover readout
    if (this.hoverGx >= 0) {
      const tile = this.tiles[this.hoverGy * MAP_SIZE + this.hoverGx]!;
      const text = `TILE ${this.hoverGx},${this.hoverGy}  ELEV ${tile.height}`;
      const w = this.font.measure(text) * 0.8 + 20;
      shapes.rect(width / 2 - w / 2, height - 44, w, 22, PALETTE.panelDark, 0.88, 0);
      shapes.line(
        width / 2 - w / 2, height - 44, width / 2 + w / 2, height - 44,
        1.5, PALETTE.glowCyan, 0.9, 1.6,
      );
      drawText(quads, this.font, text, width / 2, height - 39, {
        color: PALETTE.ink,
        scale: 0.8,
        align: 'center',
        letterSpacing: 1.2,
      });
    }

    // Controls hint
    drawText(
      quads, this.font,
      'WASD / drag to pan     scroll to zoom     click to ping',
      18, height - 128,
      { color: PALETTE.inkFaint, scale: 0.72, letterSpacing: 0.8 },
    );
  }
}
