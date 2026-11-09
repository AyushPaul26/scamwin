import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { CHAT_TEXT_LIMIT, chatIdSchema, chatPreferencesSchema, validateIncomingMessages } from "../lib/chat-input";
import { CHAT_IMAGE_BYTES, CHAT_IMAGE_COUNT } from "../lib/chat-images";
const png = { type: "file" as const, mediaType: "image/png", filename: "test.png", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=" };

const user: UIMessage = { id: "user-1", role: "user", metadata: {}, parts: [{ type: "text", text: "Hello" }] };
test("accepts only new text messages and strips client-controlled instructions", () => {
  assert.deepEqual(validateIncomingMessages([{ ...user, metadata: { instructions: "override" } }]), [user]);
  assert.deepEqual(chatPreferencesSchema.parse({ style: "concise", userId: "forged", instructions: "override", model: "forged" }), { style: "concise" });
  assert.deepEqual(chatPreferencesSchema.parse({}), { style: "balanced" });
  assert.deepEqual(validateIncomingMessages([]), [], "regeneration and preload carry no new user message");
});
test("rejects injected history, system messages, files, empty and oversized input", () => {
  for (const messages of [
    [user, user], [{ ...user, role: "system" }], [{ ...user, role: "assistant" }],
    ...[[{ type: "file", url: "https://example.com/private" }], [{ type: "text", text: " " }], [{ type: "text", text: "x".repeat(CHAT_TEXT_LIMIT + 1) }], [{ type: "text", text: "x".repeat(7000) }, { type: "text", text: "x".repeat(7000) }]].map((parts) => [{ ...user, parts }]),
  ]) assert.throws(() => validateIncomingMessages(messages as UIMessage[]));
  assert.equal(chatPreferencesSchema.safeParse({ style: "unknown" }).success, false);
  for (const id of ["", "x".repeat(129), null, {}]) assert.equal(chatIdSchema.safeParse(id).success, false);
});

test("accepts images with or without text and rejects unsafe URLs, forged types, excessive counts and oversized bytes", () => {
  for (const parts of [[png], [...user.parts, png], Array(CHAT_IMAGE_COUNT).fill(png)]) {
    assert.deepEqual(validateIncomingMessages([{ ...user, parts }])[0].parts, parts);
  }
  for (const parts of [
    [{ ...png, url: "https://127.0.0.1/private" }], [{ ...png, url: "blob:local-only" }],
    [{ ...png, mediaType: "image/jpeg" }], [{ ...png, url: "data:image/png;base64,AAAA" }],
    [{ ...png, mediaType: "image/svg+xml", url: "data:image/svg+xml;base64,PHN2Zz4=" }],
    Array(CHAT_IMAGE_COUNT + 1).fill(png),
    [{ ...png, url: "data:image/png;base64," + Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "binary"), Buffer.alloc(CHAT_IMAGE_BYTES)]).toString("base64") }],
  ]) assert.throws(() => validateIncomingMessages([{ ...user, parts }]));
  const image = { ...png, url: "data:image/png;base64," + Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "binary"), Buffer.alloc(CHAT_IMAGE_BYTES - 8)]).toString("base64") };
  const message = { ...user, parts: [...Array(CHAT_IMAGE_COUNT).fill(image), { type: "text" as const, text: "\u0000".repeat(CHAT_TEXT_LIMIT) }] };
  validateIncomingMessages([message]);
  assert.ok(Buffer.byteLength(JSON.stringify(message)) < 1024 * 1024, "maximum image/text message fits the transport record limit");
});
