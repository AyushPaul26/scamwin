import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { neon } from '@neondatabase/serverless';
import { Daytona } from '@daytona/sdk';
import { decrypt } from '../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js';
import { createPreviewContext } from './creature-preview-session.mjs';

// Explicit live integration check: provisions a computer, then removes only
// this synthetic owner's records and its matching development sandbox.
const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const browser = await chromium.launch();
let owner, sql;
try {
  const context = await createPreviewContext(browser, baseUrl, { viewport: { width: 1280, height: 900 } });
  owner = (await decrypt((await context.cookies()).find(cookie => cookie.name === '__session').value, process.env.AUTH0_SECRET)).payload.user.sub;
  sql = neon(process.env.DATABASE_URL);
  const page = await context.newPage();
  await page.goto(new URL('/dashboard', baseUrl).href);
  await page.getByRole('button', { name: 'Create a new bot', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Live creation check');
  await dialog.getByLabel('What’s their job?', { exact: true }).fill('Verify sandbox provisioning');
  await dialog.getByLabel('Instructions (optional)', { exact: true }).fill('Diagnostic test bot; no user work.');
  console.log('Submitting live bot creation');
  await dialog.getByRole('button', { name: 'Create bot', exact: true }).click();
  await dialog.locator('form[aria-busy="true"]').waitFor();
  assert.ok(await dialog.locator('input:not([type="hidden"]), textarea, button[type="submit"]').evaluateAll(inputs => inputs.every(input => input.disabled)));
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') || !!document.querySelector('[role="dialog"] [role="alert"]'), {}, { timeout: 660000 });
  const [row] = await sql`select id,name,job,instructions,sandbox_id,user_id from bots where user_id=${owner}`;
  if (!row) {
    console.log('Live bot creation failed:', await dialog.getByRole('alert').innerText());
    assert.equal(await dialog.getByLabel('Name', { exact: true }).inputValue(), 'Live creation check');
    throw new Error('Bot was not saved; entered values were preserved.');
  }
  assert.equal(row.name, 'Live creation check');
  assert.equal(row.job, 'Verify sandbox provisioning');
  assert.equal(row.instructions, 'Diagnostic test bot; no user work.');
  assert.equal(row.user_id, owner);
  const memberships = await sql`select chat_members.chat_id from chat_members inner join chats on chats.id=chat_members.chat_id where chat_members.bot_id=${row.id} and chats.user_id=${owner}`;
  assert.equal(memberships.length, 1);
  assert.equal(await dialog.count(), 0);
  console.log('Live bot creation passed: sandbox, bot/chat transaction, ownership, pending state, saved values and dialog close. Synthetic local session; real OAuth is not exercised.');
} finally {
  if (sql && owner) {
    const rows = await sql`select id,sandbox_id from bots where user_id=${owner}`;
    const api = new Daytona({ otelEnabled: false, apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL });
    for (const row of rows) {
      const sandbox = await api.get(row.sandbox_id);
      assert.equal(sandbox.labels.botId, row.id);
      assert.equal(sandbox.labels.environment, 'development');
      await api.delete(sandbox);
    }
    await sql`delete from chats where user_id=${owner}`;
    await sql`delete from bots where user_id=${owner}`;
    console.log('Live test records and sandboxes cleaned');
  }
  await browser.close();
}
