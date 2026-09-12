/**
 * Sprite baker, browser half.
 *
 * Renders a glTF model through the exact projection the game uses, so a
 * baked prop drops onto the isometric grid without anyone eyeballing a
 * scale factor. The node half (bake.mjs) drives this over Playwright.
 *
 * Why a browser at all: the alternative is Blender, which is a 400MB
 * dependency and a second renderer whose lighting would then have to be
 * matched to this one by hand. Chromium is already here, and three.js reads
 * Kenney's glTF the same way a runtime would.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The projection, derived from the engine's iso config rather than guessed.
 *
 * DEFAULT_ISO is tileW 64, tileH 32 - a 2:1 diamond. A camera at yaw 45
 * reaches 2:1 at exactly 30 degrees of elevation (sin 30 = 0.5), not at the
 * 35.264 of true isometric. A 1x1 ground tile then spans sqrt(2) camera-space
 * units horizontally, and we want that to land on 64 pixels.
 */
const TILE_W = 64;

/**
 * Bake at twice the on-screen size. The world camera goes to 2.6x zoom, and
 * a sprite baked at 1:1 turns to mush somewhere past 1.2x. Two covers the
 * range people actually play at and still fits the whole catalogue on one
 * 4096 page; 2.5 would need three pages of 2048 to buy the last stop.
 * The game divides by this when it draws.
 */
const DENSITY = 2;
const PPU = (TILE_W * DENSITY) / Math.SQRT2;
const VIEW_DIR = new THREE.Vector3(1, Math.SQRT2 * Math.tan(Math.PI / 6), 1).normalize();

/** Render this many times oversize, then box-filter down. Cheaper than MSAA here. */
const SS = 3;
/** Transparent margin, in final pixels, so the downscale never clips an edge. */
const PAD = 2;

const canvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: false,
  preserveDrawingBuffer: true,
});
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const loader = new GLTFLoader();

/** Scratch 2D canvas for the downscale and grade pass. */
const flat = document.createElement('canvas');
const fctx = flat.getContext('2d', { willReadFrequently: true });

/**
 * The light rig.
 *
 * solids.ts puts the sun in the upper left and states the rule that shadows
 * are the lit colour pulled toward blue, never toward black. So: one key
 * light placed in screen space rather than world space, or it would swing
 * around as models rotate, and a hemisphere fill that is cool from above and
 * warm from below instead of a flat grey ambient.
 */
function buildLights(camera) {
  const g = new THREE.Group();

  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const toward = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);

  const place = (light, rx, ry, rz) => {
    light.position.copy(
      right.clone().multiplyScalar(rx)
        .add(up.clone().multiplyScalar(ry))
        .add(toward.clone().multiplyScalar(rz))
        .multiplyScalar(20),
    );
    g.add(light);
  };

  place(new THREE.DirectionalLight(0xfff2d4, 2.05), -1.0, 1.15, 0.55);
  // Bounce off the grass, so undersides pick up green instead of going dead.
  place(new THREE.DirectionalLight(0x9ede54, 0.34), 0.7, -1.0, 0.4);

  g.add(new THREE.HemisphereLight(0xbfe6ff, 0xf0d9a8, 1.15));
  return g;
}

/**
 * Kenney ships MeshStandardMaterial. Swap it for Lambert.
 *
 * Standard's specular response puts a soft gradient across every face, which
 * fights the hard three-tone look of the hand-drawn solids standing next to
 * it. Lambert gives one flat value per face, which is the same language.
 */
function flatten(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const out = src.map((m) => {
      const lam = new THREE.MeshLambertMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map ?? null,
        vertexColors: m.vertexColors ?? false,
        transparent: m.transparent ?? false,
        opacity: m.opacity ?? 1,
        side: m.side ?? THREE.FrontSide,
        alphaTest: m.alphaTest ?? 0,
      });
      if (lam.map) lam.map.colorSpace = THREE.SRGBColorSpace;
      return lam;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

/**
 * Pull the render toward the game's palette.
 *
 * Three things happen. Foliage gets its hue rewritten, because Kenney draws
 * leaves mint (#2ddab9, hue 160) and the palette's leaf is a warm yellow
 * green (#5fb832, hue 100) - side by side with the hand-drawn grass the mint
 * reads as a different game. Saturation comes up, because the kits are muted
 * next to the drawn art. And the shadow end rotates toward blue while the
 * lit end goes warm, which is the one rule the palette file insists on.
 *
 * Done on pixels rather than in a shader because it is thirty lines here and
 * a whole post-processing chain there.
 */
const COOL = [0.80, 0.89, 1.14];
const WARM = [1.06, 1.02, 0.93];
const SATURATION = 1.2;

/** Source foliage band, in degrees: Kenney's mint through its pale teal. */
const LEAF_FROM = [120, 200];
/** Where that band lands: the palette's leafLight through leafDeep. */
const LEAF_TO = [88, 118];
/** Below this saturation a pixel is structural, not foliage - leave it be. */
const LEAF_MIN_SAT = 0.18;

/** Greys in these kits are cool (#767c86); the palette's rock is warm. */
const GREY_WARM = [1.05, 1.01, 0.92];
const GREY_MAX_SAT = 0.16;

function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

function grade(data, remapLeaves) {
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    let r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;

    const [h0, s0, l0] = rgbToHsl(r, g, b);
    if (remapLeaves && s0 >= LEAF_MIN_SAT && h0 >= LEAF_FROM[0] && h0 <= LEAF_FROM[1]) {
      const t = (h0 - LEAF_FROM[0]) / (LEAF_FROM[1] - LEAF_FROM[0]);
      [r, g, b] = hslToRgb(LEAF_TO[0] + t * (LEAF_TO[1] - LEAF_TO[0]), s0, l0);
    } else if (s0 < GREY_MAX_SAT) {
      r *= GREY_WARM[0]; g *= GREY_WARM[1]; b *= GREY_WARM[2];
    }

    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    // smoothstep(0.28, 0.86): how "lit" this pixel reads
    const t = Math.min(1, Math.max(0, (lum - 0.28) / 0.58));
    const w = t * t * (3 - 2 * t);

    r *= COOL[0] + (WARM[0] - COOL[0]) * w;
    g *= COOL[1] + (WARM[1] - COOL[1]) * w;
    b *= COOL[2] + (WARM[2] - COOL[2]) * w;

    const l2 = r * 0.299 + g * 0.587 + b * 0.114;
    r = l2 + (r - l2) * SATURATION;
    g = l2 + (g - l2) * SATURATION;
    b = l2 + (b - l2) * SATURATION;

    px[i] = Math.min(255, Math.max(0, r * 255));
    px[i + 1] = Math.min(255, Math.max(0, g * 255));
    px[i + 2] = Math.min(255, Math.max(0, b * 255));
  }
  return data;
}

/** Box of non-transparent pixels, or null if the render came out empty. */
function alphaBounds(data, w, h) {
  const px = data.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 3) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Bake one model at one yaw.
 *
 * Returns the pixels plus the anchor: where the model's own origin landed in
 * the image. Kenney authors every kit with the origin at the centre of the
 * tile the model occupies, at ground level, so the anchor is exactly the
 * point the game lines up with a grid cell.
 */
/**
 * Anything with a footprint bigger than this, in tiles, is treated as a
 * structure rather than a tile piece. See the pivot note in bakeOne.
 */
const STRUCTURE_TILES = 1.5;

async function bakeOne(url, yaw, remapLeaves) {
  const gltf = await loader.loadAsync(url);
  const loaded = gltf.scene;
  flatten(loaded);

  /**
   * What the yaw turns around.
   *
   * A tile piece - a path corner, a fence, a river bend - is authored with
   * its geometry offset inside a 1x1 cell and its origin at the cell centre.
   * Those have to spin about the origin or the corner ends up in the wrong
   * corner. A multi-tile structure is different: Kenney lays the space kit
   * out across a shared scene, so a hangar's origin can be somewhere off the
   * side of the building, and spinning about that sends it into orbit
   * instead of turning it on the spot.
   *
   * Footprint size separates the two cleanly, and nothing in the catalogue
   * is a tile piece larger than one cell.
   */
  const rest = new THREE.Box3().setFromObject(loaded);
  const span = rest.getSize(new THREE.Vector3());
  const root = new THREE.Group();
  if (span.x > STRUCTURE_TILES || span.z > STRUCTURE_TILES) {
    loaded.position.set(-(rest.min.x + rest.max.x) / 2, 0, -(rest.min.z + rest.max.z) / 2);
  }
  root.add(loaded);
  root.rotation.y = yaw;
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  if (!isFinite(box.min.x)) throw new Error('empty bounds: ' + url);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 8 + 40);
  camera.position.copy(centre).add(VIEW_DIR.clone().multiplyScalar(radius * 3 + 10));
  camera.up.set(0, 1, 0);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  const toCam = camera.matrixWorldInverse;

  // Camera-space extents of the model, from the eight corners of its box.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    ).applyMatrix4(toCam);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }

  const padU = PAD / PPU;
  const left = minX - padU;
  const bottom = minY - padU;
  const w = Math.max(1, Math.ceil((maxX + padU - left) * PPU));
  const h = Math.max(1, Math.ceil((maxY + padU - bottom) * PPU));
  // Snap the frustum to the pixel grid, so the scale is exact and not almost.
  camera.left = left;
  camera.right = left + w / PPU;
  camera.bottom = bottom;
  camera.top = bottom + h / PPU;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const scene = new THREE.Scene();
  scene.add(root);
  scene.add(buildLights(camera));

  renderer.setSize(w * SS, h * SS, false);
  renderer.render(scene, camera);

  flat.width = w;
  flat.height = h;
  fctx.clearRect(0, 0, w, h);
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(canvas, 0, 0, w * SS, h * SS, 0, 0, w, h);

  const graded = grade(fctx.getImageData(0, 0, w, h), remapLeaves);
  const crop = alphaBounds(graded, w, h);
  if (!crop) throw new Error('rendered nothing: ' + url);
  fctx.putImageData(graded, 0, 0);

  /**
   * The anchor: which pixel of the sprite sits on the grid cell.
   *
   * The model origin is the right answer when the kit was authored that way,
   * and it is the only one that keeps a corner fence or a path end lined up
   * with its tile rather than with its own centre of mass. The nature kit
   * does author it that way. The space kit does not - its props are laid out
   * across a shared scene, so `barrel` sits a whole unit from the origin and
   * an origin anchor lands 43 pixels off the sprite entirely.
   *
   * So: trust the origin, but check it. If it falls well outside the image
   * the model was never authored around it, and the centre of the footprint
   * at ground level is the better guess.
   */
  const project = (p) => {
    const v = p.clone().applyMatrix4(toCam);
    return { x: (v.x - camera.left) * PPU - crop.x, y: (camera.top - v.y) * PPU - crop.y };
  };
  const fromOrigin = project(new THREE.Vector3(0, 0, 0));
  const slackX = crop.w * 0.35;
  const slackY = crop.h * 0.35;
  const sane = fromOrigin.x >= -slackX && fromOrigin.x <= crop.w + slackX
    && fromOrigin.y >= -slackY && fromOrigin.y <= crop.h + slackY;
  const anchor = sane
    ? fromOrigin
    : project(new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2));
  const ax = anchor.x;
  const ay = anchor.y;

  const out = document.createElement('canvas');
  out.width = crop.w;
  out.height = crop.h;
  out.getContext('2d').drawImage(flat, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

  scene.clear();
  return { canvas: out, w: crop.w, h: crop.h, ax, ay };
}

// --- atlas packing -------------------------------------------------------

/**
 * Shelf packer, tallest first.
 *
 * A max-rects packer would waste a few percent less, but these sprites fall
 * into a handful of repeated heights and shelves handle that case within a
 * point or two of optimal for a fraction of the code.
 */
function pack(items, pageSize, padding = 1) {
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const pages = [];
  let page = null, shelfY = 0, shelfH = 0, cursorX = 0;

  const newPage = () => {
    page = { items: [] };
    pages.push(page);
    shelfY = 0; shelfH = 0; cursorX = 0;
  };
  newPage();

  for (const it of order) {
    if (it.w + padding * 2 > pageSize || it.h + padding * 2 > pageSize) {
      throw new Error('sprite larger than an atlas page: ' + it.id);
    }
    if (cursorX + it.w + padding > pageSize) {
      shelfY += shelfH + padding;
      shelfH = 0;
      cursorX = 0;
    }
    if (shelfY + it.h + padding > pageSize) newPage();

    it.x = cursorX + padding;
    it.y = shelfY + padding;
    cursorX = it.x + it.w;
    shelfH = Math.max(shelfH, it.h);
    it.page = pages.length - 1;
    page.items.push(it);
  }
  return pages;
}

// --- the API the node half calls -----------------------------------------

const baked = [];

window.bake = {
  async one(url, id, yaw, group, kit, remapLeaves) {
    const r = await bakeOne(url, yaw, remapLeaves);
    baked.push({ id, group, kit, canvas: r.canvas, w: r.w, h: r.h, ax: r.ax, ay: r.ay });
    return { id, w: r.w, h: r.h };
  },

  count: () => baked.length,

  /** Pack everything baked so far, and hand back PNG data URLs plus a manifest. */
  finish(pageSize) {
    const pages = pack(baked, pageSize);
    const images = pages.map((p) => {
      const c = document.createElement('canvas');
      c.width = pageSize;
      c.height = pageSize;
      const ctx = c.getContext('2d');
      for (const it of p.items) ctx.drawImage(it.canvas, it.x, it.y);
      return c.toDataURL('image/png');
    });

    const sprites = {};
    for (const it of baked) {
      sprites[it.id] = {
        page: it.page, x: it.x, y: it.y, w: it.w, h: it.h,
        ax: Math.round(it.ax * 100) / 100,
        ay: Math.round(it.ay * 100) / 100,
        group: it.group, kit: it.kit,
      };
    }
    return { images, sprites, pageSize, density: DENSITY };
  },
};

window.bakeReady = true;
