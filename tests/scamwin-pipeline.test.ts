import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/scamwin/store';
import { runInvestigation } from '../lib/scamwin/pipeline';
import type { CheckInput, Observation } from '../lib/scamwin/contracts';
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

