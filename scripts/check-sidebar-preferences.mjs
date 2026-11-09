import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createPreviewContext } from "./creature-preview-session.mjs";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
try {
  const context = await createPreviewContext(browser, baseUrl, {
    viewport: { width: 1280, height: 844 }, reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  const expectState = async (state) => {
    await sidebar.waitFor();
    await page.waitForFunction((expected) => document.querySelector('[data-slot="sidebar"][data-state]')?.dataset.state === expected, state);
  };
  await page.goto(new URL("/dashboard", baseUrl).href);
  await expectState("expanded");
  assert.equal(await page.getByRole("link", { name: "Your bots", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Toggle sidebar rail", exact: true }).click();
  await expectState("collapsed");
  const saved = (await context.cookies()).find((cookie) => cookie.name === "sidebar_state");
  assert.equal(saved.value, "false");
  assert.equal(saved.sameSite, "Lax");
  assert.ok(saved.expires > Date.now() / 1000 + 360 * 86400);
  await page.mouse.move(600, 100);
  await page.waitForFunction(() => {
    const search = getComputedStyle(document.querySelector('[aria-label="Search chats"][data-sidebar="menu-button"]'));
    const create = getComputedStyle(document.querySelector('[aria-label="Create new"]'));
    return search.backgroundColor === create.backgroundColor && search.color === create.color;
  });
  const appearance = (element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, radius: style.borderRadius };
  };
  const search = page.getByRole("button", { name: "Search chats", exact: true });
  const create = page.getByRole("button", { name: "Create new", exact: true });
  assert.deepEqual(await search.evaluate(appearance), await create.evaluate(appearance), "collapsed search matches the other controls");
  assert.equal(await search.evaluate((element) => getComputedStyle(element).borderTopColor), "rgba(0, 0, 0, 0)");
  await page.reload();
  await expectState("collapsed");
  const serverHtml = await (await context.request.get(new URL("/dashboard", baseUrl).href)).text();
  assert.match(serverHtml, /data-state="collapsed"/, "server render uses the saved cookie");
  await page.screenshot({ path: "/tmp/openmods-sidebar-persisted.png", animations: "disabled" });
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  await expectState("expanded");
  await page.reload();
  await expectState("expanded");
  await page.keyboard.press("Control+b");
  await expectState("collapsed");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  await page.getByRole("dialog", { name: "Sidebar", exact: true }).waitFor();
  assert.equal((await context.cookies()).find((cookie) => cookie.name === "sidebar_state").value, "false", "mobile drawer does not overwrite desktop preference");
  await page.reload();
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "Sidebar", exact: true }).count(), 0, "mobile drawer starts closed");
  await context.addCookies([{ name: "sidebar_state", value: "invalid", url: new URL(baseUrl).origin }]);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.reload();
  await expectState("expanded");
  assert.deepEqual(errors, []);
  console.log("Sidebar preferences passed: removal, matching collapsed controls, cookie expiry, server rendering, expanded/collapsed reloads, mobile isolation, and invalid-cookie fallback.");
} finally {
  await browser.close();
}
