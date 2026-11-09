import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../lib/scamwin/store';
import type { CheckInput, OutboxJob, ScamwinStore } from '../lib/scamwin/contracts';

const input: CheckInput = { url: 'https://example.org/', message: 'Synthetic offer', promisedBenefit: 'Refund', intendedAction: 'Receive money', images: [] };
async function runner() {
  const module = await import('../lib/scamwin/vercel-worker').catch(() => null);
  assert.ok(module?.runVercelInvestigation, 'Vercel investigation runner must be available');
  return module.runVercelInvestigation;
}
test('explicit Vercel selection works without a Trigger key and invalid backends fail closed', async () => {
  const module = await import('../lib/scamwin/investigation-backend').catch(() => null);
  assert.ok(module?.investigationBackend, 'Investigation backend selection must be available');
  const select = module.investigationBackend;
  assert.equal(select({ SCAMWIN_INVESTIGATION_BACKEND: 'vercel' }), 'vercel');
  assert.equal(select({ SCAMWIN_INVESTIGATION_BACKEND: 'vercel', TRIGGER_SECRET_KEY: 'synthetic' }), 'vercel');
  assert.equal(select({ TRIGGER_SECRET_KEY: 'synthetic' }), null);
  assert.equal(select({ SCAMWIN_INVESTIGATION_BACKEND: 'trigger', TRIGGER_SECRET_KEY: 'synthetic' }), 'trigger');
  assert.equal(select({ SCAMWIN_INVESTIGATION_BACKEND: 'trigger' }), null);
  assert.equal(select({ SCAMWIN_INVESTIGATION_BACKEND: 'typo', TRIGGER_SECRET_KEY: 'synthetic' }), null);
  assert.equal(select({ SCAMWIN_INVESTIGATION_BACKEND: '', TRIGGER_SECRET_KEY: 'synthetic' }), null);
  assert.equal(select({ SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY: 'synthetic' }), null);
  assert.equal(select({}), null);
});
test('runner leases one investigation, acknowledges before execution and leaves publication pending', async () => {
  const run = await runner(), events: string[] = [];
  class RecordingStore extends MemoryStore {
    override async leaseOutbox(limit?: number, kinds?: OutboxJob['kind'][]) {
      assert.equal(limit, 1); assert.deepEqual(kinds, ['investigate']);
      events.push('lease'); return super.leaseOutbox(limit, kinds);
    }
    override async finishOutbox(id: string, attempt: number, status: 'dispatched' | 'failed') {
      events.push(status); return super.finishOutbox(id, attempt, status);
    }
  }
  const store = new RecordingStore({ initialRoles: [{ ownerId: 'reviewer', role: 'reviewer' }] });
  const first = await store.createCheck('alice', input, 'first');
  await store.createCheck('bob', input, 'second');
  await store.saveObservation('alice', { id: 'page', checkId: first.id, runId: first.runId, kind: 'page', status: 'observed', sourceKind: 'live_page', sourceRef: input.url, observedAt: new Date().toISOString(), data: { text: 'Synthetic page' }, collectorVersion: 'test', policyVersion: 'test' });
  const warning = await store.submitWarning('alice', { checkId: first.id, hostname: 'example.org', summary: 'Synthetic reviewed warning', evidenceIds: ['page'], consent: true });
  await store.reviewWarning('reviewer', warning.id, { decision: 'approve', reason: 'Reviewed', expectedRevision: 1 });
  assert.equal(await run(store, { run: async (id, generation, target) => {
    events.push('run'); assert.equal(id, first.id); assert.equal(generation, 1);
    const claimed = await target.claimRun(id, generation); assert.ok(claimed);
    await target.updateRun(id, generation, claimed.revision, { state: 'completed' });
  } }), 1);
  assert.deepEqual(events, ['lease', 'dispatched', 'run']);
  const publication = await MemoryStore.prototype.leaseOutbox.call(store, 10, ['publish_warning', 'retract_warning']);
  assert.equal(publication.length, 1); assert.equal(publication[0].kind, 'publish_warning');
  const pending = await MemoryStore.prototype.leaseOutbox.call(store, 10, ['investigate']);
  assert.equal(pending.length, 1);
});
test('expired acknowledgement never starts the pipeline', async () => {
  const run = await runner(); let now = new Date('2026-11-09T11:00:00Z'), calls = 0;
  class ExpiringStore extends MemoryStore {
    override async leaseOutbox(limit?: number, kinds?: OutboxJob['kind'][]) {
      const jobs = await super.leaseOutbox(limit, kinds); now = new Date(now.getTime() + 60_000); return jobs;
    }
  }
  const store = new ExpiringStore({ now: () => now }), check = await store.createCheck('alice', input, 'first');
  assert.equal(await run(store, { run: async () => { calls++; } }), 0);
  assert.equal(calls, 0); assert.equal((await store.getInternalCheck(check.id))?.state, 'queued');
});
test('concurrent duplicate callbacks cannot execute the same delivery twice', async () => {
  const run = await runner(), store = new MemoryStore(); let calls = 0;
  const check = await store.createCheck('alice', input, 'first');
  const dependency = { run: async (id: string, generation: number, target: ScamwinStore) => {
    calls++; const claimed = await target.claimRun(id, generation); assert.ok(claimed);
    await target.updateRun(id, generation, claimed.revision, { state: 'completed' });
  } };
  assert.equal((await Promise.all([run(store, dependency), run(store, dependency)])).reduce((a, b) => a + b, 0), 1);
  assert.equal(calls, 1); assert.equal((await store.getInternalCheck(check.id))?.state, 'completed');
});
test('unexpected runner errors save a sanitized failure on the current active revision', async () => {
  const run = await runner(), store = new MemoryStore(), check = await store.createCheck('alice', input, 'first');
  assert.equal(await run(store, { run: async (id, generation, target) => {
    const claimed = await target.claimRun(id, generation); assert.ok(claimed);
    await target.updateRun(id, generation, claimed.revision, { state: 'collecting' });
    throw new Error('private provider token must never be persisted');
  } }), 1);
  const failed = await store.getInternalCheck(check.id);
  assert.equal(failed?.state, 'failed'); assert.equal(failed?.errorCode, 'investigation_unavailable');
  assert.doesNotMatch(JSON.stringify(failed), /private provider token/);
});
test('runner failure cannot overwrite completed, deleted, canceled or deadline-fenced checks', async () => {
  const run = await runner();
  for (const action of ['completed', 'deleted', 'canceled', 'expired'] as const) {
    let now = new Date('2026-11-09T11:00:00Z');
    const store = new MemoryStore({ now: () => now }), check = await store.createCheck('alice', input, action);
    await run(store, { run: async (id, generation, target) => {
      if (action === 'deleted') await target.deleteCheck('alice', id);
      else if (action === 'canceled') await target.requestCancel('alice', id);
      else if (action === 'expired') now = new Date(now.getTime() + 300_000);
      else { const claimed = (await target.claimRun(id, generation))!; await target.updateRun(id, generation, claimed.revision, { state: 'completed' }); }
      throw Error('private detail');
    } });
    const current = await store.getInternalCheck(check.id);
    assert.equal(current?.state ?? null, action === 'deleted' ? null : action === 'expired' ? 'failed' : action);
    assert.equal(current?.errorCode, action === 'expired' ? 'deadline_exceeded' : undefined);
  }
});
test('cancellation and deletion after leasing prevent execution', async () => {
  const run = await runner();
  for (const action of ['cancel', 'delete'] as const) {
    let calls = 0;
    class InterruptedStore extends MemoryStore {
      override async leaseOutbox(limit?: number, kinds?: OutboxJob['kind'][]) {
        const jobs = await super.leaseOutbox(limit, kinds);
        if (action === 'cancel') await this.requestCancel('alice', jobs[0].aggregateId);
        else await this.deleteCheck('alice', jobs[0].aggregateId);
        return jobs;
      }
    }
    const store = new InterruptedStore(); await store.createCheck('alice', input, action);
    assert.equal(await run(store, { run: async () => { calls++; } }), 0); assert.equal(calls, 0);
  }
});
