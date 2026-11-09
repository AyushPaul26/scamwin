import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { chromium } from "playwright";
import { decrypt } from "../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js";
import { createPreviewContext } from "./creature-preview-session.mjs";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const devLogPath = new URL("../.next/dev/logs/next-development.log", import.meta.url);
const devLogBefore = await readFile(devLogPath, "utf8").catch(() => "");
const browser = await chromium.launch();
const contexts = [];
const owners = [];
let sql;
try {
  for (let index = 0; index < 2; index++) {
    const context = await createPreviewContext(browser, baseUrl, { viewport: { width: 1280, height: 844 }, reducedMotion: "reduce" });
    contexts.push(context);
    const cookie = (await context.cookies()).find((item) => item.name === "__session");
    owners.push((await decrypt(cookie.value, process.env.AUTH0_SECRET)).payload.user.sub);
  }
  sql = neon(process.env.DATABASE_URL);
  const [owner, otherOwner] = owners;
  const [firstBot, secondBot, foreignBot, directChat, groupChat, emptyChat, foreignChat] = Array.from({ length: 7 }, () => randomUUID());
  const longName = "Atlas the extraordinarily enthusiastic Node.js developer";
  await sql`INSERT INTO bots (id, user_id, name, avatar, job,sandbox_id) VALUES
    (${firstBot}, ${owner}, ${longName}, 'sidebar-first', 'Developer','browser-test-no-sandbox'),
    (${secondBot}, ${owner}, 'Second member', 'sidebar-second', 'Reviewer','browser-test-no-sandbox'),
    (${foreignBot}, ${otherOwner}, 'PRIVATE OTHER OWNER', 'private-seed', 'Private','browser-test-no-sandbox')`;
  await sql`INSERT INTO chats (id, user_id, kind, name, last_message_preview, last_message_at) VALUES
    (${directChat}, ${owner}, 'direct', 'Ignored direct title', 'Pipeline review is ready <script>not executable</script>', now() - interval '2 days'),
    (${groupChat}, ${owner}, 'group', 'Release team', NULL, now() - interval '1 hour'),
    (${emptyChat}, ${owner}, 'direct', NULL, NULL, now() - interval '3 days'),
    (${foreignChat}, ${otherOwner}, 'direct', NULL, 'PRIVATE OTHER PREVIEW', now())`;
  await sql`INSERT INTO chat_members (chat_id, bot_id, joined_at) VALUES
    (${directChat}, ${firstBot}, now()),
    (${groupChat}, ${foreignBot}, now() - interval '3 days'),
    (${groupChat}, ${firstBot}, now() - interval '2 days'),
    (${groupChat}, ${secondBot}, now() - interval '1 day'),
    (${foreignChat}, ${foreignBot}, now())`;

  const page = await contexts[0].newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  await page.goto(new URL(`/dashboard?userId=${encodeURIComponent(otherOwner)}`, baseUrl).href);
  // SidebarGroup is a generic labelled container, not an interactive control.
  const sidebar = page.locator('[aria-label="Your chats"]');
  await sidebar.locator(`[data-chat-id="${directChat}"]`).waitFor();
  assert.deepEqual(await sidebar.locator("[data-chat-id]").evaluateAll((items) => items.map((item) => item.dataset.chatId)), [groupChat, directChat, emptyChat]);
  await sidebar.getByText(longName, { exact: true }).waitFor();
  await sidebar.getByText("2 days", { exact: true }).waitFor();
  assert.equal(await sidebar.getByText("No messages yet", { exact: true }).count(), 2);
  assert.equal(await sidebar.locator("canvas").count(), 0, "chat rows only render portraits");
  assert.ok(!(await page.content()).includes("PRIVATE OTHER"), "other owners' chats and member data must not reach the browser");
  const groupImage = sidebar.locator(`[data-chat-id="${groupChat}"] img`);
  assert.equal(await groupImage.getAttribute("src"), await sidebar.locator(`[data-chat-id="${directChat}"] img`).getAttribute("src"), "group uses first owned member's portrait");
  const searchButton = page.getByRole("button", { name: "Search chats", exact: true });
  await searchButton.click();
  const searchDialog = page.getByRole("dialog", { name: "Search chats", exact: true });
  const search = searchDialog.getByRole("combobox", { name: "Search chats" });
  await search.waitFor();
  assert.ok(await search.evaluate((element) => element === document.activeElement));
  assert.equal(await searchDialog.getByRole("option").count(), 3);
  assert.equal(await searchDialog.locator("canvas").count(), 0);
  assert.ok(!(await searchDialog.textContent()).includes("PRIVATE OTHER"));
  await search.fill("PIPELINE");
  assert.equal(await searchDialog.getByRole("option").count(), 1);
  await search.fill("no such chat");
  await searchDialog.getByText("No chats match your search.").waitFor();
  await page.keyboard.press("Escape");
  await searchDialog.waitFor({ state: "hidden" });
  assert.ok(await searchButton.evaluate((element) => element === document.activeElement));
  await page.getByRole("button", { name: "Toggle sidebar rail", exact: true }).click();
  await page.waitForFunction(() => Math.round(document.querySelector('[data-slot="sidebar-container"]').getBoundingClientRect().width) === 64);
  const collapsedControls = page.locator('[data-slot="sidebar-container"] [data-sidebar="menu-button"]');
  for (const control of await collapsedControls.all()) {
    const bounds = await control.boundingBox();
    assert.equal(Math.round(bounds.width), 40, "every collapsed control has the same width");
    assert.equal(Math.round(bounds.height), 40, "every collapsed control has the same height");
  }
  await sidebar.locator(`[data-chat-id="${directChat}"]`).getByRole("link").hover();
  await page.locator('[data-slot="tooltip-content"]').filter({ hasText: longName }).waitFor();
  await page.mouse.move(500, 100);
  await page.screenshot({ path: "/tmp/openmods-sidebar-collapsed.png", animations: "disabled" });
  for (const shortcut of ["Control+k", "Meta+k"]) {
    await page.keyboard.press(shortcut);
    await search.waitFor();
    await page.keyboard.press(shortcut);
    await searchDialog.waitFor({ state: "hidden" });
  }
  await page.keyboard.press("Control+k");
  await search.fill("PIPELINE");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === `/chats/${directChat}`);
  await page.getByRole("heading", { name: longName, exact: true }).waitFor();
  await page.goto(new URL("/dashboard", baseUrl).href);
  const directLink = sidebar.locator(`[data-chat-id="${directChat}"]`).getByRole("link");
  assert.equal(await directLink.getAttribute("href"), `/chats/${directChat}`);
  await directLink.click();
  await page.waitForURL((url) => url.pathname === `/chats/${directChat}`);
  await page.getByRole("heading", { name: longName, exact: true }).waitFor();
  assert.equal(await directLink.getAttribute("aria-current"), "page");
  assert.notEqual(await directLink.getAttribute("data-active"), null);
  assert.equal(await sidebar.locator('[aria-current="page"]').count(), 1);
  assert.equal(await page.locator("main:visible header img").getAttribute("src"), await sidebar.locator(`[data-chat-id="${directChat}"] img`).getAttribute("src"));
  const desktopButton = page.getByRole("button", { name: "Open computer desktop", exact: true });
  assert.equal(await desktopButton.isDisabled(), false, "owned direct chat exposes desktop access");
  await page.screenshot({ path: "/tmp/openmods-chat-header-desktop.png", animations: "disabled" });
  await sidebar.locator(`[data-chat-id="${groupChat}"]`).getByRole("link").click();
  await page.getByRole("heading", { name: "Release team", exact: true }).waitFor();
  assert.equal(await directLink.getAttribute("aria-current"), null);
  assert.equal(await sidebar.locator(`[data-chat-id="${groupChat}"] a`).getAttribute("aria-current"), "page");
  await page.goBack();
  await page.getByRole("heading", { name: longName, exact: true }).waitFor();
  assert.equal(await directLink.getAttribute("aria-current"), "page");
  await page.goto(new URL("/dashboard", baseUrl).href);
  await directLink.waitFor();
  await page.screenshot({ path: "/tmp/openmods-sidebar-chats-desktop.png", animations: "disabled" });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
    await sidebar.locator(`[data-chat-id="${directChat}"]`).waitFor();
    assert.ok(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth), "long rows must not overflow the sidebar");
    await page.screenshot({ path: `/tmp/openmods-sidebar-chats-${width}.png`, animations: "disabled" });
    await searchButton.click();
    await search.waitFor();
    await search.fill("Release");
    await page.screenshot({ path: `/tmp/openmods-chat-search-${width}.png`, animations: "disabled" });
    await searchDialog.getByRole("option", { name: /Release team/ }).click();
    await page.waitForURL((url) => url.pathname === `/chats/${groupChat}`);
    await page.getByRole("heading", { name: "Release team", exact: true }).waitFor();
    await page.goto(new URL("/dashboard", baseUrl).href);
    await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
    await directLink.click();
    await page.waitForURL((url) => url.pathname === `/chats/${directChat}`);
    await page.getByRole("heading", { name: longName, exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "chat header fits narrow screens");
    await page.screenshot({ path: `/tmp/openmods-chat-header-${width}.png`, animations: "disabled" });
    await page.goto(new URL("/dashboard", baseUrl).href);
    await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
    await searchButton.waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Sidebar", exact: true }).waitFor({ state: "hidden" });
    await page.keyboard.press("Control+k");
    await search.waitFor();
    await page.keyboard.press("Escape");
    await searchDialog.waitFor({ state: "hidden" });
  }
  for (const inaccessibleId of [foreignChat, randomUUID()]) {
    await page.goto(new URL(`/chats/${inaccessibleId}`, baseUrl).href);
    await page.getByRole("heading", { name: "404", exact: true }).waitFor();
    assert.ok(!(await page.content()).includes("PRIVATE OTHER"));
  }
  await page.goto(new URL(`/chats/${emptyChat}`, baseUrl).href);
  await page.getByRole("heading", { name: "New chat", exact: true }).waitFor();
  const anonymous = await browser.newContext();
  contexts.push(anonymous);
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(new URL(`/chats/${directChat}`, baseUrl).href);
  await anonymousPage.waitForURL((url) => url.pathname === "/sign-in");
  const otherPage = await contexts[1].newPage();
  await otherPage.goto(new URL("/dashboard", baseUrl).href);
  const otherSidebar = otherPage.locator('[aria-label="Your chats"]');
  await otherSidebar.getByText("PRIVATE OTHER OWNER", { exact: true }).waitFor();
  assert.equal(await otherSidebar.locator("[data-chat-id]").count(), 1);
  assert.ok(!(await otherPage.content()).includes(longName));
  await sql`DELETE FROM chats WHERE user_id = ${otherOwner}`;
  await otherPage.reload();
  await otherPage.getByText("No chats yet. Create a bot to get started.").waitFor();
  await otherPage.getByRole("button", { name: "Search chats", exact: true }).click();
  await otherPage.getByRole("dialog", { name: "Search chats", exact: true }).getByText("No chats yet. Create a bot to get started.").waitFor();
  assert.deepEqual(errors, []);
  const devLogAfter = await readFile(devLogPath, "utf8").catch(() => "");
  const newDevLog = devLogAfter.startsWith(devLogBefore) ? devLogAfter.slice(devLogBefore.length) : devLogAfter;
  assert.ok(!newDevLog.includes("unstable value `new Date()`"), "sidebar must not read the current time during prerendering");
  console.log("Sidebar chats passed: Auth0 isolation, ordering, portraits, search, keyboard and click navigation to owned chat headers, active state, missing/foreign chat rejection, anonymous redirect, desktop/mobile fit, and no runtime errors.");
} finally {
  if (sql) for (const owner of owners) {
    await sql`DELETE FROM chats WHERE user_id = ${owner}`;
    await sql`DELETE FROM bots WHERE user_id = ${owner}`;
  }
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
