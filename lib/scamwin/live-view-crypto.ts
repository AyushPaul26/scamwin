import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { LiveViewBinding } from "./live-view-contracts";

type LiveViewEnvironment = Record<string, string | undefined>;
function key(env: LiveViewEnvironment): Buffer {
  const value = env.SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error("live_view_key_unavailable");
  return Buffer.from(value, "hex");
}
function authenticatedData(binding: LiveViewBinding) {
  const { scope, sessionId, expiresAt } = binding;
  return Buffer.from(JSON.stringify(["scamwin-live-view-v1", scope.ownerId, scope.checkId, scope.runId, scope.generation, sessionId, expiresAt]));
}
export function sealLiveViewLocator(locator: string, binding: LiveViewBinding, env: LiveViewEnvironment = process.env): string {
  const iv = randomBytes(12);
  const authenticatedCipher = createCipheriv("aes-256-gcm", key(env), iv);
  authenticatedCipher.setAAD(authenticatedData(binding));
  const encrypted = Buffer.concat([authenticatedCipher.update(locator, "utf8"), authenticatedCipher.final()]);
  return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), authenticatedCipher.getAuthTag().toString("base64url")].join(".");
}
export function openLiveViewLocator(encrypted: string, binding: LiveViewBinding, env: LiveViewEnvironment = process.env): string {
  const secret = key(env);
  try {
    const parts = encrypted.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const [iv, ciphertext, tag] = parts.slice(1).map(part => Buffer.from(part, "base64url"));
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 16384) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", secret, iv);
    decipher.setAAD(authenticatedData(binding)); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch { throw new Error("live_view_decryption_failed"); }
}
