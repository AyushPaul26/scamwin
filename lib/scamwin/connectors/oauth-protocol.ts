import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isBoundedSecret, oauthCallbackUri, oauthProvider, type OAuthProvider, type ProtocolResult } from "./oauth-providers";

export const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

/** Secret server-only flow; persistence/encryption and atomic consumption belong to the integration layer. */
export type OAuthFlow = {
  provider: OAuthProvider;
  owner: string;
  connectionId: string;
  epoch: number;
  clientId: string;
  redirectUri: string;
  stateHash: string;
  browserBindingHash: string;
  pkceVerifier: string;
  pkceChallenge: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
};
export type BeginOAuthInput = {
  provider: OAuthProvider;
  owner: string;
  connectionId: string;
  epoch: number;
  clientId: string;
  appOrigin: string;
  now: number;
  requestRefreshConsent?: boolean;
};
export type OAuthCallbackInput = {
  provider: OAuthProvider;
  owner: string | null;
  currentEpoch: number;
  browserBindingSecret?: string;
  query: URLSearchParams;
};
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const random = () => randomBytes(32).toString("base64url");
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function beginOAuthFlow(input: BeginOAuthInput): { flow: OAuthFlow; authorizationUrl: string; browserBindingSecret: string } {
  if (!isBoundedSecret(input.owner, 512) || !isBoundedSecret(input.connectionId, 512) || !isBoundedSecret(input.clientId, 512) ||
    !Number.isSafeInteger(input.epoch) || input.epoch < 0 || !Number.isSafeInteger(input.now) || input.now < 0) throw new Error("invalid_configuration");
  const provider = oauthProvider(input.provider);
  const redirectUri = oauthCallbackUri(input.appOrigin, input.provider);
  const state = random(); const pkceVerifier = random(); const nonce = random(); const browserBindingSecret = random();
  const flow: OAuthFlow = { provider: input.provider, owner: input.owner, connectionId: input.connectionId, epoch: input.epoch,
    clientId: input.clientId, redirectUri, stateHash: digest(state), browserBindingHash: digest(browserBindingSecret), pkceVerifier,
    pkceChallenge: digest(pkceVerifier), nonce, createdAt: input.now, expiresAt: input.now + OAUTH_FLOW_TTL_MS, consumedAt: null };
  const url = new URL(provider.authorization);
  url.search = new URLSearchParams({ client_id: input.clientId, redirect_uri: redirectUri, response_type: "code", scope: provider.scopes.join(" "),
    state, nonce, code_challenge: flow.pkceChallenge, code_challenge_method: "S256" }).toString();
  if (input.provider === "gmail") {
    url.searchParams.set("access_type", "offline");
    if (input.requestRefreshConsent) url.searchParams.set("prompt", "consent");
  }
  if (input.provider === "outlook") url.searchParams.set("response_mode", "query");
  return { flow, authorizationUrl: url.toString(), browserBindingSecret };
}

/** Pure preflight only: after success, caller MUST atomically claim this flow before code exchange.
 * A successful preflight does not itself prevent two concurrent callbacks or authorize persistence.
 */
export function validateOAuthCallback(flow: OAuthFlow, input: OAuthCallbackInput, now: number): ProtocolResult<{ code: string }> {
  if (flow.consumedAt !== null) return { ok: false, reason: "flow_consumed" };
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(flow.createdAt) || !Number.isSafeInteger(flow.expiresAt) ||
    flow.createdAt > now || flow.expiresAt <= now || flow.expiresAt - flow.createdAt > OAUTH_FLOW_TTL_MS) return { ok: false, reason: "expired_flow" };
  if (!input.owner || input.owner !== flow.owner || input.provider !== flow.provider || input.currentEpoch !== flow.epoch ||
    !isBoundedSecret(input.browserBindingSecret, 128) || !equal(digest(input.browserBindingSecret), flow.browserBindingHash) ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(flow.pkceVerifier) || !equal(digest(flow.pkceVerifier), flow.pkceChallenge)) return { ok: false, reason: "invalid_binding" };
  const seen = new Set<string>();
  for (const [key, value] of input.query) {
    if (seen.has(key) || key.length > 128 || value.length > 16_384 || seen.size >= 16) return { ok: false, reason: "invalid_callback" };
    seen.add(key);
  }
  const state = input.query.get("state");
  if (!isBoundedSecret(state, 128) || !equal(digest(state), flow.stateHash)) return { ok: false, reason: "invalid_binding" };
  const error = input.query.get("error");
  if (error !== null) return { ok: false, reason: error === "access_denied" ? "consent_denied" : "provider_rejected" };
  const code = input.query.get("code");
  if (!isBoundedSecret(code)) return { ok: false, reason: "invalid_callback" };
  return { ok: true, value: { code } };
}
