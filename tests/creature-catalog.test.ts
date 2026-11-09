import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  AVAILABLE_CREATURE_IDS,
  CREATURE_CATALOG,
  CREATURE_CATALOG_VERSION,
  CREATURE_IDS,
  CREATURE_VARIANTS,
  hashCreatureSeed,
  resolveCreature,
} from "../lib/creatures/catalog";

test("v1 preserves its ordered identities and known seed mappings", () => {
  assert.equal(CREATURE_CATALOG_VERSION, 1);
  assert.deepEqual(CREATURE_IDS, ["moss-otter", "ember-gecko", "cloud-bat", "tide-axolotl", "crystal-beetle", "dusk-rabbit", "spark-jerboa"]);
  assert.deepEqual(CREATURE_VARIANTS, ["fern", "lagoon", "blossom"]);
  const examples = [
    ["", 2166136261, "cloud-bat", "blossom"],
    ["hello", 1335831723, "cloud-bat", "lagoon"],
    ["openmods", 2461388732, "dusk-rabbit", "fern"],
    ["bot_42", 1640303957, "dusk-rabbit", "fern"],
    ["森の友達", 2323502354, "dusk-rabbit", "fern"],
    ["🌱", 3224320254, "ember-gecko", "blossom"],
    ["x".repeat(128), 794728389, "moss-otter", "fern"],
  ] as const;
  for (const [seed, hash, id, variant] of examples) {
    assert.equal(hashCreatureSeed(seed), hash);
    assert.equal(resolveCreature(seed).id, id);
    assert.equal(resolveCreature(seed).variant, variant);
    assert.deepEqual(resolveCreature(seed), resolveCreature(seed));
  }
});

test("all seven enabled species have their model and all matching portraits", () => {
  assert.deepEqual(AVAILABLE_CREATURE_IDS, CREATURE_IDS);
  for (const id of AVAILABLE_CREATURE_IDS) {
    for (const variant of CREATURE_VARIANTS) {
      const creature = resolveCreature("asset-check", variant, id);
      assert.ok(existsSync(`public${creature.modelUrl}`), `Missing ${creature.modelUrl}`);
      assert.ok(existsSync(`public${creature.portraitUrl}`), `Missing ${creature.portraitUrl}`);
    }
  }
});

test("each identity uses its own palette, model and matching portrait", () => {
  for (const id of CREATURE_IDS) {
    const palettes = new Set<string>();
    for (const variant of CREATURE_VARIANTS) {
      const creature = resolveCreature("preview", variant, id);
      assert.equal(creature.id, id);
      assert.equal(creature.variant, variant);
      assert.equal(creature.name, CREATURE_CATALOG[id].name);
      assert.equal(creature.portraitUrl, `/creatures/v1/${id}-${variant}.webp`);
      assert.equal(creature.modelUrl, `/creatures/v1/${id}.glb`);
      assert.deepEqual(creature.colors, CREATURE_CATALOG[id].palettes[variant]);
      for (const color of Object.values(creature.colors)) assert.match(color, /^#[0-9a-f]{6}$/);
      palettes.add(JSON.stringify(creature.colors));
    }
    assert.equal(palettes.size, 3, `${id} needs three different palettes`);
  }
});

test("automatic seeded selection reaches every species and palette combination", () => {
  const selected = new Set(Array.from({ length: 2000 }, (_, i) => {
    const creature = resolveCreature(`bot-${i}`);
    return `${creature.id}:${creature.variant}`;
  }));
  const expected = CREATURE_IDS.flatMap((id) => CREATURE_VARIANTS.map((variant) => `${id}:${variant}`));
  assert.deepEqual([...selected].sort(), expected.sort());
});
