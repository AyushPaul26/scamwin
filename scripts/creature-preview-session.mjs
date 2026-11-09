import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { encrypt } from "../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js";

/** Synthetic sessions are restricted to local preview tooling, never external hosts. */
export async function createPreviewContext(browser, baseUrl, options = {}) {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Creature preview tooling only supports an HTTP localhost server.");
  }
  config({ path: ".env.local", quiet: true });
  if (!process.env.AUTH0_SECRET) throw new Error("AUTH0_SECRET is required for the local authenticated preview.");
  const now = Math.floor(Date.now() / 1000);
  const value = await encrypt({
    user: { sub: `creature-preview-${randomUUID()}` },
    tokenSet: { expiresAt: now + 1800 },
    internal: { sid: randomUUID(), createdAt: now },
  }, process.env.AUTH0_SECRET, now + 1800);
  const context = await browser.newContext(options);
  await context.addCookies([{ name: "__session", value, url: url.origin, httpOnly: true, sameSite: "Lax" }]);
  return context;
}
