import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Read-only browser fixtures test the app shell, never provider capability.
// Usage: node scripts/check-scamwin-live-ui.mjs http://localhost:3100
// Every check, bootstrap, artifact and remote frame request is intercepted.
const base = new URL(process.argv[2] || 'http://localhost:3100');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Live UI checks require a localhost HTTP server.');
const output = resolve('.trigger/live-ui/screenshots');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], unexpectedRequests = [];
let assertions = 0;
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
function deferred() { let release; const promise = new Promise(resolvePromise => { release = resolvePromise; }); return { promise, release }; }

function makeDetail(template, runId, generation, revision, state = 'collecting') {
  const value = structuredClone(template), now = new Date(), started = new Date(now.getTime() - 5000).toISOString();
  const oldIds = new Map(value.observations.map((o, index) => [o.id, `synthetic-live-evidence-${index + 1}`]));
  Object.assign(value.check, { id: 'synthetic-live', ownerId: 'synthetic-browser-owner', runId, generation, revision, state, createdAt: started, updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString() });
  value.check.stages = [
    { id: 'intake', label: 'Understanding your offer', status: 'completed', startedAt: started, finishedAt: new Date(now.getTime() - 4000).toISOString() },
    { id: 'browser', label: 'Observing the website', status: state === 'collecting' ? 'running' : 'completed', detailCode: 'read_page', startedAt: new Date(now.getTime() - 4000).toISOString(), ...(state === 'collecting' ? {} : { finishedAt: now.toISOString() }) },
    ...[['trust', 'Checking the connection'], ['registry', 'Checking shared warnings'], ['comparison', 'Comparing promise and request'], ['assessment', 'Preparing your result']].map(([id, label]) => ({ id, label, status: state === 'collecting' ? 'pending' : 'completed', ...(state === 'collecting' ? {} : { startedAt: started, finishedAt: now.toISOString() }) })),
  ];
  value.observations = value.observations.map(o => ({ ...o, id: oldIds.get(o.id), checkId: value.check.id, runId, observedAt: started }));
  for (const finding of value.check.assessment.findings) finding.evidenceIds = finding.evidenceIds.map(id => oldIds.get(id));
  const page = value.observations.find(o => o.kind === 'page');
  value.observations.push({ ...page, id: 'synthetic-live-inference', kind: 'semantic_mismatch', data: { description: 'Synthetic inference from the saved page.', quote: 'Verify first', basedOnEvidenceId: page.id } });
  value.check.assessment.findings.push({ id: 'synthetic-inference-finding', statement: 'Synthetic inference from the saved page.', classification: 'inference', evidenceIds: ['synthetic-live-inference'] });
  value.artifacts = [];
  value.messages = [];
  value.warningSubmissions = [];
  value.liveView = { state: state === 'collecting' ? 'ready' : 'ended', runId, generation, sessionId: `synthetic-session-${generation}` };
  return value;
}

async function visibility(page, hidden) {
  await page.evaluate(isHidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => isHidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
async function refresh(page) { await visibility(page, false); }
async function until(predicate, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(40); }
  throw new Error(message);
}
async function fits(page, width, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} fits ${width}px`);
  assertions++;
}

try {
  // Safe public fixture read. No saved check endpoint is contacted by this request.
  const fixtureContext = await browser.newContext();
  const templateResponse = await fixtureContext.request.get(new URL('/api/scamwin/demo', base).href);
  assert.equal(templateResponse.status(), 200, 'local synthetic demo fixture available');
  const template = await templateResponse.json();
  await fixtureContext.close();

  for (const width of [1440, 375, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 500)); });
    const initialDetail = deferred();
    const state = { detail: makeDetail(template, 'synthetic-run-a', 1, 1), liveState: 'ready', providerOrigin: 'https://production-sfo.browserless.io', detailCalls: 0, liveCalls: 0, detailInFlight: 0, liveInFlight: 0, maxDetail: 0, maxLive: 0, delay: 0, holdOldLive: null, heldOldStarted: false, frameLoads: 0 };
    const viewerUrl = generation => `${state.providerOrigin}/live/synthetic-ui-${generation}`;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!['GET', 'HEAD'].includes(request.method())) {
        unexpectedRequests.push({ kind: 'mutation', method: request.method(), path: url.pathname });
        await route.abort('blockedbyclient'); return;
      }
      if (url.origin === state.providerOrigin && /^\/live\/synthetic-ui-\d+$/.test(url.pathname)) {
        state.frameLoads++;
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#141414;color:#b8ccff;font:24px Arial"><p>Synthetic viewer fixture · shell verification only</p><p>No real provider stream is used in this check.</p></body></html>' }); return;
      }
      // Windows antivirus injects this script into localhost documents. Keep the
      // environment hook offline without treating it as application traffic.
      if (url.hostname === 'gc.kis.v2.scr.kaspersky-labs.com' && url.pathname.endsWith('/main.js')) { await route.fulfill({ contentType: 'application/javascript', body: '// Local browser QA: environment-injected script disabled.' }); return; }
      if (url.origin !== base.origin) {
        unexpectedRequests.push({ kind: 'external', origin: url.origin, path: url.pathname });
        await route.abort('blockedbyclient'); return;
      }
      if (url.pathname === '/api/scamwin/bootstrap') {
        await route.fulfill({ json: { configured: true, user: { name: 'Synthetic browser fixture', sub: 'synthetic-browser-owner' }, role: 'user', readiness: [] } }); return;
      }
      if (url.pathname === '/api/scamwin/checks/synthetic-live/live-view') {
        state.liveCalls++; state.liveInFlight++; state.maxLive = Math.max(state.maxLive, state.liveInFlight);
        const runId = request.headers()['x-scamwin-run-id'], generation = Number(request.headers()['x-scamwin-generation']);
        const value = { state: state.liveState, runId, generation, ...(state.liveState === 'starting' ? {} : { sessionId: `synthetic-session-${generation}`, viewerUrl: viewerUrl(generation), issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }) };
        try {
          if (state.holdOldLive && runId === 'synthetic-run-a') { state.heldOldStarted = true; await state.holdOldLive.promise; value.state = 'ended'; delete value.viewerUrl; }
          else if (state.delay) await pause(state.delay);
          await route.fulfill({ json: value });
        } catch (error) { if (!/closed|aborted|disposed|canceled|cancelled|Invalid InterceptionId/i.test(String(error))) throw error; }
        finally { state.liveInFlight--; }
        return;
      }
      if (url.pathname === '/api/scamwin/checks/synthetic-live') {
        state.detailCalls++; state.detailInFlight++; state.maxDetail = Math.max(state.maxDetail, state.detailInFlight);
        const value = structuredClone(state.detail);
        try { if (state.detailCalls === 1) await initialDetail.promise; else if (state.delay) await pause(state.delay); await route.fulfill({ json: value }); }
        catch (error) { if (!/closed|aborted|disposed|canceled|cancelled|Invalid InterceptionId/i.test(String(error))) throw error; }
        finally { state.detailInFlight--; }
        return;
      }
      if (url.pathname === '/api/scamwin/artifacts/synthetic-capture') { await route.fulfill({ contentType: 'image/png', body: tinyPng }); return; }
      if (url.pathname.startsWith('/api/scamwin/checks/') || url.pathname.startsWith('/api/scamwin/artifacts/')) {
        unexpectedRequests.push({ kind: 'unexpected-private-read', path: url.pathname });
        await route.abort('blockedbyclient'); return;
      }
      await route.continue();
    });

    const documentResponse = await page.goto(new URL('/checks/synthetic-live', base).href, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const csp = documentResponse.headers()['content-security-policy'] || '';
    state.providerOrigin = /frame-src\s+(https:\/\/[^;\s]+)/.exec(csp)?.[1] || state.providerOrigin;
    await page.getByRole('link', { name: 'My checks', exact: true }).first().focus();
    const focused = await page.evaluate(() => document.activeElement?.textContent), scroll = await page.evaluate(() => scrollY);
    initialDetail.release();
    const frame = page.locator('iframe.sw-live-frame');
    await frame.waitFor();
    await page.frameLocator('iframe.sw-live-frame').getByText('Synthetic viewer fixture · shell verification only', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Collapse view', exact: true }).getAttribute('aria-expanded'), 'true', 'owner active viewer auto-opens');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), focused, 'automatic opening preserves focus');
    assert.equal(await page.evaluate(() => scrollY), scroll, 'automatic opening preserves scroll');
    await frame.evaluate(element => { element.__syntheticLiveInstance = 'original-a'; });
    assert.equal(await frame.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
    assert.equal(await frame.getAttribute('referrerpolicy'), 'no-referrer');
    assert.ok((await frame.getAttribute('allow')).includes("camera 'none'"));
    assert.equal(await frame.getAttribute('tabindex'), '-1');
    for (const label of ['Understanding your offer', 'Observing the website', 'Checking the connection', 'Checking shared warnings', 'Comparing promise and request', 'Preparing your result']) await page.getByRole('heading', { name: label, exact: true }).waitFor();
    await page.getByText('Reading the page', { exact: true }).waitFor();
    assert.ok(await page.locator('.sw-progress-time time[datetime]').count(), 'stages retain server timestamps');
    await fits(page, width, 'live result');
    await page.screenshot({ path: resolve(output, `live-${width}.png`), fullPage: true });
    assertions += 12;

    state.liveState = 'live'; state.detail.liveView.state = 'live'; state.detail.check.revision = 3;
    await refresh(page);
    await page.locator('.sw-live-inspection[data-live-state="live"]').waitFor();
    assert.equal(await frame.evaluate(element => element.__syntheticLiveInstance), 'original-a', 'ready→live preserves iframe DOM instance');
    assert.equal(state.frameLoads, 1, 'ready→live does not navigate the frame again');
    await page.getByRole('button', { name: 'Collapse view', exact: true }).click();
    const detailCalls = state.detailCalls;
    await refresh(page); await until(() => state.detailCalls > detailCalls && state.detailInFlight === 0, 'collapsed poll completes');
    assert.equal(await page.getByRole('button', { name: 'Open view', exact: true }).getAttribute('aria-expanded'), 'false', 'polling respects manual collapse');
    assert.equal(await frame.count(), 1, 'collapse keeps session frame mounted');
    assert.equal(await frame.evaluate(element => element.__syntheticLiveInstance), 'original-a');
    await page.getByRole('button', { name: 'Open view', exact: true }).click();
    assert.equal(await frame.evaluate(element => element.__syntheticLiveInstance), 'original-a', 'reopen reuses the same session');

    await until(() => state.detailInFlight === 0 && state.liveInFlight === 0, 'initial Strict Mode cleanup and prior reads settle');
    // Development Strict Mode may abort its first mount's pending fixture read.
    // Measure concurrent visibility churn on the established current mount.
    state.maxDetail = 0; state.maxLive = 0; state.delay = 220;
    const beforeChurnDetail = state.detailCalls, beforeChurnLive = state.liveCalls;
    await page.evaluate(() => { for (let i = 0; i < 10; i++) document.dispatchEvent(new Event('visibilitychange')); });
    await until(() => state.detailCalls > beforeChurnDetail && state.liveCalls > beforeChurnLive && state.detailInFlight === 0 && state.liveInFlight === 0, 'visibility requests start and settle');
    assert.equal(state.maxDetail, 1, 'detail polling allows one request at a time');
    assert.equal(state.maxLive, 1, 'viewer polling allows one request at a time');
    state.delay = 0;

    const saved = structuredClone(state.detail);
    state.detail = makeDetail(template, 'synthetic-run-a', 1, 2, 'completed');
    const staleCalls = state.detailCalls;
    await refresh(page); await until(() => state.detailCalls > staleCalls && state.detailInFlight === 0, 'stale terminal fixture returned');
    assert.equal(await frame.evaluate(element => element.__syntheticLiveInstance), 'original-a', 'lower terminal revision cannot remove a current frame');
    assert.equal(await page.locator('.sw-live-inspection').getAttribute('data-live-state'), 'live');
    state.detail = saved;
    state.holdOldLive = deferred();
    await refresh(page); await until(() => state.heldOldStarted, 'old run owner response held');
    state.detail = makeDetail(template, 'synthetic-run-b', 2, 4); state.liveState = 'ready';
    await refresh(page);
    await until(async () => (await frame.getAttribute('src')) === viewerUrl(2), 'new run attaches its own viewer');
    state.holdOldLive.release();
    await until(() => state.liveInFlight === 0, 'aborted old response settles');
    assert.equal(await frame.getAttribute('src'), viewerUrl(2), 'old response cannot replace a new run');
    assert.equal(await page.locator('.sw-live-inspection').getAttribute('data-live-state'), 'ready');
    assertions += 12;

    // Preparation pauses HTTP while hidden, then resumes at the bounded visible cadence.
    state.detail = makeDetail(template, 'synthetic-run-c', 3, 5); state.detail.liveView.state = 'starting'; state.liveState = 'starting';
    await refresh(page); await page.locator('.sw-live-inspection[data-live-state="starting"]').waitFor();
    await until(() => state.liveInFlight === 0, 'preparation request settles');
    await visibility(page, true);
    const hiddenCalls = state.liveCalls;
    await pause(2200);
    assert.equal(state.liveCalls, hiddenCalls, 'hidden preparation does not poll owner endpoint');
    await visibility(page, false);
    await until(() => state.liveCalls > hiddenCalls, 'visible preparation resumes immediately');
    const visibleCalls = state.liveCalls;
    await until(() => state.liveCalls > visibleCalls, 'visible preparation polls at one-second cadence', 1600);
    assertions += 2;

    const terminal = makeDetail(template, 'synthetic-run-c', 3, 6, 'completed');
    const captureAt = terminal.check.updatedAt;
    terminal.observations.push({ id: 'synthetic-live-capture', checkId: 'synthetic-live', runId: terminal.check.runId, kind: 'capture', status: 'observed', sourceKind: 'live_page', sourceRef: terminal.check.input.url, observedAt: captureAt, artifactId: 'synthetic-capture', data: { synthetic: true, sha256: 'synthetic-only' }, collectorVersion: 'synthetic-ui-1', policyVersion: 'synthetic-ui-1' });
    terminal.artifacts.push({ id: 'synthetic-capture', checkId: 'synthetic-live', runId: terminal.check.runId, name: 'Synthetic UI fixture capture', mediaType: 'image/png', kind: 'capture', byteLength: tinyPng.length, sha256: 'synthetic-only', createdAt: captureAt, expiresAt: new Date(Date.now() + 3600000).toISOString(), url: '/api/scamwin/artifacts/synthetic-capture' });
    state.detail = terminal;
    await refresh(page); await page.locator('.sw-live-inspection[data-live-state="ended"]').waitFor();
    assert.equal(await frame.count(), 0, 'terminal stage tears down the iframe');
    await page.locator('.sw-live-capture img').waitFor();
    await page.locator('.sw-live-caption').filter({ hasText: 'Captured screenshot' }).waitFor();
    const enlarge = page.getByRole('button', { name: 'Enlarge captured screenshot, evidence 8', exact: true });
    await enlarge.click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    await dialog.getByRole('heading', { name: 'Captured website screenshot' }).waitFor();
    await dialog.evaluate(element => Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 901, `capture modal fits ${width}px: ${JSON.stringify(bounds)}`);
    await fits(page, width, 'capture modal');
    await page.screenshot({ path: resolve(output, `capture-modal-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await enlarge.evaluate(element => element === document.activeElement), true, 'Escape restores enlargement button focus');
    assert.equal(context.pages().length, 1, 'enlargement stays inside the site');
    const inference = page.locator('.sw-findings li').filter({ hasText: 'Synthetic inference from the saved page.' });
    await inference.locator('a[href="#evidence-synthetic-live-evidence-2"]').click();
    assert.equal(await page.locator('#evidence-synthetic-live-evidence-2').evaluate(element => element.open), true, 'inference cites and discloses underlying page');
    await page.locator('.sw-decision-comparison a[href="#evidence-synthetic-live-evidence-6"]').first().click();
    assert.equal(await page.locator('#evidence-synthetic-live-evidence-6').evaluate(element => element.open), true, 'observed payment source deep link works');
    await fits(page, width, 'completed result with expanded evidence');
    await page.screenshot({ path: resolve(output, `completed-${width}.png`), fullPage: true });
    assertions += 9;
    console.log(JSON.stringify({ width, status: 'passed', coverage: 'Synthetic shell only; stable frame, disclosure, focus, run/revision/visibility fencing, capture and citations' }));
    await context.close();
  }
  assert.deepEqual(unexpectedRequests, [], 'No mutations, real checks or external provider traffic');
  assert.deepEqual(errors, [], 'No browser runtime or console errors');
  console.log(JSON.stringify({ status: 'passed', assertions, widths: [1440, 375, 320], screenshots: output, providerAcceptance: 'Not tested: viewer responses and frame content are synthetic fixtures.' }, null, 2));
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ path: new URL(page.url()).pathname, liveState: await page.locator('.sw-live-inspection').getAttribute('data-live-state').catch(() => null), headings: await page.locator('h1,h2').allTextContents(), overflow: await page.evaluate(() => [...document.querySelectorAll('.sw *')].map(element => ({ tag: element.tagName, class: String(element.className), right: element.getBoundingClientRect().right })).filter(item => item.right > innerWidth + 1).slice(0, 10)), errors, unexpectedRequests }, null, 2));
  }
  throw error;
} finally { await browser.close(); }
