/**
 * Download and unpack the source model kits.
 *
 *   node packages/tools/src/bake/fetch-kits.mjs
 *
 * The kits are CC0 and a few tens of megabytes, so they are not in the repo -
 * only the baked atlas is. This script puts them back. The URLs carry a
 * content hash that Kenney changes when a kit is revised; if one 404s, open
 * the asset page and copy the new download link here.
 */

import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const SRC = join(ROOT, 'assets-src');

export const KIT_URLS = [
  ['kenney_nature-kit', 'https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip'],
  ['kenney_space-kit', 'https://kenney.nl/media/pages/assets/space-kit/20874c75ac-1677698978/kenney_space-kit.zip'],
  ['kenney_survival-kit', 'https://kenney.nl/media/pages/assets/survival-kit/4065a8185b-1712149243/kenney_survival-kit.zip'],
  ['kenney_tower-defense-kit', 'https://kenney.nl/media/pages/assets/tower-defense-kit/a402493eaa-1726471567/kenney_tower-defense-kit.zip'],
];

const force = process.argv.includes('--force');

await mkdir(join(SRC, 'zips'), { recursive: true });
await mkdir(join(SRC, 'raw'), { recursive: true });

for (const [name, url] of KIT_URLS) {
  const zip = join(SRC, 'zips', name + '.zip');
  const out = join(SRC, 'raw', name);

  if (existsSync(out) && !force) {
    const n = (await readdir(out)).length;
    console.log(`${name}: already unpacked (${n} entries)`);
    continue;
  }

  console.log(`${name}: downloading`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText} - the hashed URL has probably rotated`);
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  // No unzip in node, and every platform this runs on ships one of these.
  if (process.platform === 'win32') {
    await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${zip}" -DestinationPath "${out}" -Force`]);
  } else {
    await run('unzip', ['-q', '-o', zip, '-d', out]);
  }
  console.log(`${name}: unpacked`);
}

console.log('\nready - now run: npm run bake');
