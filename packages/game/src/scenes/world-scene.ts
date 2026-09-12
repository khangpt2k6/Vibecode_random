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
import {
  PropAtlas,
  groupExcluding,
  groupMatching,
  pickFrom,
  propPool,
  ATLAS_GROUPS,
} from '../art/atlas.js';
import { footprint } from '../art/solids.js';
import { drawBuilding, drawMainHall, type BuildingStyle } from '../art/buildings.js';
import { drawCrop, drawEmptyPlot, drawPlotBase, drawScaffold } from '../art/farm.js';
import { drawIconBadge } from '../art/icons.js';
import { drawCreature, drawNamePlate, type CreatureVisual } from '../art/creatures.js';
import { BattleScene } from './battle-scene.js';
import { getCreature, incidentsOfTier } from '@stackmon/content';
import {
  applyBattle,
  attemptCapture,
  battleLineup,
  claimObjectiveRewards,
  grantXp,
  objectivesDone,
  OBJECTIVES,
  buildProgress,
  captureChance,
  captureCost,
  growth,
  harvest,
  isReady,
  owns,
  plant,
  rushBuild,
  startBuild,
  syncPlots,
  tickBuild,
  type PlayerState,
} from '@stackmon/core';
import { getBuilding, getCrop } from '@stackmon/content';
import { savePlayer } from '../state/save.js';
import type { UIContext } from '../ui/widgets.js';
import {
  drawBuildMenu,
  drawHelp,
  drawNudges,
  drawObjective,
  drawPlantMenu,
  drawResourceBar,
  drawToolbar,
} from '../ui/world-hud.js';
import { drawQuestLog, questLogOverflow } from '../ui/quest-log.js';

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

/** Scatter that grows: spread across the island by terrain and noise. */
type NatureKind = 'tree' | 'pine' | 'bush' | 'rock' | 'flowers' | 'tuft';

/**
 * Scatter that was installed: clustered around whatever built it.
 *
 * These exist so the base reads as running infrastructure rather than as
 * houses in a field. They are deliberately not a replacement for the
 * buildings - the hand-drawn structures carry the brand colour and the
 * technology's icon, which is the whole identity of the place, and a generic
 * low-poly hangar would throw that away. This is the pipework around them.
 */
type BaseKind = 'machine' | 'dish' | 'pipe' | 'crate' | 'panel';

type PropKind = NatureKind | BaseKind;

/**
 * Which slice of the baked atlas each kind of scatter draws from.
 *
 * The baker files every conifer under "tree" because it sorts by what the
 * model is, not by how the island uses it. The island wants pines on the
 * ridges and broadleaf in the meadow, so the two are split back apart here.
 * Rocks and stones are two groups in the atlas - same shapes, two colour
 * families - and the island is happy with either.
 */
const PROP_POOLS: Record<PropKind, () => readonly string[]> = {
  tree: () => groupExcluding('tree', 'pine'),
  pine: () => groupMatching('tree', 'pine'),
  bush: () => ATLAS_GROUPS.bush ?? [],
  rock: () => [...(ATLAS_GROUPS.rock ?? []), ...(ATLAS_GROUPS.stone ?? [])],
  flowers: () => ATLAS_GROUPS.flower ?? [],
  tuft: () => ATLAS_GROUPS.grass ?? [],

  machine: () => ATLAS_GROUPS.machine ?? [],
  dish: () => ATLAS_GROUPS.dish ?? [],
  // Not the whole pipe group: the rings, the high supports and the tunnel
  // entrance are all big vertical hoops that read as abandoned playground
  // equipment when they are sitting on grass next to a cottage. What is left
  // is pipework lying along the ground, which is what a yard looks like.
  pipe: () => (ATLAS_GROUPS.pipe ?? []).filter((id) => !/ring|entrance|supportHigh/.test(id)),
  crate: () => [...(ATLAS_GROUPS.crate ?? []), ...(ATLAS_GROUPS.resource ?? [])],
  panel: () => ATLAS_GROUPS.panel ?? [],
};

/**
 * How much of each thing ends up around a building, and how big.
 *
 * Weighted heavily toward crates because clutter should read as clutter.
 * A satellite dish is a silhouette, and a silhouette repeated on every
 * building stops being one - so dishes are rare and the boxes are common.
 * The scales pull the larger space-kit models down a little so they sit
 * beside a one-storey house rather than dwarfing it.
 */
const BASE_CLUTTER: ReadonlyArray<{ kind: BaseKind; weight: number; min: number; max: number }> = [
  { kind: 'crate', weight: 5, min: 0.78, max: 1.08 },
  { kind: 'pipe', weight: 3, min: 0.82, max: 1.05 },
  { kind: 'machine', weight: 2, min: 0.74, max: 0.96 },
  { kind: 'panel', weight: 1, min: 0.8, max: 1.0 },
  { kind: 'dish', weight: 1, min: 0.68, max: 0.88 },
];

/**
 * Choose this prop's sprite from its tile, once, at generation time.
 *
 * Seeded from the coordinates rather than drawn from the scatter Rng so that
 * adding a prop kind later does not reshuffle every tree already on the map.
 */
function spriteFor(kind: PropKind, gx: number, gy: number, index: number): string | undefined {
  const pool = propPool(kind, PROP_POOLS[kind]);
  return pickFrom(pool, Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ Math.imul(index, 83492791));
}

interface Prop {
  kind: PropKind;
  anchor: PropAnchor;
  /** Sort key, so props interleave correctly with terrain and buildings. */
  depth: number;
  /**
   * Baked sprite for this prop, chosen at scatter time so it survives a
   * reload. Undefined only while the atlas is still downloading, and for the
   * handful of kinds it has no models for - drawProp falls back to the
   * hand-drawn version either way.
   */
  sprite?: string;
}

interface Structure {
  gx: number;
  gy: number;
  style: BuildingStyle;
  label: string;
  creatureId: string;
}

/**
 * A wild creature wandering the island.
 *
 * Position is kept in fractional grid coordinates rather than world pixels,
 * so walking logic can ask "is the next tile walkable" without converting
 * back and forth, and so depth sorting is just (gx + gy) like everything else.
 */
interface Wild {
  creatureId: string;
  label: string;
  type: TypeId;
  gx: number;
  gy: number;
  targetGx: number;
  targetGy: number;
  speed: number;
  facing: -1 | 1;
  phase: number;
  /** Seconds to stand still before choosing somewhere new to go. */
  restFor: number;
  level: number;
  /** Set when caught; the creature fades out and is removed. */
  leaving: number;
}

/** A short message that floats up and fades. */
interface Toast {
  x: number;
  y: number;
  text: string;
  color: number;
  life: number;
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

  constructor(private readonly player: PlayerState) {}

  private tiles: Tile[] = [];
  private props: Prop[] = [];
  private structures: Structure[] = [];
  private wild: Wild[] = [];
  private toasts: Toast[] = [];
  private hoverWild: Wild | null = null;
  private hallAt = { gx: 0, gy: 0 };

  private font!: Font;
  private fontSmall!: Font;
  /** Baked scenery. Null until the atlas finishes loading, or if it failed. */
  private atlas: PropAtlas | null = null;
  private particles!: ParticleSystem;
  private readonly rng = new Rng('stackmon-island-v2');
  private captureRng!: Rng;
  private time = 0;

  private hoverGx = -1;
  private hoverGy = -1;
  /** Which full-screen overlay is open, if any. */
  private overlay: 'none' | 'codex' | 'build' | 'help' | 'plant' | 'quests' = 'none';
  /** Scroll offset inside the quest log. */
  private questScroll = 0;
  /** Plot the plant menu is choosing a crop for. */
  private plantingPlot = -1;
  /** Grid tiles the farm plots occupy, laid out around the Ops Centre. */
  private plotTiles: Array<{ gx: number; gy: number }> = [];
  private hoverPlot = -1;
  /** Labels collected during the world pass and drawn together at the end. */
  private pendingLabels: Array<{ x: number; y: number; text: string; type: TypeId }> = [];

  enter(ctx: SceneContext): void {
    // Deliberately not awaited. SceneManager does await enter(), but it puts
    // the scene on the stack first and render() has no guard for a scene that
    // has not finished entering, so blocking here would draw a half-built
    // world for a frame. Every prop has a hand-drawn fallback, so the worst
    // case of a slow or failed atlas is the island the game shipped with.
    void PropAtlas.load(ctx.renderer.gl)
      .then((atlas) => { this.atlas = atlas; })
      .catch((err: unknown) => { console.warn('prop atlas unavailable, using drawn scenery', err); });

    this.font = new Font(ctx.renderer.gl, { size: 17, weight: 700 });
    this.fontSmall = new Font(ctx.renderer.gl, { size: 11, weight: 600 });
    this.particles = new ParticleSystem(this.rng.fork('particles'));
    // Seeded from the save plus how many things have happened in it, so a
    // reload cannot re-roll a capture that already failed.
    this.captureRng = new Rng(`${this.player.seed}-capture-${this.player.clock}`);

    this.generateTerrain();
    this.carvePaths();
    this.placeStructures();
    this.scatterProps();
    this.spawnWild();
    syncPlots(this.player.base);
    this.layoutPlots();
    // After layoutPlots, deliberately. It claims up to forty tiles around the
    // Ops Centre for the farm - far more than the player owns yet - and then
    // evicts any prop standing on one. Scattering clutter before it would
    // place a yard's worth of machinery and silently delete most of it.
    this.scatterBaseClutter();

    ctx.renderer.camera.minZoom = 0.3;
    ctx.renderer.camera.maxZoom = 2.6;
    this.fitCamera(ctx);
  }

  exit(): void {
    this.font.dispose();
    this.fontSmall.dispose();
  }

  /** Coming back from a battle: the battle moved the camera, put it back. */
  resume(ctx: SceneContext): void {
    this.fitCamera(ctx);
  }

  private fitCamera(ctx: SceneContext): void {
    const camera = ctx.renderer.camera;
    const centre = gridToScreen({ gx: MAP_SIZE / 2, gy: MAP_SIZE / 2, h: 1 }, DEFAULT_ISO);
    const worldW = MAP_SIZE * DEFAULT_ISO.tileW;
    const worldH = MAP_SIZE * DEFAULT_ISO.tileH + MAX_HEIGHT * DEFAULT_ISO.elevation;
    camera.bounds = {
      minX: -worldW / 2 - 160,
      maxX: worldW / 2 + 160,
      minY: -160,
      maxY: worldH + 160,
    };
    const fit = Math.min(ctx.renderer.ctx.width / worldW, ctx.renderer.ctx.height / worldH) * 1.4;
    camera.snapTo(centre.x, centre.y);
    camera.setZoom(Math.max(camera.minZoom, Math.min(1.1, fit)), true);
  }

  private battleCount = 0;

  /**
   * Clicking the hall picks a fight.
   *
   * Tier climbs with how many incidents the player has cleared, and within a
   * tier the incidents rotate, so a player who keeps losing to one keeps
   * meeting it - which is the point - but is not stuck with only that one.
   */
  private startBattle(ctx: SceneContext): void {
    const p = this.player;
    const cleared = Object.values(p.incidents).filter((r) => r.won > 0).length;
    const tier = Math.min(4, 1 + Math.floor(cleared / 2)) as 1 | 2 | 3 | 4;
    const pool = incidentsOfTier(tier);
    const incident = pool[this.battleCount % pool.length]!;
    this.battleCount++;

    const { lineup, bench } = battleLineup(p);
    const participants = [
      ...lineup.filter((m): m is NonNullable<typeof m> => m !== null),
      ...bench,
    ].map((m) => m.uid);

    ctx.scenes.pushWith(
      new BattleScene({
        setup: { lineup, bench, incidentId: incident.id, seed: `${p.seed}-battle-${p.clock}` },
        onFinish: (battle) => {
          const st = battle.state;
          if (st.outcome === 'ongoing') return;
          const rewards = applyBattle(p, {
            incidentId: incident.id,
            won: st.outcome === 'victory',
            turns: st.turn - 1,
            opsServed: st.totalHandled,
            opsDropped: st.totalDropped,
            participants,
          });
          savePlayer(p);
          const hall = gridToScreen({ gx: this.hallAt.gx, gy: this.hallAt.gy, h: 2 }, DEFAULT_ISO);
          this.toast(hall.x, hall.y - 80, `+${rewards.scrap} scrap  +${rewards.xpEach} xp each`, PALETTE.flowerYellow);
          rewards.levelUps.forEach((up, i) => {
            const c = p.roster.find((r) => r.uid === up.uid);
            if (c) this.toast(hall.x, hall.y - 110 - i * 18, `${getCreature(c.specId).name} reached L${up.to}`, PALETTE.good);
          });
        },
      }),
      { style: 'iris', duration: 0.34 },
    );
  }

  /**
   * Try to catch a wild creature.
   *
   * The offer is the base cost plus half of whatever scrap the player has
   * spare, capped: the player is always making a real trade, and never
   * emptying the account on one gamble.
   */
  private tryCapture(w: Wild): void {
    const p = this.player;
    const spec = getCreature(w.creatureId);
    const cost = captureCost(spec, w.level);
    const h = this.heightAt(Math.round(w.gx), Math.round(w.gy));
    const pos = gridToScreen({ gx: w.gx, gy: w.gy, h }, DEFAULT_ISO);

    if (p.resources.scrap < cost) {
      this.toast(pos.x, pos.y - 60, `Need ${cost} scrap (have ${p.resources.scrap})`, PALETTE.danger);
      return;
    }

    const spare = Math.max(0, p.resources.scrap - cost);
    const offer = cost + Math.min(Math.round(spare * 0.5), cost * 2);
    const result = attemptCapture(p, { specId: spec.id, level: w.level, scrapOffered: offer }, this.captureRng);
    savePlayer(p);

    if (result.success) {
      w.leaving = 0.01;
      this.toast(pos.x, pos.y - 60, `${spec.name} joined the roster!`, PALETTE.good);
      this.particles.emit({
        x: pos.x,
        y: pos.y - 20,
        count: 40,
        color: PALETTE.sparkle,
        colorEnd: TYPE_COLORS[w.type],
        speedMin: 40,
        speedMax: 160,
        lifeMin: 0.5,
        lifeMax: 1.1,
        sizeMin: 2,
        sizeMax: 5,
        gravity: 60,
        shape: 'spark',
        emissive: 1.6,
      });
    } else {
      const odds = Math.round(result.chance * 100);
      this.toast(pos.x, pos.y - 60, `${spec.name} slipped away  (-${result.scrapSpent} scrap, ${odds}% odds)`, PALETTE.warn);
      // It bolts for somewhere else on the island.
      for (let attempt = 0; attempt < 40; attempt++) {
        const gx = this.rng.int(3, MAP_SIZE - 4);
        const gy = this.rng.int(3, MAP_SIZE - 4);
        if (this.walkable(gx, gy)) {
          w.targetGx = gx;
          w.targetGy = gy;
          w.speed = 2.2;
          break;
        }
      }
    }
  }

  private toast(x: number, y: number, text: string, color: number): void {
    this.toasts.push({ x, y, text, color, life: 2.6 });
  }

  /**
   * The quest log's GO button.
   *
   * Two of these open a panel; the rest move the camera onto the thing the
   * mission is about and leave the player there. Pointing at something is a
   * much better answer to "where do I do this" than a sentence describing
   * where it is.
   */
  private goToObjective(ctx: SceneContext, target: string): void {
    const camera = ctx.renderer.camera;
    const focus = (gx: number, gy: number, zoom: number, label: string, color: number) => {
      const h = Math.max(0, this.heightAt(Math.round(gx), Math.round(gy)));
      const p = gridToScreen({ gx, gy, h }, DEFAULT_ISO);
      camera.moveTo(p.x, p.y);
      camera.setZoom(zoom);
      this.overlay = 'none';
      this.toast(p.x, p.y - 70, label, color);
    };

    switch (target) {
      case 'build':
        this.overlay = 'build';
        return;
      case 'codex':
        this.overlay = 'codex';
        return;
      case 'ops':
        focus(this.hallAt.gx, this.hallAt.gy, 1.3, 'Click the Ops Centre to fight', PALETTE.info);
        return;
      case 'plot': {
        const idx = this.player.base.plots.findIndex((x) => x.cropId === null);
        const tile = this.plotTile(Math.max(0, idx));
        if (!tile) {
          this.overlay = 'build';
          return;
        }
        focus(tile.gx, tile.gy, 1.6, 'Click a plot to plant', PALETTE.good);
        return;
      }
      case 'wild': {
        // Nearest to the camera, so GO never throws the player across the map.
        const alive = this.wild.filter((w) => w.leaving === 0);
        if (alive.length === 0) return;
        const target0 = alive.reduce((best, w) => {
          const p = gridToScreen({ gx: w.gx, gy: w.gy, h: 0 }, DEFAULT_ISO);
          const bp = gridToScreen({ gx: best.gx, gy: best.gy, h: 0 }, DEFAULT_ISO);
          const d = Math.hypot(p.x - camera.renderX, p.y - camera.renderY);
          const bd = Math.hypot(bp.x - camera.renderX, bp.y - camera.renderY);
          return d < bd ? w : best;
        });
        focus(target0.gx, target0.gy, 1.6, `Click ${target0.label} to capture`, PALETTE.good);
        return;
      }
    }
  }

  /** Click a plot: harvest if ready, otherwise open the crop picker. */
  private usePlot(index: number): void {
    const plot = this.player.base.plots[index];
    const tile = this.plotTile(index);
    if (!plot || !tile) return;
    const now = Date.now();
    const pos = gridToScreen({ gx: tile.gx, gy: tile.gy, h: this.heightAt(tile.gx, tile.gy) }, DEFAULT_ISO);

    if (isReady(plot, now)) {
      const cropId = plot.cropId;
      const result = harvest(this.player, this.player.base, plot.id, now);
      if (result.ok && result.gained && cropId) {
        const parts = Object.entries(result.gained).map(([k, v]) => `+${v} ${k}`);
        this.toast(pos.x, pos.y - 44, parts.join('  '), PALETTE.good);
        this.particles.emit({
          x: pos.x, y: pos.y - 18, count: 18, color: getCrop(cropId).tint,
          colorEnd: PALETTE.sparkle, speedMin: 30, speedMax: 110,
          lifeMin: 0.35, lifeMax: 0.8, sizeMin: 2, sizeMax: 4,
          gravity: 140, shape: 'spark', emissive: 1.3,
        });
        savePlayer(this.player);
      }
      return;
    }

    if (plot.cropId) {
      const left = Math.max(0, Math.ceil((plot.readyAt - now) / 1000));
      this.toast(pos.x, pos.y - 44, `${getCrop(plot.cropId).name}  -  ${left}s left`, PALETTE.info);
      return;
    }

    this.plantingPlot = index;
    this.overlay = 'plant';
  }

  private doPlant(cropId: string): void {
    const plot = this.player.base.plots[this.plantingPlot];
    const tile = this.plotTile(this.plantingPlot);
    this.overlay = 'none';
    if (!plot || !tile) return;

    const result = plant(this.player, this.player.base, plot.id, cropId, Date.now());
    const pos = gridToScreen({ gx: tile.gx, gy: tile.gy, h: this.heightAt(tile.gx, tile.gy) }, DEFAULT_ISO);
    if (result.ok) {
      this.toast(pos.x, pos.y - 44, `Planted ${getCrop(cropId).name}`, PALETTE.good);
      savePlayer(this.player);
    } else {
      this.toast(pos.x, pos.y - 44, 'Not enough scrap', PALETTE.danger);
    }
  }

  private doBuild(buildingId: string): void {
    const result = startBuild(this.player, this.player.base, buildingId, Date.now());
    const hall = gridToScreen({ gx: this.hallAt.gx, gy: this.hallAt.gy, h: 3 }, DEFAULT_ISO);
    if (result.ok) {
      this.toast(hall.x, hall.y - 70, `${getBuilding(buildingId).name} started`, PALETTE.good);
      this.overlay = 'none';
      savePlayer(this.player);
    } else if (!result.ok && result.reason === 'cost') {
      const parts = Object.entries(result.missing ?? {}).map(([k, v]) => `${v} ${k}`);
      this.toast(hall.x, hall.y - 70, `Need ${parts.join(', ')}`, PALETTE.danger);
    }
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
        // The exponent sharpens the coast. A linear falloff spends a third
        // of the island's radius crossing the beach, which is why the shore
        // read as an enormous flat sand ring rather than as a shoreline.
        const radial = Math.pow(Math.max(0, 1 - Math.hypot(dx, dy) * 1.05), 0.55);
        const n = shapeNoise.fbm(gx * 0.075, gy * 0.075, 4);
        const elevation = radial * 0.86 + n * 0.36 - 0.2;

        let terrain: Terrain;
        let height: number;

        if (elevation < 0.06) {
          terrain = 'water';
          height = 0;
        } else if (elevation < 0.13) {
          terrain = 'sand';
          height = 1;
        } else {
          // A gentle curve, so the interior is rolling meadow with a few
          // hills rather than one saturated plateau. The earlier mapping hit
          // its ceiling almost immediately and flattened the whole middle of
          // the island into a single grey slab.
          // Low-frequency ridges give broad hills and valleys; the elevation
          // term only tilts them toward the middle of the island.
          const ridge = detail.fbm(gx * 0.062, gy * 0.062, 4);
          const h = (elevation - 0.13) * 0.75 + (ridge - 0.34) * 1.75;
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

  /**
   * A branch from the plaza out to one structure.
   *
   * Runs along the central row first and only then turns, so every branch
   * shares the same spine. Turning first instead gave each structure its own
   * full-width road across the island, and twenty-four of those paved most of
   * the meadow.
   */
  private pathTo(gx: number, gy: number): void {
    const mid = Math.floor(MAP_SIZE / 2);
    const stepX = gx > mid ? 1 : -1;
    for (let x = mid; x !== gx; x += stepX) this.markPath(x, mid);
    const stepY = gy > mid ? 1 : -1;
    for (let y = mid; y !== gy; y += stepY) this.markPath(gx, y);
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
          const kind = this.propKindFor(t, forest, rng);
          this.props.push({
            kind,
            sprite: spriteFor(kind, gx, gy, i),
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

  /**
   * Ring the buildings with machinery.
   *
   * The island scatter deliberately leaves a one-tile gap around every
   * structure so houses are not swallowed by trees, and that gap is what
   * makes the settlement read as houses in a field. Filling it with pipework,
   * crates and generators is what turns it into somewhere that runs
   * something - which is the whole premise of the game.
   *
   * Nothing here is interactive, so it skips `occluded()` for the same
   * reason the foliage does: a decorative crate behind a rise is drawn
   * correctly, and nobody ever needs to click it.
   */
  private scatterBaseClutter(): void {
    const rng = this.rng.fork('base-clutter-v1');
    const plots = new Set(this.plotTiles.map((t) => `${t.gx},${t.gy}`));
    const added: Prop[] = [];

    const place = (gx: number, gy: number, chance: number): void => {
      if (gx < 1 || gy < 1 || gx >= MAP_SIZE - 1 || gy >= MAP_SIZE - 1) return;
      const t = this.tiles[gy * MAP_SIZE + gx]!;
      // Paths are how the player walks in, and the plaza is a path too.
      if (t.terrain === 'water' || t.path) return;
      if (plots.has(`${gx},${gy}`)) return;
      if (this.structures.some((st) => st.gx === gx && st.gy === gy)) return;
      if (!rng.chance(chance)) return;

      const spec = rng.pickWeighted(BASE_CLUTTER, (c) => c.weight);
      const jx = rng.range(-0.26, 0.26);
      const jy = rng.range(-0.26, 0.26);
      added.push({
        kind: spec.kind,
        sprite: spriteFor(spec.kind, gx, gy, added.length),
        anchor: anchorAt(
          { gx: gx + jx, gy: gy + jy, h: t.height },
          rng.range(0, Math.PI * 2),
          rng.range(spec.min, spec.max),
        ),
        depth: gx + gy + (jx + jy) * 0.5,
      });
    };

    for (const s of this.structures) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          // Corners get less, so the yard hugs the walls instead of forming
          // a solid square of boxes around every house.
          place(s.gx + dx, s.gy + dy, dx !== 0 && dy !== 0 ? 0.34 : 0.6);
        }
      }
    }

    // The Ops Centre gets a service yard rather than a ring. Its plaza is
    // path on all sides and the farm has the front, so what is left is the
    // back and the flanks, two rings out from the plaza edge.
    const { gx: hx, gy: hy } = this.hallAt;
    for (let ring = 3; ring <= 4; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          place(hx + dx, hy + dy, 0.42);
        }
      }
    }

    this.props.push(...added);
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

  /**
   * Populate the island with wild creatures, weighted toward their habitat.
   *
   * They exist before any of the catching mechanics do because an empty world
   * reads as a diorama. Something moving in the middle distance is what makes
   * a place feel inhabited, and it costs almost nothing.
   */
  private spawnWild(): void {
    const rng = this.rng.fork('wild-v1');
    const pool: Array<[TypeId, string, string]> = [];
    for (const type of TYPE_IDS) {
      for (const [id, label] of TECH_BY_TYPE[type]) pool.push([type, id, label]);
    }

    for (let i = 0; i < 26; i++) {
      for (let attempt = 0; attempt < 120; attempt++) {
        const gx = rng.int(3, MAP_SIZE - 4);
        const gy = rng.int(3, MAP_SIZE - 4);
        if (!this.walkable(gx, gy)) continue;
        const [type, creatureId, label] = rng.pick(pool);
        this.wild.push({
          creatureId,
          label,
          type,
          gx,
          gy,
          targetGx: gx,
          targetGy: gy,
          speed: rng.range(0.35, 0.75),
          facing: rng.chance(0.5) ? -1 : 1,
          phase: rng.range(0, 20),
          restFor: rng.range(0.5, 4),
          level: rng.int(4, 9),
          leaving: 0,
        });
        break;
      }
    }
  }

  /**
   * Where the farm plots sit.
   *
   * A ring of tiles spiralling out from the Ops Centre, skipping water,
   * paths, buildings and anything not level with the plaza. Growing outward
   * from the hall means the farm always reads as part of the settlement
   * rather than as squares dropped somewhere on the map.
   */
  private layoutPlots(): void {
    const { gx: hx, gy: hy } = this.hallAt;
    const hallHeight = this.heightAt(hx, hy);
    this.plotTiles = [];

    const hallSum = hx + hy;
    for (let ring = 2; ring <= 10 && this.plotTiles.length < 40; ring++) {
      for (let dx = -ring; dx <= ring && this.plotTiles.length < 40; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const gx = hx + dx;
          const gy = hy + dy;
          // Only tiles on the hall's diagonal or in front of it. Painter order
          // draws smaller (gx + gy) first, so a plot behind the Ops Centre is
          // drawn and then immediately covered by its roof - the plots were
          // rendering perfectly and were simply underneath a building.
          if (gx + gy < hallSum) continue;
          const t = this.tiles[gy * MAP_SIZE + gx];
          if (!t || t.terrain === 'water' || t.terrain === 'rock' || t.path) continue;
          if (t.height !== hallHeight) continue;
          if (this.structures.some((st) => st.gx === gx && st.gy === gy)) continue;
          // Nothing in front may be tall enough to cover it. A tile `n` steps
          // further along both axes and `2n` elevations up lands on exactly
          // the same pixels, so a plot at the foot of a rise is drawn, looks
          // fine, and cannot be clicked - the pick resolves to the hill.
          if (occluded(gx, gy, hallHeight, this.heightAt)) continue;
          this.plotTiles.push({ gx, gy });
          if (this.plotTiles.length >= 40) break;
        }
      }
    }
    // Nearest first, so the first few plots a player is given cluster right
    // by the Ops Centre instead of being scattered around the ring.
    this.plotTiles.sort(
      (a, b) =>
        Math.abs(a.gx - hx) + Math.abs(a.gy - hy) - (Math.abs(b.gx - hx) + Math.abs(b.gy - hy)),
    );

    // Plots are not scatter, so nothing decorative may stand on one.
    const taken = new Set(this.plotTiles.map((t) => `${t.gx},${t.gy}`));
    this.props = this.props.filter((prop) => {
      const gx = Math.round(prop.anchor.gridX);
      const gy = Math.round(prop.anchor.gridY);
      return !taken.has(`${gx},${gy}`);
    });
  }

  /** Screen-space tile for plot `index`, or null if the base has fewer plots. */
  private plotTile(index: number): { gx: number; gy: number } | null {
    return this.plotTiles[index] ?? null;
  }

  /** A tile a creature can stand on: land, and level with its neighbours. */
  private walkable(gx: number, gy: number): boolean {
    const t = this.tiles[gy * MAP_SIZE + gx];
    if (!t || t.terrain === 'water') return false;
    return !this.structures.some((s) => s.gx === gx && s.gy === gy);
  }

  private updateWild(dt: number): void {
    const rng = this.rng;
    for (const w of this.wild) {
      const dx = w.targetGx - w.gx;
      const dy = w.targetGy - w.gy;
      const dist = Math.hypot(dx, dy);

      if (dist < 0.05) {
        w.gx = w.targetGx;
        w.gy = w.targetGy;
        w.restFor -= dt;
        if (w.restFor <= 0) {
          // Pick an adjacent walkable tile, or stand still a bit longer if
          // the creature has wandered into a dead end.
          const options: Array<[number, number]> = [];
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            if (this.walkable(w.gx + ox, w.gy + oy)) options.push([w.gx + ox, w.gy + oy]);
          }
          if (options.length > 0) {
            const [nx, ny] = rng.pick(options);
            w.targetGx = nx;
            w.targetGy = ny;
            // Isometric: moving toward +gx goes right on screen, +gy goes left.
            w.facing = nx - w.gx - (ny - w.gy) >= 0 ? 1 : -1;
          }
          w.restFor = rng.range(0.6, 4.5);
        }
        continue;
      }

      const step = (w.speed * dt) / Math.max(dist, 1e-4);
      w.gx += dx * Math.min(1, step);
      w.gy += dy * Math.min(1, step);
    }
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

    if (input.wasPressed('KeyJ')) this.overlay = this.overlay === 'quests' ? 'none' : 'quests';
    if (input.wasPressed('KeyG')) this.overlay = this.overlay === 'codex' ? 'none' : 'codex';
    if (input.wasPressed('KeyB')) this.overlay = this.overlay === 'build' ? 'none' : 'build';
    if (input.wasPressed('KeyH')) this.overlay = this.overlay === 'help' ? 'none' : 'help';
    if (input.wasPressed('Escape')) this.overlay = 'none';

    // An overlay owns the pointer, and this guard has to come before anything
    // that reads it. Sitting below the camera block meant dragging across an
    // open menu still panned the world underneath it.
    if (this.overlay !== 'none') {
      if (this.overlay === 'quests' && input.pointer.wheel !== 0) {
        const max = questLogOverflow(ctx.renderer.ctx.height);
        this.questScroll = Math.max(0, Math.min(max, this.questScroll + input.pointer.wheel * 0.5));
      }
      this.hoverWild = null;
      this.hoverPlot = -1;
      this.hoverGx = -1;
      this.updateWild(dt);
      this.particles.update(dt);
      return;
    }

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

    // Missions pay out the moment they are satisfied, wherever that happened.
    for (const claim of claimObjectiveRewards(this.player, Date.now())) {
      // XP goes to the whole roster: a mission is something the stack did.
      const share = Math.max(1, Math.round(claim.xp / Math.max(1, this.player.roster.length)));
      for (const c of this.player.roster) grantXp(c, share);
      savePlayer(this.player);
      const hall = gridToScreen({ gx: this.hallAt.gx, gy: this.hallAt.gy, h: 3 }, DEFAULT_ISO);
      this.toast(hall.x, hall.y - 96, `MISSION: ${claim.title}`, PALETTE.flowerYellow);
      this.toast(hall.x, hall.y - 74, `+${claim.scrap} scrap  +${claim.xp} xp`, PALETTE.good);
    }

    // Construction finishes on wall-clock time, including while away.
    if (tickBuild(this.player.base, Date.now())) {
      syncPlots(this.player.base);
      this.layoutPlots();
      savePlayer(this.player);
      const hall = gridToScreen({ gx: this.hallAt.gx, gy: this.hallAt.gy, h: 3 }, DEFAULT_ISO);
      this.toast(hall.x, hall.y - 70, 'Construction complete', PALETTE.good);
    }


    const world = camera.screenToWorld(input.pointer.position);
    const picked = screenToGridOnHeightmap(world, this.heightAt, MAX_HEIGHT, DEFAULT_ISO);
    this.hoverGx = picked ? picked.gx : -1;
    this.hoverGy = picked ? picked.gy : -1;

    const onHall =
      picked !== null &&
      Math.abs(picked.gx - this.hallAt.gx) <= 1 &&
      Math.abs(picked.gy - this.hallAt.gy) <= 1;

    // Wild creatures are picked by screen distance, not tile, because they
    // stand between tiles while walking and are much smaller than one.
    this.hoverWild = null;
    let bestDist = 30 * Math.max(0.6, camera.zoom);
    for (const w of this.wild) {
      if (w.leaving > 0) continue;
      const wh = this.heightAt(Math.round(w.gx), Math.round(w.gy));
      const wp = camera.worldToScreen(gridToScreen({ gx: w.gx, gy: w.gy, h: wh }, DEFAULT_ISO));
      const d = Math.hypot(
        wp.x - input.pointer.position.x,
        wp.y - (input.pointer.position.y + 14 * camera.zoom),
      );
      if (d < bestDist) {
        bestDist = d;
        this.hoverWild = w;
      }
    }

    // Plots are picked by tile, since they are exactly one tile each.
    this.hoverPlot = -1;
    if (picked) {
      const idx = this.plotTiles.findIndex((t) => t.gx === picked.gx && t.gy === picked.gy);
      if (idx >= 0 && idx < this.player.base.plots.length) this.hoverPlot = idx;
    }

    if (input.clicked && this.hoverPlot >= 0) {
      this.usePlot(this.hoverPlot);
      // If that opened a panel, the click must not reach it too.
      if (this.overlay !== 'none') input.consumeClick();
      return;
    }

    if (input.clicked && this.hoverWild) {
      this.tryCapture(this.hoverWild);
      return;
    }

    if (input.clicked && onHall) {
      this.startBattle(ctx);
      return;
    }

    for (const t of this.toasts) t.life -= dt;
    this.toasts = this.toasts.filter((t) => t.life > 0);
    for (const w of this.wild) {
      if (w.leaving > 0) w.leaving += dt;
    }
    this.wild = this.wild.filter((w) => w.leaving < 0.8);

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

    this.updateWild(dt);
    this.particles.update(dt);
  }

  // ---------------------------------------------------------------- render

  render(_alpha: number, ctx: SceneContext): void {
    const r = ctx.renderer;

    r.beginLayer('world');
    this.renderWorld(ctx);
    this.drawLabels(ctx);
    r.beginLayer('effects');
    this.particles.render(r.shapes);
    r.beginLayer('ui');
    this.renderHud(ctx);
    this.renderOverlays(ctx);
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
    const { shapes, quads, camera } = ctx.renderer;
    const pad = DEFAULT_ISO.tileW * 2 + MAX_HEIGHT * DEFAULT_ISO.elevation + 80;
    const view = camera.visibleBounds(pad);

    let propIndex = 0;
    let structIndex = 0;
    const maxSum = (MAP_SIZE - 1) * 2;

    // Creatures move, so their sort order is rebuilt every frame rather than
    // baked at spawn like the props. Twenty-six entries is nothing to sort.
    const wildSorted = [...this.wild].sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
    let wildIndex = 0;

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

      // Plots sit on their tile, so they draw with that tile's diagonal.
      for (let i = 0; i < this.plotTiles.length && i < this.player.base.plots.length; i++) {
        const t = this.plotTiles[i]!;
        if (t.gx + t.gy !== sum) continue;
        this.drawPlot(shapes, i, t);
      }
      if (this.player.base.building && this.hallAt.gx + this.hallAt.gy + 2 === sum) {
        this.drawConstruction(shapes);
      }

      // Props go in two passes over the same range rather than one. Shadows
      // are shapes and baked scenery is quads, and the two batches flush each
      // other on every alternation - interleaving them per prop would cost a
      // draw call per tree.
      const propStart = propIndex;
      while (propIndex < this.props.length && this.props[propIndex]!.depth < sum + 1) propIndex++;
      if (this.atlas) {
        for (let i = propStart; i < propIndex; i++) {
          const prop = this.props[i]!;
          const size = prop.sprite && this.atlas.sizeOf(prop.sprite);
          if (size) {
            footprint(shapes, prop.anchor.x, prop.anchor.y, size.w * prop.anchor.scale * 0.34, 0.26);
          }
        }
      }
      for (let i = propStart; i < propIndex; i++) {
        this.drawProp(shapes, quads, this.props[i]!);
      }
      while (wildIndex < wildSorted.length && wildSorted[wildIndex]!.gx + wildSorted[wildIndex]!.gy < sum + 1) {
        this.drawWild(ctx, wildSorted[wildIndex]!);
        wildIndex++;
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

  private drawWild(ctx: SceneContext, w: Wild): void {
    const { shapes, quads, camera } = ctx.renderer;
    const h = this.heightAt(Math.round(w.gx), Math.round(w.gy));
    const p = gridToScreen({ gx: w.gx, gy: w.gy, h: Math.max(0, h) }, DEFAULT_ISO);

    const moving = Math.hypot(w.targetGx - w.gx, w.targetGy - w.gy) > 0.05 ? 1 : 0;
    const isHovered = this.hoverWild === w;
    if (isHovered) {
      shapes.ring(p.x, p.y, 26, 2.5, PALETTE.sparkle, 0.9, 0.8, 24);
    }
    // A caught creature shrinks into a point of light rather than blinking off.
    const leave = w.leaving > 0 ? Math.max(0, 1 - w.leaving / 0.7) : 1;
    const visual: CreatureVisual = {
      creatureId: w.creatureId,
      type: w.type,
      x: p.x,
      y: p.y - (1 - leave) * 30,
      scale: 0.82 * leave,
      phase: w.phase,
      facing: w.facing,
      moving,
    };
    if (leave > 0.05) drawCreature(shapes, visual, this.time);

    // Name plates only when the camera is close enough for them to be
    // legible - labels on everything at every zoom turns a world into a list.
    // They are queued rather than drawn here: interleaving a plate (shapes)
    // and its text (quads) per creature forced a draw call per creature, and
    // drawing all plates then all text at the end costs two.
    if (camera.zoom > 0.85 || isHovered) {
      this.pendingLabels.push({ x: p.x, y: p.y - 42, text: `${w.label}  L${w.level}`, type: w.type });
    }
    void quads;
  }

  private drawLabels(ctx: SceneContext): void {
    const { shapes, quads } = ctx.renderer;
    for (const l of this.pendingLabels) {
      drawNamePlate(shapes, l.x, l.y, this.fontSmall.measure(l.text), l.type);
    }
    for (const l of this.pendingLabels) {
      drawText(quads, this.fontSmall, l.text, l.x, l.y + 1, {
        color: PALETTE.ink,
        align: 'center',
        scale: 0.92,
        letterSpacing: 0.6,
      });
    }
    this.pendingLabels.length = 0;
  }

  private drawPlot(
    shapes: SceneContext['renderer']['shapes'], index: number, tile: { gx: number; gy: number },
  ): void {
    const plot = this.player.base.plots[index];
    if (!plot) return;
    const now = Date.now();
    const p = { gx: tile.gx, gy: tile.gy, h: this.heightAt(tile.gx, tile.gy) };
    const hovered = this.hoverPlot === index;

    drawPlotBase(shapes, p, hovered);
    if (plot.cropId) {
      drawCrop(shapes, p, plot.cropId, growth(plot, now), isReady(plot, now), this.time);
    } else {
      drawEmptyPlot(shapes, p, hovered, this.time);
    }
  }

  /** The structure currently going up, parked beside the Ops Centre. */
  private drawConstruction(shapes: SceneContext['renderer']['shapes']): void {
    const c = this.player.base.building;
    if (!c) return;
    const spec = getBuilding(c.buildingId);
    const gx = this.hallAt.gx + 2;
    const gy = this.hallAt.gy;
    drawScaffold(
      shapes,
      { gx, gy, h: this.heightAt(gx, gy) },
      buildProgress(this.player.base, Date.now()),
      spec.tint,
      this.time,
    );
  }

  private drawProp(
    shapes: SceneContext['renderer']['shapes'],
    quads: SceneContext['renderer']['quads'],
    prop: Prop,
  ): void {
    if (this.atlas && prop.sprite) {
      this.atlas.draw(quads, prop.sprite, prop.anchor.x, prop.anchor.y, {
        scale: prop.anchor.scale,
      });
      return;
    }
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
      case 'machine':
      case 'dish':
      case 'pipe':
      case 'crate':
      case 'panel':
        // Base clutter exists only as baked sprites. Hand-drawing a fallback
        // generator and satellite dish, for the one case where the atlas
        // fails to load, would be a lot of geometry nobody ever sees - the
        // base just reads the way it did before the atlas existed.
        break;
    }
  }

  /** Whichever full-screen panel is open, and whatever the player clicked in it. */
  private renderOverlays(ctx: SceneContext): void {
    if (this.overlay === 'none') return;
    const { width, height } = ctx.renderer.ctx;
    const ui: UIContext = {
      shapes: ctx.renderer.shapes,
      quads: ctx.renderer.quads,
      input: ctx.input,
      font: this.font,
      fontSmall: this.fontSmall,
      fontBig: this.font,
      time: this.time,
    };

    switch (this.overlay) {
      case 'quests': {
        const r = drawQuestLog(ui, this.player, Date.now(), width, height, this.questScroll);
        if (r.close) this.overlay = 'none';
        if (r.goto) {
          this.goToObjective(ctx, r.goto);
          ctx.input.consumeClick();
        }
        break;
      }
      case 'codex':
        this.renderGallery(ctx);
        break;
      case 'help':
        if (drawHelp(ui, width, height)) this.overlay = 'none';
        break;
      case 'plant': {
        const r = drawPlantMenu(ui, this.player, width, height);
        if (r.close) this.overlay = 'none';
        else if (r.crop) this.doPlant(r.crop);
        break;
      }
      case 'build': {
        const r = drawBuildMenu(ui, this.player, Date.now(), width, height);
        if (r.close) this.overlay = 'none';
        if (r.build) this.doBuild(r.build);
        if (r.rush && rushBuild(this.player, this.player.base, Date.now())) savePlayer(this.player);
        break;
      }
    }
  }

  /**
   * Every creature body, laid out in a grid over the world.
   *
   * A development view first, but it is also the bones of the codex screen:
   * the same pose contract, the same bodies, just standing still.
   */
  private renderGallery(ctx: SceneContext): void {
    const { shapes, quads } = ctx.renderer;
    const { width, height } = ctx.renderer.ctx;
    shapes.rect(0, 0, width, height, PALETTE.uiShadow, 0.55, 0);

    const all: Array<[TypeId, string, string]> = [];
    for (const type of TYPE_IDS) {
      for (const [id, label] of TECH_BY_TYPE[type]) all.push([type, id, label]);
    }
    const cols = 8;
    const cellW = Math.min(150, (width - 60) / cols);
    const cellH = 150;
    const x0 = (width - cellW * cols) / 2;
    const y0 = (height - cellH * Math.ceil(all.length / cols)) / 2 + 20;

    for (let i = 0; i < all.length; i++) {
      const [type, id, label] = all[i]!;
      const cx = x0 + (i % cols) * cellW + cellW / 2;
      const cy = y0 + Math.floor(i / cols) * cellH + cellH * 0.66;
      shapes.roundedRect(cx - cellW / 2 + 6, cy - cellH * 0.62, cellW - 12, cellH - 12, 14, PALETTE.uiPanel, 0.95, 0);
      shapes.roundedRect(cx - cellW / 2 + 6, cy - cellH * 0.62, cellW - 12, 6, 3, TYPE_COLORS[type], 1, 0);
      drawCreature(shapes, {
        creatureId: id,
        type,
        x: cx,
        y: cy,
        scale: 1.35,
        phase: i * 1.7,
        facing: i % 2 === 0 ? 1 : -1,
        moving: 0,
      }, this.time);
      drawText(quads, this.fontSmall, label, cx, cy + 14, {
        color: PALETTE.ink,
        align: 'center',
        letterSpacing: 1,
      });
    }
    drawText(quads, this.font, 'CODEX  -  press G to close', width / 2, y0 - 46, {
      color: PALETTE.uiPanel,
      align: 'center',
      letterSpacing: 2,
    });
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

    const ui: UIContext = {
      shapes,
      quads,
      input: ctx.input,
      font: this.font,
      fontSmall: this.fontSmall,
      fontBig: this.font,
      time: this.time,
    };
    const p = this.player;
    const now = Date.now();

    drawResourceBar(ui, p, width);
    const objH = drawObjective(ui, p, now, 70);
    drawNudges(ui, p, now, 70 + objH + 10);

    const toolbar = drawToolbar(ui, height, {
      questsDone: objectivesDone(p, now),
      questsTotal: OBJECTIVES.length,
    });
    if (toolbar.openQuests || toolbar.openBuild || toolbar.openCodex || toolbar.openHelp) {
      this.overlay = toolbar.openQuests
        ? 'quests'
        : toolbar.openBuild
          ? 'build'
          : toolbar.openCodex
            ? 'codex'
            : 'help';
      if (toolbar.openQuests) this.questScroll = 0;
      ctx.input.consumeClick();
    }

    // Toasts, projected from world space.
    for (const t of this.toasts) {
      const k = 1 - t.life / 2.6;
      const sp = ctx.renderer.camera.worldToScreen({ x: t.x, y: t.y - k * 40 });
      const w = this.fontSmall.measure(t.text) + 22;
      const alpha = t.life < 0.5 ? t.life / 0.5 : 1;
      shapes.roundedRect(sp.x - w / 2, sp.y - 4, w, 22, 11, PALETTE.ink, 0.9 * alpha, 0);
      drawText(quads, this.fontSmall, t.text, sp.x, sp.y, { color: t.color, align: 'center', alpha });
    }

    // Capture prompt for the creature under the pointer.
    if (this.hoverWild) {
      const w = this.hoverWild;
      const spec = getCreature(w.creatureId);
      const cost = captureCost(spec, w.level);
      const chance = Math.round(captureChance(spec, w.level, cost) * 100);
      const have = owns(p, spec.id);
      const canAfford = p.resources.scrap >= cost;
      const line1 = `${spec.name}  L${w.level}${have ? '  (owned)' : ''}`;
      const line2 = canAfford
        ? `Click to capture  -  ${cost} scrap  -  ${chance}% base odds`
        : `Need ${cost} scrap to attempt`;
      const boxW = 440;
      const lines3 = this.fontSmall.wrap(spec.keyInsight, boxW - 44);
      const boxH = 62 + lines3.length * 15;
      const x = width / 2 - boxW / 2;
      const y = height - 90 - boxH;
      shapes.roundedRect(x, y + 3, boxW, boxH, 13, PALETTE.uiShadow, 0.2, 0);
      shapes.roundedRect(x, y, boxW, boxH, 13, PALETTE.uiPanel, 0.97, 0);
      shapes.roundedRect(x, y, boxW, 6, 3, TYPE_COLORS[w.type], 1, 0);
      drawText(quads, this.font, line1, x + 22, y + 14, { color: PALETTE.ink, letterSpacing: 1 });
      drawText(quads, this.fontSmall, line2, x + 22, y + 36, { color: canAfford ? PALETTE.good : PALETTE.danger });
      for (let i = 0; i < lines3.length; i++) {
        drawText(quads, this.fontSmall, lines3[i]!, x + 22, y + 54 + i * 15, { color: PALETTE.inkSoft, scale: 0.95 });
      }
    }

    // Hover readout
    if (this.hoverGx >= 0 && !this.hoverWild) {
      const tile = this.tiles[this.hoverGy * MAP_SIZE + this.hoverGx]!;
      const struct = this.structures.find((s) => s.gx === this.hoverGx && s.gy === this.hoverGy);
      const onHall =
        Math.abs(this.hoverGx - this.hallAt.gx) <= 1 && Math.abs(this.hoverGy - this.hallAt.gy) <= 1;
      const title = onHall ? 'OPS CENTRE' : struct ? struct.label : tile.terrain.toUpperCase();
      const sub = onHall
        ? 'Click to respond to an incident'
        : struct
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

/**
 * Is anything in front of this tile tall enough to cover it?
 *
 * In this projection a tile `n` steps further along both axes and exactly
 * `2n` elevations higher occupies the same pixels and is drawn later, so it
 * wins both the eye and the pick. Two steps is far enough to check: a hill
 * three tiles away would have to be six elevations taller than the ground,
 * which the terrain generator cannot produce.
 */
function occluded(
  gx: number, gy: number, height: number, heightAt: (x: number, y: number) => number,
): boolean {
  for (let n = 1; n <= 2; n++) {
    if (heightAt(gx + n, gy + n) >= height + n * 2) return true;
  }
  return false;
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
