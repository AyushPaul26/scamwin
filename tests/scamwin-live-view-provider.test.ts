import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWatchOnlyLiveView, closeWatchOnlyLiveView, isApprovedLiveViewUrl,
  subscribeWatchOnlyLiveView, type BrowserlessCdp,
} from '../lib/scamwin/live-view-provider';

const origin = 'https://production-sfo.browserless.io';
const viewer = `${origin}/live/viewer-id?i=viewer-capability`;
const options = { providerOrigin: origin, providerToken: 'PRIVATE_PROVIDER_TOKEN', remainingMs: 20_000 };
const success = { error: null, liveURL: viewer, liveURLId: 'viewer-id', timeout: 10_000, targetId: 'page-target' };

function transport(mint: unknown = success) {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const cdp: BrowserlessCdp = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'page-target', type: 'page' } };
      if (method === 'Browserless.liveURL') return mint;
      return { error: null, liveURLId: params?.liveURLId };
    },
    on(event, handler) { const set = listeners.get(event) ?? new Set(); set.add(handler); listeners.set(event, set); },
    off(event, handler) { listeners.get(event)?.delete(handler); },
  };
  return { cdp, calls, listeners, emit(event: string, payload: unknown) { for (const handler of listeners.get(event) ?? []) handler(payload); } };
}

test('mints on the existing page target with explicit watch-only fixed viewport options', async () => {
  const { cdp, calls } = transport();
  const locator = await createWatchOnlyLiveView(cdp, options);
  assert.deepEqual(locator, { liveURL: viewer, liveURLId: 'viewer-id', timeoutMs: 10_000, targetId: 'page-target' });
  assert.deepEqual(calls.map(call => call.method), ['Target.getTargetInfo', 'Browserless.liveURL']);
  const params = calls[1].params!;
  assert.deepEqual({ ...params, timeout: 20_000 }, {
    targetId: 'page-target', interactable: false, resizable: false, mode: 'tab',
    showBrowserInterface: false, type: 'jpeg', quality: 50, captureScale: 1, timeout: 20_000,
  });
  assert.ok(Number.isInteger(params.timeout) && Number(params.timeout) > 0 && Number(params.timeout) <= options.remainingMs);
});

test('caps the requested lifetime to the sixty-second collector budget', async () => {
  const { cdp, calls } = transport();
  await createWatchOnlyLiveView(cdp, { ...options, remainingMs: 120_000 });
  assert.ok(Number(calls[1].params?.timeout) <= 60_000);
  for (const remainingMs of [0, -1, NaN, Infinity]) {
    const fixture = transport();
    await assert.rejects(createWatchOnlyLiveView(fixture.cdp, { ...options, remainingMs }), /live_view_budget/);
    assert.equal(fixture.calls.length, 0);
  }
});

test('validates only the configured exact approved HTTPS regional origin and live path', () => {
  for (const host of ['production-sfo', 'production-lon', 'production-ams']) {
    const region = `https://${host}.browserless.io`;
    assert.equal(isApprovedLiveViewUrl(`${region}/live/index.html?i=capability`, region), true);
    assert.equal(isApprovedLiveViewUrl(`${region}/live/?i=capability`, region), true);
    assert.equal(isApprovedLiveViewUrl(`${region}/chromium/live/index.html?i=capability`, region), true);
    assert.equal(isApprovedLiveViewUrl(`${region}/chromium/live/?i=capability`, region), true);
    assert.equal(isApprovedLiveViewUrl(`${region}/e/session-123/live/index.html?i=capability`, region), true);
  }
  for (const value of [
    `http://production-sfo.browserless.io/live/x`, `${origin}.evil.example/live/x`,
    'https://production-lon.browserless.io/live/x', `${origin}:8443/live/x`,
    'https://user:password@production-sfo.browserless.io/live/x', `${origin}/live/x#fragment`,
    `${origin}/chromium?token=secret`, `${origin}/live`,
    `${origin}/live/../chromium`, `${origin}/live/%2e%2e/chromium`, `${origin}/live/x?token=secret`,
    `${origin}/live/x?%74oken=secret`, `${origin}/live/x?apiKey=secret`, `${origin}/live/x\n`,
    `${origin}/live/x?redirect=https://other.example`,
    `${origin}/live/x?%2574oken=secret`, `${origin}/live/x?redirect=https%253A%252F%252Fother.example`,
    `${origin}/live/https://other.example/live/x`, `${origin}/e/session-123/live/../../live/x`,
    `${origin}/e/session-123/extra/live/index.html`, `${origin}/other/e/session-123/live/index.html`,
  ]) assert.equal(isApprovedLiveViewUrl(value, origin), false, value);
  for (const provider of ['https://evil.example', `${origin}:8443`, `${origin}/chromium`, `${origin}?token=x`, `${origin}#x`]) {
    assert.equal(isApprovedLiveViewUrl(viewer, provider), false);
  }
});

test('rejects bad provider responses with fixed codes and closes any rejected minted viewer', async () => {
  for (const timeout of [0, -1, 20_001, 1.5, NaN, Infinity, undefined]) {
    const fixture = transport({ ...success, timeout });
    await assert.rejects(createWatchOnlyLiveView(fixture.cdp, options), /live_view_invalid_response/);
    assert.equal(fixture.calls.at(-1)?.method, 'Browserless.closeLiveURL');
  }
  for (const response of [
    { ...success, error: `PRIVATE_PROVIDER_TOKEN ${viewer}` },
    { ...success, targetId: 'different-page' }, { ...success, liveURLId: '' },
    { ...success, liveURL: `${origin}/live/PRIVATE_PROVIDER_TOKEN` },
    { ...success, liveURL: `${origin}/live/x?i=${encodeURIComponent('PRIVATE_PROVIDER_TOKEN')}` },
    { ...success, liveURL: 'https://evil.example/live/x' }, null,
  ]) {
    await assert.rejects(createWatchOnlyLiveView(transport(response).cdp, options), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^live_view_(provider_error|invalid_response)$/);
      assert.doesNotMatch(`${error.message} ${error.stack} ${JSON.stringify(error)}`, /PRIVATE_PROVIDER_TOKEN|viewer-capability|https:\/\//);
      return true;
    });
  }
});

test('sanitizes thrown transport failures and rejects non-page targets', async () => {
  const fixture = transport();
  fixture.cdp.send = async () => { throw Error(`${viewer} PRIVATE_PROVIDER_TOKEN`); };
  await assert.rejects(createWatchOnlyLiveView(fixture.cdp, options), /^Error: live_view_provider_error$/);
  fixture.cdp.send = async () => ({ targetInfo: { targetId: 'browser-target', type: 'browser' } });
  await assert.rejects(createWatchOnlyLiveView(fixture.cdp, options), /live_view_invalid_response/);
});

test('reports documented unsupported and expired capabilities using bounded codes only', async () => {
  for (const [message, code] of [
    ['Live URLs are not supported.', 'live_view_unsupported'],
    ['The browser session has expired.', 'live_view_expired'],
  ]) {
    await assert.rejects(createWatchOnlyLiveView(transport({ error: message }).cdp, options), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, code);
      assert.doesNotMatch(JSON.stringify(error), /Live URLs|browser session/);
      return true;
    });
  }
});

test('closes a minted response that arrives after the bounded caller stopped waiting', async () => {
  const fixture = transport();
  const send = fixture.cdp.send;
  let deliver: (value: unknown) => void = () => {};
  fixture.cdp.send = (method, params) => method === 'Browserless.liveURL'
    ? new Promise(resolve => { deliver = resolve; }) : send(method, params);
  await assert.rejects(createWatchOnlyLiveView(fixture.cdp, { ...options, commandTimeoutMs: 10 }), /live_view_timeout/);
  deliver(success);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.calls.at(-1)?.method, 'Browserless.closeLiveURL');
});

test('bounds stalled mint and honors pre-aborted collection without starting commands', async () => {
  const fixture = transport();
  fixture.cdp.send = async () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(createWatchOnlyLiveView(fixture.cdp, { ...options, commandTimeoutMs: 15 }), /live_view_timeout/);
  assert.ok(Date.now() - started < 500);
  const untouched = transport();
  await assert.rejects(createWatchOnlyLiveView(untouched.cdp, { ...options, signal: AbortSignal.abort(Error(viewer)) }), /live_view_aborted/);
  assert.equal(untouched.calls.length, 0);
});

test('closes boundedly and idempotently without echoing provider failures', async () => {
  const fixture = transport();
  await Promise.all([closeWatchOnlyLiveView(fixture.cdp, 'viewer-id'), closeWatchOnlyLiveView(fixture.cdp, 'viewer-id')]);
  await closeWatchOnlyLiveView(fixture.cdp, 'viewer-id');
  assert.equal(fixture.calls.filter(call => call.method === 'Browserless.closeLiveURL').length, 1);
  const stalled = transport();
  stalled.cdp.send = async () => new Promise(() => {});
  const start = Date.now();
  await assert.rejects(closeWatchOnlyLiveView(stalled.cdp, 'viewer-id', { timeoutMs: 15 }), /live_view_timeout/);
  assert.ok(Date.now() - start < 500);
  const failed = transport();
  failed.cdp.send = async () => { throw Error(viewer); };
  await assert.rejects(closeWatchOnlyLiveView(failed.cdp, 'viewer-id'), /^Error: live_view_provider_error$/);
});

test('filters session events, sanitizes completion, catches callback rejection and disposes safely', async () => {
  const fixture = transport();
  const events: string[] = [];
  const dispose = subscribeWatchOnlyLiveView(fixture.cdp, success, {
    onConnected: async () => { events.push('connected'); throw Error('callback failure'); },
    onComplete: async reason => { events.push(reason); throw Error('callback failure'); },
  });
  fixture.emit('Browserless.liveViewerConnected', { liveURLId: 'other-viewer' });
  fixture.emit('Browserless.liveComplete', { liveURLId: 'viewer-id', targetId: 'page-target', reason: viewer });
  fixture.emit('Browserless.liveViewerConnected', { liveURLId: 'viewer-id', raw: viewer });
  fixture.emit('Browserless.liveComplete', { liveURLId: 'viewer-id', targetId: 'page-target', reason: 'timeout', feedback: { message: viewer } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['connected', 'timeout']);
  dispose(); dispose();
  fixture.emit('Browserless.liveViewerConnected', { liveURLId: 'viewer-id' });
  assert.deepEqual(events, ['connected', 'timeout']);
  assert.equal([...fixture.listeners.values()].reduce((count, set) => count + set.size, 0), 0);
});
