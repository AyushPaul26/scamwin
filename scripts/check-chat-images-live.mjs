import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { decrypt } from '../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js';
import { createPreviewContext } from './creature-preview-session.mjs';

// Explicit live check: uses the configured development Trigger worker and model.
// Only synthetic local-session data is created; no computer is provisioned.
const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const browser = await chromium.launch();
const botId = randomUUID(), chatId = randomUUID();
let sql, owner;
try {
  const context = await createPreviewContext(browser, baseUrl, { viewport: { width: 1280, height: 900 } });
  if (!process.env.TRIGGER_SECRET_KEY?.startsWith('tr_dev_')) throw new Error('Live image checks require a development Trigger environment.');
  owner = (await decrypt((await context.cookies()).find(cookie => cookie.name === '__session').value, process.env.AUTH0_SECRET)).payload.user.sub;
  sql = neon(process.env.DATABASE_URL);
  await sql`insert into bots (id,user_id,name,avatar,job,sandbox_id) values (${botId},${owner},'Vision check','visionCheckSeed1234567','Describe images','browser-test-no-computer')`;
  await sql`insert into chats (id,user_id,kind) values (${chatId},${owner},'direct')`;
  await sql`insert into chat_members (chat_id,bot_id) values (${chatId},${botId})`;
  const page = await context.newPage();
  page.on('response', response => { if (response.status() >= 400) console.log('Live image HTTP failure', response.status(), new URL(response.url()).pathname.replace(/session_[^/]+/g, '[session]')); });
  page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') console.log('Live image request failure', request.failure()?.errorText); });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Cannot update a component|THREE\.Clock/.test(message.text())) errors.push(message.text()); });
  await page.goto(new URL(`/chats/${chatId}`, baseUrl).href);
  const input = page.getByRole('textbox', { name: 'Message Vision check', exact: true });
  await input.waitFor();
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ff0000' } }).png().toBuffer();
  await page.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'color.png', mimeType: 'image/png', buffer: png });
  await input.fill('What is the dominant color in the attached image? Respond only with the English color name. Do not use tools.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  try {
    await page.getByText('Red', { exact: true }).waitFor({ timeout: 45000 });
  } catch (error) {
    console.log('Live image UI diagnostic', (await page.locator('body').innerText()).slice(-2000));
    await page.screenshot({ path: '/tmp/openmods-live-image-failure.png' });
    throw error;
  }
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
  assert.equal(await page.getByRole('img', { name: 'color.jpg', exact: true }).count(), 1);
  await page.reload(); await input.waitFor();
  try {
    await page.getByText('Red', { exact: true }).waitFor();
  } catch (error) {
    console.log('Reload UI diagnostic', (await page.locator('body').innerText()).slice(-2000));
    await page.screenshot({ path: '/tmp/openmods-live-image-reload.png' });
    throw error;
  }
  assert.equal(await page.getByRole('img', { name: 'color.jpg', exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('Live image check passed: browser upload → authenticated connection → Trigger worker → model recognizes red → saved image and answer reload. Synthetic localhost session, real Trigger/OpenAI; no OAuth.');
} finally {
  if (sql && owner) { await sql`delete from chats where id=${chatId} and user_id=${owner}`; await sql`delete from bots where id=${botId} and user_id=${owner}`; }
  await browser.close();
}
