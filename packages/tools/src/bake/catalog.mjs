/**
 * Which downloaded models actually become game sprites.
 *
 * The Kenney kits ship 763 models between them and most of it is not useful
 * here: corridor sections, spaceships, weapons, tools. This file is the
 * curation step - it names the subset that fits a bright island of running
 * infrastructure, and sorts it into the groups the world generator asks for
 * ("give me a tree", "give me a small rock").
 *
 * A fifth kit, city-kit-commercial, was downloaded and then dropped: its
 * office blocks bake out navy and grey, which fights the daylight palette
 * every other surface in the game is painted in. The space kit's hangars and
 * the tower kit's towers cover the same buildings and stay bright.
 *
 * `rots` is how many yaw variants to bake. Scatter props get more than one
 * so a forest does not read as the same stamp repeated; a building that the
 * player places on a grid gets four so it can face any way.
 *
 * The kits are CC0, so the baked sprites carry no attribution
 * requirement. See assets-src/SOURCES.md for where each came from.
 */

/** kit id -> folder under assets-src/raw, and where the .glb files sit in it. */
export const KITS = {
  nature: { dir: 'kenney_nature-kit', glb: 'Models/GLTF format' },
  space: { dir: 'kenney_space-kit', glb: 'Models/GLTF format' },
  survival: { dir: 'kenney_survival-kit', glb: 'Models/GLB format' },
  towerDefense: { dir: 'kenney_tower-defense-kit', glb: 'Models/GLB format' },
};

/**
 * One rule = one group of models.
 *
 * `match` is tested against the file's base name. Keep the patterns anchored;
 * an unanchored pattern quietly pulls in half a kit.
 */
export const RULES = [
  // --- nature: the bulk of what makes the island look alive ---
  { group: 'tree', kit: 'nature', rots: 2, match: /^tree_(default|detailed|fat|oak|simple|small|tall|thin|blocks|cone|plateau)(_dark|_fall|_darkh)?$/ },
  { group: 'tree', kit: 'nature', rots: 2, match: /^tree_pine(DefaultA|DefaultB|RoundA|RoundB|RoundC|SmallA|SmallB|SmallC|TallA|TallB)$/ },
  { group: 'palm', kit: 'nature', rots: 2, match: /^tree_palm(|Bend|Short|Tall|DetailedShort|DetailedTall)$/ },
  { group: 'bush', kit: 'nature', rots: 2, match: /^plant_bush(|Detailed|Large|LargeTriangle|Small|Triangle)$/ },
  { group: 'grass', kit: 'nature', rots: 3, match: /^grass(|_large|_leafs|_leafsLarge)$/ },
  { group: 'flower', kit: 'nature', rots: 2, match: /^flower_(purple|red|yellow)[ABC]$/ },
  { group: 'mushroom', kit: 'nature', rots: 2, match: /^mushroom_(red|tan)(|Group|Tall)$/ },
  { group: 'rock', kit: 'nature', rots: 2, match: /^rock_(small|tall|large)[A-J]$/ },
  { group: 'rock', kit: 'nature', rots: 2, match: /^rock_smallFlat[ABC]$/ },
  { group: 'stone', kit: 'nature', rots: 2, match: /^stone_(small|tall|large)[A-J]$/ },
  { group: 'log', kit: 'nature', rots: 2, match: /^(log|log_large|log_stack|log_stackLarge)$/ },
  { group: 'stump', kit: 'nature', rots: 2, match: /^stump_(old|oldTall|round|roundDetailed|square|squareDetailed)$/ },
  { group: 'lily', kit: 'nature', rots: 2, match: /^lily_(small|large)$/ },
  { group: 'crop', kit: 'nature', rots: 1, match: /^crops_(wheat|corn|leafs|bamboo)Stage[A-D]$/ },
  { group: 'crop', kit: 'nature', rots: 1, match: /^crop_(carrot|melon|pumpkin|turnip)$/ },
  { group: 'soil', kit: 'nature', rots: 1, match: /^crops_dirt(Single|Row|RowEnd|RowCorner|DoubleRow)$/ },
  { group: 'fence', kit: 'nature', rots: 4, match: /^fence_(simple|simpleHigh|simpleLow|planks|planksDouble|corner|gate|bend)$/ },
  { group: 'path', kit: 'nature', rots: 4, match: /^path_(stone|stoneCircle|stoneCorner|stoneEnd|wood|woodCorner|woodEnd)$/ },
  { group: 'platform', kit: 'nature', rots: 1, match: /^platform_(grass|stone|beach)$/ },
  { group: 'prop', kit: 'nature', rots: 2, match: /^(pot_small|pot_large|sign|campfire_stones|campfire_logs|bridge_wood|bridge_stone)$/ },
  { group: 'statue', kit: 'nature', rots: 2, match: /^statue_(block|column|obelisk|ring|head)$/ },

  // --- space kit: reads as machinery, which is what a tech island needs ---
  { group: 'machine', kit: 'space', rots: 4, match: /^machine_(generator|generatorLarge|barrel|barrelLarge|wireless|wirelessCable)$/ },
  { group: 'dish', kit: 'space', rots: 4, match: /^satelliteDish(|_detailed|_large)$/ },
  { group: 'pipe', kit: 'space', rots: 4, match: /^pipe_(straight|corner|cross|split|end|ring|ringHigh|supportHigh|supportLow|entrance)$/ },
  { group: 'hangar', kit: 'space', rots: 4, match: /^hangar_(smallA|smallB|largeA|largeB|roundA|roundB|roundGlass)$/ },
  { group: 'structure', kit: 'space', rots: 4, match: /^structure(|_closed|_detailed|_diagonal)$/ },
  { group: 'platformMetal', kit: 'space', rots: 4, match: /^platform_(center|corner|end|high|large|long|low|side|small|straight)$/ },
  { group: 'rail', kit: 'space', rots: 4, match: /^monorail_track(Straight|CornerSmall|Support)$/ },
  { group: 'prop', kit: 'space', rots: 2, match: /^(chimney|chimney_detailed|barrel|barrels|barrels_rail|craterLarge|crater|rover|turret_single|turret_double)$/ },
  { group: 'crystal', kit: 'space', rots: 2, match: /^rock_crystals(|LargeA|LargeB)$/ },
  { group: 'gate', kit: 'space', rots: 4, match: /^gate_(simple|complex)$/ },

  // --- survival kit: the small clutter that fills a base ---
  { group: 'crate', kit: 'survival', rots: 2, match: /^(barrel|barrel-open|box|box-large|box-open|box-large-open|chest|bucket|bottle|bottle-large)$/ },
  { group: 'resource', kit: 'survival', rots: 2, match: /^resource-(planks|stone|stone-large|wood)$/ },
  { group: 'workbench', kit: 'survival', rots: 4, match: /^workbench(|-anvil|-grind)$/ },
  { group: 'prop', kit: 'survival', rots: 2, match: /^(signpost|signpost-single|campfire-pit|campfire-stand|tent|tent-canvas)$/ },
  { group: 'panel', kit: 'survival', rots: 4, match: /^metal-panel(|-narrow|-screws|-screws-half|-screws-narrow)$/ },

  // --- tower defense kit: modular towers for the tall buildings ---
  { group: 'towerBase', kit: 'towerDefense', rots: 4, match: /^tower-(round|square)-bottom-[abc]$/ },
  { group: 'towerMid', kit: 'towerDefense', rots: 4, match: /^tower-(round|square)-middle-[abc]$/ },
  { group: 'towerTop', kit: 'towerDefense', rots: 4, match: /^tower-(round|square)-(top|roof)-[abc]$/ },
  { group: 'towerFull', kit: 'towerDefense', rots: 4, match: /^tower-(round|square)-build-[a-f]$/ },
  { group: 'weapon', kit: 'towerDefense', rots: 4, match: /^weapon-(turret|cannon|ballista|catapult)$/ },
  { group: 'detail', kit: 'towerDefense', rots: 2, match: /^detail-(crystal|crystal-large|rocks|rocks-large|dirt|dirt-large)$/ },
  { group: 'woodStructure', kit: 'towerDefense', rots: 4, match: /^wood-structure(|-high|-part|-high-part)$/ },
];

/**
 * Kits whose greens get rewritten to the palette's leaf hue.
 *
 * These three draw vegetation. The space and city kits do not, and their
 * teals are glass and painted metal - remapping those would turn every
 * window green.
 */
export const LEAF_KITS = new Set(['nature', 'survival', 'towerDefense']);
