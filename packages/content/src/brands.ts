/**
 * Brand colours.
 *
 * The colour a developer already associates with each technology. Redis is
 * that specific red, Go is that specific cyan, Python is blue and yellow.
 *
 * This is separate from the family colour on purpose, and the split is load
 * bearing. Colouring every DATA creature the same blue made the roster
 * readable at the level of game mechanics and completely unrecognisable at
 * the level of "that is Postgres" - which is the level that actually teaches.
 * So: brand colour is identity, family colour is mechanics. The creature is
 * drawn in its brand colours, and the family shows up on the badge ring, the
 * platform, and the name plate stripe.
 *
 * Values are taken from each project's own brand guidance or its primary
 * logo. Where a project has no official palette the closest widely-used
 * colour is used and noted.
 */

export interface Brand {
  /** The colour the logo is mostly made of. */
  primary: number;
  /** A second logo colour, where the mark has one. */
  secondary?: number;
  /** A small highlight: an eye, a beak, a spark. */
  accent?: number;
  /** True when the mark is essentially monochrome dark. */
  dark?: boolean;
}

export const BRANDS: Record<string, Brand> = {
  // --- DATA ---
  postgres: { primary: 0x336791, secondary: 0x2f5d8a, accent: 0xffffff },
  mysql: { primary: 0x00758f, secondary: 0xf29111, accent: 0xffffff },
  mongo: { primary: 0x47a248, secondary: 0x116149, accent: 0x001e2b },
  sqlite: { primary: 0x003b57, secondary: 0x0f80cc, accent: 0xffffff },

  // --- STREAM ---
  // Kafka's mark is monochrome; a warm near-black keeps it readable on grass.
  kafka: { primary: 0x2b2b2b, secondary: 0x5a5a5a, accent: 0xffffff, dark: true },
  rabbitmq: { primary: 0xff6600, secondary: 0xffffff, accent: 0xf06000 },
  pulsar: { primary: 0x188fff, secondary: 0x0b6bd3, accent: 0xffffff },
  nats: { primary: 0x27aae1, secondary: 0x375c93, accent: 0xffffff },

  // --- RUNTIME ---
  jvm: { primary: 0x5382a1, secondary: 0xed8b00, accent: 0xffffff },
  cpython: { primary: 0x3776ab, secondary: 0xffd43b, accent: 0xffffff },
  node: { primary: 0x5fa04e, secondary: 0x3c873a, accent: 0xffffff },
  golang: { primary: 0x00add8, secondary: 0x007d9c, accent: 0xffffff },

  // --- INFRA ---
  docker: { primary: 0x2496ed, secondary: 0x0db7ed, accent: 0xffffff },
  kubernetes: { primary: 0x326ce5, secondary: 0x2a56b8, accent: 0xffffff },
  nginx: { primary: 0x009639, secondary: 0x00753a, accent: 0xffffff },
  envoy: { primary: 0xac6199, secondary: 0x7d4470, accent: 0xffffff },

  // --- CACHE ---
  redis: { primary: 0xff4438, secondary: 0xc6291f, accent: 0xffffff },
  // Memcached has no official palette; this is the shade its site has used.
  memcached: { primary: 0x3e7c7b, secondary: 0x2b5857, accent: 0xffffff },
  varnish: { primary: 0xd3453d, secondary: 0x8f2a24, accent: 0xffffff },
  // Caffeine is a library with no logo. Coffee brown is the obvious read.
  caffeine: { primary: 0x6f4e37, secondary: 0x4a3323, accent: 0xf5e6d3 },

  // --- INTEL ---
  // Elastic's mark is four colours at once, which is its whole identity.
  elasticsearch: { primary: 0x00bfb3, secondary: 0xfec514, accent: 0xf04e98 },
  spark: { primary: 0xe25a1c, secondary: 0xffa000, accent: 0xffffff },
  clickhouse: { primary: 0xffcc01, secondary: 0x161616, accent: 0xffffff },
  milvus: { primary: 0x00a1ea, secondary: 0x0b7fc4, accent: 0xffffff },
};

/** Brand for a creature, falling back to a neutral slate for new content. */
export function brandOf(creatureId: string): Brand {
  return BRANDS[creatureId] ?? { primary: 0x5d7a9e, secondary: 0x3f5771, accent: 0xffffff };
}
