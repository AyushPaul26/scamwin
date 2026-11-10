import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { beginOAuthFlow, validateOAuthCallback } from "../lib/scamwin/connectors/oauth-protocol";
import { exchangeAuthorizationCode, refreshMailboxToken, revokeMailboxToken, type ProtocolHttp } from "../lib/scamwin/connectors/token-client";
import { verifyProviderIdToken } from "../lib/scamwin/connectors/oidc";

const now = 1_800_000_000_000;
const scope = "https://www.googleapis.com/auth/gmail.readonly";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "synthetic-key", use: "sig", alg: "RS256" };
function jwt(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "synthetic-key", ...header })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: "https://oauth.telegram.org", sub: "opaque-subject-not-id", id: 123456789,
    aud: "synthetic-client", nonce: "synthetic-nonce", iat: now / 1000, exp: now / 1000 + 300, ...claims })).toString("base64url");
  const input = `${head}.${body}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), pair.privateKey).toString("base64url")}`;
}
function http(body: unknown, status = 200, inspect?: (url: string, init: RequestInit) => void): ProtocolHttp {
  return { now: () => now, fetch: async (url, init) => {
    inspect?.(String(url), init ?? {});
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  } };
}
function begin(provider: "gmail" | "outlook" | "telegram" = "gmail") {
  return beginOAuthFlow({ provider, clientId: "synthetic-client", appOrigin: "https://scamwin.example",
    owner: "auth0|synthetic-owner", connectionId: "synthetic-connection", epoch: 3, now });
}
function callback(start: ReturnType<typeof begin>) {
  return { provider: start.flow.provider, owner: start.flow.owner, currentEpoch: 3,
    browserBindingSecret: start.browserBindingSecret,
    query: new URLSearchParams({ state: new URL(start.authorizationUrl).searchParams.get("state")!, code: "synthetic-code" }) };
}
const verifyInput = (idToken = jwt()) => ({ provider: "telegram" as const, idToken, clientId: "synthetic-client", nonce: "synthetic-nonce", issuedAfter: now - 1000 });
const keysHttp = () => http({ keys: [jwk] });

test("authorization is fixed-origin code+S256 with independent browser/state/nonce secrets", () => {
  for (const provider of ["gmail", "outlook", "telegram"] as const) {
    const start = begin(provider);
    const url = new URL(start.authorizationUrl);
    assert.equal(url.origin, provider === "gmail" ? "https://accounts.google.com" : provider === "outlook" ? "https://login.microsoftonline.com" : "https://oauth.telegram.org");
    assert.equal(url.searchParams.get("redirect_uri"), `https://scamwin.example/api/scamwin/connections/${provider}/callback`);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(start.flow.pkceVerifier).digest("base64url"));
    assert.equal(new Set([url.searchParams.get("state"), start.flow.pkceVerifier, start.flow.nonce, start.browserBindingSecret]).size, 4);
    assert.equal(url.searchParams.has("client_secret"), false);
    assert.equal(url.searchParams.get("state")!.includes("synthetic-owner"), false);
    assert.equal(url.searchParams.get("scope"), provider === "gmail" ? `openid email ${scope}` : provider === "outlook" ? "openid profile email offline_access https://graph.microsoft.com/Mail.Read" : "openid profile");
  }
  assert.notEqual(begin().authorizationUrl, begin().authorizationUrl);
  assert.equal(new URL(begin().authorizationUrl).searchParams.get("prompt"), null);
  const recover = beginOAuthFlow({ provider: "gmail", clientId: "client", appOrigin: "https://scamwin.example", owner: "owner", connectionId: "id", epoch: 1, now, requestRefreshConsent: true });
  assert.equal(new URL(recover.authorizationUrl).searchParams.get("prompt"), "consent");
  for (const appOrigin of ["http://scamwin.example", "https://evil.example/path", "https://user:pass@scamwin.example", "https://scamwin.example?return=evil"]) {
    assert.throws(() => beginOAuthFlow({ provider: "gmail", clientId: "synthetic-client", appOrigin, owner: "owner", connectionId: "id", epoch: 1, now }), /invalid_configuration/);
  }
});

test("callback enforces owner AND browser AND state, provider, epoch, TTL, PKCE and replay boundaries", () => {
  const start = begin();
  assert.deepEqual(validateOAuthCallback(start.flow, callback(start), now), { ok: true, value: { code: "synthetic-code" } });
  for (const patch of [{ owner: null }, { owner: "auth0|other" }, { browserBindingSecret: undefined }, { browserBindingSecret: "forwarded-browser" }, { currentEpoch: 4 }, { provider: "telegram" as const }]) {
    assert.equal(validateOAuthCallback(start.flow, { ...callback(start), ...patch }, now).ok, false);
  }
  for (const patch of [{ consumedAt: now }, { expiresAt: now }, { createdAt: now + 1 }, { pkceVerifier: "A".repeat(43) }]) {
    assert.equal(validateOAuthCallback({ ...start.flow, ...patch }, callback(start), now).ok, false);
  }
  const missing = callback(start); missing.query.delete("state");
  assert.equal(validateOAuthCallback(start.flow, missing, now).ok, false);
  const wrong = callback(start); wrong.query.set("state", "wrong-state");
  assert.equal(validateOAuthCallback(start.flow, wrong, now).ok, false);
  const duplicate = callback(start); duplicate.query.append("code", "second");
  assert.equal(validateOAuthCallback(start.flow, duplicate, now).ok, false);
  const denied = callback(start); denied.query.delete("code"); denied.query.set("error", "access_denied");
  assert.deepEqual(validateOAuthCallback(start.flow, denied, now), { ok: false, reason: "consent_denied" });
});

test("Gmail exchange sends confidential form to fixed endpoint and uses saved PKCE/callback", async () => {
  const start = begin();
  const result = await exchangeAuthorizationCode({ flow: start.flow, code: "code +/?", clientSecret: "secret +&" }, http({
    access_token: "synthetic-access", refresh_token: "synthetic-refresh", id_token: "synthetic-id", token_type: "Bearer", expires_in: 3600, scope,
  }, 200, (url, init) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    const fields = new URLSearchParams(String(init.body));
    assert.equal(fields.get("code"), "code +/?"); assert.equal(fields.get("client_secret"), "secret +&");
    assert.equal(fields.get("code_verifier"), start.flow.pkceVerifier);
    assert.equal(fields.get("redirect_uri"), "https://scamwin.example/api/scamwin/connections/gmail/callback");
    assert.equal(fields.get("grant_type"), "authorization_code");
  }));
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.value.kind, "mailbox_tokens"); assert.equal("expiresAt" in result.value && result.value.expiresAt, now + 3_600_000); }
});

test("Telegram uses Basic auth and returns an identity-only token, never mailbox credentials", async () => {
  const result = await exchangeAuthorizationCode({ flow: begin("telegram").flow, code: "code", clientSecret: "synthetic-secret" }, http({ id_token: "synthetic-id", access_token: "discard-me" }, 200, (url, init) => {
    assert.equal(url, "https://oauth.telegram.org/token");
    assert.equal(new Headers(init.headers).get("authorization"), `Basic ${Buffer.from("synthetic-client:synthetic-secret").toString("base64")}`);
    assert.equal(new URLSearchParams(String(init.body)).has("client_secret"), false);
  }));
  assert.deepEqual(result, { ok: true, value: { kind: "telegram_identity_token", idToken: "synthetic-id" } });
});

test("refresh preserves an omitted refresh token, accepts rotation, and retains effective read scope", async () => {
  const input = { provider: "outlook" as const, clientId: "synthetic-client", clientSecret: "secret", refreshToken: "old-refresh", scopes: ["https://graph.microsoft.com/Mail.Read"] };
  for (const refresh_token of [undefined, "rotated-refresh"]) {
    const result = await refreshMailboxToken(input, http({ access_token: "new-access", token_type: "Bearer", expires_in: 3600, refresh_token, scope: "Mail.Read" }, 200, (url, init) => {
      assert.equal(url, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
      assert.equal(new URLSearchParams(String(init.body)).get("grant_type"), "refresh_token");
      assert.equal(new URLSearchParams(String(init.body)).get("refresh_token"), "old-refresh");
    }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.refreshToken, refresh_token ?? "old-refresh");
  }
  const unchangedScope = await refreshMailboxToken(input, http({ access_token: "new-access", token_type: "Bearer", expires_in: 3600 }));
  assert.equal(unchangedScope.ok, true);
  if (unchangedScope.ok) assert.deepEqual(unchangedScope.value.scopes, ["https://graph.microsoft.com/Mail.Read"]);
  assert.deepEqual(await refreshMailboxToken(input, http({ error: "invalid_grant", error_description: "synthetic-secret" }, 400)), { ok: false, reason: "reconnect_required" });
});

test("token errors, truncated JSON, invalid expiry, absent read scope and oversized bodies fail safely", async () => {
  const input = { flow: begin().flow, code: "code", clientSecret: "secret" };
  const good = { access_token: "access", id_token: "id", token_type: "Bearer", expires_in: 3600, scope };
  const cases: [unknown, number, string][] = [
    [{ error: "invalid_grant", error_description: "SECRET" }, 400, "reconnect_required"],
    [{ error: "invalid_client" }, 401, "provider_rejected"],
    ["{", 200, "malformed_response"], ["x".repeat(65_537), 200, "response_too_large"],
    [{ ...good, expires_in: -1 }, 200, "malformed_response"], [{ ...good, expires_in: "3600" }, 200, "malformed_response"],
    [{ ...good, access_token: undefined }, 200, "malformed_response"], [{ ...good, scope: "openid email" }, 200, "missing_read_scope"],
    [{ ...good, token_type: "mac" }, 200, "malformed_response"], [{ ...good, id_token: undefined }, 200, "malformed_response"],
  ];
  for (const [body, status, reason] of cases) assert.deepEqual(await exchangeAuthorizationCode(input, http(body, status)), { ok: false, reason });
});

test("HTTP rejects redirects and has deadlines covering both headers and streamed bodies", async () => {
  const input = { flow: begin().flow, code: "code", clientSecret: "secret" };
  assert.deepEqual(await exchangeAuthorizationCode(input, http("", 302)), { ok: false, reason: "provider_rejected" });
  for (const fetch of [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    assert.deepEqual(await exchangeAuthorizationCode(input, { now: () => now, timeoutMs: 10, fetch }), { ok: false, reason: "timeout" });
  }
  const broken = new Response(new ReadableStream({ start(controller) { controller.error(new Error("sensitive transport details")); } }));
  assert.deepEqual(await exchangeAuthorizationCode(input, { now: () => now, fetch: async () => broken }), { ok: false, reason: "network_error" });
  const oversizedHeaders = new Response("{}", { headers: { "content-length": "65537" } });
  assert.deepEqual(await exchangeAuthorizationCode(input, { now: () => now, fetch: async () => oversizedHeaders }), { ok: false, reason: "response_too_large" });
  const invalidUtf8 = new Response(new Uint8Array([0xc3, 0x28]));
  assert.deepEqual(await exchangeAuthorizationCode(input, { now: () => now, fetch: async () => invalidUtf8 }), { ok: false, reason: "malformed_response" });
});

test("revocation only uses documented Gmail endpoint and never invents Outlook or Telegram API", async () => {
  assert.deepEqual(await revokeMailboxToken({ provider: "gmail", token: "synthetic-token" }, http("", 200, (url, init) => {
    assert.equal(url, "https://oauth2.googleapis.com/revoke");
    assert.equal(new URLSearchParams(String(init.body)).get("token"), "synthetic-token");
    assert.equal(url.includes("synthetic-token"), false);
  })), { ok: true, value: { revoked: true } });
  assert.deepEqual(await revokeMailboxToken({ provider: "outlook", token: "synthetic-token" }, { fetch: async () => { throw new Error("must not fetch"); } }), { ok: false, reason: "unsupported_operation" });
  assert.deepEqual(await revokeMailboxToken({ provider: "gmail", token: "synthetic-token" }, http("sensitive provider detail", 503)), { ok: false, reason: "provider_rejected" });
});

test("real signature verification yields Telegram numeric id separately from opaque subject", async () => {
  const result = await verifyProviderIdToken(verifyInput(), http({ keys: [jwk] }, 200, (url, init) => {
    assert.equal(url, "https://oauth.telegram.org/.well-known/jwks.json");
    assert.equal(init.redirect, "error"); assert.equal(new Headers(init.headers).has("authorization"), false);
  }));
  assert.deepEqual(result, { ok: true, value: { provider: "telegram", issuer: "https://oauth.telegram.org", subject: "opaque-subject-not-id", telegramUserId: "123456789", verifiedAt: now, expiresAt: now + 300_000 } });
});

test("signature tampering, none/HS256, token-provided keys and ambiguous signing keys are rejected", async () => {
  const token = jwt(); const parts = token.split(".");
  // Keep all claims valid: only cryptographic signature verification can reject this alteration.
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), sub: "attacker" })).toString("base64url");
  for (const bad of [`${parts[0]}.${changed}.${parts[2]}`, jwt({}, { alg: "none" }), jwt({}, { alg: "HS256" }), jwt({}, { jku: "https://evil.example/keys" }), jwt({}, { crit: ["b64"], b64: false })]) {
    assert.equal((await verifyProviderIdToken(verifyInput(bad), keysHttp())).ok, false);
  }
  assert.equal((await verifyProviderIdToken(verifyInput(), http({ keys: [jwk, jwk] }))).ok, false);
  assert.equal((await verifyProviderIdToken(verifyInput(), http({ keys: [{ ...jwk, use: "enc" }] }))).ok, false);
});

test("code exchange rejects corrupt PKCE, noncanonical callbacks and expired flows before HTTP", async () => {
  const start = begin();
  for (const patch of [{ pkceVerifier: "A".repeat(43) }, { redirectUri: "https://scamwin.example/unapproved" },
    { redirectUri: "http://scamwin.example/api/scamwin/connections/gmail/callback" }, { expiresAt: now }, { createdAt: now + 1 }]) {
    let requests = 0;
    const result = await exchangeAuthorizationCode({ flow: { ...start.flow, ...patch }, code: "code", clientSecret: "secret" }, {
      now: () => now, fetch: async () => { requests++; return new Response(JSON.stringify({ access_token: "access", id_token: "id", token_type: "Bearer", expires_in: 3600, scope })); },
    });
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(requests, 0);
  }
});

test("fresh fixed JWKS fetch is bounded to one attempt for an unknown kid and rejects malformed/redirected keys", async () => {
  let requests = 0;
  const unknown = await verifyProviderIdToken(verifyInput(jwt({}, { kid: "unknown" })), http({ keys: [jwk] }, 200, () => requests++));
  assert.deepEqual(unknown, { ok: false, reason: "invalid_token" }); assert.equal(requests, 1);
  for (const body of ["{", { keys: [] }, { keys: Array.from({ length: 65 }, () => jwk) }, { keys: [{ ...jwk, alg: "HS256" }] },
    { keys: [{ ...jwk, key_ops: ["sign"] }] }, { keys: [{ ...jwk, n: "invalid+encoding" }] }]) {
    assert.equal((await verifyProviderIdToken(verifyInput(), http(body))).ok, false);
  }
  assert.deepEqual(await verifyProviderIdToken(verifyInput(), http("", 302)), { ok: false, reason: "provider_rejected" });
  assert.deepEqual(await verifyProviderIdToken(verifyInput(), http("x".repeat(65_537))), { ok: false, reason: "response_too_large" });
});

test("a foreign signature using a matching kid cannot establish identity", async () => {
  const foreign = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const input = jwt().split(".").slice(0, 2).join(".");
  const forged = `${input}.${sign("RSA-SHA256", Buffer.from(input), foreign.privateKey).toString("base64url")}`;
  assert.deepEqual(await verifyProviderIdToken(verifyInput(forged), keysHttp()), { ok: false, reason: "invalid_token" });
});

test("token expiry is checked again after JWKS network latency", async () => {
  let reads = 0;
  assert.deepEqual(await verifyProviderIdToken(verifyInput(), { ...keysHttp(), now: () => ++reads === 1 ? now : now + 300_000 }), { ok: false, reason: "invalid_token" });
});

test("verified claims enforce issuer, audience/azp, nonce, expiry, issued-at and not-before", async () => {
  const patches = [{ iss: "https://evil.example" }, { aud: "other" }, { aud: ["synthetic-client", "other"] }, { azp: "other" },
    { nonce: "other" }, { nonce: undefined }, { exp: now / 1000 }, { exp: "9999999999" }, { iat: now / 1000 + 61 },
    { iat: now / 1000 - 601 }, { nbf: now / 1000 + 61 }, { sub: "" }];
  for (const patch of patches) assert.equal((await verifyProviderIdToken(verifyInput(jwt(patch)), keysHttp())).ok, false, JSON.stringify(patch));
});

test("Telegram id must be verified and canonical; never infer it from sub or round unsafe numbers", async () => {
  for (const id of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "00123", "1e8", "9223372036854775808"]) {
    assert.deepEqual(await verifyProviderIdToken(verifyInput(jwt({ id, sub: "123456789" })), keysHttp()), { ok: false, reason: "invalid_identity" });
  }
  const result = await verifyProviderIdToken(verifyInput(jwt({ id: "9007199254740993" })), keysHttp());
  assert.equal(result.ok && result.value.provider === "telegram" && result.value.telegramUserId, "9007199254740993");
});

test("Gmail issuer and Microsoft tenant/key-issuer are verified against fixed trusted JWKS", async () => {
  const google = await verifyProviderIdToken({ ...verifyInput(jwt({ iss: "https://accounts.google.com" })), provider: "gmail" }, http({ keys: [jwk] }, 200, url => assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs")));
  assert.equal(google.ok, true);
  const tid = "12345678-1234-1234-1234-123456789abc";
  const issuer = `https://login.microsoftonline.com/${tid}/v2.0`;
  const input = { ...verifyInput(jwt({ iss: issuer, tid })), provider: "outlook" as const };
  assert.equal((await verifyProviderIdToken(input, http({ keys: [{ ...jwk, issuer: "https://login.microsoftonline.com/{tenantid}/v2.0" }] }, 200, url => assert.equal(url, "https://login.microsoftonline.com/common/discovery/v2.0/keys")))).ok, true);
  for (const keyIssuer of [undefined, "https://evil.example/{tenantid}/v2.0", "https://login.microsoftonline.com/other/v2.0"]) {
    assert.equal((await verifyProviderIdToken(input, http({ keys: [{ ...jwk, issuer: keyIssuer }] }))).ok, false);
  }
  assert.equal((await verifyProviderIdToken({ ...input, idToken: jwt({ iss: issuer, tid: "../../evil" }) }, keysHttp())).ok, false);
});
