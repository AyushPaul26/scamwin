import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { chromium } from "playwright";
import { decrypt } from "../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js";
import { createPreviewContext } from "./creature-preview-session.mjs";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const contexts = [], owners = [];
const [botId, teammateId, foreignBotId, directId, groupId, foreignChatId] = Array.from({ length: 6 }, () => randomUUID());
let sql, release;
try {
  for (let i = 0; i < 2; i++) {
    const context = await createPreviewContext(browser, baseUrl, { viewport: { width: 1280, height: 844 }, reducedMotion: "reduce" });
    contexts.push(context);
    owners.push((await decrypt((await context.cookies()).find((cookie) => cookie.name === "__session").value, process.env.AUTH0_SECRET)).payload.user.sub);
  }
  const [owner, otherOwner] = owners;
  const anonymous = await browser.newContext(); contexts.push(anonymous);
  sql = neon(process.env.DATABASE_URL);
  await sql`INSERT INTO bots (id,user_id,name,avatar,job,sandbox_id) VALUES (${botId},${owner},'Atlas','deleteBotSeed123456789','Developer','browser-test-no-sandbox'), (${teammateId},${owner},'Teammate','teammate','Reviewer','browser-test-no-sandbox'), (${foreignBotId},${otherOwner},'Other owner','foreign','Reviewer','browser-test-no-sandbox')`;
  await sql`INSERT INTO chats (id,user_id,kind,name) VALUES (${directId},${owner},'direct',NULL), (${groupId},${owner},'group','Team'), (${foreignChatId},${otherOwner},'direct',NULL)`;
  await sql`INSERT INTO chat_members (chat_id,bot_id) VALUES (${directId},${botId}), (${groupId},${botId}), (${groupId},${teammateId}), (${foreignChatId},${foreignBotId})`;
  const page = await contexts[0].newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const url = new URL(`/chats/${directId}`, baseUrl).href;
  await page.goto(url);
  await page.getByRole("button", { name: "Edit Atlas", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit your bot", exact: true });
  await editor.getByLabel("Name", { exact: true }).fill("Unsaved draft");
  const deleteButton = editor.getByRole("button", { name: "Delete bot", exact: true });
  const confirmation = page.getByRole("alertdialog", { name: "Delete Atlas?", exact: true });
  let posts = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.headers()["next-action"]) posts++; });
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    assert.ok(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1));
    await deleteButton.click(); await confirmation.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === "Keep bot");
    assert.equal(posts, 0, "opening confirmation never deletes");
    await page.screenshot({ path: `/tmp/openmods-delete-bot-${width}.png`, animations: "disabled" });
    await confirmation.getByRole("button", { name: "Keep bot", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await editor.getByLabel("Name", { exact: true }).inputValue(), "Unsaved draft");
    assert.ok(await deleteButton.evaluate((el) => el === document.activeElement));
  }
  assert.equal((await sql`SELECT id FROM bots WHERE id=${botId}`).length, 1);
  await deleteButton.click(); await confirmation.waitFor();
  await page.keyboard.press("Escape"); await confirmation.waitFor({ state: "hidden" });
  assert.ok(await editor.isVisible());
  await deleteButton.click();
  await page.route(url, async (route) => {
    if (route.request().method() === "POST") await route.abort("failed"); else await route.continue();
  });
  await confirmation.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await confirmation.getByText("We couldn’t delete your bot. Please try again.", { exact: true }).waitFor();
  assert.equal((await sql`SELECT id FROM bots WHERE id=${botId}`).length, 1);
  await page.unroute(url);
  let captured;
  const gate = new Promise((resolve) => { release = resolve; });
  let notifyRequest;
  const requestReady = new Promise((resolve) => { notifyRequest = resolve; });
  await page.route(url, async (route) => {
    if (route.request().method() === "POST") {
      captured = { headers: route.request().headers(), body: route.request().postDataBuffer() };
      notifyRequest(); await gate;
    }
    await route.continue();
  });
  await confirmation.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await requestReady;
  assert.ok(await confirmation.getByRole("button", { name: "Deleting…", exact: true }).isDisabled());
  assert.ok(await confirmation.getByRole("button", { name: "Keep bot", exact: true }).isDisabled());
  await page.keyboard.press("Escape"); assert.ok(await confirmation.isVisible());
  for (const context of [contexts[1], anonymous]) {
    const response = await context.request.post(url, { headers: { "next-action": captured.headers["next-action"], "content-type": captured.headers["content-type"], origin: new URL(baseUrl).origin }, data: captured.body });
    assert.ok((await response.text()).includes(context === anonymous ? "Please sign in again" : "no longer available"));
  }
  assert.equal((await sql`SELECT id FROM bots WHERE id=${botId}`).length, 1, "foreign and anonymous actions cannot delete");
  assert.equal((await sql`SELECT id FROM chats WHERE id=${directId}`).length, 1);
  release();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  await page.getByRole("heading", { name: "Your bots", exact: true }).waitFor();
  assert.equal((await sql`SELECT id FROM bots WHERE id=${botId}`).length, 0);
  assert.equal((await sql`SELECT id FROM chats WHERE id=${directId}`).length, 0);
  assert.equal((await sql`SELECT bot_id FROM chat_members WHERE bot_id=${botId}`).length, 0);
  assert.equal((await sql`SELECT id FROM chats WHERE id=${groupId}`).length, 1);
  assert.equal((await sql`SELECT bot_id FROM chat_members WHERE chat_id=${groupId} AND bot_id=${teammateId}`).length, 1);
  assert.equal((await sql`SELECT id FROM bots WHERE id=${foreignBotId}`).length, 1);
  assert.equal((await sql`SELECT id FROM chats WHERE id=${foreignChatId}`).length, 1);
  assert.equal(await page.locator(`[data-chat-id="${directId}"]`).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Delete passed: confirmation/cancel/Escape, preserved draft, mobile fit, failure/retry, pending lock, cross-owner and anonymous rejection, atomic direct-chat cleanup, group preservation and dashboard redirect.");
} finally {
  release?.();
  if (sql) for (const owner of owners) {
    await sql`DELETE FROM chats WHERE user_id=${owner}`;
    await sql`DELETE FROM bots WHERE user_id=${owner}`;
  }
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
