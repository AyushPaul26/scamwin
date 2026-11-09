import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createMockTriggerChat } from "./mock-trigger-chat.mjs";
import { neon } from "@neondatabase/serverless";
import { chromium } from "playwright";
import sharp from "sharp";
import { decrypt } from "../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js";
import { createPreviewContext } from "./creature-preview-session.mjs";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const target = new URL(baseUrl);
if (target.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) throw new Error("Chat checks require an HTTP localhost URL.");
let occupied = false;
try { await fetch(baseUrl, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { /* no server */ }
if (occupied) throw new Error("Stop the existing Next.js dev server before running chat browser checks; this check starts its own server with a mock Trigger backend.");
const browser = await chromium.launch();
const contexts = [], owners = [];
const botId = randomUUID(), chatId = randomUUID();
let sql;
const mock = await createMockTriggerChat(baseUrl);
const requests = mock.requests;
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", process.env.OPENMODS_BROWSER_BUILD ? "start" : "dev", "--port", new URL(baseUrl).port || "3000"], { env: { ...process.env, OPENMODS_NEXT_DIST_DIR: process.env.OPENMODS_NEXT_DIST_DIR || ".next-chat-check", TRIGGER_API_URL: mock.origin, TRIGGER_SECRET_KEY: "tr_dev_test_only_not_a_real_key" }, stdio: ["ignore", openSync("/tmp/openmods-chat-browser-next.log", "w"), openSync("/tmp/openmods-chat-browser-next-errors.log", "w")] });
for (let attempt = 0; attempt < 90; attempt++) {
  if (next.exitCode !== null) { await mock.close(); await browser.close(); throw new Error("The test Next.js server could not start. See /tmp/openmods-chat-browser-next-errors.log."); }
  try { await fetch(baseUrl); break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
}

async function waitForComposerLayout(page) {
  await page.waitForFunction(() => {
    const composer = [...document.querySelectorAll("[data-chat-composer-motion]")].find((element) => element.getClientRects().length);
    return composer && ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(getComputedStyle(composer).transform);
  });
}

async function checkWelcome(page, { compact = true, centered = true } = {}) {
  const region = page.getByRole("region", { name: "Conversation with Atlas" });
  assert.equal(await region.getAttribute("data-chat-state"), "welcome");
  const heading = await page.getByRole("heading", { name: "What are we working on?" }).boundingBox();
  const group = await region.locator("[data-chat-composer-container]").boundingBox();
  const pill = await region.locator("[data-slot=input-group]").boundingBox();
  const suggestions = await page.getByRole("button", { name: "Review some code", exact: true }).boundingBox();
  const bounds = await region.boundingBox();
  assert.ok(heading.y + heading.height < pill.y, "heading is above the composer");
  assert.ok(suggestions.y > pill.y + pill.height, "suggestions are below the composer");
  assert.ok(pill.width <= 768, "composer is no wider than 768px");
  assert.ok(Math.abs(pill.x + pill.width / 2 - bounds.x - bounds.width / 2) < 1, "composer is horizontally centered in the chat pane");
  if (centered) assert.ok(Math.abs(group.y + group.height / 2 - bounds.y - bounds.height / 2) < 1, "welcome group is vertically centered");
  if (compact) {
    assert.ok(Math.abs(pill.height - 56) <= 1, `single-line composer is 56px high (actual ${pill.height})`);
    for (const control of [page.getByRole("button", { name: "Starter prompts", exact: true }), page.getByRole("textbox", { name: "Message Atlas", exact: true }), page.getByRole("button", { name: "Send message", exact: true })]) {
      const box = await control.boundingBox();
      assert.ok(Math.abs(box.y + box.height / 2 - pill.y - pill.height / 2) < 1, "controls share a vertical center");
    }
  }
}

async function checkDocked(page) {
  await waitForComposerLayout(page);
  const region = page.getByRole("region", { name: "Conversation with Atlas" });
  assert.equal(await region.getAttribute("data-chat-state"), "active");
  assert.equal(await page.getByRole("heading", { name: "What are we working on?" }).count(), 0);
  const dock = await region.locator("[data-chat-composer-container]").boundingBox();
  const bounds = await region.boundingBox();
  const transcript = await page.getByRole("log", { name: "Chat messages" }).boundingBox();
  assert.ok(Math.abs(dock.y + dock.height - bounds.y - bounds.height) < 1, "composer stays docked at the bottom");
  assert.ok(transcript.y + transcript.height <= dock.y + 1, "transcript does not overlap the composer");
}

try {
  for (let i = 0; i < 2; i++) {
    const context = await createPreviewContext(browser, baseUrl, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }); contexts.push(context);
    owners.push((await decrypt((await context.cookies()).find((cookie) => cookie.name === "__session").value, process.env.AUTH0_SECRET)).payload.user.sub);
  }
  sql = neon(process.env.DATABASE_URL);
  await sql`INSERT INTO bots (id,user_id,name,avatar,job,sandbox_id) VALUES (${botId},${owners[0]},'Atlas','chatComposerSeed123456','Developer','browser-test-no-sandbox')`;
  await sql`INSERT INTO chats (id,user_id,kind) VALUES (${chatId},${owners[0]},'direct')`;
  await sql`INSERT INTO chat_members (chat_id,bot_id) VALUES (${chatId},${botId})`;
  const anonymous = await browser.newContext(); contexts.push(anonymous);
  const foreignPage = await contexts[1].newPage();
  await foreignPage.goto(new URL(`/chats/${chatId}`, baseUrl).href);
  await foreignPage.getByText("This page could not be found.").waitFor();
  await foreignPage.close();
  const deniedPage = await anonymous.newPage();
  await deniedPage.goto(new URL(`/chats/${chatId}`, baseUrl).href);
  await deniedPage.waitForURL(/sign-in/);
  await deniedPage.close();
  const page = await contexts[0].newPage();
  await page.addInitScript(() => {
    window.speechSessions = [];
    class MockSpeechRecognition {
      constructor() { window.speechSessions.push(this); }
      start() {
        if (window.failSpeechStart) throw new Error("Simulated microphone startup failure");
        queueMicrotask(() => this.onstart?.());
      }
      stop() {
        this.stopped = true;
        queueMicrotask(() => {
          if (this.finalWords) this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: this.finalWords } }] });
          this.onend?.();
        });
      }
      abort() { this.aborted = true; }
    }
    window.SpeechRecognition = window.MockSpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = undefined;
  });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", message => { if (/Cannot update a component|THREE\.Clock/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((origin) => {
    const originalFetch = window.fetch;
    window.fetch = (input, init) => originalFetch(typeof input === "string" && input.startsWith("https://api.trigger.dev/") ? input.replace("https://api.trigger.dev", origin) : input, init);
  }, mock.origin);
  const chatUrl = new URL(`/chats/${chatId}`, baseUrl).href;
  await page.goto(chatUrl);
  const input = page.getByRole("textbox", { name: "Message Atlas", exact: true });
  await input.waitFor();
  await page.evaluate(() => document.fonts.ready);
  await checkWelcome(page);
  assert.ok(await page.getByRole("button", { name: "Send message", exact: true }).isDisabled());
  assert.equal(await page.getByRole("region", { name: "Conversation with Atlas" }).locator("[data-slot=input-group]").evaluate((element) => getComputedStyle(element).opacity), "1", "empty composer remains fully visible");
  await page.screenshot({ path: "/tmp/openmods-composer-desktop.png", animations: "disabled" });
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "collapsed");
  // Wait for the sidebar's width transition before checking centering.
  await page.locator('[data-slot="sidebar-gap"]').evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  await checkWelcome(page);
  await page.screenshot({ path: "/tmp/openmods-composer-desktop-collapsed.png", animations: "disabled" });
  assert.equal(await page.evaluate(() => window.speechSessions.length), 0, "microphone never starts automatically");
  await input.fill("Please review");
  await page.getByRole("button", { name: "Dictate message", exact: true }).click();
  await page.getByText("Listening… Tap the microphone to finish.", { exact: true }).waitFor();
  const speechResults = [{ isFinal: true, 0: { transcript: "this patch" } }, { isFinal: false, 0: { transcript: "unfinished" } }];
  await page.evaluate((results) => {
    window.speechSessions.at(-1).onresult({ resultIndex: 0, results });
    window.speechSessions.at(-1).onresult({ resultIndex: 0, results });
  }, speechResults);
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "Please review this patch");
  assert.equal(await input.inputValue(), "Please review this patch", "dictation appends once and ignores interim results");
  await input.fill("Please review this patch carefully");
  await page.evaluate(() => window.speechSessions.at(-1).onresult({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: "this patch" } }, { isFinal: true, 0: { transcript: "and explain." } }] }));
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "Please review this patch carefully and explain.");
  assert.equal(await input.inputValue(), "Please review this patch carefully and explain.", "dictation preserves edits made while listening");
  assert.equal(requests.length, 0, "dictation does not submit the draft");
  await page.getByRole("button", { name: "Stop dictation", exact: true }).click();
  await page.getByRole("button", { name: "Dictate message", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.speechSessions.at(-1).stopped), "mic stops the recognition session");
  await input.fill("");
  await page.getByRole("button", { name: "Dictate message", exact: true }).click();
  await page.getByText("Listening… Tap the microphone to finish.", { exact: true }).waitFor();
  await page.evaluate(() => { window.speechSessions.at(-1).finalWords = "Final words before stopping"; });
  await page.getByRole("button", { name: "Stop dictation", exact: true }).click();
  await page.getByRole("button", { name: "Dictate message", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "Final words before stopping", "normal stop includes final captured words");
  for (const [code, message] of [["not-allowed", "Microphone access was denied."], ["network", "Voice input couldn’t connect."]]) {
    await page.getByRole("button", { name: "Dictate message", exact: true }).click();
    await page.getByText("Listening… Tap the microphone to finish.", { exact: true }).waitFor();
    await page.evaluate((error) => window.speechSessions.at(-1).onerror({ error }), code);
    await page.getByRole("alert").filter({ hasText: message }).waitFor();
    assert.equal(await input.inputValue(), "Final words before stopping", "microphone errors preserve the draft");
    assert.ok(await page.evaluate(() => window.speechSessions.at(-1).aborted), "failed recording is released");
  }
  await page.evaluate(() => { window.SpeechRecognition = undefined; });
  await page.getByRole("button", { name: "Dictate message", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Voice input isn’t supported" }).waitFor();
  await page.evaluate(() => { window.SpeechRecognition = window.MockSpeechRecognition; window.failSpeechStart = true; });
  await page.getByRole("button", { name: "Dictate message", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Voice input couldn’t start" }).waitFor();
  await page.evaluate(() => { window.failSpeechStart = false; });
  await page.getByRole("button", { name: "Dictate message", exact: true }).click();
  await page.getByText("Listening… Tap the microphone to finish.", { exact: true }).waitFor();
  await input.fill("x".repeat(11999));
  await page.evaluate(() => window.speechSessions.at(-1).onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Additional words" } }] }));
  assert.equal((await input.inputValue()).length, 12000, "dictation respects the message limit");
  await page.getByRole("button", { name: "Plan a task", exact: true }).click();
  assert.ok(await page.evaluate(() => window.speechSessions.at(-1).aborted), "choosing a starter ends recording");
  assert.match(await input.inputValue(), /implementation plan/);
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Message Atlas");
  assert.ok(await input.evaluate((element) => element === document.activeElement), "starter focuses the input");
  await checkWelcome(page, { compact: false });
  assert.equal(requests.length, 0, "starter selection does not send a message");
  await page.getByRole("button", { name: "Starter prompts", exact: true }).click();
  await page.getByRole("menuitem", { name: "Review some code" }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  assert.match(await input.inputValue(), /Review this code/);
  assert.ok(await input.evaluate((element) => element === document.activeElement), "menu returns focus to the input");
  await input.fill("Plan the fix");
  await input.press("Shift+Enter"); await input.press("a");
  assert.match(await input.inputValue(), /\n/); assert.equal(requests.length, 0);
  await page.getByRole("button", { name: "Reply style", exact: true }).click();
  await page.getByRole("menuitem", { name: "Concise", exact: true }).click();
  await page.getByRole("button", { name: "Dictate message", exact: true }).click();
  await page.getByText("Listening… Tap the microphone to finish.", { exact: true }).waitFor();
  await page.evaluate(() => { window.lateSpeechResult = window.speechSessions.at(-1).onresult; });
  const originalInput = await input.elementHandle();
  await input.press("Enter");
  await page.getByRole("button", { name: "Stop response", exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Dictate message", exact: true }).isDisabled(), "mic is disabled while sending");
  assert.ok(await page.evaluate(() => window.speechSessions.at(-1).aborted), "sending ends microphone capture");
  await page.evaluate(() => window.lateSpeechResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "late words" } }] }));
  assert.equal(await input.inputValue(), "", "late speech events cannot change a new draft after sending");
  await checkDocked(page);
  assert.ok(await originalInput.evaluate((element) => element.isConnected && element === document.activeElement), "docking preserves the original input and keyboard focus");
  assert.equal(await page.getByRole("region", { name: "Conversation with Atlas" }).locator("[data-chat-composer-motion]").evaluate((element) => getComputedStyle(element).transform), "none", "reduced motion skips the docking transform");
  await page.getByText("Here’s a practical plan", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await checkDocked(page);
  assert.equal(requests[0].chatId, chatId); assert.equal(requests[0].style, "concise");
  assert.equal(await page.locator("ol").evaluate((element) => getComputedStyle(element).listStyleType), "decimal", "markdown lists retain numbering");
  await page.screenshot({ path: "/tmp/openmods-composer-reply.png", animations: "disabled" });
  mock.mode = "slow"; await input.fill("A second question"); await input.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".is-assistant")].length >= 2);
  await page.getByRole("button", { name: "Stop response", exact: true }).click();
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await checkDocked(page);
  mock.mode = "fail"; await input.fill("Keep this question for retry"); await input.press("Enter");
  const chatAlert = page.getByRole("region", { name: "Conversation with Atlas" }).getByRole("alert");
  await chatAlert.waitFor();
  await checkDocked(page);
  await page.getByText("Keep this question for retry", { exact: true }).waitFor();
  mock.mode = "reply"; await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("button", { name: "Stop response", exact: true }).waitFor();
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  assert.equal(await page.getByText("Keep this question for retry", { exact: true }).count(), 1);
  assert.equal(await chatAlert.count(), 0);
  await checkDocked(page);
  mock.mode = "long"; await input.fill("Explain in detail"); await input.press("Enter");
  await page.getByRole("button", { name: "Stop response", exact: true }).waitFor();
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await checkDocked(page);
  const scroller = page.getByRole("log", { name: "Chat messages" }).locator(":scope > div").first();
  await scroller.evaluate((element) => { element.scrollTop = 0; });
  await page.getByRole("button", { name: "Jump to latest message", exact: true }).click();
  await page.waitForFunction(() => {
    const element = document.querySelector('[role="log"] > div');
    return element && element.scrollHeight - element.scrollTop - element.clientHeight < 2;
  });
  await checkDocked(page);
  await page.reload(); await input.waitFor();
  await checkDocked(page);
  assert.equal(await page.getByText("Keep this question for retry", { exact: true }).count(), 1, "history survives reload");
  mock.reset(); await page.reload(); await input.waitFor();
  for (const [width, height] of [[390, 844], [320, 568], [390, 400]]) {
    await page.setViewportSize({ width, height });
    await checkWelcome(page);
    await page.screenshot({ path: `/tmp/openmods-composer-empty-${width}-${height}.png`, animations: "disabled" });
    await input.fill("A longer message\n".repeat(15));
    const field = await input.boundingBox();
    assert.ok(field.height <= 160, "long input is capped at 160px");
    assert.ok(await input.evaluate((element) => element.scrollHeight > element.clientHeight), "long input can scroll internally");
    const send = page.getByRole("button", { name: "Send message", exact: true });
    await send.scrollIntoViewIfNeeded();
    const bounds = await send.boundingBox(); assert.ok(bounds.y + bounds.height <= height, "send stays in the viewport");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
    await page.screenshot({ path: `/tmp/openmods-composer-${width}-${height}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Starter prompts", exact: true }).click();
    const menu = await page.getByRole("menu").boundingBox();
    assert.ok(menu.x >= 0 && menu.y >= 0 && menu.x + menu.width <= width && menu.y + menu.height <= height, "mobile menu stays within the viewport");
    await page.getByRole("menu").press("Escape");
    await page.getByRole("menu").waitFor({ state: "hidden" });
    assert.ok(await input.evaluate((element) => element === document.activeElement), "Escape returns focus to the input");
    mock.mode = "reply"; await input.fill("A mobile question"); await input.press("Enter");
    await page.getByRole("button", { name: "Stop response", exact: true }).waitFor();
    await checkDocked(page);
    await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
    await input.fill("A longer follow-up\n".repeat(15));
    await checkDocked(page);
    const dockedSend = await send.boundingBox();
    assert.ok(dockedSend.y >= 0 && dockedSend.y + dockedSend.height <= height, "multiline docked send stays visible");
    await page.screenshot({ path: `/tmp/openmods-composer-docked-${width}-${height}.png`, animations: "disabled" });
    mock.reset(); await page.reload(); await input.waitFor();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload(); await input.waitFor();
  await checkWelcome(page);
  await input.fill("Animate the first message");
  await page.evaluate(() => {
    window.composerTransforms = [];
    const sample = () => {
      window.composerTransforms.push(getComputedStyle([...document.querySelectorAll("[data-chat-composer-motion]")].find((element) => element.getClientRects().length)).transform);
      if (window.composerTransforms.length < 45) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await input.press("Enter");
  await page.getByRole("button", { name: "Stop response", exact: true }).waitFor();
  await checkDocked(page);
  assert.ok(await page.evaluate(() => window.composerTransforms.some((transform) => transform !== "none" && transform !== "matrix(1, 0, 0, 1, 0, 0)")), "normal motion animates the first docking transition");
  await input.fill("Keep this follow-up draft");
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "Keep this follow-up draft", "streaming updates preserve the next draft");
  assert.equal(await page.getByRole("region", { name: "Conversation with Atlas" }).locator("[data-chat-composer-motion]").evaluate((element) => getComputedStyle(element).transform), "none", "streaming does not restart the docking animation");
  // Activity hides the route and cleans up its effects while preserving draft state.
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).first().click();
  await page.getByRole("button", { name: "Dictate message", exact: true }).click();
  await page.getByText("Listening… Tap the microphone to finish.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "OpenMods", exact: true }).click();
  await page.waitForURL(new URL("/dashboard", baseUrl).href);
  await page.waitForFunction(() => window.speechSessions.at(-1).aborted === true);
  await page.goBack(); await page.waitForURL(chatUrl); await input.waitFor();
  assert.equal(await page.getByRole("button", { name: "Dictate message", exact: true }).getAttribute("aria-pressed"), "false", "returning to a preserved chat resets the microphone UI");
  assert.equal(await input.inputValue(), "Keep this follow-up draft", "navigation preserves the draft without restarting dictation");
  assert.ok(await page.evaluate(() => window.speechSessions.every((session) => session.aborted)), "returning never resumes recording automatically");
  // Images use the same composer and survive transcript reloads and retries.
  await input.fill("");
  const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#00aa55" } }).png().toBuffer();
  const upload = page.getByLabel("Upload files", { exact: true });
  const imageFile = { name: "green.png", mimeType: "image/png", buffer: png };
  await page.getByRole("button", { name: "Starter prompts", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Add photos", exact: true }).click();
  await (await chooser).setFiles(imageFile);
  await page.getByRole("img", { name: "green.png", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Send message", exact: true }).isEnabled(), true, "images can be sent without text");
  await page.getByRole("button", { name: "Remove green.png", exact: true }).click();
  assert.equal(await page.getByRole("group", { name: "Attached images", exact: true }).count(), 0);
  await upload.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await page.getByText("Add up to 4 PNG, JPEG, WebP, or GIF images, up to 10 MB each.", { exact: true }).waitFor();
  await upload.setInputFiles(Array.from({ length: 5 }, (_, index) => ({ ...imageFile, name: `image-${index}.png` })));
  assert.equal(await page.getByRole("group", { name: "Attached images", exact: true }).getByRole("img").count(), 4, "overflow keeps only the allowed four files");
  while (await page.getByRole("button", { name: /^Remove image-/ }).count()) await page.getByRole("button", { name: /^Remove image-/ }).first().click();
  await upload.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("invalid image") });
  await input.fill("Keep this draft");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Couldn’t prepare this image. Try a smaller PNG, JPEG, WebP, or GIF.", { exact: true }).waitFor();
  assert.equal(await input.inputValue(), "Keep this draft");
  assert.equal(await page.getByRole("button", { name: "Remove broken.png", exact: true }).count(), 1, "preparation failure preserves attachments");
  await page.getByRole("button", { name: "Remove broken.png", exact: true }).click();
  await input.fill("");
  async function insertImage(eventName) {
    await input.evaluate((element, { encoded, eventName }) => {
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], `${eventName}.png`, { type: "image/png" }));
      element.dispatchEvent(eventName === "paste" ? new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }) : new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }, { encoded: png.toString("base64"), eventName });
  }
  await insertImage("paste");
  await insertImage("drop");
  assert.equal(await page.getByRole("group", { name: "Attached images", exact: true }).getByRole("img").count(), 2);
  await page.screenshot({ path: "/tmp/openmods-images-desktop.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/openmods-images-mobile.png", animations: "disabled" });
  const sendBounds = await page.getByRole("button", { name: "Send message", exact: true }).boundingBox();
  assert.ok(sendBounds.x >= 0 && sendBounds.x + sendBounds.width <= 390 && sendBounds.y + sendBounds.height <= 844, "image composer controls fit a small phone");
  const beforeImages = requests.length;
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Stop response", exact: true }).waitFor();
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  assert.equal(requests.length, beforeImages + 1);
  const sentImages = requests.at(-1).message.parts.filter(part => part.type === "file");
  assert.equal(sentImages.length, 2);
  assert.ok(sentImages.every(part => part.mediaType === "image/jpeg" && part.url.startsWith("data:image/jpeg;base64,")), "normalized image bytes reach the chat transport");
  assert.equal(await page.getByRole("group", { name: "Attached images", exact: true }).count(), 0);
  await page.reload(); await input.waitFor();
  assert.equal(await page.getByRole("img", { name: /^(paste|drop)\.jpg$/ }).count(), 2, "saved image messages reload");
  const assistantCount = mock.histories.get(chatId).filter(message => message.role === "assistant").length;
  mock.delaySnapshot(chatId, 2);
  await page.reload(); await input.waitFor();
  await input.fill("Keep this draft while history catches up");
  await page.waitForFunction(count => document.querySelectorAll(".is-assistant").length === count, assistantCount);
  assert.equal(await input.inputValue(), "Keep this draft while history catches up", "recovery from a late snapshot preserves the new draft");
  assert.equal(await page.getByRole("img", { name: /^(paste|drop)\.jpg$/ }).count(), 2);
  const [chat] = await sql`SELECT last_message_preview FROM chats WHERE id=${chatId}`;
  assert.equal(chat.last_message_preview, null, "transcripts are stored by Trigger.dev, without changing chat preview rows");
  assert.deepEqual(errors, []);
  console.log("Composer passed: image upload/paste/drop, previews/removal, image-only send, validation/preparation failures, transport and transcript persistence; no render-time state updates or Clock warnings; desktop/mobile layout, dictation, keyboard, streaming, retry. Synthetic local sessions and mock streaming; no live microphone, OAuth or OpenAI call.");
} catch (error) {
  const page = contexts[0]?.pages()[0];
  if (page) await page.screenshot({ path: "/tmp/openmods-composer-failure.png" });
  throw error;
} finally {
  if (sql) { await sql`DELETE FROM chats WHERE id=${chatId}`; await sql`DELETE FROM bots WHERE id=${botId}`; }
  next.kill("SIGTERM");
  await mock.close();
  await Promise.all(contexts.map((context) => context.close())); await browser.close();
}
