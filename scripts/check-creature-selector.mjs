import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { CREATURE_CATALOG, CREATURE_IDS } from "../lib/creatures/catalog.ts";
import { createPreviewContext } from "./creature-preview-session.mjs";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3001";
const outputDirectory = process.env.CREATURE_SELECTOR_SCREENSHOT_DIR ?? "/tmp/openmods-creature-selector";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];

async function setup(options = {}) {
  const context = await createPreviewContext(browser, baseUrl, options);
  const models = [];
  context.on("request", (request) => { if (request.url().endsWith(".glb")) models.push(new URL(request.url()).pathname); });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/dashboard`);
  const selector = page.locator("main [data-creature-selector]");
  await selector.waitFor();
  const carousel = selector.getByRole("region", { name: "Choose your creature", exact: true });
  return { context, page, selector, carousel, models };
}

async function selected(selector, id, reduced = false) {
  await selector.locator(`[data-creature='${id}'][data-renderer-status='${reduced ? "reduced-motion" : "ready"}']`).waitFor();
  assert.equal(await selector.getAttribute("data-selected-creature"), id);
  assert.equal(await selector.locator("canvas").count(), reduced ? 0 : 1, "only the active character creates a canvas");
}

async function choose(selector, id, reduced = false) {
  await selector.getByRole("button", { name: `Choose ${CREATURE_CATALOG[id].name}`, exact: true }).click();
  await selected(selector, id, reduced);
}

async function controlsFit(page, selector) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page overflow");
  const bounds = await selector.locator("[data-diagonal-carousel]").boundingBox();
  for (const button of await selector.locator("[data-carousel-controls] button").all()) {
    const rect = await button.boundingBox();
    assert.ok(rect && rect.width >= 24 && rect.height >= 24, "controls need usable touch targets");
    assert.ok(rect.x >= bounds.x - 1 && rect.x + rect.width <= bounds.x + bounds.width + 1, "all seven choices and both arrows must fit the clipped carousel");
  }
}

async function compactDialogFits(page, dialog, species, variant) {
  const avatar = dialog.locator("[data-creature]");
  await dialog.locator(`[data-creature='${species}'][data-renderer-status='ready']`).waitFor();
  assert.equal(await avatar.count(), 1, "the dialog shows only the selected avatar");
  assert.equal(await dialog.locator("[data-creature-selector], [data-diagonal-carousel]").count(), 0, "selection stays on the dashboard");
  assert.equal(await avatar.getAttribute("data-creature-variant"), variant);
  const avatarBounds = await avatar.boundingBox();
  assert.ok(avatarBounds && avatarBounds.width <= 80 && avatarBounds.height <= 80, "the dialog avatar is compact");
  assert.ok(await dialog.evaluate((element) => element.scrollHeight <= element.clientHeight + 1), "the dialog fits without vertical scrolling");
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, "the whole dialog stays within the viewport");
  for (const control of await dialog.locator("input:not([type='hidden']), textarea, button[type='submit']").all()) {
    const rect = await control.boundingBox();
    assert.ok(rect && rect.y >= bounds.y && rect.y + rect.height <= bounds.y + bounds.height, "fields and submission are visible without scrolling");
  }
}

async function swipeLeft(page, carousel) {
  const box = await carousel.locator("[data-carousel-active]").boundingBox();
  const x = box.x + box.width * 0.72;
  const y = box.y + box.height * 0.5;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 5; step += 1) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - step * 20, y }] });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
}

try {
  await mkdir(outputDirectory, { recursive: true });
  const desktop = await setup({ viewport: { width: 1280, height: 900 } });
  const { page, selector, carousel } = desktop;
  for (const id of CREATURE_IDS) {
    await choose(selector, id);
    assert.equal(await selector.getByRole("button", { name: `Choose ${CREATURE_CATALOG[id].name}`, exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await selector.locator("[data-carousel-slide][data-active='false'] canvas").count(), 0);
  }
  await controlsFit(page, selector);
  await carousel.focus();
  await page.keyboard.press("Home");
  await selected(selector, "moss-otter");
  assert.ok(await carousel.getByRole("button", { name: "Previous creature", exact: true }).isDisabled());
  await page.keyboard.press("ArrowRight");
  await selected(selector, "ember-gecko");
  await page.keyboard.press("End");
  await selected(selector, "spark-jerboa");
  assert.ok(await carousel.getByRole("button", { name: "Next creature", exact: true }).isDisabled());
  await page.keyboard.press("ArrowLeft");
  await selected(selector, "dusk-rabbit");
  await page.keyboard.press("Home");
  await selected(selector, "moss-otter");

  // Respect the deliberate-hover cooldown, then move a real mouse onto a side
  // character. Keeping it still must not cause a chain of automatic selections.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(950);
  const neighbor = await carousel.getByRole("button", { name: "Preview Ember gecko", exact: true }).boundingBox();
  await page.mouse.move(neighbor.x + neighbor.width / 2, neighbor.y + neighbor.height / 2, { steps: 5 });
  await selected(selector, "ember-gecko");
  await page.waitForTimeout(1500);
  assert.equal(await selector.getAttribute("data-selected-creature"), "ember-gecko", "stationary pointer must not cascade through characters");
  await carousel.getByRole("button", { name: "Next creature", exact: true }).click();
  await selected(selector, "cloud-bat");
  await carousel.getByRole("button", { name: "Previous creature", exact: true }).click();
  await selected(selector, "ember-gecko");
  await selector.getByRole("button", { name: "Bot avatar. Say hello", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await selector.locator("[data-creature]").getAttribute("data-creature-state"), "greeting");
  await page.keyboard.press("ArrowRight");
  await selected(selector, "cloud-bat");
  assert.ok(await carousel.evaluate((element) => document.activeElement === element), "switching from the greeting button preserves keyboard focus on the carousel");
  await page.keyboard.press("ArrowRight");
  await selected(selector, "tide-axolotl");
  await page.screenshot({ path: `${outputDirectory}/desktop.png`, fullPage: true });
  const desktopVariant = await selector.locator("[data-creature]").getAttribute("data-creature-variant");
  await page.getByRole("button", { name: "Create a new bot", exact: true }).click();
  const desktopDialog = page.getByRole("dialog", { name: "Create your bot", exact: true });
  await compactDialogFits(page, desktopDialog, "tide-axolotl", desktopVariant);
  await page.screenshot({ path: `${outputDirectory}/dialog-desktop.png`, fullPage: true });
  await desktop.context.close();
  console.log("Desktop selection passed: all seven creatures, arrows, keyboard, deliberate hover, greeting, and one canvas.");

  for (const width of [390, 320]) {
    const mobile = await setup({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    await choose(mobile.selector, "moss-otter");
    await controlsFit(mobile.page, mobile.selector);
    await mobile.selector.getByRole("button", { name: "Choose Cloud bat", exact: true }).tap();
    await selected(mobile.selector, "cloud-bat");
    await mobile.selector.getByRole("button", { name: "Bot avatar. Say hello", exact: true }).tap();
    assert.equal(await mobile.selector.locator("[data-creature]").getAttribute("data-creature-state"), "greeting");
    await choose(mobile.selector, "moss-otter");
    await mobile.page.waitForTimeout(900);
    await swipeLeft(mobile.page, mobile.carousel);
    await selected(mobile.selector, "ember-gecko");
    assert.equal(await mobile.selector.locator("[data-creature]").getAttribute("data-creature-state"), "idle", "a swipe must not also greet the new character");
    const variant = await mobile.selector.locator("[data-creature]").getAttribute("data-creature-variant");
    await mobile.page.getByRole("button", { name: "Create a new bot", exact: true }).tap();
    const dialog = mobile.page.getByRole("dialog", { name: "Create your bot", exact: true });
    await compactDialogFits(mobile.page, dialog, "ember-gecko", variant);
    await mobile.page.screenshot({ path: `${outputDirectory}/dialog-${width}.png`, fullPage: true });
    await mobile.context.close();
    console.log(`Mobile selection passed at ${width}px: controls fit, tap, swipe, and compact single-avatar dialog.`);
  }

  const reduced = await setup({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  for (const id of CREATURE_IDS) await choose(reduced.selector, id, true);
  await reduced.carousel.focus();
  await reduced.page.keyboard.press("Home");
  await selected(reduced.selector, "moss-otter", true);
  assert.equal(reduced.models.length, 0, "reduced-motion selection uses portraits without fetching models");
  await reduced.context.close();
  assert.deepEqual(errors, [], "unexpected browser errors");
  console.log(`Creature selector checks passed. Screenshots: ${outputDirectory}`);
} finally {
  await browser.close();
}
