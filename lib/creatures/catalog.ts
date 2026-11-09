/** Freeze this ordering and palette mapping for v1; new mappings require a new version. */
export const CREATURE_CATALOG_VERSION = 1;

export const CREATURE_IDS = ["moss-otter", "ember-gecko", "cloud-bat", "tide-axolotl", "crystal-beetle", "dusk-rabbit", "spark-jerboa"] as const;
export type CreatureId = (typeof CREATURE_IDS)[number];

// Publish a species only after its GLB and all three portraits are verified.
export const AVAILABLE_CREATURE_IDS: readonly CreatureId[] = CREATURE_IDS;

export const CREATURE_VARIANTS = ["fern", "lagoon", "blossom"] as const;
export type CreatureVariant = (typeof CREATURE_VARIANTS)[number];

export const CREATURE_CATALOG = {
  "moss-otter": {
    name: "Moss otter", description: "A gentle soul with a leaf for a tail.", greeting: "Paw wave",
    labels: { fern: "Fern", lagoon: "Lagoon", blossom: "Blossom" },
    palettes: {
      fern: { body: "#508b69", cream: "#f2dfb2", accent: "#93bc67" },
      lagoon: { body: "#418f9b", cream: "#e4ead1", accent: "#80bdb0" },
      blossom: { body: "#ae7890", cream: "#f2ddd0", accent: "#d7a0b0" },
    },
  },
  "ember-gecko": {
    name: "Ember gecko", description: "Warm-hearted, quick-footed, and always curious.", greeting: "Happy hop",
    labels: { fern: "Ember", lagoon: "Slate", blossom: "Rose" },
    palettes: {
      fern: { body: "#c97243", cream: "#ffd78a", accent: "#d94937" },
      lagoon: { body: "#456f9a", cream: "#d5e0f0", accent: "#83b9c8" },
      blossom: { body: "#bc6e83", cream: "#f1d9c1", accent: "#e7a6b7" },
    },
  },
  "cloud-bat": {
    name: "Cloud bat", description: "Soft wings, big ears, and a sky full of ideas.", greeting: "Wing flutter",
    labels: { fern: "Cloud", lagoon: "Moonlight", blossom: "Petal" },
    palettes: {
      fern: { body: "#8a82b3", cream: "#f0e9e2", accent: "#bd98c6" },
      lagoon: { body: "#536794", cream: "#edfcf1", accent: "#9cbbd7" },
      blossom: { body: "#b984a0", cream: "#f8e5e6", accent: "#ebc1cb" },
    },
  },
  "tide-axolotl": {
    name: "Tide axolotl", description: "A wide smile and a little wave from the shallows.", greeting: "Two-handed wave",
    labels: { fern: "Tide", lagoon: "Bluebell", blossom: "Coral" },
    palettes: {
      fern: { body: "#5ba5a3", cream: "#d7ead1", accent: "#ef9b91" },
      lagoon: { body: "#648fb4", cream: "#d7edf6", accent: "#bf96c9" },
      blossom: { body: "#d494b2", cream: "#ffead7", accent: "#f1b8a7" },
    },
  },
  "crystal-beetle": {
    name: "Crystal beetle", description: "A tiny explorer with a gleaming crown.", greeting: "Bow",
    labels: { fern: "Jade", lagoon: "Amber", blossom: "Amethyst" },
    palettes: {
      fern: { body: "#548f9c", cream: "#d8e8d6", accent: "#91d4cb" },
      lagoon: { body: "#a78a4b", cream: "#e8dcb5", accent: "#debd64" },
      blossom: { body: "#8d7dab", cream: "#ece0ed", accent: "#bdace5" },
    },
  },
  "dusk-rabbit": {
    name: "Dusk rabbit", description: "Perked ears, soft paws, and a playful streak.", greeting: "Ear perk and wave",
    labels: { fern: "Dusk", lagoon: "Mist", blossom: "Peach" },
    palettes: {
      fern: { body: "#b18eab", cream: "#f4e2ce", accent: "#d2a4b4" },
      lagoon: { body: "#a1a0bc", cream: "#f5f0df", accent: "#7f8bab" },
      blossom: { body: "#c18886", cream: "#f6ddca", accent: "#edb6a3" },
    },
  },
  "spark-jerboa": {
    name: "Spark jerboa", description: "Big ears, bright ideas, and a spark in every hop.", greeting: "Spark hop",
    labels: { fern: "Sunbeam", lagoon: "Honey", blossom: "Apricot" },
    palettes: {
      fern: { body: "#d6a739", cream: "#fff0ba", accent: "#bd6a32" },
      lagoon: { body: "#bb873d", cream: "#f5e2b0", accent: "#8c6148" },
      blossom: { body: "#dd9970", cream: "#fbe9cf", accent: "#b56566" },
    },
  },
} as const;

/** FNV-1a over UTF-16 code units: identical in server and browser runtimes. */
export function hashCreatureSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

export function resolveCreature(seed: string, requestedVariant?: CreatureVariant, requestedSpecies?: CreatureId) {
  const hash = hashCreatureSeed(seed);
  const selectedId = requestedSpecies ?? CREATURE_IDS[hash % CREATURE_IDS.length];
  // Explicit species are reserved for the protected asset review/capture tooling.
  const id = requestedSpecies ?? (AVAILABLE_CREATURE_IDS.includes(selectedId) ? selectedId : "moss-otter");
  const variant = requestedVariant ?? CREATURE_VARIANTS[Math.floor(hash / CREATURE_IDS.length) % CREATURE_VARIANTS.length];
  const definition = CREATURE_CATALOG[id];
  return {
    id,
    name: definition.name,
    variant,
    modelUrl: `/creatures/v1/${id}.glb`,
    portraitUrl: `/creatures/v1/${id}-${variant}.webp`,
    colors: definition.palettes[variant],
  };
}
