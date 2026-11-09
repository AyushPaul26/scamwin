import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser } from 'playwright';
import { collectWebsite } from '../lib/scamwin/collector';

const env = { BROWSERLESS_TOKEN: 'PROVIDER_PRIVATE', SCAMWIN_BROWSER_CAPABILITY_VERIFIED: 'true', SCAMWIN_LIVE_VIEW_ENABLED: 'true', SCAMWIN_APPROVED_ORIGINS: 'https://lab.example.com' };
const source = { checkId: 'check-id', runId: 'run-id' };
const locator = { error: null, liveURL: 'https://production-sfo.browserless.io/live/viewer-id?i=BEARER_PRIVATE', liveURLId: 'viewer-id', targetId: 'page-target', timeout: 10_000 };

function browserFixture(options: { mintError?: boolean; navigateError?: boolean; onNavigate?: () => void; closeStalls?: boolean; closeError?: boolean } = {}) {
  const order: string[] = [];
  const events = new Map<string, (event: unknown) => void>();
  let pageCount = 0, cdpCount = 0;
  const cdp = {
    async send(method: string, params?: Record<string, unknown>) {
      order.push(method);
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'page-target', type: 'page' } };
      if (method === 'Browserless.liveURL') {
        assert.ok(Number(params?.timeout) <= 60_000);
        return options.mintError ? { error: `${locator.liveURL} ${env.BROWSERLESS_TOKEN}` } : locator;
      }
      if (method === 'Browserless.closeLiveURL' && options.closeError) throw Error(`${locator.liveURL} PROVIDER_PRIVATE`);
      return { error: null, liveURLId: 'viewer-id' };
    },
    on(name: string, callback: (event: unknown) => void) { order.push(`on:${name}`); events.set(name, callback); },
    off(name: string) { order.push(`off:${name}`); events.delete(name); },
  };
  const page = {
    on() {},
    async goto() { order.push('navigate'); options.onNavigate?.(); if (options.navigateError) throw Error('navigation unavailable'); return { allHeaders: async () => ({}) }; },
    async waitForLoadState() {}, url: () => 'https://lab.example.com/',
    async evaluate() { order.push('read'); return { title: 'Controlled fixture', text: 'Factual observed content', links: [], forms: [], password: false, mixed: false }; },
    async screenshot() { order.push('capture'); return Buffer.from('capture'); },
  };
  const context = {
    async route() {}, async routeWebSocket() {}, on() {},
    async newPage() { pageCount++; return page; },
    async newCDPSession(actual: unknown) { assert.equal(actual, page); cdpCount++; return cdp; },
    async close() {},
  };
  const browser = { async newContext(settings: unknown) { assert.deepEqual(settings, { viewport: { width: 1200, height: 800 }, serviceWorkers: 'block', acceptDownloads: false, permissions: [], ignoreHTTPSErrors: false }); return context; }, async close() { order.push('browser-close'); if (options.closeStalls) await new Promise(() => {}); } } as unknown as Browser;
  return { order, events, browser, counts: () => ({ pageCount, cdpCount }) };
}

test('live collector awaits real phases, binds the existing page and subscribes before ready/navigation', async () => {
  const fixture = browserFixture();
  const phases: string[] = [];
  let ready = false;
  const result = await collectWebsite('https://lab.example.com/', source, {
    env, connect: async () => fixture.browser,
    onProgress: async phase => { await Promise.resolve(); phases.push(phase); },
    onLiveViewReady: async view => {
      assert.equal(view.liveURL, locator.liveURL);
      assert.equal(view.targetId, 'page-target');
      assert.ok(Date.parse(view.expiresAt) > Date.parse(view.issuedAt));
      assert.ok(fixture.events.has('Browserless.liveViewerConnected'));
      assert.ok(fixture.events.has('Browserless.liveComplete'));
      assert.ok(!fixture.order.includes('navigate'));
      await Promise.resolve(); ready = true; fixture.order.push('ready');
    },
    onLiveViewEnded: async () => { fixture.order.push('ended'); },
  });
  assert.equal(ready, true);
  assert.deepEqual(fixture.counts(), { pageCount: 1, cdpCount: 1 });
  assert.deepEqual(phases, ['connect_browser', 'create_context', 'configure_routes', 'navigate', 'read_page', 'capture']);
  assert.ok(fixture.order.indexOf('Browserless.liveURL') < fixture.order.indexOf('ready'));
  assert.ok(fixture.order.indexOf('ready') < fixture.order.indexOf('navigate'));
  assert.ok(fixture.order.indexOf('Browserless.closeLiveURL') < fixture.order.indexOf('browser-close'));
  assert.equal(fixture.events.has('Browserless.liveViewerConnected'), false);
  assert.equal(result.captures.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /BEARER_PRIVATE|PROVIDER_PRIVATE|liveURL|viewer-id/);
});

test('disabled and unsupported viewing leave evidence collection available', async () => {
  for (const disabled of [true, false]) {
    const fixture = browserFixture({ mintError: !disabled });
    const unavailable: string[] = [];
    let ready = 0;
    const result = await collectWebsite('https://lab.example.com/', source, {
      env: { ...env, SCAMWIN_LIVE_VIEW_ENABLED: disabled ? 'false' : 'true' },
      connect: async () => fixture.browser, onLiveViewReady: async () => { ready++; },
      onLiveViewUnavailable: async event => { unavailable.push(event.reasonCode); },
    });
    assert.equal(ready, 0);
    assert.equal(fixture.order.includes('Browserless.liveURL'), !disabled);
    assert.equal(unavailable.length, disabled ? 0 : 1);
    assert.doesNotMatch(JSON.stringify(unavailable), /BEARER_PRIVATE|PROVIDER_PRIVATE|https:/);
    assert.ok(result.observations.some(item => item.kind === 'page' && item.status === 'observed'));
  }
});

test('ready-persistence failure closes viewer and still captures the inspected page', async () => {
  const fixture = browserFixture();
  let unavailable = 0;
  const result = await collectWebsite('https://lab.example.com/', source, {
    env, connect: async () => fixture.browser,
    onLiveViewReady: async () => { throw Error(`${locator.liveURL} database failure`); },
    onLiveViewUnavailable: async event => { unavailable++; assert.match(event.reasonCode, /^[a-z_]+$/); },
  });
  assert.equal(unavailable, 1);
  assert.ok(fixture.order.indexOf('Browserless.closeLiveURL') < fixture.order.indexOf('navigate'));
  assert.equal(result.captures.length, 1);
});

test('viewer events are actual provider callbacks and listener failures cannot abort collection', async () => {
  const fixture = browserFixture({ onNavigate: () => {
    fixture.events.get('Browserless.liveViewerConnected')?.({ liveURLId: 'viewer-id' });
    fixture.events.get('Browserless.liveComplete')?.({ liveURLId: 'viewer-id', targetId: 'page-target', reason: 'timeout', feedback: { message: 'PRIVATE' } });
  } });
  let connected = 0;
  const endings: string[] = [];
  const result = await collectWebsite('https://lab.example.com/', source, {
    env, connect: async () => fixture.browser, onLiveViewReady: async () => {},
    onLiveViewConnected: async () => { connected++; throw Error('hook failure'); },
    onLiveViewEnded: async event => { endings.push(event.reasonCode); },
  });
  assert.equal(connected, 1);
  assert.ok(endings.includes('timeout'));
  assert.equal(result.captures.length, 1);
});

test('normal failure and cancellation retire viewer and close the original browser', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const fixture = browserFixture({ navigateError: !cancel, onNavigate: () => { if (cancel) controller.abort(Error('canceled')); } });
    let ended = 0;
    const run = collectWebsite('https://lab.example.com/', source, {
      env, signal: controller.signal, connect: async () => fixture.browser,
      onLiveViewReady: async () => {}, onLiveViewEnded: async () => { ended++; },
    });
    if (cancel) await assert.rejects(run, /canceled/); else await run;
    assert.ok(fixture.order.includes('Browserless.closeLiveURL'));
    assert.ok(fixture.order.includes('browser-close'));
    assert.ok(ended > 0);
  }
});

test('provider-close failure is sanitized and never prevents browser closure or saved captures', async () => {
  const fixture = browserFixture({ closeError: true });
  const unavailable: string[] = [];
  const result = await collectWebsite('https://lab.example.com/', source, {
    env, connect: async () => fixture.browser, onLiveViewReady: async () => {},
    onLiveViewUnavailable: async event => { unavailable.push(event.reasonCode); },
  });
  assert.deepEqual(unavailable, ['live_view_provider_error']);
  assert.ok(fixture.order.includes('browser-close'));
  assert.equal(result.captures.length, 1);
});
