import assert from "node:assert/strict";
import { chromium } from "playwright";

// Browser-only read fixtures. Mutation calls reach the real signed-out server
// and must be rejected before any database write or provider call.
const base = new URL(process.argv[2] || "http://localhost:3000");
if (base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error("Controls checks require a local HTTP server.");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
let checks = 0;
async function fixtureContext(role) {
  const context = await browser.newContext({ viewport: { width: 375, height: 900 }, reducedMotion: "reduce" });
  await context.route("**/api/scamwin/bootstrap", route => route.fulfill({ json: { configured: true, user: { name: "Synthetic controls fixture", sub: "synthetic-client-fixture" }, role, readiness: [] } }));
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  return { context, page };
}

try {
  const admin = await fixtureContext("admin");
  let paused = false;
  await admin.page.route("**/api/scamwin/operations", route => route.fulfill({ json: { state: { investigationPaused: paused, publicationPaused: paused, updatedAt: "2026-11-08T08:00:00.000Z" } } }));
  await admin.page.goto(new URL("/operations", base).href, { waitUntil: "domcontentloaded" });
  await admin.page.getByRole("button", { name: "Pause new checks", exact: true }).waitFor();
  await admin.page.getByRole("button", { name: "Pause new warning signatures", exact: true }).waitFor();
  assert.equal(await admin.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "Admin controls fit mobile");
  await admin.page.getByRole("button", { name: "Pause new checks", exact: true }).click();
  await admin.page.getByText("Sign in to use your private checks.", { exact: false }).waitFor();
  assert.equal(await admin.page.getByRole("button", { name: "Pause new checks", exact: true }).isDisabled(), true, "Unconfirmed pause cannot be repeated before authoritative reload");
  paused = true;
  await admin.page.getByRole("button", { name: "Reload operational state" }).click();
  await admin.page.getByRole("button", { name: "Resume new checks", exact: true }).waitFor();
  await admin.page.getByRole("button", { name: "Resume new warning signatures", exact: true }).waitFor();
  assert.ok((await admin.page.locator("main").innerText()).includes("Already signed transactions still reconcile"));
  checks += 6;
  await admin.context.close();

  const reviewer = await fixtureContext("reviewer");
  await reviewer.page.route("**/api/scamwin/review", route => route.fulfill({ json: { submissions: [{ id: "synthetic-review", hostname: "example.com", summary: "Synthetic review-only warning.", status: "pending", revision: 1, createdAt: "2026-11-08T08:00:00.000Z", consentAt: "2026-11-08T08:00:00.000Z", category: "suspicious_offer", evidence: [] }] } }));
  await reviewer.page.goto(new URL("/review", base).href, { waitUntil: "domcontentloaded" });
  await reviewer.page.getByRole("button", { name: "Request more information", exact: true }).click();
  await reviewer.page.getByText("Add a review reason before recording a decision.", { exact: true }).waitFor();
  await reviewer.page.getByLabel("Review reason", { exact: true }).fill("Please clarify the exact hostname-wide scope.");
  assert.equal(await reviewer.page.locator("input[type=checkbox]").isChecked(), false);
  await reviewer.page.getByRole("button", { name: "Request more information", exact: true }).click();
  await reviewer.page.getByText("Sign in to use your private checks.", { exact: true }).waitFor();
  assert.equal(await reviewer.page.getByLabel("Review reason", { exact: true }).inputValue(), "Please clarify the exact hostname-wide scope.");
  checks += 4;
  await reviewer.context.close();

  const owner = await fixtureContext("user");
  const response = await owner.context.request.get(new URL("/api/scamwin/demo", base).href);
  assert.equal(response.status(), 200);
  const detail = await response.json();
  detail.check.id = "synthetic-owner-check";
  detail.warningSubmissions = [{ id: "synthetic-owner-submission", status: "needs_information", createdAt: "2026-11-08T08:00:00.000Z", reviewReason: "Clarify the hostname scope without personal data." }];
  await owner.page.route("**/api/scamwin/checks/synthetic-owner-check", route => route.fulfill({ json: detail }));
  await owner.page.goto(new URL("/checks/synthetic-owner-check", base).href, { waitUntil: "domcontentloaded" });
  await owner.page.getByText("Your review submissions", { exact: true }).waitFor();
  await owner.page.getByText("Reviewer reason: Clarify the hostname scope without personal data.", { exact: true }).waitFor();
  await owner.page.getByRole("button", { name: "Preview a shared warning" }).click();
  const modalBounds = await owner.page.getByRole("dialog").boundingBox();
  assert.ok(modalBounds && modalBounds.x >= 0 && modalBounds.y >= 0 && modalBounds.x + modalBounds.width <= 375 && modalBounds.y + modalBounds.height <= 900, "The full consent dialog fits inside the mobile visual viewport");
  await owner.page.getByLabel("Redacted summary", { exact: true }).fill("A new synthetic clarification, not an edit of the old packet.");
  await owner.page.getByRole("dialog").locator("input[type=checkbox]").first().check();
  await owner.page.getByRole("dialog").locator("input[type=checkbox]").last().check();
  await owner.page.getByRole("button", { name: "Keep private", exact: true }).click();
  await owner.page.getByRole("button", { name: "Preview a shared warning" }).click();
  assert.equal(await owner.page.getByLabel("Redacted summary", { exact: true }).inputValue(), "", "A new submission starts with a fresh summary");
  assert.equal(await owner.page.getByRole("dialog").locator("input:checked").count(), 0, "A new submission requires fresh evidence selection and consent");
  checks += 5;
  await owner.context.close();

  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(JSON.stringify({ checks, status: "passed", coverage: "Synthetic admin/reviewer/owner read states, real signed-out mutation rejection, mobile controls, review clarification and fresh consent" }, null, 2));
} finally { await browser.close(); }
