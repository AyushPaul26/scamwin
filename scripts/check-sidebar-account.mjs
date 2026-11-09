import assert from "node:assert/strict";
import { chromium } from "playwright";
import { decrypt, encrypt } from "../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js";
import { createPreviewContext } from "./creature-preview-session.mjs";

// Synthetic localhost sessions only; does not test the external OAuth provider.
const baseUrl = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const errors = [];
try {
  for (const width of [1280, 390, 320]) {
    const context = await createPreviewContext(browser, baseUrl, {
      viewport: { width, height: width === 320 ? 568 : 844 }, reducedMotion: "reduce",
    });
    const cookie = (await context.cookies()).find((item) => item.name === "__session");
    const { payload } = await decrypt(cookie.value, process.env.AUTH0_SECRET);
    const name = width === 320 ? "Your account" : "Alex Morgan";
    if (width !== 320) Object.assign(payload.user, {
      name, email: "alex@example.test", email_verified: true,
      picture: new URL(width === 1280 ? "/missing-profile-image.png" : "/creatures/v1/cloud-bat-fern.webp", baseUrl).href,
    });
    payload.user.private_claim = "private-profile-claim-must-not-leak";
    payload.tokenSet.accessToken = "private-access-token-must-not-leak";
    await context.addCookies([{
      name: "__session", url: new URL(baseUrl).origin, httpOnly: true, sameSite: "Lax",
      value: await encrypt(payload, process.env.AUTH0_SECRET, Math.floor(Date.now() / 1000) + 1800),
    }]);
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(new URL("/dashboard", baseUrl).href);
      if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
      const trigger = page.getByRole("button", { name: `Account menu for ${name}`, exact: true });
      await trigger.waitFor();
      assert.ok(!(await page.content()).includes("private-profile-claim-must-not-leak"));
      assert.ok(!(await page.content()).includes("private-access-token-must-not-leak"));
      if (width === 1280) await trigger.getByText("AM", { exact: true }).waitFor();
      if (width === 390) assert.ok(await trigger.locator("img").evaluate((img) => img.complete && img.naturalWidth > 0));
      if (width === 1280) await page.getByRole("button", { name: "Toggle sidebar rail", exact: true }).click();
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await menu.waitFor();
      assert.equal(await menu.getByRole("menuitem", { name: "Sign out", exact: true }).getAttribute("href"), "/auth/logout");
      await menu.getByText("Secured by Auth0", { exact: true }).waitFor();
      const bounds = await menu.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, "account menu fits the viewport");
      await page.screenshot({ path: `/tmp/openmods-account-menu-${width}.png`, animations: "disabled" });
      await menu.getByRole("menuitem", { name: "View profile", exact: true }).click();
      const profile = page.getByRole("dialog", { name: "Your profile", exact: true });
      await profile.waitFor();
      await profile.getByText(width === 320 ? "Not provided" : "Verified", { exact: true }).waitFor();
      assert.ok(await profile.evaluate((el) => el.contains(document.activeElement)), "profile receives focus");
      await page.screenshot({ path: `/tmp/openmods-account-profile-${width}.png`, animations: "disabled" });
      await page.keyboard.press("Escape");
      await profile.waitFor({ state: "hidden" });
      assert.ok(await trigger.evaluate((el) => el === document.activeElement), "profile returns focus to the account button");
      if (width < 768) {
        await page.keyboard.press("Escape");
        await page.getByRole("dialog", { name: "Sidebar", exact: true }).waitFor({ state: "hidden" });
      }
      const logout = await context.request.get(new URL("/auth/logout", baseUrl).href, { maxRedirects: 0 });
      assert.equal(logout.status(), 307);
      assert.ok(!(await context.cookies()).some((item) => item.name === "__session"), "Auth0 logout clears the local session");
      await page.goto(new URL("/dashboard", baseUrl).href);
      await page.waitForURL((url) => url.pathname === "/sign-in");
      assert.equal(await page.getByRole("button", { name: `Account menu for ${name}`, exact: true }).count(), 0);
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log("Account UI passed: desktop/mobile, avatar/fallback, keyboard and focus, profile fields, private-claim exclusion, and local Auth0 logout.");
} finally {
  await browser.close();
}
