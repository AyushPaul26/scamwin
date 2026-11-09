import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { createPreviewContext } from "./creature-preview-session.mjs";
import { readFile } from "node:fs/promises";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const species = process.argv[3] ?? "moss-otter";
if (!/^[a-z]+(?:-[a-z]+)+$/.test(species)) throw new Error("Invalid creature ID");
await readFile(`public/creatures/v1/${species}.glb`);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const context = await createPreviewContext(browser, baseUrl, { viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${baseUrl}/dashboard/avatar-preview?capture=1&species=${species}`);
  await page.addStyleTag({ content: "[data-review-stage], [data-review-stage] > [data-creature] { width: 512px !important; height: 512px !important; }" });
  await mkdir("public/creatures/v1", { recursive: true });
  for (const variant of ["fern", "lagoon", "blossom"]) {
    await page.getByRole("button", { name: `${variant} colors`, exact: true }).click();
    const canvas = page.locator("[data-review-stage] canvas");
    await canvas.waitFor({ state: "visible", timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("[data-review-stage] [data-renderer-status='ready']"));
    // Allow the material update and fixed capture frame to reach the drawing buffer.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const data = await canvas.evaluate((element) => element.toDataURL("image/png"));
    const path = `public/creatures/v1/${species}-${variant}.webp`;
    await sharp(Buffer.from(data.split(",")[1], "base64")).resize(512, 512).webp({ quality: 92, alphaQuality: 100 }).toFile(path);
    console.log(`Rendered ${path}`);
  }
} finally {
  await browser.close();
}
