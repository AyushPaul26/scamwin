import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { chromium } from "playwright";
import { decrypt } from "../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js";
import { createPreviewContext } from "./creature-preview-session.mjs";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const contexts = [];
let sql, owner;
const botId = randomUUID(), chatId = randomUUID();
const seed = "editBotSeed12345678901";
try {
  const context = await createPreviewContext(browser, baseUrl, { viewport: { width: 1280, height: 844 }, reducedMotion: "reduce" });
  contexts.push(context);
  owner = (await decrypt((await context.cookies()).find((cookie) => cookie.name === "__session").value, process.env.AUTH0_SECRET)).payload.user.sub;
  sql = neon(process.env.DATABASE_URL);
  await sql`INSERT INTO bots (id,user_id,name,avatar,job,instructions,sandbox_id) VALUES (${botId},${owner},'Atlas',${seed},'Developer','Keep my custom instructions.','browser-test-no-sandbox')`;
  await sql`INSERT INTO chats (id,user_id,kind) VALUES (${chatId},${owner},'direct')`;
  await sql`INSERT INTO chat_members (chat_id,bot_id) VALUES (${chatId},${botId})`;
  const url = new URL(`/chats/${chatId}`, baseUrl).href;
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  let lastAction, actionCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) {
      lastAction = { headers: request.headers(), body: request.postDataBuffer() };
      actionCount++;
    }
  });
  const row = async () => (await sql`SELECT * FROM bots WHERE id=${botId}`)[0];
  await page.goto(url);
  const trigger = page.getByRole("button", { name: "Edit Atlas", exact: true });
  await trigger.waitFor();
  assert.equal(await trigger.locator("button").count(), 0, "no nested greeting button");
  assert.equal(await trigger.locator("[data-renderer-status]").getAttribute("data-renderer-status"), "reduced-motion");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit your bot", exact: true });
  await dialog.waitFor();
  const name = dialog.getByLabel("Name", { exact: true });
  const job = dialog.getByLabel("What’s their job?", { exact: true });
  const instructions = dialog.getByLabel("Instructions (optional)", { exact: true });
  const save = dialog.getByRole("button", { name: "Save changes", exact: true });
  assert.equal(await name.inputValue(), "Atlas");
  assert.equal(await job.inputValue(), "Developer");
  assert.equal(await instructions.inputValue(), "Keep my custom instructions.");
  const portrait = await dialog.locator("[data-creature] img").getAttribute("src");
  await name.fill(" ");
  await save.click();
  await dialog.getByText("Give your bot a name.", { exact: true }).waitFor();
  assert.equal(actionCount, 0);
  assert.ok(await name.evaluate((input) => input === document.activeElement));
  await name.fill("Atlas updated");
  await dialog.locator("form").evaluate((form) => {
    const input = document.createElement("input"); input.type = "hidden"; input.name = "job"; input.value = "duplicate"; input.dataset.testField = "true"; form.append(input);
  });
  await save.click();
  await dialog.getByText("Enter text for this field.", { exact: true }).waitFor();
  assert.equal((await row()).name, "Atlas");
  await page.waitForFunction(() => document.activeElement?.id === "bot-job");
  await dialog.locator('[data-test-field="true"]').evaluate((input) => input.remove());
  await job.fill("Reviewer");
  assert.equal(await dialog.locator("[data-creature] img").getAttribute("src"), portrait);

  // A failed request leaves the form available for retry.
  await page.route(url, async (route) => {
    if (route.request().method() === "POST") await route.abort("failed");
    else await route.continue();
  });
  await save.click();
  await dialog.getByText("We couldn’t save your bot. Your details are still here — please try again.", { exact: true }).waitFor();
  assert.equal(await name.inputValue(), "Atlas updated");
  await page.unroute(url);
  await dialog.locator("form").evaluate((form) => {
    for (const [name, value] of Object.entries({ userId: "forged", avatar: "forged", sandboxId: "forged", id: "forged" })) {
      const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.append(input);
    }
  });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(url, async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  await save.click();
  await dialog.locator('form[aria-busy="true"]').waitFor();
  assert.ok(await dialog.locator('input:not([type="hidden"]), textarea, button[type="submit"], [data-slot="toggle-group-item"]').evaluateAll((inputs) => inputs.every((input) => input.disabled)));
  release();
  await dialog.waitFor({ state: "hidden" });
  await page.unroute(url);
  await page.getByRole("heading", { name: "Atlas updated", exact: true }).waitFor();
  const saved = await row();
  assert.equal(saved.name, "Atlas updated"); assert.equal(saved.job, "Reviewer");
  assert.equal(saved.instructions, "Keep my custom instructions.");
  assert.equal(saved.avatar, seed); assert.equal(saved.user_id, owner); assert.equal(saved.sandbox_id, "browser-test-no-sandbox");
  await page.locator(`[data-chat-id="${chatId}"]`).getByRole("link", { name: "Open chat Atlas updated", exact: true }).waitFor();

  // Replay the actual action under a different and an anonymous session.
  const other = await createPreviewContext(browser, baseUrl); contexts.push(other);
  const anon = await browser.newContext(); contexts.push(anon);
  for (const client of [other, anon]) {
    const response = await client.request.post(url, { headers: { "next-action": lastAction.headers["next-action"], "content-type": lastAction.headers["content-type"], origin: new URL(baseUrl).origin }, data: lastAction.body });
    const body = await response.text();
    assert.ok(body.includes(client === anon ? "Please sign in again" : "no longer available"), "action authenticates and checks ownership");
  }
  assert.deepEqual(await row(), saved);

  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.getByRole("button", { name: "Edit Atlas updated", exact: true }).click();
    await dialog.waitFor();
    assert.equal(await name.inputValue(), "Atlas updated");
    assert.ok(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), "normal dialog fits without scrolling");
    await page.screenshot({ path: `/tmp/openmods-edit-bot-${width}.png` });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.ok(await page.getByRole("button", { name: "Edit Atlas updated", exact: true }).evaluate((el) => el === document.activeElement));
  }
  // Confirm the header upgrades to the live renderer when motion is allowed.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('header [data-renderer-status="ready"]').waitFor({ timeout: 60000 });
  assert.equal(await page.locator("header canvas").count(), 1);
  await page.getByRole("button", { name: "Edit Atlas updated", exact: true }).click();
  await dialog.waitFor();
  assert.equal(await page.locator("header [data-creature-state]").getAttribute("data-creature-state"), "paused");
  await page.keyboard.press("Escape");
  // An older save cannot dismiss a newly opened editor or replace its draft.
  await page.getByRole("button", { name: "Edit Atlas updated", exact: true }).click();
  await name.fill("Older saved edit");
  let releaseOld;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  await page.route(url, async (route) => {
    if (route.request().method() === "POST") await oldGate;
    await route.continue();
  });
  await save.click();
  await dialog.locator('form[aria-busy="true"]').waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Edit Atlas updated", exact: true }).click();
  await name.fill("New unsaved draft");
  releaseOld();
  await page.getByRole("heading", { name: "Older saved edit", exact: true, includeHidden: true }).waitFor();
  assert.ok(await dialog.isVisible());
  assert.equal(await name.inputValue(), "New unsaved draft");
  await page.unroute(url);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("heading", { name: "Older saved edit", exact: true, includeHidden: true }).waitFor();
  assert.deepEqual(runtimeErrors, []);
  console.log("Edit bot passed: prefilled fields, client/server validation, rejection and retry, pending controls, saved values, ownership replay, avatar preservation, keyboard/mobile fit and live animation.");
} finally {
  if (sql) { await sql`DELETE FROM chats WHERE id=${chatId}`; await sql`DELETE FROM bots WHERE id=${botId}`; }
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
