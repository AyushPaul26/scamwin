import assert from "node:assert/strict";
import test from "node:test";
import { sealLiveViewLocator, openLiveViewLocator } from "../lib/scamwin/live-view-crypto";

const env = { SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY: "ab".repeat(32) };
const binding = { scope: { ownerId: "alice", checkId: "check", runId: "run", generation: 1 }, sessionId: "session", expiresAt: "2026-11-10T12:00:30.000Z" };
const locator = "https://production-sfo.browserless.io/live/?id=private-fixture";
test("AES-GCM hides a locator and authenticates every scope, session and expiry field", () => {
  const encrypted = sealLiveViewLocator(locator, binding, env);
  assert.equal(encrypted.includes(locator), false);
  assert.equal(openLiveViewLocator(encrypted, binding, env), locator);
  assert.notEqual(sealLiveViewLocator(locator, binding, env), encrypted);
  for (const key of ["ownerId", "checkId", "runId", "generation"] as const) {
    const changed = { ...binding, scope: { ...binding.scope, [key]: key === "generation" ? 2 : "other" } };
    assert.throws(() => openLiveViewLocator(encrypted, changed, env), /live_view_decryption_failed/);
  }
  for (const changed of [{ ...binding, sessionId: "other" }, { ...binding, expiresAt: "2026-11-10T12:00:31.000Z" }])
    assert.throws(() => openLiveViewLocator(encrypted, changed, env), /live_view_decryption_failed/);
  for (const index of [1, 2, 3]) {
    const parts = encrypted.split(".");
    parts[index] = (parts[index][0] === "a" ? "b" : "a") + parts[index].slice(1);
    assert.throws(() => openLiveViewLocator(parts.join("."), binding, env), /live_view_decryption_failed/);
  }
  assert.throws(() => openLiveViewLocator(encrypted, binding, { SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY: "cd".repeat(32) }), /live_view_decryption_failed/);
});
test("the dedicated key is resolved lazily and accepts exactly 64 hex characters", () => {
  for (const key of [undefined, "x".repeat(64), "ab".repeat(31), "ab".repeat(33), " " + "ab".repeat(32)])
    assert.throws(() => sealLiveViewLocator(locator, binding, { SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY: key, AUTH0_SECRET: "ab".repeat(32) }), /live_view_key_unavailable/);
});
