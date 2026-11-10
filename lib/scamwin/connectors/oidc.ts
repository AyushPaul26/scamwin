import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { isBoundedSecret, type OAuthProvider, type ProtocolResult } from "./oauth-providers";
import { isRecord, requestProviderJson, type ProtocolHttp } from "./token-client";

type IdentityBase = { issuer: string; subject: string; verifiedAt: number; expiresAt: number };
export type VerifiedProviderIdentity = (IdentityBase & { provider: "gmail" | "outlook" }) |
  (IdentityBase & { provider: "telegram"; telegramUserId: string });
export type VerifyIdTokenInput = { provider: OAuthProvider; idToken: string; clientId: string; nonce: string; issuedAfter: number };
const CLOCK_SKEW_SECONDS = 60;

function decodePart(part: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("invalid_token");
  const decoded = Buffer.from(part, "base64url");
  if (decoded.toString("base64url") !== part) throw new Error("invalid_token");
  return decoded;
}
function jsonPart(part: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodePart(part)));
  if (!isRecord(value)) throw new Error("invalid_token");
  return value;
}
function canonicalTelegramId(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) return undefined;
  return value;
}
function trustedIssuer(provider: OAuthProvider, claims: Record<string, unknown>): string | undefined {
  if (provider === "telegram") return claims.iss === "https://oauth.telegram.org" ? claims.iss : undefined;
  if (provider === "gmail") return claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com" ? claims.iss : undefined;
  if (typeof claims.tid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(claims.tid)) return undefined;
  const issuer = `https://login.microsoftonline.com/${claims.tid}/v2.0`;
  return claims.iss === issuer ? issuer : undefined;
}

/** Strict RS256 verifier. Fetches fresh JWKS once per verification, so there is no stale cache or
 * unknown-kid retry loop. No discovery URL or JWT-supplied key URL is ever fetched.
 * Call only on the ID token returned by the server's bound, claimed code exchange.
 */
export async function verifyProviderIdToken(input: VerifyIdTokenInput, http: ProtocolHttp): Promise<ProtocolResult<VerifiedProviderIdentity>> {
  try {
    if (!isBoundedSecret(input.idToken, 32_768) || !isBoundedSecret(input.clientId, 512) || !isBoundedSecret(input.nonce, 128)) return { ok: false, reason: "invalid_token" };
    const parts = input.idToken.split(".");
    if (parts.length !== 3) return { ok: false, reason: "invalid_token" };
    const header = jsonPart(parts[0]); const claims = jsonPart(parts[1]); const signature = decodePart(parts[2]);
    if (header.alg !== "RS256" || !isBoundedSecret(header.kid, 256) ||
      ["jku", "x5u", "jwk", "crit", "b64"].some(key => key in header) || (header.typ !== undefined && header.typ !== "JWT")) return { ok: false, reason: "invalid_token" };
    const issuer = trustedIssuer(input.provider, claims);
    const now = (http.now ?? Date.now)();
    const seconds = Math.floor(now / 1000);
    const audience = claims.aud;
    const audienceValid = typeof audience === "string" ? audience === input.clientId :
      Array.isArray(audience) && audience.length > 0 && audience.length <= 16 && audience.every(aud => typeof aud === "string") &&
      audience.includes(input.clientId) && (audience.length === 1 || claims.azp === input.clientId);
    if (!issuer || !Number.isSafeInteger(now) || !Number.isSafeInteger(input.issuedAfter) || input.issuedAfter > now ||
      !audienceValid || (claims.azp !== undefined && claims.azp !== input.clientId) || claims.nonce !== input.nonce ||
      !isBoundedSecret(claims.sub, 512) || typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds ||
      typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) || claims.iat > seconds + CLOCK_SKEW_SECONDS ||
      claims.iat < Math.floor(input.issuedAfter / 1000) - CLOCK_SKEW_SECONDS || claims.exp <= claims.iat ||
      (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isSafeInteger(claims.nbf) || claims.nbf > seconds + CLOCK_SKEW_SECONDS))) return { ok: false, reason: "invalid_token" };
    const keys = await requestProviderJson(input.provider, "jwks", { method: "GET", headers: { accept: "application/json" } }, http);
    if (!keys.ok) return keys;
    if (!isRecord(keys.value) || !Array.isArray(keys.value.keys) || keys.value.keys.length === 0 || keys.value.keys.length > 64) return { ok: false, reason: "invalid_token" };
    const matches = keys.value.keys.filter((key: unknown) => isRecord(key) && key.kid === header.kid);
    if (matches.length !== 1) return { ok: false, reason: "invalid_token" };
    const key: Record<string, unknown> = matches[0];
    if (key.kty !== "RSA" || (key.alg !== undefined && key.alg !== "RS256") || (key.use !== undefined && key.use !== "sig") ||
      (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== "verify")) ||
      typeof key.n !== "string" || typeof key.e !== "string" || ["d", "p", "q", "dp", "dq", "qi", "oth"].some(field => field in key)) return { ok: false, reason: "invalid_token" };
    if (input.provider === "outlook" && (typeof key.issuer !== "string" || key.issuer.replace("{tenantid}", String(claims.tid)) !== issuer)) return { ok: false, reason: "invalid_token" };
    decodePart(key.n); decodePart(key.e);
    const publicKey = createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e } as JsonWebKey, format: "jwk" });
    const modulus = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
    if (modulus < 2048 || modulus > 8192 || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, signature)) return { ok: false, reason: "invalid_token" };
    // JWKS I/O can outlive token expiry. Recheck after signature verification before producing proof.
    const verifiedAt = (http.now ?? Date.now)();
    if (!Number.isSafeInteger(verifiedAt) || claims.exp * 1000 <= verifiedAt) return { ok: false, reason: "invalid_token" };
    const identity: IdentityBase = { issuer, subject: claims.sub, verifiedAt, expiresAt: Math.min(claims.exp * 1000, verifiedAt + 10 * 60_000) };
    if (input.provider === "telegram") {
      const telegramUserId = canonicalTelegramId(claims.id);
      return telegramUserId ? { ok: true, value: { ...identity, provider: "telegram", telegramUserId } } : { ok: false, reason: "invalid_identity" };
    }
    return { ok: true, value: { ...identity, provider: input.provider } };
  } catch { return { ok: false, reason: "invalid_token" }; }
}
