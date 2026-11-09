import assert from "node:assert/strict";
import test from "node:test";
import { parseBotInput } from "../lib/bot-input";
import { CREATURE_IDS, CREATURE_VARIANTS, resolveCreature, type CreatureId, type CreatureVariant } from "../lib/creatures/catalog";
import { seedForCreature } from "../lib/creatures/selection";

const baseSeeds = Array.from({ length: 100 }, (_, index) => `creature${index.toString(36).padStart(13, "0")}`);

test("selecting any creature retains the base palette and produces a persistable seed", () => {
  const seenPalettes = new Set<CreatureVariant>();
  for (const seed of baseSeeds) {
    const original = resolveCreature(seed);
    seenPalettes.add(original.variant);
    const selectedSeeds = new Set<string>();
    for (const species of CREATURE_IDS) {
      const selected = seedForCreature(seed, species);
      const avatar = resolveCreature(selected);
      assert.equal(avatar.id, species);
      assert.equal(avatar.variant, original.variant);
      assert.match(selected, /^[A-Za-z0-9_-]{21}$/);
      assert.equal(selected.slice(0, 17), seed.slice(0, 17), "selection must retain the random prefix");
      assert.equal(seedForCreature(seed, species), selected, "repeat choices must be deterministic");
      assert.equal(seedForCreature(selected, species), selected, "selecting the current character is idempotent");
      selectedSeeds.add(selected);

      const form = new FormData();
      form.set("name", "Chosen companion");
      form.set("job", "Help with research");
      form.set("avatar", selected);
      const parsed = parseBotInput(form);
      assert.equal(parsed.valid, true);
      assert.equal(parsed.values.avatar, selected, "submission must preserve the chosen seed exactly");
    }
    assert.equal(selectedSeeds.size, CREATURE_IDS.length, "different species must have different seeds");
  }
  assert.deepEqual([...seenPalettes].sort(), [...CREATURE_VARIANTS].sort());
});

test("an explicit palette can reproduce all 21 appearances from a fresh seed", () => {
  for (const seed of [baseSeeds[0], "A_B-cD9eF0gH1iJ2kL3mN"]) {
    const choices = new Set<string>();
    for (const species of CREATURE_IDS) {
      for (const variant of CREATURE_VARIANTS) {
        const selected = seedForCreature(seed, species, variant);
        const avatar = resolveCreature(selected);
        assert.equal(avatar.id, species);
        assert.equal(avatar.variant, variant);
        assert.equal(seedForCreature(seed, species, variant), selected);
        assert.equal(seedForCreature(selected, species, variant), selected);
        choices.add(selected);
      }
    }
    assert.equal(choices.size, CREATURE_IDS.length * CREATURE_VARIANTS.length);
  }
});

test("the current appearance keeps the original seed, including its original suffix", () => {
  for (const seed of baseSeeds) {
    const current = resolveCreature(seed);
    assert.equal(seedForCreature(seed, current.id), seed);
    assert.equal(seedForCreature(seed, current.id, current.variant), seed);
  }
});

test("fresh random prefixes retain distinct identities for the same selected artwork", () => {
  const seeds = ["A".repeat(21), "B".repeat(21), "C".repeat(21)];
  for (const species of CREATURE_IDS) {
    for (const variant of CREATURE_VARIANTS) {
      const choices = seeds.map((seed) => seedForCreature(seed, species, variant));
      assert.equal(new Set(choices).size, seeds.length);
      choices.forEach((choice, index) => assert.equal(choice.slice(0, 17), seeds[index].slice(0, 17)));
    }
  }
});

test("malformed seeds and unavailable selections are rejected", () => {
  for (const seed of ["", "a".repeat(20), "a".repeat(22), `${"a".repeat(20)} `, `${"a".repeat(20)}/`, "é".repeat(21), null, undefined, 42]) {
    assert.throws(() => seedForCreature(seed as string, "moss-otter"), TypeError);
  }
  assert.throws(() => seedForCreature(baseSeeds[0], "missing" as CreatureId), TypeError);
  assert.throws(() => seedForCreature(baseSeeds[0], "moss-otter", "missing" as CreatureVariant), TypeError);
});
