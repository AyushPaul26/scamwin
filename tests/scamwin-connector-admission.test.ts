import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../lib/scamwin/store';
import { admitConnectorTarget } from '../lib/scamwin/connectors/admission';
import { runConnectorTarget } from '../lib/scamwin/connectors/runner';
import { createConnectorTestStore } from './utils/scamwin-connector-test-db';
import { runInvestigation } from '../lib/scamwin/pipeline';
import { buildTargetInput, readParentOutcome } from '../lib/scamwin/connectors/targets';

export async function queued(store: Awaited<ReturnType<typeof createConnectorTestStore>>['store'], manual = false) {
  let c = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account', scope: ['inbox'] });
  if (!manual) c = await store.configureConnection(c, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 2 });
  await store.saveGrant(c, { accessToken: 'fixture', scopes: ['inbox'] });
  const value = { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'hello', urls: [], attachments: [] };
  const saved = manual ? await store.saveSelectedRevision(c, value) : await store.saveRevision(c, value);
  const input = { message: 'hello', url: null, images: [] };
  const job = await store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input });
  const lease = await store.leaseDueJob(); assert.ok(lease);
  return { c, saved, job, lease, input };
}

test('main outbox aggregate filter selects this check before leasing unrelated work', async () => {
  const main = new MemoryStore();
  const input = { url: '', message: 'hello', promisedBenefit: '', intendedAction: '', images: [] };
  const unrelated = await main.createCheck('bob', input, 'bob');
  const own = await main.createCheck('alice', input, 'alice');
  assert.equal((await main.leaseOutbox(1, ['investigate'], own.id))[0].aggregateId, own.id);
  assert.equal((await main.leaseOutbox(1, ['investigate']))[0].aggregateId, unrelated.id);
});

test('worker readiness precedes main clock and quota waits preserve automatic allowance', async () => {
  const f = await createConnectorTestStore();
  try {
    const q = await queued(f.store), main = new MemoryStore({ now: () => new Date('2026-11-10T12:00:00Z') });
    const outcome = await runConnectorTarget(q.lease, { mainStore: main, connectorStore: f.store, workerReady: false, now: () => new Date('2026-11-10T12:00:00Z') });
    assert.equal(outcome.status, 'deferred'); assert.equal((await main.listChecks('alice', {})).total, 0);
    f.advance(60001); const lease = await f.store.leaseDueJob(); assert.ok(lease);
    await main.createCheck('alice', { url: '', message: 'manual', images: [], promisedBenefit: '', intendedAction: '' }, 'existing');
    assert.equal((await admitConnectorTarget(lease, main, f.store, new Date('2026-11-10T12:01:00Z'))).status, 'deferred');
    assert.equal((await f.database.query("SELECT sum(used)::int AS used FROM connector_quotas WHERE id<>'automatic-lock'")).rows[0].used, 0);
  } finally { await f.close(); }
});

test('selected Manual uses main budget without automatic quota and exact ACK precedes pipeline', async () => {
  const f = await createConnectorTestStore();
  try {
    const q = await queued(f.store, true), main = new MemoryStore({ now: () => new Date('2026-11-10T12:00:00Z') });
    let calls = 0;
    const outcome = await runConnectorTarget(q.lease, { mainStore: main, connectorStore: f.store, workerReady: true, now: () => new Date('2026-11-10T12:00:00Z'), run: async (id, generation, store) => {
      calls++; assert.deepEqual(await store.leaseOutbox(1, ['investigate'], id), []);
      const c = await store.claimRun(id, generation); assert.ok(c);
      await store.updateRun(id, generation, c.revision, { state: 'failed', errorCode: 'fixture_terminal' });
    } });
    assert.equal(calls, 1); assert.equal(outcome.status, 'failed');
    assert.equal((await f.database.query("SELECT count(*)::int AS count FROM connector_quotas WHERE id<>'automatic-lock'")).rows[0].count, 0);
  } finally { await f.close(); }
});

test('failed exact outbox acknowledgment never executes or marks the connector target complete', async () => {
  const f = await createConnectorTestStore();
  try {
    const q = await queued(f.store), main = new MemoryStore({ now: () => new Date('2026-11-10T12:00:00Z') });
    main.finishOutbox = async () => false;
    const result = await runConnectorTarget(q.lease, { mainStore: main, connectorStore: f.store, workerReady: true, now: () => new Date('2026-11-10T12:00:00Z'), run: async () => assert.fail('ACK must succeed first') });
    assert.equal(result.status, 'deferred');
    assert.equal((await f.store.getRevision(q.c, q.saved.revision.id))?.manifest.counts.checked, 0);
    assert.equal((await main.listChecks('alice', {})).checks[0].state, 'queued');
  } finally { await f.close(); }
});

test('existing injected pipeline preserves partial delivery and strongest grounded payment risk across siblings', async () => {
  const f = await createConnectorTestStore();
  try {
    const q = await queued(f.store);
    const main = new MemoryStore({ now: () => new Date('2026-11-10T12:00:00Z') });
    const result = await runConnectorTarget(q.lease, { mainStore: main, connectorStore: f.store, workerReady: true, now: () => new Date('2026-11-10T12:00:00Z'), run: (id, gen, store, deps) => runInvestigation(id, gen, store, { ...deps, env: {} }) });
    assert.equal(result.status, 'completed'); assert.equal(result.childState, 'partial');
    assert.equal((await f.store.getRevision(q.c, q.saved.revision.id))?.manifest.coverage, 'partial');
    // A fresh owner keeps this evidence test independent of the daily owner quota.
    let c = await f.store.createConnection('evidence-owner', { provider: 'gmail', providerAccountId: 'evidence-account', scope: ['inbox'] });
    c = await f.store.configureConnection(c, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 2 });
    const saved = await f.store.saveRevision(c, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00Z', text: '', urls: ['https://example.com/pay', 'https://example.com/listing'], attachments: [] });
    const content = await f.store.readRevisionContent(c, saved.revision.id); assert.ok(content);
    for (const target of saved.revision.manifest.targets) await f.store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: target.id, generation: 1, input: { ...await buildTargetInput({ revision: saved.revision, content }, target.id), intendedAction: 'receive_money' } });
    for (let i = 0; i < 2; i++) {
      const lease = await f.store.leaseDueJob(); assert.ok(lease);
      await runConnectorTarget(lease, { mainStore: main, connectorStore: f.store, workerReady: true, now: () => new Date('2026-11-10T12:00:00Z'), run: async (id, generation, store, deps) => {
        const check = await store.getInternalCheck(id); assert.ok(check);
        const obs = (kind: string, data: Record<string, string | boolean>) => ({ id: `${id}-${kind}`, checkId: id, runId: check.runId, kind, status: 'observed' as const, sourceKind: 'live_page' as const, sourceRef: check.input.url, observedAt: new Date().toISOString(), collectorVersion: 'fixture', policyVersion: 'fixture', data });
        await runInvestigation(id, generation, store, { ...deps, env: { SCAMWIN_INDICATOR_HMAC_SECRET: 'x'.repeat(64) }, extract: async () => ({ promisedBenefit: 'Refund', claimedOrganization: null, intendedAction: 'receive_money', requestedActions: [], extractedCandidates: [], uncertainties: [] }), collect: async () => ({ observations: [obs('page', { text: 'Refund', readable: true, complete: true }), ...(check.input.url.endsWith('/pay') ? [obs('payment_action', { direction: 'outgoing', recipient: 'refund@example', selectedCheckpoint: true })] : []), obs('action_review', { complete: true })], captures: [] }), probe: async () => ({ ...obs('tls', { valid: true }), sourceKind: 'origin_probe' }), lookup: async () => ({ status: 'ready', message: '', warnings: [], chainId: 84532, checkedAt: new Date().toISOString() }), compare: async () => [] });
      } });
    }
    const parent = await readParentOutcome(c, saved.revision.id, { connectorStore: f.store, mainStore: main });
    assert.equal(parent?.risk, 'high_risk'); assert.equal(parent?.children.length, 2);
    assert.ok(parent?.children.find(child => child.risk === 'high_risk')?.evidenceIds.length);
    assert.ok(parent?.children.some(child => child.risk === 'no_observed_red_flags'));
    const high = parent!.children.find(child => child.risk === 'high_risk')!;
    await main.deleteCheck(c.ownerId, high.checkId);
    const deleted = await readParentOutcome(c, saved.revision.id, { connectorStore: f.store, mainStore: main });
    assert.equal(deleted?.risk, 'inconclusive'); assert.equal(deleted?.coverage, 'partial');
    assert.equal(deleted?.manifest.counts.checked, 1);
    assert.equal(deleted?.manifest.targets.find(t => t.id === 'url-0')?.status, 'unavailable');
  } finally { await f.close(); }
});
