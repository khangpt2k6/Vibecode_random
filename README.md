# STACKMON - The Distributed Realm

A creature-collecting, base-building, pipeline-battling game where every creature is a real technology and every stat is a real trade-off.

Redis has latency 5 and durability 55. PostgreSQL has latency 55 and consistency 195. Kafka has memory 190 because it retains its log. Spark has latency 175 because it is a batch engine. None of these numbers were tuned for balance first: they were written to be true, and balance was fixed somewhere else. The bet is that a player who gets good at the combat has necessarily learned why you do not put a cache where you needed a database.

The enemies are production incidents: Thundering Herd, Poison Pill, Network Partition, Cascading Failure, Black Friday. You beat one by building a pipeline that survives it, and when you lose, the game tells you what would have worked.

## Running it

```
npm install
npm run dev
```

Open http://127.0.0.1:5173. WASD or drag to pan, scroll to zoom, click the Ops Centre in the middle of the island to respond to an incident, press G for the creature codex.

```
npm test                                   # 23 tests on the battle rules
npx tsc -b                                 # typecheck every package
npx tsx packages/tools/src/balance.ts      # win-rate sweep of every incident vs party level
npx tsx packages/tools/src/balance.ts detail netsplit 15
```

## How it is built

Web, TypeScript, and a custom WebGL2 engine. No game framework. Monorepo with npm workspaces.

```
packages/
  util/      Seeded RNG and scalar maths. The leaf of the graph.
  engine/    Renderer, ECS, loop, input, scenes, text. Knows nothing about the game.
  content/   Creatures, skills, incidents, biomes, the type chart. Pure data.
  core/      Battle rules. Pure TypeScript, runs in Node, fully tested.
  game/      The actual game: art, scenes, UI. The only package that touches the DOM.
  tools/     Balance sweep.
```

The rule that shapes everything: `core` may not import `engine`. The combat simulator has no idea a screen exists. That is what makes it testable, replayable from a seed, and sweepable ten thousand fights at a time by the balance tool.

### The engine

- Isometric projection with height, painter-order depth, and height-aware picking.
- Two vertex batches (flat polygons and textured quads) that keep GPU draw order equal to submission order across each other. A whole island with 700 props is about 8 draw calls.
- HDR scene target with a separate emissive attachment, progressive dual-filter bloom, and a composite grade with a knee rolloff rather than ACES, because ACES lifts shadows and this world lives in daylight.
- A sky pass with camera-parallax clouds, done entirely in the fragment shader.
- Runtime glyph atlas rasterised from a system font at device resolution. No font files shipped.
- Fixed-timestep loop with render interpolation, structure-of-arrays particles, a scene stack.

### The art

There are no image assets. Everything is drawn from primitives at runtime: the terrain, four hundred trees, the houses, and all twenty-four creatures. Each creature is a chunky pseudo-3D form of its technology's mark - Postgres is an elephant, Docker is a whale carrying containers, Redis is a stack of red discs, ClickHouse is a row of columns - with the same wide-set eyes, because eyes are what make a diagram a character.

Shadows are tinted toward blue, never toward black. That single rule is most of the difference between "3D cartoon" and "flat diagram".

### The battle

A pipeline of three slots: INGEST, PROCESS, STORE. Load arrives at ingest. Each stage handles what its throughput allows, buffers the overflow up to its memory, and drops the rest. What a stage handles is what it passes downstream, so the bottleneck is wherever the smallest capacity is, and adding capacity anywhere else does nothing. There is a test for that.

You win by serving traffic through the incident until its integrity is gone. You lose when your error budget is exhausted, and the budget burns on error *rate*, not absolute count, because that is what an error budget is.

Skills are real mechanisms with honest numbers. Backpressure widens a buffer. Stop-the-World GC heals a lot and pauses you for a turn. GIL Contention costs nothing and is actively harmful, and is on CPython because that is where it belongs. Every skill carries a `realWorld` string that the tooltip shows you.

## Where it is going

- Capture wild creatures, level them, build a roster that persists.
- Harvest resources and build out the island.
- Educational mini-games woven into the world.
- Higher-tier incidents that demand swapping components mid-fight.
