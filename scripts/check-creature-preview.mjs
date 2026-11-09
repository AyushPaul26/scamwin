import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { createPreviewContext } from "./creature-preview-session.mjs";
import { AVAILABLE_CREATURE_IDS, CREATURE_CATALOG, CREATURE_VARIANTS } from "../lib/creatures/catalog.ts";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3001";
const outputDirectory = process.env.CREATURE_SCREENSHOT_DIR ?? "/tmp/openmods-creature-review";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];

async function pixelsDiffer(first, second, minimum = 25) {
  const a = await sharp(first).removeAlpha().raw().toBuffer();
  const b = await sharp(second).removeAlpha().raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) changed += 1;
  }
  return changed > minimum;
}

async function setup(options = {}, intercept) {
  const context = await createPreviewContext(browser, baseUrl, options);
  if (intercept) await intercept(context);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/dashboard/avatar-preview`);
  const avatar = page.locator("[data-review-stage] [data-creature]");
  return { context, page, avatar };
}

try {
  await mkdir(outputDirectory, { recursive: true });
  const { context, page, avatar } = await setup({ viewport: { width: 1280, height: 1024 } });
  await avatar.locator("canvas").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-renderer-status='ready']"));
  const hello = page.getByRole("button", { name: "Moss otter. Say hello", exact: true });
  const canvas = avatar.locator("canvas");
  const portraits = page.locator("footer img");
  assert.ok(await portraits.evaluate((image) => image.complete && image.naturalWidth > 0));
  assert.equal(await page.locator("canvas").count(), 1, "portrait must not create another canvas");
  await page.screenshot({ path: `${outputDirectory}/desktop.png`, fullPage: true });

  const resting = await canvas.screenshot();
  const bounds = await hello.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.92, bounds.y + bounds.height * 0.28);
  await page.waitForTimeout(450);
  assert.ok(await pixelsDiffer(resting, await canvas.screenshot()), "gaze/idle should change the rendered model");
  await hello.click();
  assert.equal(await avatar.getAttribute("data-creature-state"), "greeting");
  await page.waitForTimeout(600);
  await hello.click();
  // A second click cannot queue a second greeting; the first must finish on time.
  await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-creature-state='idle']"), null, { timeout: 6000 });
  await page.waitForTimeout(250);
  assert.equal(await avatar.getAttribute("data-creature-state"), "idle");
  await hello.focus();
  await page.keyboard.press("Enter");
  assert.equal(await avatar.getAttribute("data-creature-state"), "greeting");
  await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-creature-state='idle']"));
  await page.keyboard.press("Space");
  assert.equal(await avatar.getAttribute("data-creature-state"), "greeting");

  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  assert.equal(await avatar.getAttribute("data-creature-state"), "paused");
  await page.waitForTimeout(150);
  const paused = await canvas.screenshot();
  await page.waitForTimeout(400);
  assert.ok(!(await pixelsDiffer(paused, await canvas.screenshot())), "paused canvas must stay still");
  await page.getByRole("button", { name: "Resume motion", exact: true }).click();

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-creature-state='paused']"));
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
    document.body.style.paddingBottom = "1800px";
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-creature-state='paused']"));
  await page.evaluate(() => { document.body.style.paddingBottom = ""; window.scrollTo(0, 0); });
  await page.waitForFunction(() => !document.querySelector("[data-review-stage] [data-creature-state='paused']"));

  const openDialog = page.getByRole("button", { name: "See the smaller view", exact: true });
  await openDialog.click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("[data-renderer-status='ready']").waitFor();
  assert.equal(await avatar.getAttribute("data-creature-state"), "paused", "background must pause during dialog");
  await page.screenshot({ path: `${outputDirectory}/dialog.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await openDialog.evaluate((element) => document.activeElement === element));
  for (let i = 0; i < 2; i += 1) {
    await openDialog.click();
    await dialog.locator("[data-renderer-status='ready']").waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  assert.equal(await page.locator("canvas").count(), 1, "closed dialogs must dispose their canvas");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector("[data-renderer-status='reduced-motion']"));
  assert.equal(await page.locator("canvas").count(), 0);
  assert.ok(await avatar.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await avatar.locator("canvas").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-renderer-status='ready']"));
  await page.getByRole("button", { name: "lagoon colors", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-creature-variant='lagoon'][data-renderer-status='ready']"));
  assert.match(await portraits.getAttribute("src"), /moss-otter-lagoon.webp/);
  await page.screenshot({ path: `${outputDirectory}/lagoon.png`, fullPage: true });
  await page.getByRole("button", { name: "blossom colors", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-creature-variant='blossom'][data-renderer-status='ready']"));
  await page.screenshot({ path: `${outputDirectory}/blossom.png`, fullPage: true });
  await avatar.locator("canvas").evaluate((element) => element.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
  await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-renderer-status='fallback']"));
  assert.ok(await avatar.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0));
  await context.close();

  const collection = await setup({ viewport: { width: 1280, height: 1024 } });
  const modelRequests = [];
  collection.context.on("request", (request) => {
    if (request.url().endsWith(".glb")) modelRequests.push(new URL(request.url()).pathname);
  });
  for (const species of AVAILABLE_CREATURE_IDS) {
    const name = CREATURE_CATALOG[species].name;
    const beforeSelection = modelRequests.length;
    await collection.page.getByRole("button", { name: `Choose ${name}`, exact: true }).click();
    await collection.page.waitForFunction((id) => document.querySelector(`[data-review-stage] [data-creature='${id}'][data-renderer-status='ready']`), species);
    assert.ok(modelRequests.slice(beforeSelection).every((path) => path === `/creatures/v1/${species}.glb`), "only the selected model should load");
    const afterSelection = modelRequests.length;
    for (const variant of CREATURE_VARIANTS) {
      await collection.page.getByRole("button", { name: `${variant} colors`, exact: true }).click();
      await collection.page.waitForFunction(({ id, color }) => document.querySelector(`[data-review-stage] [data-creature='${id}'][data-creature-variant='${color}'][data-renderer-status='ready']`), { id: species, color: variant });
      const portrait = collection.page.locator("footer img");
      assert.match(await portrait.getAttribute("src"), new RegExp(`${species}-${variant}\\.webp`));
      await portrait.evaluate((image) => image.decode());
      assert.equal(await collection.page.locator("canvas").count(), 1);
      await collection.avatar.screenshot({ path: `${outputDirectory}/${species}-${variant}.png` });
    }
    assert.equal(modelRequests.length, afterSelection, "color changes reuse the selected GLB");
    const hello = collection.page.getByRole("button", { name: `${name}. Say hello`, exact: true });
    const beforeGreeting = await collection.avatar.screenshot();
    await hello.click();
    assert.equal(await collection.avatar.getAttribute("data-creature-state"), "greeting");
    await collection.page.waitForTimeout(650);
    const greetingFrame = await collection.avatar.screenshot({ path: `${outputDirectory}/${species}-greeting.png` });
    assert.ok(await pixelsDiffer(beforeGreeting, greetingFrame), `${species} greeting should move its model`);
    await collection.page.waitForFunction(() => document.querySelector("[data-review-stage] [data-creature-state='idle']"));
  }
  await collection.context.close();

  const mobile = await setup({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.page.waitForFunction(() => document.querySelector("[data-review-stage] [data-renderer-status='ready']"));
  assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await mobile.page.getByRole("button", { name: "Moss otter. Say hello", exact: true }).tap();
  assert.equal(await mobile.avatar.getAttribute("data-creature-state"), "greeting");
  await mobile.page.screenshot({ path: `${outputDirectory}/mobile.png`, fullPage: true });
  await mobile.page.getByRole("button", { name: "See the smaller view", exact: true }).tap();
  await mobile.page.getByRole("dialog").locator("[data-renderer-status='ready']").waitFor();
  await mobile.page.screenshot({ path: `${outputDirectory}/mobile-dialog.png`, fullPage: true });
  assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await mobile.page.getByRole("button", { name: "Back to the collection", exact: true }).tap();
  await mobile.page.getByRole("dialog").waitFor({ state: "hidden" });
  for (const species of AVAILABLE_CREATURE_IDS) {
    const name = CREATURE_CATALOG[species].name;
    await mobile.page.getByRole("button", { name: `Choose ${name}`, exact: true }).tap();
    await mobile.page.waitForFunction((id) => document.querySelector(`[data-review-stage] [data-creature='${id}'][data-renderer-status='ready']`), species);
    await mobile.page.getByRole("button", { name: `${name}. Say hello`, exact: true }).tap();
    assert.equal(await mobile.avatar.getAttribute("data-creature-state"), "greeting");
    assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  await mobile.context.close();

  const reducedRequests = [];
  const reduced = await setup({ reducedMotion: "reduce" }, async (context) => {
    context.on("request", (request) => { if (request.url().endsWith(".glb")) reducedRequests.push(request.url()); });
  });
  await reduced.page.waitForFunction(() => document.querySelector("[data-renderer-status='reduced-motion']"));
  assert.equal(reducedRequests.length, 0, "reduced-motion visits should not fetch a model");
  await reduced.context.close();

  const failed = await setup({}, (context) => context.route("**/moss-otter.glb", (route) => route.abort()));
  await failed.page.waitForFunction(() => document.querySelector("[data-review-stage] [data-renderer-status='fallback']"));
  assert.ok(await failed.avatar.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0));
  assert.equal(await failed.page.locator("canvas").count(), 0);
  await failed.context.close();

  // React reports an intentionally rejected model load to its error boundary.
  const unexpected = errors.filter((message) => !/moss-otter\.glb|Failed to fetch/.test(message));
  assert.deepEqual(unexpected, [], "unexpected browser errors");
  console.log(`Creature preview checks passed. Screenshots: ${outputDirectory}`);
} finally {
  await browser.close();
}
