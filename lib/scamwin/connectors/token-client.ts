import { createHash } from "node:crypto";
import { hasMailboxReadScope, isBoundedSecret, oauthCallbackUri, oauthProvider, type MailboxProvider, type OAuthProvider, type ProtocolReason, type ProtocolResult } from "./oauth-providers";
import { OAUTH_FLOW_TTL_MS, type OAuthFlow } from "./oauth-protocol";

export type ProtocolHttp = {
  /** Required injection. This module never falls back to global fetch. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  /** Clamped to 1..10000ms, covering response headers AND body. */
  timeoutMs?: number;
};
export type MailboxTokens = {
  kind: "mailbox_tokens";
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
};
export type CodeTokens = (MailboxTokens & { idToken: string }) | { kind: "telegram_identity_token"; idToken: string };
const MAX_RESPONSE_BYTES = 65_536;

/** Internal shared fixed-endpoint transport, also used for trusted JWKS. No caller-selected URLs. */
export async function requestProviderJson(provider: OAuthProvider, operation: "token" | "jwks" | "revoke", init: RequestInit,
  http: ProtocolHttp): Promise<ProtocolResult<unknown>> {
  const url = oauthProvider(provider)[operation];
  if (!url) return { ok: false, reason: "unsupported_operation" };
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const configuredTimeout = http.timeoutMs ?? 10_000;
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1, Math.min(10_000, configuredTimeout)) : 10_000;
  const work = async (): Promise<ProtocolResult<unknown>> => {
    try {
      const response = await http.fetch(url, { ...init, redirect: "error", signal: controller.signal, cache: "no-store" });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); return { ok: false, reason: "timeout" }; }
      if (response.redirected || (response.url && response.url !== url) || (response.status >= 300 && response.status < 400)) return { ok: false, reason: "provider_rejected" };
      const declaredLength = response.headers.get("content-length");
      if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) return { ok: false, reason: "response_too_large" };
      reader = response.body?.getReader();
      let length = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > MAX_RESPONSE_BYTES) return { ok: false, reason: "response_too_large" };
          chunks.push(part.value);
        }
      }
      if (operation === "revoke") return response.ok ? { ok: true, value: null } : { ok: false, reason: "provider_rejected" };
      let body: unknown;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return { ok: false, reason: response.ok ? "malformed_response" : "provider_rejected" }; }
      if (!response.ok || (isRecord(body) && "error" in body)) {
        const reason: ProtocolReason = isRecord(body) && body.error === "invalid_grant" ? "reconnect_required" : "provider_rejected";
        return { ok: false, reason };
      }
      return { ok: true, value: body };
    } catch { return { ok: false, reason: controller.signal.aborted ? "timeout" : "network_error" }; }
  };
  try {
    return await Promise.race([work(), new Promise<ProtocolResult<unknown>>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ ok: false, reason: "timeout" }); }, timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Cancellation itself may hang on a hostile/misbehaving injected stream; never await it.
    if (reader) void reader.cancel().catch(() => {});
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function tokenRequest(fields: URLSearchParams, authorization?: string): RequestInit {
  return { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...(authorization ? { authorization } : {}) }, body: fields.toString() };
}
function parseMailboxTokens(provider: MailboxProvider, body: unknown, fallbackScopes: readonly string[], now: number, previousRefresh?: string): ProtocolResult<MailboxTokens> {
  if (!isRecord(body) || !isBoundedSecret(body.access_token) || typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer" ||
    typeof body.expires_in !== "number" || !Number.isSafeInteger(body.expires_in) || body.expires_in <= 0 || body.expires_in > 604_800 ||
    !Number.isSafeInteger(now) || now < 0 || (body.refresh_token !== undefined && !isBoundedSecret(body.refresh_token)) ||
    (body.scope !== undefined && !isBoundedSecret(body.scope, 4096))) return { ok: false, reason: "malformed_response" };
  const scopes = body.scope === undefined ? [...fallbackScopes] : (body.scope as string).split(/ +/).filter(Boolean);
  if (!hasMailboxReadScope(provider, scopes)) return { ok: false, reason: "missing_read_scope" };
  return { ok: true, value: { kind: "mailbox_tokens", accessToken: body.access_token, refreshToken: body.refresh_token as string | undefined ?? previousRefresh,
    expiresAt: now + body.expires_in * 1000, scopes: [...new Set(scopes)] } };
}

/** Called only after the integration has validated AND atomically claimed the owner/browser-bound flow.
 * Returned ID tokens remain untrusted until verifyProviderIdToken succeeds.
 */
export async function exchangeAuthorizationCode(input: { flow: OAuthFlow; code: string; clientSecret: string }, http: ProtocolHttp): Promise<ProtocolResult<CodeTokens>> {
  const { flow } = input;
  if (!isBoundedSecret(input.code) || !isBoundedSecret(input.clientSecret) || !isBoundedSecret(flow.clientId, 512) ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(flow.pkceVerifier) ||
    createHash("sha256").update(flow.pkceVerifier).digest("base64url") !== flow.pkceChallenge) return { ok: false, reason: "invalid_configuration" };
  try {
    // Origin was approved at beginOAuthFlow; the saved callback must still have the canonical path.
    if (oauthCallbackUri(new URL(flow.redirectUri).origin, flow.provider) !== flow.redirectUri) return { ok: false, reason: "invalid_configuration" };
  } catch { return { ok: false, reason: "invalid_configuration" }; }
  const now = (http.now ?? Date.now)();
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(flow.createdAt) || !Number.isSafeInteger(flow.expiresAt) ||
    flow.createdAt > now || flow.expiresAt <= now || flow.expiresAt - flow.createdAt > OAUTH_FLOW_TTL_MS) return { ok: false, reason: "expired_flow" };
  const fields = new URLSearchParams({ grant_type: "authorization_code", client_id: flow.clientId, code: input.code, redirect_uri: flow.redirectUri, code_verifier: flow.pkceVerifier });
  let authorization: string | undefined;
  if (flow.provider === "telegram") {
    const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
    authorization = `Basic ${Buffer.from(`${encode(flow.clientId)}:${encode(input.clientSecret)}`).toString("base64")}`;
  } else fields.set("client_secret", input.clientSecret);
  const result = await requestProviderJson(flow.provider, "token", tokenRequest(fields, authorization), http);
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !isBoundedSecret(body.id_token, 32_768)) return { ok: false, reason: "malformed_response" };
  if (flow.provider === "telegram") return { ok: true, value: { kind: "telegram_identity_token", idToken: body.id_token } };
  const tokens = parseMailboxTokens(flow.provider, body, oauthProvider(flow.provider).scopes, (http.now ?? Date.now)());
  return tokens.ok ? { ok: true, value: { ...tokens.value, idToken: body.id_token } } : tokens;
}

/** Pure network protocol, NOT a durable refresh lifecycle. Caller serializes refresh and fences
 * the atomic replacement by current epoch/lease; rejected persistence must discard these tokens.
 */
export async function refreshMailboxToken(input: { provider: MailboxProvider; clientId: string; clientSecret: string; refreshToken: string; scopes: readonly string[] }, http: ProtocolHttp): Promise<ProtocolResult<MailboxTokens>> {
  if (input.provider !== "gmail" && input.provider !== "outlook") return { ok: false, reason: "unsupported_operation" };
  if (![input.clientId, input.clientSecret, input.refreshToken].every(value => isBoundedSecret(value)) ||
    input.scopes.length > 32 || !input.scopes.every(scope => isBoundedSecret(scope, 512) && !/\s/.test(scope))) return { ok: false, reason: "invalid_configuration" };
  if (!hasMailboxReadScope(input.provider, input.scopes)) return { ok: false, reason: "missing_read_scope" };
  const fields = new URLSearchParams({ grant_type: "refresh_token", client_id: input.clientId, client_secret: input.clientSecret, refresh_token: input.refreshToken });
  const result = await requestProviderJson(input.provider, "token", tokenRequest(fields), http);
  return result.ok ? parseMailboxTokens(input.provider, result.value, input.scopes, (http.now ?? Date.now)(), input.refreshToken) : result;
}

export async function revokeMailboxToken(input: { provider: MailboxProvider; token: string }, http: ProtocolHttp): Promise<ProtocolResult<{ revoked: true }>> {
  if (input.provider !== "gmail") return { ok: false, reason: "unsupported_operation" };
  if (!isBoundedSecret(input.token)) return { ok: false, reason: "invalid_configuration" };
  const result = await requestProviderJson(input.provider, "revoke", tokenRequest(new URLSearchParams({ token: input.token })), http);
  return result.ok ? { ok: true, value: { revoked: true } } : result;
}
