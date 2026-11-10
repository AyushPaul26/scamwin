import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/scamwin/store';
import { runInvestigation } from '../lib/scamwin/pipeline';
import type { CheckInput, Observation } from '../lib/scamwin/contracts';
import { verifyOfficialOffer } from '../lib/scamwin/official-verification';
import { officialFixtureCatalog, officialFixtureDocument, officialInput, officialIntent } from './fixtures/scamwin-official-fixture';
const input: CheckInput = { url: 'https://refund.example.com', message: 'Receive a refund', promisedBenefit: 'Refund', intendedAction: 'receive_money', images: [] };
test('worker saves grounded payment evidence and a cited high-risk assessment', async () => {
  const store = new MemoryStore(), c = await store.createCheck('owner', input, 'one');
  const evidence = (kind: string, data: Observation['data']): Observation => ({ id: kind, checkId: c.id, runId: c.runId, kind, status: 'observed', sourceKind: 'live_page', sourceRef: input.url, observedAt: new Date().toISOString(), collectorVersion: 'test', policyVersion: 'test', data });
  await runInvestigation(c.id, 1, store, { env: { SCAMWIN_INDICATOR_HMAC_SECRET: 'x'.repeat(64) }, extract: async () => ({ promisedBenefit: 'Refund', claimedOrganization: null, intendedAction: 'receive_money', requestedActions: [], extractedCandidates: [], uncertainties: [] }), collect: async () => ({ observations: [evidence('page', { text: 'Pay ₹1', readable: true, complete: true }), evidence('payment_action', { direction: 'outgoing', recipient: 'refund@example', selectedCheckpoint: true }), evidence('action_review', { complete: true })], captures: [] }), probe: async () => ({ ...evidence('tls', { valid: true }), sourceKind: 'origin_probe' }), lookup: async () => ({ status: 'ready', message: '', warnings: [], chainId: 84532, checkedAt: new Date().toISOString() }), compare: async () => [] });
  const result = await store.getCheck('owner', c.id);
  assert.equal(result?.state, 'completed'); assert.equal(result?.assessment?.risk, 'high_risk');
  assert.deepEqual(result?.assessment?.findings[0].evidenceIds, ['payment_action']);
  assert.equal((await store.listObservations('other', c.id)).length, 0);
});
test('unconfigured providers produce partial evidence, never a synthetic clean result', async () => {
  const store = new MemoryStore(), c = await store.createCheck('owner', { ...input, url: 'https://example.com' }, 'two');
  await runInvestigation(c.id, 1, store, { env: {} });
  const result = await store.getCheck('owner', c.id);
  assert.equal(result?.state, 'partial'); assert.equal(result?.assessment?.risk, 'inconclusive');
  assert.ok(result?.assessment?.missingChecks.length);
});
test('cancellation and duplicate delivery do not restart the run', async () => {
  const store = new MemoryStore(), c = await store.createCheck('owner', input, 'three');
  await store.requestCancel('owner', c.id);
  await runInvestigation(c.id, 1, store, { env: {} });
  assert.equal((await store.getCheck('owner', c.id))?.state, 'canceled');
  await runInvestigation(c.id, 1, store, { env: {} });
  assert.equal((await store.getCheck('owner', c.id))?.state, 'canceled');
});
test('submitted screenshots remain traceable private artifacts, never live-page evidence', async () => {
  const store=new MemoryStore(), c=await store.createCheck('owner',{...input,url:'',images:[{name:'offer.png',mediaType:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'}]},'image');
  await runInvestigation(c.id,1,store,{env:{}});
  const observations=await store.listObservations('owner',c.id), image=observations.find(o=>o.kind==='submitted_image');
  assert.equal(image?.sourceKind,'user_image'); assert.ok(image?.artifactId);
  assert.equal((await store.getArtifact('owner',image!.artifactId!))?.name,'offer.png');
  assert.equal(await store.getArtifact('other',image!.artifactId!),null);
});

test('official stage runs after browser teardown and preserves an observed payment risk', async () => {
  const store = new MemoryStore(), c = await store.createCheck('official-owner', { ...officialInput, intendedAction: 'receive_money' }, 'official-enabled');
  let browserEnded = false, officialCalls = 0;
  const obs = (kind: string, data: Observation['data']): Observation => ({ id: kind, checkId: c.id, runId: c.runId, kind, status: 'observed', sourceKind: 'live_page', sourceRef: c.input.url, observedAt: new Date().toISOString(), collectorVersion: 'test', policyVersion: 'test', data });
  await runInvestigation(c.id, 1, store, { env: { SCAMWIN_OFFICIAL_VERIFICATION_ENABLED: 'true' }, extract: async () => officialIntent, collect: async () => { browserEnded = true; return { observations: [obs('page', { text: 'Pay a fee', readable: true, complete: true }), obs('payment_action', { direction: 'outgoing', recipient: 'test@example', selectedCheckpoint: true }), obs('action_review', { complete: true })], captures: [] }; }, probe: async () => ({ ...obs('tls', { valid: true }), sourceKind: 'origin_probe' }), compare: async () => [], lookup: async () => ({ status: 'ready', message: '', warnings: [], chainId: 84532 }), verifyOfficial: async args => {
    officialCalls++; assert.equal(browserEnded, true);
    const latest = await store.getCheck('official-owner', c.id);
    assert.equal(latest?.stages.find(stage => stage.id === 'browser')?.status, 'completed');
    assert.equal(latest?.state, 'collecting');
    let i = 0;
    return verifyOfficialOffer({ ...args, pipelineDeadlineAtMs: Date.parse('2026-11-10T12:04:00Z') }, { catalog: officialFixtureCatalog, reader: async source => officialFixtureDocument(source), now: () => new Date('2026-11-10T12:00:00Z'), makeId: () => `official-evidence-${++i}` });
  } });
  const saved = await store.getCheck('official-owner', c.id);
  assert.equal(officialCalls, 1);
  assert.equal(saved?.assessment?.risk, 'high_risk');
  assert.equal(saved?.stages.find(stage => stage.id === 'official')?.status, 'completed');
  assert.ok((await store.listObservations('official-owner', c.id)).some(item => item.kind === 'official_offer' && item.data.offerStatus === 'matched_public_reference'));
});

test('disabled official feature never reads new sources and its stage is skipped', async () => {
  const store = new MemoryStore(), c = await store.createCheck('disabled-owner', input, 'official-disabled');
  let officialCalls = 0;
  await runInvestigation(c.id, 1, store, { env: {}, extract: async () => officialIntent, collect: async () => ({ observations: [], captures: [] }), probe: async () => ({ id: 'no-tls', checkId: c.id, runId: c.runId, kind: 'tls', status: 'not_checked', sourceKind: 'origin_probe', sourceRef: input.url, observedAt: new Date().toISOString(), data: {}, collectorVersion: 'test', policyVersion: 'test' }), verifyOfficial: async () => { officialCalls++; return []; } });
  assert.equal(officialCalls, 0);
  assert.equal((await store.getCheck('disabled-owner', c.id))?.stages.find(stage => stage.id === 'official')?.status, 'skipped');
});

test('an unexpected official-source failure leaves a partial assessment instead of failing existing checks', async () => {
  const store = new MemoryStore(), c = await store.createCheck('failure-owner', input, 'official-failure');
  await runInvestigation(c.id, 1, store, { env: { SCAMWIN_OFFICIAL_VERIFICATION_ENABLED: 'true' }, extract: async () => officialIntent, collect: async () => ({ observations: [], captures: [] }), verifyOfficial: async () => { throw Error('private internal detail'); } });
  const saved = await store.getCheck('failure-owner', c.id);
  assert.equal(saved?.state, 'partial');
  assert.equal(saved?.stages.find(stage => stage.id === 'official')?.status, 'unavailable');
  assert.ok(saved?.assessment?.missingChecks.length);
  assert.equal(JSON.stringify(await store.listObservations('failure-owner', c.id)).includes('private internal detail'), false);
});

test('canceling during official collection prevents late records and duplicate execution', async () => {
  const store = new MemoryStore(), c = await store.createCheck('cancel-official-owner', officialInput, 'cancel-official');
  let calls = 0;
  const dependencies = { env: { SCAMWIN_OFFICIAL_VERIFICATION_ENABLED: 'true' }, extract: async () => officialIntent, collect: async () => ({ observations: [], captures: [] }), verifyOfficial: async () => {
    calls++;
    await store.requestCancel('cancel-official-owner', c.id);
    return [{ id: 'late-official', checkId: c.id, runId: c.runId, kind: 'official_company', sourceKind: 'official_source' as const, sourceRef: 'catalog:test', observedAt: new Date().toISOString(), status: 'observed' as const, data: {}, collectorVersion: 'test', policyVersion: 'test' }];
  } };
  await runInvestigation(c.id, 1, store, dependencies);
  await runInvestigation(c.id, 1, store, dependencies);
  assert.equal(calls, 1);
  assert.equal((await store.getCheck('cancel-official-owner', c.id))?.state, 'canceled');
  assert.equal((await store.listObservations('cancel-official-owner', c.id)).some(item => item.id === 'late-official'), false);
});

