import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInvestigation } from '../lib/scamwin/pipeline';
import { MemoryStore } from '../lib/scamwin/store';
import type { CheckInput, Observation } from '../lib/scamwin/contracts';

const input: CheckInput = { url: 'https://scamwin.vercel.app/lab/refund-checkpoint', message: 'Refund', promisedBenefit: 'Refund', intendedAction: 'receive_money', images: [] };
const env = { SCAMWIN_LIVE_VIEW_ENABLED: 'true', SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY: '11'.repeat(32), BROWSERLESS_BASE_URL: 'https://production-sfo.browserless.io', SCAMWIN_INDICATOR_HMAC_SECRET: '22'.repeat(32) };
const intent = { promisedBenefit: 'Refund', claimedOrganization: null, intendedAction: 'send_money', requestedActions: [], extractedCandidates: [], uncertainties: [] };

test('pipeline persists a private live capability only during the real browser stage and records six timed stages', async () => {
  const store = new MemoryStore(), check = await store.createCheck('owner', input, 'live');
  const scope = { ownerId: 'owner', checkId: check.id, runId: check.runId, generation: 1 };
  const observation = (kind: string, data: Observation['data']): Observation => ({ id: kind, checkId: check.id, runId: check.runId, kind, data, sourceKind: 'live_page', sourceRef: input.url, status: 'observed', observedAt: new Date().toISOString(), collectorVersion: 'test', policyVersion: 'test' });
  const locator = 'https://production-sfo.browserless.io/live/private-viewer';
  await runInvestigation(check.id, 1, store, { env, extract: async () => intent, collect: async (_url, _source, options) => {
    const current = (await store.getCheck('owner', check.id))!;
    assert.equal(current.stages.find(stage => stage.id === 'intake')?.status, 'completed');
    assert.equal(current.stages.find(stage => stage.id === 'browser')?.status, 'running');
    await options!.onProgress!('navigate');
    const issuedAt = new Date().toISOString();
    await options!.onLiveViewReady!({ liveURL: locator, liveURLId: 'provider-id', targetId: 'page-id', timeoutMs: 30_000, issuedAt, expiresAt: new Date(Date.now() + 30_000).toISOString(), providerOrigin: env.BROWSERLESS_BASE_URL });
    const live = await store.getLiveView('owner', check.id, scope);
    assert.equal(live?.status, 'ready');
    assert.ok(live?.encryptedLocator);
    assert.doesNotMatch(JSON.stringify(live), /private-viewer|provider-id/);
    assert.equal(await store.getLiveView('other', check.id, scope), null);
    await options!.onLiveViewConnected!();
    assert.equal((await store.getLiveView('owner', check.id, scope))?.status, 'connected');
    await options!.onLiveViewEnded!({ reasonCode: 'collection_complete' });
    assert.equal((await store.getLiveView('owner', check.id, scope))?.encryptedLocator, null);
    return { observations: [observation('page', { readable: true, complete: true, text: 'Pay a fee' }), observation('payment_action', { direction: 'outgoing', recipient: 'example@invalid', selectedCheckpoint: true }), observation('action_review', { complete: true })], captures: [] };
  }, probe: async () => ({ ...observation('tls', { valid: true }), sourceKind: 'origin_probe' }), lookup: async () => ({ status: 'ready', message: '', chainId: 84532, warnings: [] }), compare: async () => [] });
  const final = (await store.getCheck('owner', check.id))!;
  assert.equal(final.state, 'completed');
  assert.equal(final.assessment?.risk, 'high_risk'); // The submitted intention remains authoritative.
  assert.deepEqual(final.stages.map(stage => stage.id), ['intake', 'browser', 'trust', 'registry', 'comparison', 'assessment']);
  assert.ok(final.stages.every(stage => stage.status === 'completed' && stage.startedAt && stage.finishedAt));
  assert.doesNotMatch(JSON.stringify(final) + JSON.stringify(await store.listObservations('owner', check.id)), /private-viewer|encryptedLocator|provider-id/);
});

test('a collector failure retires its locator and freezes genuine progress without inventing completed stages', async () => {
  const store = new MemoryStore(), check = await store.createCheck('owner', input, 'failure');
  const scope = { ownerId: 'owner', checkId: check.id, runId: check.runId, generation: 1 };
  await runInvestigation(check.id, 1, store, { env, extract: async () => intent, collect: async (_url, _source, options) => {
    const issuedAt = new Date().toISOString();
    await options!.onLiveViewReady!({ liveURL: 'https://production-sfo.browserless.io/live/failed', liveURLId: 'provider-id', targetId: 'page-id', timeoutMs: 30_000, issuedAt, expiresAt: new Date(Date.now() + 30_000).toISOString(), providerOrigin: env.BROWSERLESS_BASE_URL });
    throw Error('collection failed');
  } });
  const final = (await store.getCheck('owner', check.id))!;
  assert.equal(final.state, 'failed');
  assert.equal(final.stages.find(stage => stage.id === 'browser')?.status, 'unavailable');
  assert.equal(final.stages.find(stage => stage.id === 'trust')?.status, 'skipped');
  assert.equal((await store.getLiveView('owner', check.id, scope))?.encryptedLocator ?? null, null);
});

test('an unsupported stream and a missing encryption key have durable unavailable metadata without blocking evidence collection', async () => {
  for (const missingKey of [false, true]) {
    const store = new MemoryStore(), check = await store.createCheck('owner', input, `unavailable-${missingKey}`);
    let collected = false;
    await runInvestigation(check.id, 1, store, { env: { ...env, ...(missingKey ? { SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY: '' } : {}) }, extract: async () => intent,
      collect: async (_url, _source, options) => {
        collected = true;
        if (missingKey) assert.equal(options?.onLiveViewReady, undefined);
        else await options!.onLiveViewUnavailable!({ reasonCode: 'live_view_provider_error' });
        const row = await store.getLiveView('owner', check.id, { runId: check.runId, generation: 1 });
        assert.equal(row?.status, 'unavailable'); assert.equal(row?.encryptedLocator, null);
        return { observations: [], captures: [] };
      },
    });
    assert.equal(collected, true);
    assert.equal((await store.getCheck('owner', check.id))?.state, 'partial');
  }
});

test('a missing observed page cannot complete the promise/request comparison', async () => {
  const store = new MemoryStore(), check = await store.createCheck('owner', input, 'missing-page');
  await runInvestigation(check.id, 1, store, { env: {}, extract: async () => intent, collect: async () => ({ observations: [], captures: [] }), compare: async () => [] });
  assert.equal((await store.getCheck('owner', check.id))?.stages.find(stage => stage.id === 'comparison')?.status, 'unavailable');
});

test('a failed final result save never leaves the assessment stage marked completed', async () => {
  const store = new MemoryStore(), check = await store.createCheck('owner', input, 'failed-result');
  const update = store.updateRun.bind(store);
  store.updateRun = async (id, generation, revision, patch) => { if (patch.assessment) throw Error('temporary result write failure'); return update(id, generation, revision, patch); };
  await runInvestigation(check.id, 1, store, { env: {}, extract: async () => intent, collect: async () => ({ observations: [], captures: [] }), compare: async () => [] });
  const final = (await store.getCheck('owner', check.id))!;
  assert.equal(final.state, 'failed'); assert.equal(final.assessment, undefined);
  assert.equal(final.stages.find(stage => stage.id === 'assessment')?.status, 'unavailable');
});
