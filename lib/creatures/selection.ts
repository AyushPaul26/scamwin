import { AVATAR_SEED_LENGTH } from "../bot-form-schema";
import {
  AVAILABLE_CREATURE_IDS,
  CREATURE_VARIANTS,
  hashCreatureSeed,
  resolveCreature,
  type CreatureId,
  type CreatureVariant,
} from "./catalog";

/** Choose artwork without changing the versioned seed-to-avatar mapping. */
export function seedForCreature(seed: string, species: CreatureId, variant?: CreatureVariant): string {
  if (typeof seed !== "string" || seed.length !== AVATAR_SEED_LENGTH || /[^A-Za-z0-9_-]/.test(seed)) {
    throw new TypeError("A creature selection requires a valid avatar seed.");
  }
  if (!AVAILABLE_CREATURE_IDS.includes(species)) {
    throw new TypeError("The selected creature is unavailable.");
  }
  if (variant !== undefined && !CREATURE_VARIANTS.includes(variant)) {
    throw new TypeError("The selected creature palette is unavailable.");
  }

  const current = resolveCreature(seed);
  const palette = variant ?? current.variant;
  if (current.id === species && current.variant === palette) return seed;

  // Retain 17 random characters; only the suffix steers the existing catalog.
  // Starting from the whole seed keeps repeated choices deterministic.
  const prefix = seed.slice(0, AVATAR_SEED_LENGTH - 4);
  const start = hashCreatureSeed(seed) & 0xffff;
  for (let offset = 0; offset < 0x10000; offset += 1) {
    const suffix = ((start + offset) & 0xffff).toString(16).padStart(4, "0");
    const candidate = `${prefix}${suffix}`;
    const creature = resolveCreature(candidate);
    if (creature.id === species && creature.variant === palette) return candidate;
  }

  throw new Error("No avatar seed matches the selected creature and palette.");
}
