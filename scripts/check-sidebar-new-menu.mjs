import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createPreviewContext } from "./creature-preview-session.mjs";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
try {
  for (const width of [1280, 390, 320]) {
    const context = await createPreviewContext(browser, baseUrl, {
      viewport: { width, height: 844 }, reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type()) && message.text().includes("Base UI:")) {
          errors.push(message.text());
        }
      });
      await page.goto(new URL("/dashboard", baseUrl).href);
      if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
      const trigger = page.getByRole("button", { name: "Create new", exact: true });
      await trigger.waitFor();
      if (width >= 768) await page.getByRole("button", { name: "Toggle sidebar rail", exact: true }).click();
      for (const activation of ["click", "Enter", "Space"]) {
        await trigger.click();
        const item = page.getByRole("menuitem", { name: "Create new bot", exact: true });
        if (activation === "click") await item.click();
        else {
          await item.focus();
          await page.keyboard.press(activation);
        }
        const dialog = page.getByRole("dialog", { name: "Create your bot", exact: true });
        await dialog.waitFor();
        assert.equal(await dialog.count(), 1);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.ok(await trigger.evaluate((element) => element === document.activeElement));
      }
      await trigger.click();
      await page.getByRole("menuitem", { name: "Create group chat", exact: true }).click();
      assert.equal(await page.getByRole("dialog", { name: "Create your bot", exact: true }).count(), 0);
      assert.deepEqual(errors, [], "sidebar menu must not emit Base UI warnings or runtime errors");
      console.log(`Sidebar menu passed at ${width}px: click, Enter, Space, focus return, and no Base UI warnings.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
