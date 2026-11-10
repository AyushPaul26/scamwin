/** Server protocol configuration. Never derive these endpoints from callbacks or JWT headers. */
export type OAuthProvider = "gmail" | "outlook" | "telegram";
export type MailboxProvider = Exclude<OAuthProvider, "telegram">;
export type ProtocolReason = "invalid_configuration" | "invalid_callback" | "invalid_binding" |
  "expired_flow" | "flow_consumed" | "consent_denied" | "provider_rejected" |
  "reconnect_required" | "missing_read_scope" | "malformed_response" | "response_too_large" |
  "network_error" | "timeout" | "unsupported_operation" | "invalid_token" | "invalid_identity";
export type ProtocolResult<T> = { ok: true; value: T } | { ok: false; reason: ProtocolReason };

const providers = Object.freeze({
  gmail: Object.freeze({
    authorization: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    revoke: "https://oauth2.googleapis.com/revoke",
    scopes: Object.freeze(["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"]),
  }),
  outlook: Object.freeze({
    authorization: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    jwks: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    revoke: null,
    scopes: Object.freeze(["openid", "profile", "email", "offline_access", "https://graph.microsoft.com/Mail.Read"]),
  }),
  telegram: Object.freeze({
    authorization: "https://oauth.telegram.org/auth",
    token: "https://oauth.telegram.org/token",
    jwks: "https://oauth.telegram.org/.well-known/jwks.json",
    revoke: null,
    scopes: Object.freeze(["openid", "profile"]),
  }),
});

export function oauthProvider(provider: OAuthProvider) {
  if (!Object.hasOwn(providers, provider)) throw new Error("invalid_configuration");
  return providers[provider];
}

/** appOrigin is trusted server configuration, never an incoming Host/Origin/return URL. */
export function oauthCallbackUri(appOrigin: string, provider: OAuthProvider): string {
  oauthProvider(provider);
  let url: URL;
  try { url = new URL(appOrigin); } catch { throw new Error("invalid_configuration"); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    (appOrigin !== url.origin && appOrigin !== `${url.origin}/`)) throw new Error("invalid_configuration");
  return `${url.origin}/api/scamwin/connections/${provider}/callback`;
}

export function hasMailboxReadScope(provider: MailboxProvider, scopes: readonly string[]): boolean {
  return provider === "gmail" ? scopes.includes("https://www.googleapis.com/auth/gmail.readonly") :
    scopes.some(scope => ["mail.read", "https://graph.microsoft.com/mail.read"].includes(scope.toLowerCase()));
}

export function isBoundedSecret(value: unknown, max = 16_384): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
