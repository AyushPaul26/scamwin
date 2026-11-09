import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_SEED_LENGTH, BOT_LIMITS, parseBotInput, parseBotUpdateInput } from "../lib/bot-input";
import { botFormSchema } from "../lib/bot-form-schema";
import { botCreateSchema, botInsertSchema } from "../lib/db/bot-validation";

const avatar = "aB0_-".repeat(4) + "Z";

test("updates allow only editable fields and preserve server-managed identity", () => {
  const result = parseBotUpdateInput(form({ name: " Atlas ", job: " Developer ", userId: "other", id: "other", avatar: "replacement", sandboxId: "other" }));
  assert.equal(result.valid, true);
  if (result.valid) assert.deepEqual(result.values, { name: "Atlas", job: "Developer", instructions: "" });
});

test("updates reject duplicate, file, blank and overlong editable fields", () => {
  for (const field of Object.keys(BOT_LIMITS)) {
    const duplicate = form({ name: "Atlas", job: "Developer", instructions: "Original" });
    duplicate.append(field, "duplicate");
    assert.equal(parseBotUpdateInput(duplicate).valid, false);
    const file = form({ name: "Atlas", job: "Developer" });
    file.set(field, new File(["data"], "value.txt"));
    assert.equal(parseBotUpdateInput(file).valid, false);
    assert.equal(parseBotUpdateInput(form({ name: "Atlas", job: "Developer", [field]: "x".repeat(BOT_LIMITS[field as keyof typeof BOT_LIMITS] + 1) })).valid, false);
  }
  assert.equal(parseBotUpdateInput(form({ name: " ", job: "Developer" })).valid, false);
  assert.equal(parseBotUpdateInput(form({ name: "Atlas", job: " " })).valid, false);
});

function form(values: Record<string, string>) {
  const data = new FormData();
  data.set("avatar", avatar);
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

test("trims input and accepts omitted instructions without accepting ownership fields", () => {
  const result = parseBotInput(form({ name: " Atlas ", job: " Research ", userId: "another-user", sandboxId: "external", id: "forged-id", createdAt: "yesterday", avatarUrl: "https://example.com/other-avatar" }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.values, { name: "Atlas", job: "Research", instructions: "", avatar });
});

test("rejects missing and whitespace-only required fields", () => {
  for (const data of [form({}), form({ name: "  ", job: "\n" })]) {
    const result = parseBotInput(data);
    assert.equal(result.valid, false);
    assert(result.errors.name);
    assert(result.errors.job);
  }
});

test("enforces every length limit while accepting its boundary", () => {
  for (const [field, max] of Object.entries(BOT_LIMITS)) {
    assert.equal(parseBotInput(form({ name: "Atlas", job: "Research", [field]: "x".repeat(max) })).valid, true);
    assert.equal(parseBotInput(form({ name: "Atlas", job: "Research", [field]: "x".repeat(max + 1) })).valid, false);
  }
});

test("rejects file values rather than coercing them to text", () => {
  for (const field of [...Object.keys(BOT_LIMITS), "avatar"]) {
    const data = form({ name: "Atlas", job: "Research" });
    data.set(field, new File(["data"], "value.txt"));
    const result = parseBotInput(data);
    assert.equal(result.valid, false);
    assert(result.errors[field as keyof typeof result.errors]);
  }
});

test("preserves a valid preview seed exactly", () => {
  const result = parseBotInput(form({ name: "Atlas", job: "Research", avatar }));
  assert.equal(avatar.length, AVATAR_SEED_LENGTH);
  assert.equal(result.valid, true);
  assert.equal(result.values.avatar, avatar);
});

test("rejects absent, malformed, or whitespace-padded preview seeds", () => {
  const missing = form({ name: "Atlas", job: "Research" });
  missing.delete("avatar");
  assert.equal(parseBotInput(missing).valid, false);
  assert(parseBotInput(missing).errors.avatar);

  for (const invalid of [
    "",
    "x".repeat(AVATAR_SEED_LENGTH - 1),
    "x".repeat(AVATAR_SEED_LENGTH + 1),
    ` ${avatar}`,
    `${avatar} `,
    "x".repeat(AVATAR_SEED_LENGTH - 1) + "\n",
    "x".repeat(AVATAR_SEED_LENGTH - 1) + "/",
    "é".repeat(AVATAR_SEED_LENGTH),
  ]) {
    const result = parseBotInput(form({ name: "Atlas", job: "Research", avatar: invalid }));
    assert.equal(result.valid, false, `Should reject ${JSON.stringify(invalid)}`);
    assert(result.errors.avatar);
    assert.equal(result.values.avatar, "");
  }
});

test("rejects duplicate avatar fields instead of choosing an ambiguous identity", () => {
  const data = form({ name: "Atlas", job: "Research" });
  data.append("avatar", "x".repeat(AVATAR_SEED_LENGTH));
  const result = parseBotInput(data);
  assert.equal(result.valid, false);
  assert(result.errors.avatar);
});

test("rejects duplicate editable fields rather than silently taking the first value", () => {
  for (const field of Object.keys(BOT_LIMITS)) {
    const data = form({ name: "Atlas", job: "Node.js developer", instructions: "Add tests." });
    data.append(field, "Unexpected second value");
    const result = parseBotInput(data);
    assert.equal(result.valid, false);
    assert(result.errors[field as keyof typeof result.errors]);
  }
});

test("Drizzle insert validation requires ownership while public input excludes protected columns", () => {
  const editable = { name: "Atlas", job: "Node.js developer", instructions: "Add tests.", avatar };
  const protectedFields = { userId: "forged-owner", id: "forged-id", sandboxId: "forged-sandbox", createdAt: new Date() };
  assert.deepEqual(botCreateSchema.parse({ ...editable, ...protectedFields }), editable);
  assert.equal(botInsertSchema.safeParse({ name: "Atlas", job: "Developer" }).success, false);
  assert.equal(botInsertSchema.safeParse({ userId: "owner", name: "Atlas", job: "Developer" }).success, false);
  assert.equal(botInsertSchema.safeParse({ userId: "auth0|verified", sandboxId: "verified-sandbox", name: "Atlas", job: "Developer", instructions: null }).success, true);
});

test("browser and server validation share trimming and required-field rules", () => {
  const values = { name: "  Atlas  ", job: " Node.js developer ", instructions: "  Add tests.  " };
  assert.deepEqual(parseBotInput(form(values)).values, { ...botFormSchema.parse(values), avatar });
  for (const field of ["name", "job"] as const) {
    const invalid = { ...values, [field]: "  " };
    assert.equal(botFormSchema.safeParse(invalid).success, false);
    assert.equal(parseBotInput(form(invalid)).valid, false);
  }
});
