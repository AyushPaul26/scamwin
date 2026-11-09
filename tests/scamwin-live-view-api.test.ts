import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScamwinStore } from '../lib/scamwin/contracts';
import type { LiveViewRecord } from '../lib/scamwin/live-view-contracts';
import { sealLiveViewLocator } from '../lib/scamwin/live-view-crypto';
import { getOwnedLiveViewResponse, getSanitizedLiveViewStatus } from '../lib/scamwin/live-view-server';
import { MemoryStore } from '../lib/scamwin/store';

const started = '2026-11-10T12:00:00.000Z';
const now = () => new Date('2026-11-10T12:00:10.000Z');
const locator = 'https://production-sfo.browserless.io/live/fixture-session';
const env = { SCAMWIN_LIVE_VIEW_ENABLED: 'true', SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY: 'ab'.repeat(32), BROWSERLESS_BASE_URL: 'https://production-sfo.browserless.io', BROWSERLESS_TOKEN: 'fixture-provider-key' };

async function fixture(clock = () => new Date(started)) {
  const store = new MemoryStore({ now: clock });
  const queued = await store.createCheck('alice', { url: 'https://example.org/', message: 'Offer', promisedBenefit: 'Refund', intendedAction: 'receive_money', images: [] }, 'live-api');
  const check = (await store.updateRun(queued.id, 1, 0, { state: 'collecting', stages: [{ id: 'browser', label: 'Observing website', status: 'running' }] }))!;
  const record: LiveViewRecord = { scope: { ownerId: 'alice', checkId: check.id, runId: check.runId, generation: 1 }, sessionId: 'fixture-session', status: 'ready', encryptedLocator: null, createdAt: started, expiresAt: '2026-11-10T12:00:40.000Z' };
  record.encryptedLocator = sealLiveViewLocator(locator, record, env);
  assert.equal(await store.putLiveView(record.scope, record), true);
  return { store, check, record, options: { subject: 'alice', checkId: check.id, expectedRunId: check.runId, expectedGeneration: '1', store, env, now } };
}

async function body(response: Response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  return await response.json();
}

test('owner current active browser receives only its bounded ready or live capability', async () => {
  const { options, store, record } = await fixture();
  let response = await getOwnedLiveViewResponse(options);
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { state: 'ready', sessionId: 'fixture-session', runId: options.expectedRunId, generation: 1, viewerUrl: locator, issuedAt: now().toISOString(), expiresAt: record.expiresAt });
  await store.updateLiveView(record.scope, record.sessionId, { status: 'connected', connectedAt: now().toISOString() });
  response = await getOwnedLiveViewResponse(options);
  assert.equal((await body(response)).state, 'live');
});

test('unauthenticated, absent and cross-owner requests never issue a locator', async () => {
  const { options } = await fixture();
  for (const [change, status] of [[{ subject: null }, 401], [{ subject: 'bob' }, 404], [{ checkId: 'missing' }, 404]] as const) {
    const response = await getOwnedLiveViewResponse({ ...options, ...change });
    assert.equal(response.status, status);
    const value = JSON.stringify(await body(response));
    assert.ok(!value.includes(locator));
    assert.ok(!value.includes(env.SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY));
  }
});

test('expected identity is required, bounded and compared with the owned current run', async () => {
  const { options } = await fixture();
  for (const change of [
    { expectedRunId: null }, { expectedRunId: 'x'.repeat(121) }, { expectedRunId: 'run\nother' },
    { expectedGeneration: null }, { expectedGeneration: '0' }, { expectedGeneration: '1.5' },
    { expectedGeneration: '01' }, { expectedGeneration: '9007199254740992' },
  ]) {
    const response = await getOwnedLiveViewResponse({ ...options, ...change });
    assert.equal(response.status, 400);
    assert.ok(!JSON.stringify(await body(response)).includes(locator));
  }
  for (const change of [{ expectedRunId: 'old-run' }, { expectedGeneration: '2' }]) {
    const response = await getOwnedLiveViewResponse({ ...options, ...change });
    assert.equal(response.status, 409);
    assert.ok(!JSON.stringify(await body(response)).includes(locator));
  }
});

test('disabled feature avoids new-table reads and does not resolve an encryption key', async () => {
  const { options, check } = await fixture();
  let reads = 0;
  const store = { getCheck: options.store.getCheck.bind(options.store), getLiveView: async () => { reads++; throw new Error('new table not installed'); } };
  const disabled = { ...options, store, env: { SCAMWIN_LIVE_VIEW_ENABLED: 'false' } };
  const response = await getOwnedLiveViewResponse(disabled);
  assert.equal((await body(response)).state, 'unavailable');
  assert.equal(await getSanitizedLiveViewStatus({ check, store, env: disabled.env, now }), undefined);
  assert.equal(reads, 0);
});

test('terminal, canceled, expired and completed browser stages cannot release a saved locator', async () => {
  const { options, check, record } = await fixture();
  for (const change of [
    { state: 'analyzing' as const }, { state: 'completed' as const }, { state: 'cancel_requested' as const },
    { state: 'canceled' as const }, { cancelRequestedAt: now().toISOString() },
    { expiresAt: '2026-11-10T11:00:00.000Z' }, { createdAt: '2026-11-10T11:00:00.000Z' },
    { stages: [{ id: 'browser', label: 'Browser', status: 'completed' as const }] },
  ]) {
    let rowReads = 0;
    const store = { getCheck: async () => ({ ...check, ...change }), getLiveView: async () => { rowReads++; return record; } };
    const response = await getOwnedLiveViewResponse({ ...options, store, env: { SCAMWIN_LIVE_VIEW_ENABLED: 'true' } });
    const value = await body(response);
    assert.ok(['ended', 'expired'].includes(value.state));
    assert.ok(!JSON.stringify(value).includes(locator));
    assert.equal(rowReads, 0, 'inactive browser cannot query/decrypt a live capability');
  }
});

test('missing current session waits without creating a browser or requiring a key', async () => {
  const { options, check } = await fixture();
  const store = { getCheck: async () => check, getLiveView: async () => null };
  const response = await getOwnedLiveViewResponse({ ...options, store, env: { SCAMWIN_LIVE_VIEW_ENABLED: 'true' } });
  assert.equal((await body(response)).state, 'starting');
});

test('real store session expiry reports expired instead of starting and never returns a locator', async () => {
  let time = new Date(started);
  const { options, check } = await fixture(() => time);
  time = new Date('2026-11-10T12:00:41.000Z');
  const response = await getOwnedLiveViewResponse({ ...options, now: () => time });
  assert.equal((await body(response)).state, 'expired');
  const metadata = await getSanitizedLiveViewStatus({ check, store: options.store, env, now: () => time });
  assert.equal(metadata?.state, 'expired');
  assert.ok(!JSON.stringify(metadata).includes('viewerUrl'));
});

test('expired, terminal, mismatched scope and malformed persisted locators are denied', async () => {
  const { options, check, record } = await fixture();
  for (const changed of [
    { ...record, expiresAt: now().toISOString() }, { ...record, status: 'ended' as const },
    { ...record, status: 'unavailable' as const }, { ...record, encryptedLocator: null },
    { ...record, scope: { ...record.scope, ownerId: 'bob' } }, { ...record, scope: { ...record.scope, runId: 'old-run' } },
    { ...record, scope: { ...record.scope, generation: 2 } }, { ...record, encryptedLocator: 'corrupt.private-ciphertext' },
  ]) {
    const response = await getOwnedLiveViewResponse({ ...options, store: { getCheck: async () => check, getLiveView: async () => changed } });
    const value = JSON.stringify(await body(response));
    assert.ok(!value.includes('viewerUrl'));
    assert.ok(!value.includes(locator));
    assert.ok(!value.includes(String(changed.encryptedLocator)));
  }
});

test('decrypted destinations are revalidated and provider credentials never escape', async () => {
  const { options, check, record } = await fixture();
  for (const value of [
    'https://attacker.example/live/private', 'http://production-sfo.browserless.io/live/private',
    'https://production-sfo.browserless.io/live/private?token=fixture-provider-key',
    'https://production-sfo.browserless.io/live/fixture-provider-key',
    'https://production-sfo.browserless.io/live/?id=fixture%2Dprovider%2Dkey',
  ]) {
    const changed = { ...record, encryptedLocator: sealLiveViewLocator(value, record, env) };
    const response = await getOwnedLiveViewResponse({ ...options, store: { getCheck: async () => check, getLiveView: async () => changed } });
    const result = await body(response);
    assert.equal(result.state, 'unavailable');
    assert.ok(!JSON.stringify(result).includes('viewerUrl'));
  }
});

test('cancellation during the read cannot issue a previously eligible locator', async () => {
  const { options, check, record } = await fixture();
  let canceled = false;
  const store = { getCheck: async () => ({ ...check, state: canceled ? 'cancel_requested' as const : 'collecting' as const }), getLiveView: async () => { canceled = true; return record; } };
  const response = await getOwnedLiveViewResponse({ ...options, store });
  assert.equal((await body(response)).state, 'ended');
});

test('generic owner metadata uses a fixed projection without decrypting or exposing ciphertext', async () => {
  const { options, check, record } = await fixture();
  const metadata = await getSanitizedLiveViewStatus({ check, store: options.store, env: { SCAMWIN_LIVE_VIEW_ENABLED: 'true' }, now });
  assert.deepEqual(metadata, { state: 'ready', runId: check.runId, generation: 1, sessionId: record.sessionId, createdAt: started, expiresAt: record.expiresAt });
  const json = JSON.stringify(metadata);
  assert.ok(!json.includes('viewerUrl'));
  assert.ok(!json.includes('encryptedLocator'));
  assert.ok(!json.includes(record.encryptedLocator!));
  assert.ok(!JSON.stringify(await options.store.getCheck('alice', check.id)).includes(record.encryptedLocator!));
  assert.ok(!JSON.stringify(await options.store.listChecks('alice', {})).includes(record.encryptedLocator!));
  assert.ok(!JSON.stringify(await options.store.listObservations('alice', check.id)).includes(record.encryptedLocator!));
  assert.ok(!JSON.stringify(await options.store.listArtifacts('alice', check.id)).includes(record.encryptedLocator!));
});

test('storage and decryption failures use sanitized private responses', async () => {
  const { options, check, record } = await fixture();
  const stores: Pick<ScamwinStore, 'getCheck' | 'getLiveView'>[] = [
    { getCheck: async () => { throw new Error(`${locator} ${record.encryptedLocator} ${env.BROWSERLESS_TOKEN}`); }, getLiveView: async () => null },
    { getCheck: async () => check, getLiveView: async () => { throw new Error(locator); } },
  ];
  for (const store of stores) {
    const response = await getOwnedLiveViewResponse({ ...options, store });
    const value = JSON.stringify(await body(response));
    assert.equal(response.status, 503);
    assert.ok(!value.includes(locator));
    assert.ok(!value.includes(record.encryptedLocator!));
    assert.ok(!value.includes(env.BROWSERLESS_TOKEN));
  }
});
