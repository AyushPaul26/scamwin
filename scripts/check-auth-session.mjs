import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import { chromium } from "playwright";
import { encrypt } from "../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js";
import { AUTH_SESSION_CONFIG } from "../lib/auth-session.ts";

const baseUrl = new URL(process.argv[2] ?? "http://localhost:3000");
if (baseUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("Synthetic session checks only support an HTTP localhost server.");
}
config({ path: ".env.local", quiet: true });
if (!process.env.AUTH0_SECRET) throw new Error("AUTH0_SECRET is required for the local session check.");

const profileDirectory = await mkdtemp(join(tmpdir(), "openmods-session-"));
const errors = [];
let context;

async function launch() {
  const browserContext = await chromium.launchPersistentContext(profileDirectory, {
    headless: true,
    reducedMotion: "reduce",
  });
  browserContext.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  return browserContext;
}

async function sessionCookie() {
  return (await context.cookies(baseUrl.origin)).find((cookie) => cookie.name === "__session");
}

function assertPersistent(cookie) {
  assert.ok(cookie, "the middleware must issue a session cookie");
  assert.ok(Math.abs(cookie.expires - Date.now() / 1000 - AUTH_SESSION_CONFIG.inactivityDuration) < 60);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Lax");
  assert.equal(cookie.path, "/");
}

try {
  context = await launch();
  let page = await context.newPage();
  await page.goto(new URL("/sign-in", baseUrl).href);
  await page.getByRole("heading", { name: "Log in to OpenMods", exact: true }).waitFor();

  const now = Math.floor(Date.now() / 1000);
  const userId = `session-check-${randomUUID()}`;
  const value = await encrypt({
    user: { sub: userId, name: "Session check" },
    tokenSet: { expiresAt: now + 3600 },
    internal: { sid: randomUUID(), createdAt: now },
  }, process.env.AUTH0_SECRET, now + 3600);
  await context.addCookies([{
    name: "__session", value, url: baseUrl.origin,
    httpOnly: true, sameSite: "Lax", expires: now + 3600,
  }]);

  await page.goto(new URL("/sign-in", baseUrl).href);
  await page.waitForURL(new URL("/dashboard", baseUrl).href);
  assertPersistent(await sessionCookie());
  assert.equal(await page.evaluate(() => document.cookie.includes("__session=")), false);

  // Close the whole browser and reopen its on-disk profile, without reinserting cookies.
  await context.close();
  context = undefined;
  context = await launch();
  assertPersistent(await sessionCookie());
  const profile = await context.request.get(new URL("/auth/profile", baseUrl).href);
  assert.equal(profile.status(), 200);
  assert.equal((await profile.json()).sub, userId);

  page = await context.newPage();
  for (const route of ["/sign-in", "/sign-up"]) {
    await page.goto(new URL(route, baseUrl).href);
    await page.waitForURL(new URL("/dashboard", baseUrl).href);
    assertPersistent(await sessionCookie());
  }

  // Exercise local logout without following its redirect to the real identity provider.
  const logout = await context.request.get(new URL("/auth/logout", baseUrl).href, { maxRedirects: 0 });
  assert.equal(logout.status(), 307);
  assert.equal(await sessionCookie(), undefined, "logout must remove the browser's session");
  await page.goto(new URL("/dashboard", baseUrl).href);
  await page.waitForURL(new URL("/sign-in", baseUrl).href);
  await page.getByRole("heading", { name: "Log in to OpenMods", exact: true }).waitFor();
  await page.goto(new URL("/sign-up", baseUrl).href);
  await page.getByRole("heading", { name: "Sign up for OpenMods", exact: true }).waitFor();
  assert.deepEqual(errors, [], "browser rendering must not produce runtime errors");

  console.log("Passed: persistent cookie, full browser restart, signed-in redirects, signed-out forms, and local logout.");
  console.log("Uses a synthetic localhost session; external Auth0 login/SSO is not exercised.");
} finally {
  await context?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
