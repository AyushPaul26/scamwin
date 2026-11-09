import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

// Read-only localhost browser coverage. No Auth0 bypass or production writes.
const base = new URL(process.argv[2] || "http://localhost:3000");
if (base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error("Scamwin UI checks only support a local HTTP server.");
const output = join(tmpdir(), "scamwin-ui-evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const errors = [];
const networkErrors = [];
let checks = 0;
try {
  for (const width of process.env.SCAMWIN_UI_WIDTHS ? process.env.SCAMWIN_UI_WIDTHS.split(",").map(Number) : [1440, 375, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("requestfailed", request => networkErrors.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on("console", message => { if (message.type() === "error") networkErrors.push({ console: message.text().slice(0, 500) }); });
    async function visit(path) {
      await page.goto(new URL(path, base).href, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.locator("main").waitFor();
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${path} fits ${width}px`);
      assert.equal(await page.locator("main").count(), 1);
      assert.ok(await page.title(), `${path} has a document title`);
      checks++;
      console.log(JSON.stringify({ width, path, status: "rendered" }));
    }
    await visit("/");
    await page.screenshot({ path: join(output, `landing-${width}.png`), fullPage: true });
    assert.ok(await page.getByRole("link", { name: "Check an offer", exact: true }).count());
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
    await visit("/demo");
    await page.getByRole("heading", { name: "This action carries a high risk." }).waitFor({ timeout: 60000 });
    assert.equal(await page.getByRole("button", { name: "Delete", exact: true }).count(), 0, "Demo has no delete mutation");
    assert.equal(await page.getByRole("button", { name: "Ask", exact: true }).count(), 0, "Demo has no follow-up mutation");
    await page.getByRole("link", { name: "Evidence 6" }).first().click();
    assert.equal(await page.locator("details[open]").count(), 1, "Evidence links disclose their source");
    await page.getByRole("button", { name: "Missing evidence", exact: true }).click();
    await page.getByRole("heading", { name: "There isn’t enough evidence to decide." }).waitFor();
    await page.getByText("Destination not observed", { exact: true }).waitFor();
    await page.screenshot({ path: join(output, `limited-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Comparison offer", exact: true }).click();
    await page.getByRole("heading", { name: "No red flags in the completed checks." }).waitFor();
    for (const path of ["/check", "/checks", "/account", "/warnings", "/review", "/operations"]) await visit(path);
    await context.close();
  }
  // Synthetic bootstrap is a browser-only response fixture for form validation.
  // The server remains signed out; no valid mutation is submitted.
  const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
  const page = await context.newPage();
  await page.route("**/api/scamwin/bootstrap", route => route.fulfill({ json: { configured: true, user: { name: "Synthetic test session", sub: "synthetic-browser-fixture" }, role: "user", readiness: [] } }));
  await page.goto(new URL("/check", base).href, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator("#offer-url").waitFor();
  assert.ok((await page.locator("#offer-url").boundingBox()).width > 250, "Mobile form inputs fill their field");
  assert.ok((await page.locator("#offer-images").boundingBox()).width <= 1, "The native file input stays visually hidden behind its accessible picker");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "The signed-in form fits the mobile viewport");
  await page.getByRole("button", { name: "Check this offer" }).click();
  await page.getByText("Add a link, message or screenshot to check.", { exact: true }).waitFor();
  assert.equal(await page.locator("#offer-message").evaluate(el => el === document.activeElement), true, "First invalid field receives focus");
  await page.getByLabel("Offer link", { exact: false }).fill("http://localhost/private");
  await page.getByRole("button", { name: "Check this offer" }).click();
  await page.getByText("Enter one public HTTP or HTTPS link without credentials or a custom port.", { exact: true }).waitFor();
  await page.getByLabel("What might you do?", { exact: false }).selectOption("receive_money");
  assert.equal(await page.locator("#offer-action").inputValue(), "receive_money", "Intended action is an explicit deterministic token");
  assert.ok((await page.locator(".sw-preview .sw-journey").innerText()).includes("Receive money"));
  await page.getByRole("link", { name: "My checks", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "My checks");
  assert.equal(await page.locator("#offer-url").inputValue(), "http://localhost/private", "Unsaved form survives navigation cancellation");
  await page.locator("#offer-url").fill("https://example.com/offer");
  await page.locator("#offer-message").fill("Synthetic browser test offer; no real personal data.");
  await page.getByRole("button", { name: "Check this offer" }).click();
  await page.getByText("Sign in to use your private checks.", { exact: false }).waitFor();
  assert.equal(await page.locator("#offer-message").inputValue(), "Synthetic browser test offer; no real personal data.", "Server authentication rejection preserves the draft");
  await page.screenshot({ path: join(output, "intake-validation-375.png"), fullPage: true });
  checks += 12;
  await context.close();
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(JSON.stringify({ checks, status: "passed", screenshots: output, coverage: "Read-only keyless pages, synthetic demos, keyboard, 320/375/1440px, synthetic client validation and unsaved navigation" }, null, 2));
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page) {
    await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ url: page.url(), headings: await page.locator("h1").allTextContents(), notices: await page.locator(".sw-notice").allTextContents(), overflow: await page.evaluate(() => [...document.querySelectorAll(".sw *")].map(element => ({ name: element.tagName, class: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })).filter(item => item.right > innerWidth + 1).slice(0, 12)), browserErrors: errors, networkErrors }, null, 2));
  }
  throw error;
} finally { await browser.close(); }
