import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_CONFIG } from "../lib/auth-session";
// Create synthetic cookies using the installed SDK's encryption format. These
// tests exercise its real middleware without contacting an identity provider.
import { decrypt, encrypt } from "../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js";

const DAY = 24 * 60 * 60;
const USER = { sub: "auth0|session-test", name: "Session test" };
const now = () => Math.floor(Date.now() / 1000);

function client(secret: string, appBaseUrl = "http://localhost:3000") {
  return new Auth0Client({
    secret,
    appBaseUrl,
    domain: "session-tests.auth0.invalid",
    clientId: "session-test-client",
    clientSecret: "session-test-client-secret",
    session: AUTH_SESSION_CONFIG,
    enableTelemetry: false,
    customFetch: async () => {
      throw new Error("Session persistence must not contact Auth0");
    },
  });
}

function request(cookie?: string, origin = "http://localhost:3000") {
  return new NextRequest(`${origin}/dashboard`, {
    headers: cookie ? { cookie: `__session=${cookie}` } : {},
  });
}

async function sessionCookie(
  secret: string,
  { createdAt = now(), expiresAt = now() + DAY } = {},
) {
  return encrypt(
    {
      user: USER,
      tokenSet: { accessToken: "synthetic-token", expiresAt: now() + DAY },
      internal: { sid: "synthetic-session", createdAt },
    },
    secret,
    expiresAt,
  );
}

test("SDK issues a persistent HttpOnly cookie valid for 400 idle days on localhost", async () => {
  const secret = randomBytes(32).toString("hex");
  const auth = client(secret);
  const response = await auth.middleware(request(await sessionCookie(secret)));
  const cookie = response.cookies.get("__session");

  assert(cookie);
  assert.equal(cookie.maxAge, 400 * DAY);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.path, "/");
  assert.equal(Boolean(cookie.secure), false);
  assert(cookie.expires instanceof Date);
  assert(Math.abs(cookie.expires.getTime() / 1000 - (now() + 400 * DAY)) < 5);
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
});

test("activity renews a nearly expired cookie without changing the original sign-in time", async () => {
  const secret = randomBytes(32).toString("hex");
  const auth = client(secret);
  const createdAt = now() - 2 * DAY;
  const cookie = await sessionCookie(secret, { createdAt, expiresAt: now() + 60 });
  const response = await auth.middleware(request(cookie));
  const renewed = response.cookies.get("__session");

  assert(renewed);
  assert.equal(renewed.maxAge, 400 * DAY);
  const session = await auth.getSession(request(renewed.value));
  assert.deepEqual(session?.user, USER);
  assert.equal(session?.internal.createdAt, createdAt);
  const decoded = await decrypt(renewed.value, secret);
  assert(decoded?.payload.exp);
  assert(Number.isFinite(decoded.payload.exp));
  assert(Math.abs(decoded.payload.exp - (now() + 400 * DAY)) < 5);
});

test("activity renews an old session for 400 days without an absolute sign-in deadline", async () => {
  const secret = randomBytes(32).toString("hex");
  const auth = client(secret);
  const createdAt = now() - 800 * DAY;
  const response = await auth.middleware(
    request(await sessionCookie(secret, { createdAt, expiresAt: now() + 60 })),
  );
  const cookie = response.cookies.get("__session");

  assert(cookie);
  assert.equal(cookie.maxAge, 400 * DAY);
  const restored = await auth.getSession(request(cookie.value));
  assert.deepEqual(restored?.user, USER);
  assert.equal(restored?.internal.createdAt, createdAt);
  const decoded = await decrypt(cookie.value, secret);
  assert(decoded?.payload.exp);
  assert(Number.isFinite(decoded.payload.exp));
  assert(Math.abs(decoded.payload.exp - (now() + 400 * DAY)) < 5);
});

test("updating a newly established session also writes a finite persistent expiry", async () => {
  const secret = randomBytes(32).toString("hex");
  const auth = client(secret);
  const req = request(await sessionCookie(secret));
  const session = await auth.getSession(req);
  assert(session);
  const response = NextResponse.next();

  await auth.updateSession(req, response, {
    ...session,
    user: { ...session.user, name: "Updated session test" },
  });

  const cookie = response.cookies.get("__session");
  assert(cookie);
  assert.equal(cookie.maxAge, 400 * DAY);
  assert(cookie.expires instanceof Date);
  assert(Number.isFinite(cookie.expires.getTime()));
  const decoded = await decrypt(cookie.value, secret);
  assert(decoded?.payload.exp);
  assert(Number.isFinite(decoded.payload.exp));
  assert(Math.abs(decoded.payload.exp - (now() + 400 * DAY)) < 5);
  assert.equal(
    (await auth.getSession(request(cookie.value)))?.user.name,
    "Updated session test",
  );
});

test("missing, expired, and tampered cookies cannot establish or renew a session", async () => {
  const secret = randomBytes(32).toString("hex");
  const auth = client(secret);
  const valid = await sessionCookie(secret);
  const pieces = valid.split(".");
  pieces[3] = `${pieces[3][0] === "A" ? "B" : "A"}${pieces[3].slice(1)}`;
  const invalidCookies = [
    undefined,
    await sessionCookie(secret, { expiresAt: now() - 60 }),
    pieces.join("."),
  ];

  for (const cookie of invalidCookies) {
    assert.equal(await auth.getSession(request(cookie)), null);
    const response = await auth.middleware(request(cookie));
    assert.equal(response.cookies.get("__session"), undefined);
  }
});

test("a new client instance restores the session with the same secret only", async () => {
  const secret = randomBytes(32).toString("hex");
  const response = await client(secret).middleware(request(await sessionCookie(secret)));
  const cookie = response.cookies.get("__session");

  assert(cookie);
  assert.deepEqual((await client(secret).getSession(request(cookie.value)))?.user, USER);
  assert.equal(
    await client(randomBytes(32).toString("hex")).getSession(request(cookie.value)),
    null,
  );
});

test("SDK automatically secures the persistent cookie when the app uses HTTPS", async () => {
  const secret = randomBytes(32).toString("hex");
  const origin = "https://openmods.example";
  const response = await client(secret, origin).middleware(
    request(await sessionCookie(secret), origin),
  );
  const cookie = response.cookies.get("__session");

  assert(cookie);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.maxAge, 400 * DAY);
});
