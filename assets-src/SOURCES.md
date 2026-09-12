# Source models

Nothing in this folder is committed. `npm run assets:fetch` downloads and
unpacks it; `npm run bake` turns it into `packages/game/public/atlas`.

All four kits are by Kenney (kenney.nl) and released under Creative Commons
CC0 1.0, so the baked sprites carry no attribution requirement and no
licence file needs to ship with the game. Attribution is given here anyway
because it costs nothing and the work deserves it.

| kit | models | used for |
| --- | --- | --- |
| nature-kit | 329 | trees, plants, flowers, rocks, crops, fences, paths |
| space-kit | 153 | generators, dishes, pipes, hangars, platforms |
| survival-kit | 80 | barrels, crates, workbenches, signs, panels |
| tower-defense-kit | 160 | modular towers, turrets, terrain detail |

Downloaded 2026-09-12. The URLs in `fetch-kits.mjs` carry a content hash
that changes when Kenney revises a kit, so a 404 there means the link needs
refreshing from the asset page, not that the kit is gone.

## Considered and rejected

- **city-kit-commercial** (41 models). Downloaded, baked, dropped. The office
  blocks come out navy and grey and fight the daylight palette that
  everything else is painted in. The space kit's hangars and the tower kit's
  towers cover the same buildings and stay bright.
- **Quaternius / KayKit packs.** Good quality and also CC0, but they need an
  itch.io download flow rather than a direct link, so they cannot be fetched
  unattended. Worth revisiting by hand if more variety is wanted.
