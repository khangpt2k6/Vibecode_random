/**
 * Visual check for the baked atlas.
 *
 * Draws a real isometric grid and stands sprites on it through their
 * anchors, then writes a PNG. Two mistakes are invisible in the atlas sheet
 * and obvious here: a sprite baked at the wrong scale does not match its
 * tile, and a bad anchor floats or sinks.
 *
 *   node packages/tools/src/bake/preview.mjs [--group tree] [--out preview.png]
 */

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const MANIFEST = join(ROOT, 'packages', 'game', 'src', 'art', 'atlas.generated.ts');
const ATLAS_DIR = join(ROOT, 'packages', 'game', 'public', 'atlas');

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const GROUP = flag('group', null);
const OUT = resolve(flag('out', join(ROOT, '.scratch', 'atlas-preview.png')));
const COLS = Number(flag('cols', 12));

/** Pull the frames back out of the generated module. It is the source of truth. */
async function readManifest() {
  const src = await readFile(MANIFEST, 'utf8');
  const density = Number(src.match(/ATLAS_DENSITY = (\d+)/)[1]);
  const pages = [...src.matchAll(/^  "(\/atlas\/[^"]+)",$/gm)].map((m) => m[1]);
  const frames = {};
  const re = /^  "([^"]+)": \{ p: (\d+), x: (\d+), y: (\d+), w: (\d+), h: (\d+), ax: (-?[\d.]+), ay: (-?[\d.]+) \},$/gm;
  for (const m of src.matchAll(re)) {
    frames[m[1]] = {
      p: +m[2], x: +m[3], y: +m[4], w: +m[5], h: +m[6], ax: +m[7], ay: +m[8],
    };
  }
  const groups = {};
  const gre = /^  "(\w+)": \[\n((?:    "[^"]+",\n)+)  \],$/gm;
  for (const m of src.matchAll(gre)) {
    groups[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  return { density, pages, frames, groups };
}

const MIME = { '.png': 'image/png', '.html': 'text/html' };

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = p.startsWith('/atlas/') ? join(ATLAS_DIR, p.slice(7)) : join(ROOT, p);
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('missing');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

const man = await readManifest();
let ids = Object.keys(man.frames);
if (GROUP) {
  const g = man.groups[GROUP];
  if (!g) throw new Error(`no such group: ${GROUP}. have: ${Object.keys(man.groups).join(', ')}`);
  ids = g;
}
// One sample per model, not per rotation, unless a single group was asked for.
if (!GROUP) ids = ids.filter((id) => !id.includes('#') || id.endsWith('#0'));

const { server, port } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/packages/tools/src/bake/page/preview.html`);

const png = await page.evaluate(
  async (input) => window.renderPreview(input),
  { man, ids, cols: COLS },
);
await browser.close();
server.close();

await writeFile(OUT, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
console.log(`${ids.length} sprites -> ${OUT}`);
