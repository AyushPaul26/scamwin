import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { MemoryStore } from '../lib/scamwin/store';
import { admitConnectorTarget } from '../lib/scamwin/connectors/admission';
import { runConnectorTarget } from '../lib/scamwin/connectors/runner';
import { reconcileConnectorJobs } from '../lib/scamwin/connectors/reconcile';
import { createConnectorTestStore } from './utils/scamwin-connector-test-db';
import { PostgresConnectorStore, type ConnectorDatabase } from '../lib/scamwin/connectors/store';

let shared: Awaited<ReturnType<typeof createConnectorTestStore>> | undefined;
after(async () => { await shared?.close(); });
async function setup() {
  if (shared) await shared.reset(); else shared = await createConnectorTestStore();
  const f = shared; let clock = Date.parse('2026-11-10T12:00:00Z');
  const now = () => new Date(clock), advance = (ms: number) => { clock += ms; f.advance(ms); };
  const main = new MemoryStore({ now });
  const c0 = await f.store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account', scope: ['inbox'] });
  const c = await f.store.configureConnection(c0, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 2 });
  const saved = await f.store.saveRevision(c, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: now().toISOString(), text: 'hello', urls: [], attachments: [] });
  const input = { message: 'hello', url: null, images: [] };
  const job = await f.store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input });
  const lease = await f.store.leaseDueJob(1000); assert.ok(lease);
  return { ...f, close: async () => undefined, main, c, saved, input, job, lease, now, advance };
}

test('crash after main create recovers identical check with stable key and stale lease cannot overwrite', async () => {
  const f = await setup();
  try {
    const check = await f.main.createCheck('alice', { ...f.input, url: '', promisedBenefit: '', intendedAction: '' }, f.job.admissionKey);
    f.advance(1001); const next = await f.store.leaseDueJob(); assert.ok(next);
    const recovered = await admitConnectorTarget(next, f.main, f.store, f.now());
    assert.equal(recovered.status, 'admitted'); if (recovered.status === 'admitted') assert.equal(recovered.check.id, check.id);
    await assert.rejects(f.store.recordAdmission(f.lease, check.id), /stale_lease/);
    assert.equal((await f.main.listChecks('alice', {})).total, 1);
  } finally { await f.close(); }
});

test('crash after ACK waits for authoritative deadline then allows only one separately budgeted retry', async () => {
  const f = await setup();
  try {
    const result = await admitConnectorTarget(f.lease, f.main, f.store, f.now()); assert.equal(result.status, 'admitted'); if (result.status !== 'admitted') return;
    const [outbox] = await f.main.leaseOutbox(1, ['investigate'], result.check.id); await f.main.finishOutbox(outbox.id, outbox.attempts, 'dispatched');
    f.advance(1001); const next = await f.store.leaseDueJob(); assert.ok(next);
    let calls = 0;
    assert.equal((await runConnectorTarget(next, { mainStore: f.main, connectorStore: f.store, workerReady: true, now: f.now, run: async () => { calls++; } })).status, 'deferred');
    assert.equal(calls, 0);
    f.advance(300000);
    const summary = await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
    assert.equal(summary.retried, 1);
    const retry = await f.store.leaseDueJob(); assert.ok(retry); assert.equal(retry.job.generation, 2);
    const admitted = await admitConnectorTarget(retry, f.main, f.store, f.now()); assert.equal(admitted.status, 'admitted');
    f.advance(300001);
    assert.equal((await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store })).retried, 0);
    assert.equal(await f.store.leaseDueJob(), null);
  } finally { await f.close(); }
});

test('deleted check is unavailable suppression, never a new key or assumed owner-deletion', async () => {
  const f = await setup();
  try {
    const result = await admitConnectorTarget(f.lease, f.main, f.store, f.now()); assert.equal(result.status, 'admitted'); if (result.status !== 'admitted') return;
    await f.main.deleteCheck('alice', result.check.id); f.advance(1001);
    const next = await f.store.leaseDueJob(); assert.ok(next);
    const outcome = await runConnectorTarget(next, { mainStore: f.main, connectorStore: f.store, workerReady: true, now: f.now, run: async () => { assert.fail('must not execute'); } });
    assert.equal(outcome.status, 'suppressed'); assert.equal(outcome.reason, 'main_check_unavailable');
    await assert.rejects(f.store.enqueueTarget(f.c, { revisionId: f.saved.revision.id, targetId: 'body-0', generation: 2, input: f.input }), /recheck_requires_user/);
  } finally { await f.close(); }
});

test('disconnect after admission cancels owned work and forbids stale epoch completion', async () => {
  const f = await setup();
  try {
    const result = await admitConnectorTarget(f.lease, f.main, f.store, f.now()); assert.equal(result.status, 'admitted'); if (result.status !== 'admitted') return;
    await f.store.revokeConnection('alice', f.c.id, f.c.epoch);
    await runConnectorTarget({ ...f.lease, job: { ...f.job, checkId: result.check.id } }, { mainStore: f.main, connectorStore: f.store, workerReady: true, now: f.now, run: async () => { assert.fail('must not execute'); } });
    assert.equal((await f.main.getCheck('alice', result.check.id))?.state, 'canceled');
    assert.deepEqual(await f.store.listPendingDisconnectCheckIds('alice', f.c.id), []);
  } finally { await f.close(); }
});

test('reconciliation independently drains persisted disconnect cancellation without leasing the revoked epoch', async () => {
  const f = await setup();
  try {
    const result = await admitConnectorTarget(f.lease, f.main, f.store, f.now()); assert.equal(result.status, 'admitted'); if (result.status !== 'admitted') return;
    await f.store.revokeConnection('alice', f.c.id, f.c.epoch);
    await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
    assert.equal((await f.main.getCheck('alice', result.check.id))?.state, 'canceled');
    assert.deepEqual(await f.store.listPendingDisconnectCheckIds('alice', f.c.id), []);
  } finally { await f.close(); }
});

test('body expiry produces explicit not-checked parent coverage without ever admitting main work', async () => {
  const f = await setup();
  try {
    f.advance(30 * 86400000 + 1); await f.store.purgeExpired();
    const revision = await f.store.getRevision(f.c, f.saved.revision.id);
    assert.equal(revision?.manifest.coverage, 'partial');
    assert.equal(revision?.manifest.targets[0].reason, 'content_expired');
    assert.equal(revision?.manifest.counts.pending, 0);
    assert.equal(await f.store.leaseDueJob(), null);
    assert.equal((await f.main.listChecks('alice', {})).total, 0);
  } finally { await f.close(); }
});

test('duplicate deliveries and leases serialize, and an older revision cannot replace the latest parent state', async () => {
  const f = await setup();
  try {
    const attempts = await Promise.all([1, 2].map(() => f.store.enqueueTarget(f.c, { revisionId: f.saved.revision.id, targetId: 'body-0', generation: 1, input: f.input })));
    assert.equal(attempts[0].id, attempts[1].id);
    assert.deepEqual(await Promise.all([f.store.leaseDueJob(), f.store.leaseDueJob()]), [null, null]);
    const edit = await f.store.saveRevision(f.c, { providerItemId: 'mail', revisionHash: 'b'.repeat(64), receivedAt: f.now().toISOString(), text: 'new edited body', urls: [], attachments: [] });
    await f.store.recordAdmission(f.lease, 'old-check');
    await f.store.finishJob(f.lease, { status: 'completed', childState: 'completed' });
    const parent = await f.store.getItem(f.c, f.saved.item.id);
    assert.equal(parent?.latestRevisionId, edit.revision.id); assert.equal(parent?.state, 'queued');
  } finally { await f.close(); }
});

test('submission_expired after lost admission save suppresses instead of generating another key', async () => {
  const f = await setup();
  try {
    const check = await f.main.createCheck('alice', { ...f.input, url: '', promisedBenefit: '', intendedAction: '' }, f.job.admissionKey);
    await f.main.deleteCheck('alice', check.id);
    const result = await runConnectorTarget(f.lease, { mainStore: f.main, connectorStore: f.store, workerReady: true, now: f.now, run: async () => assert.fail('must not run') });
    assert.equal(result.status, 'suppressed'); assert.equal(result.reason, 'submission_expired');
    assert.equal(await f.store.leaseDueJob(), null);
  } finally { await f.close(); }
});

test('terminal interrupted outcome and retry enqueue commit together and keep parent pending', async () => {
  const f = await setup();
  try {
    const result = await admitConnectorTarget(f.lease, f.main, f.store, f.now()); assert.equal(result.status, 'admitted');
    f.advance(300001); const lease = await f.store.leaseDueJob(); assert.ok(lease);
    await runConnectorTarget(lease, { mainStore: f.main, connectorStore: f.store, workerReady: true, now: f.now, run: async () => assert.fail('expired run') });
    const retry = await f.store.leaseDueJob(); assert.ok(retry); assert.equal(retry.job.generation, 2);
    assert.equal((await f.store.getRevision(f.c, f.saved.revision.id))?.manifest.counts.pending, 1);
    assert.equal((await f.store.readJobInput(retry)).message, 'hello');
  } finally { await f.close(); }
});

test('disconnect racing main commit retains cancellation intent even when immediate cancellation fails', async () => {
  const f = await setup();
  try {
    const create = f.main.createCheck.bind(f.main), cancel = f.main.requestCancel.bind(f.main);
    f.main.createCheck = async (...args) => { const check = await create(...args); await f.store.revokeConnection('alice', f.c.id, f.c.epoch); return check; };
    f.main.requestCancel = async () => { throw new Error('transient_main_outage'); };
    await assert.rejects(admitConnectorTarget(f.lease, f.main, f.store, f.now()));
    assert.equal((await f.store.listPendingDisconnectCheckIds('alice', f.c.id)).length, 1);
    f.main.requestCancel = cancel;
    await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
    assert.equal((await f.main.listChecks('alice', {})).checks[0].state, 'canceled');
  } finally { await f.close(); }
});

test('external main worker occupancy survives connector deferral and blocks a second automatic owner until terminal reconciliation', async () => {
  const f = await setup();
  const admitted = await admitConnectorTarget(f.lease, f.main, f.store, f.now()); assert.equal(admitted.status, 'admitted'); if (admitted.status !== 'admitted') return;
  const first = await f.main.claimRun(admitted.check.id, admitted.check.generation); assert.ok(first);
  assert.equal((await runConnectorTarget(f.lease, { mainStore: f.main, connectorStore: f.store, workerReady: true, now: f.now, run: async () => assert.fail('external worker owns run') })).status, 'deferred');
  let other = await f.store.createConnection('bob', { provider: 'gmail', providerAccountId: 'second-account', scope: ['inbox'] });
  other = await f.store.configureConnection(other, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
  const saved = await f.store.saveRevision(other, { providerItemId: 'mail', revisionHash: 'b'.repeat(64), receivedAt: f.now().toISOString(), text: 'second', urls: [], attachments: [] });
  await f.store.enqueueTarget(other, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { ...f.input, message: 'second' } });
  assert.equal(await f.store.leaseDueJob(), null);
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  assert.equal(await f.store.leaseDueJob(), null);
  await f.main.updateRun(first.id, first.generation, first.revision, { state: 'failed', errorCode: 'known_terminal' });
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  const next = await f.store.leaseDueJob(); assert.ok(next); assert.equal(next.ref.ownerId, 'bob');
});

test('ambiguous committed admission followed by process death and disconnect is located without creating work', async () => {
  const f = await setup(); const create = f.main.createCheck.bind(f.main);
  f.main.createCheck = async (...args) => { await create(...args); throw new Error('process_died_after_main_commit'); };
  await assert.rejects(admitConnectorTarget(f.lease, f.main, f.store, f.now()), /process_died/);
  await f.store.revokeConnection('alice', f.c.id, f.c.epoch);
  f.main.createCheck = async () => assert.fail('disconnected recovery must never create');
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  const [check] = (await f.main.listChecks('alice', {})).checks;
  assert.equal(check.state, 'canceled'); assert.deepEqual(await f.main.leaseOutbox(1, ['investigate'], check.id), []);
  assert.deepEqual(await f.store.listPendingDisconnectCheckIds('alice', f.c.id), []);
});

test('ambiguous null lookup retains intent and finds a delayed main commit on a later disconnected reconciliation', async () => {
  const f = await setup(); const create = f.main.createCheck.bind(f.main);
  f.main.createCheck = async () => { throw new Error('transport_outcome_unknown'); };
  await assert.rejects(admitConnectorTarget(f.lease, f.main, f.store, f.now()));
  await f.store.revokeConnection('alice', f.c.id, f.c.epoch);
  f.main.createCheck = async () => assert.fail('recovery cannot create');
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  const check = await create('alice', { ...f.input, url: '', promisedBenefit: '', intendedAction: '' }, f.job.admissionKey);
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  assert.equal((await f.main.getCheck('alice', check.id))?.state, 'canceled');
});

test('owner and submission lookup is read-only, never admits, and does not expose another owner', async () => {
  let clock = Date.parse('2026-11-10T12:00:00Z'); const main = new MemoryStore({ now: () => new Date(clock) });
  const input = { url: '', message: 'lookup', promisedBenefit: '', intendedAction: '', images: [] };
  assert.equal(await main.findCheckBySubmissionKey('alice', 'key'), null);
  const check = await main.createCheck('alice', input, 'key');
  assert.equal(await main.findCheckBySubmissionKey('bob', 'key'), null);
  assert.equal((await main.findCheckBySubmissionKey('alice', 'key'))?.id, check.id);
  clock += 300001;
  assert.equal((await main.findCheckBySubmissionKey('alice', 'key'))?.state, 'queued');
  assert.equal((await main.getCheck('alice', check.id))?.state, 'failed');
  await main.deleteCheck('alice', check.id);
  assert.equal(await main.findCheckBySubmissionKey('alice', 'key'), null);
});

test('expiry and completion obey connection-job-revision serialization and preserve both terminal outcomes in either serial order', async () => {
  // PGlite has no independent concurrent sessions. This controlled protocol guard
  // checks locks acquired by executed SQL, plus both valid serial outcomes; it is
  // deliberately not presented as a concurrent PostgreSQL acceptance test.
  for (const terminal of ['completed', 'partial'] as const) for (const first of ['expiry', 'completion'] as const) {
    const f = await setup(); await f.store.recordAdmission(f.lease, 'owned-main-check');
    await f.database.query('UPDATE connector_revisions SET content_expires_at=$1 WHERE id=$2', ['2026-11-10T11:59:59Z', f.saved.revision.id]);
    await f.database.query('UPDATE connector_jobs SET content_expires_at=$1 WHERE id=$2', ['2026-11-10T11:59:59Z', f.job.id]);
    const guardedDatabase: ConnectorDatabase = {
      query: f.database.query,
      transaction: fn => f.database.transaction(async db => {
        const connections = new Set<string>(), jobs = new Set<string>();
        return fn({ query: async (sql, values) => {
          if (/^SELECT.*FROM connector_revisions /s.test(sql) || /^UPDATE connector_revisions /.test(sql)) {
            assert.ok(connections.has(f.c.id), 'manifest access requires the connection serialization lock');
            assert.ok(jobs.has(f.job.id), 'manifest access follows job locking, never the reverse');
          }
          const result = await db.query(sql, values);
          if (/^SELECT.*FROM connector_connections .*FOR UPDATE/s.test(sql)) for (const row of result.rows) connections.add(String(row.id));
          if (/^SELECT.*FROM connector_jobs .*FOR UPDATE/s.test(sql)) {
            assert.ok(connections.has(f.c.id), 'job lock follows connection lock');
            for (const row of result.rows) jobs.add(String(row.id));
          }
          return result;
        } });
      }),
    };
    const store = new PostgresConnectorStore(guardedDatabase, { keyring: f.keyring, now: f.now });
    const complete = () => store.finishJob(f.lease, { status: 'completed', childState: terminal });
    if (first === 'expiry') { await store.purgeExpired(); await complete(); }
    else { await complete(); await store.purgeExpired(); }
    const revision = await f.store.getRevision(f.c, f.saved.revision.id);
    assert.equal(revision?.manifest.targets[0].status, terminal === 'completed' ? 'checked' : 'partial');
    assert.equal(revision?.manifest.counts.checked, terminal === 'completed' ? 1 : 0);
    assert.equal(revision?.manifest.coverage, terminal === 'completed' ? 'complete' : 'partial');
    assert.equal((await f.store.getItem(f.c, f.saved.item.id))?.state, terminal === 'completed' ? 'result_ready' : 'partial');
  }
});

test('fenced disconnected intent releases occupancy while its source tombstone survives until metadata retention', async () => {
  const f = await setup();
  f.main.createCheck = async () => { throw new Error('unknown_commit_outcome'); };
  await assert.rejects(admitConnectorTarget(f.lease, f.main, f.store, f.now()));
  await f.store.revokeConnection('alice', f.c.id, f.c.epoch);
  f.advance(30 * 86400000 + 1); await f.store.purgeExpired();
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  assert.deepEqual(await f.store.listAdmissionIntents(), []);
  const row = (await f.database.query('SELECT encrypted_input,admission_resolved_at,reason FROM connector_jobs WHERE id=$1', [f.job.id])).rows[0];
  assert.equal(row.encrypted_input, null); assert.ok(row.admission_resolved_at); assert.equal(row.reason, 'admission_deadline_expired');
  f.advance(60 * 86400000); await f.store.purgeExpired();
  assert.deepEqual(await f.store.listAdmissionIntents(), []);
  assert.equal((await f.database.query('SELECT id FROM connector_jobs WHERE id=$1', [f.job.id])).rows.length, 0);
});

test('cancel_requested remains automatic occupancy until main cancellation is terminal', async () => {
  const f = await setup();
  const admitted = await admitConnectorTarget(f.lease, f.main, f.store, f.now()); assert.equal(admitted.status, 'admitted'); if (admitted.status !== 'admitted') return;
  await f.main.claimRun(admitted.check.id, admitted.check.generation);
  await f.store.revokeConnection('alice', f.c.id, f.c.epoch);
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  assert.equal((await f.main.getCheck('alice', admitted.check.id))?.state, 'cancel_requested');
  assert.equal((await f.store.listAdmissionIntents()).length, 1);
  let other = await f.store.createConnection('bob', { provider: 'gmail', providerAccountId: 'after-cancel', scope: ['inbox'] });
  other = await f.store.configureConnection(other, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
  const saved = await f.store.saveRevision(other, { providerItemId: 'mail', revisionHash: 'b'.repeat(64), receivedAt: f.now().toISOString(), text: 'other', urls: [], attachments: [] });
  await f.store.enqueueTarget(other, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: f.input });
  assert.equal(await f.store.leaseDueJob(), null);
  f.advance(300001); await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  assert.equal((await f.main.getCheck('alice', admitted.check.id))?.state, 'canceled');
  assert.deepEqual(await f.store.listAdmissionIntents(), []);
  assert.equal((await f.store.leaseDueJob())?.ref.ownerId, 'bob');
});

test('main admission deadline rejects late insertion without budget use and preserves same-key recovery and deleted metadata', async () => {
  let clock = Date.parse('2026-11-10T12:00:00Z'); const main = new MemoryStore({ now: () => new Date(clock) });
  const input = { url: '', message: 'bounded admission', promisedBenefit: '', intendedAction: '', images: [] };
  const deadline = '2026-11-10T12:00:30.000Z';
  clock += 30001;
  await assert.rejects(main.createCheck('alice', input, 'late', deadline), /admission_deadline_expired/);
  assert.equal((await main.listChecks('alice', {})).total, 0); assert.deepEqual(await main.leaseOutbox(), []);
  assert.deepEqual(await main.lookupCheckAdmission('alice', 'late', deadline), { status: 'absent_fenced' });
  // Rejections did not consume the owner's three ordinary starts.
  for (let i = 0; i < 3; i++) { const c = await main.createCheck('alice', input, `ordinary-${i}`); await main.deleteCheck('alice', c.id); }
  clock += 86400000;
  const currentDeadline = new Date(clock + 30000).toISOString();
  const committed = await main.createCheck('alice', input, 'committed', currentDeadline);
  clock += 30001;
  assert.equal((await main.createCheck('alice', input, 'committed', currentDeadline)).id, committed.id);
  await main.deleteCheck('alice', committed.id);
  const metadata = await main.lookupCheckAdmission('alice', 'committed', currentDeadline);
  assert.deepEqual(metadata, { status: 'terminal_unavailable', checkId: committed.id, reason: 'deleted' });
  assert.equal(JSON.stringify(metadata).includes(input.message), false);
  await assert.rejects(main.createCheck('alice', input, 'committed', currentDeadline), /submission_expired/);
});

test('deleted automatic child releases capacity for another owner while retaining suppression', async () => {
  const f = await setup();
  const admitted = await admitConnectorTarget(f.lease, f.main, f.store, f.now()); assert.equal(admitted.status, 'admitted'); if (admitted.status !== 'admitted') return;
  await f.main.deleteCheck('alice', admitted.check.id);
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  assert.deepEqual(await f.store.listAdmissionIntents(), []);
  assert.equal((await f.store.listRevisionJobs(f.c, f.saved.revision.id))[0].state, 'suppressed');
  let other = await f.store.createConnection('bob', { provider: 'gmail', providerAccountId: 'after-deletion', scope: ['inbox'] });
  other = await f.store.configureConnection(other, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
  const saved = await f.store.saveRevision(other, { providerItemId: 'mail', revisionHash: 'b'.repeat(64), receivedAt: f.now().toISOString(), text: 'other', urls: [], attachments: [] });
  await f.store.enqueueTarget(other, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: f.input });
  assert.equal((await f.store.leaseDueJob())?.ref.ownerId, 'bob');
  await assert.rejects(f.store.enqueueTarget(f.c, { revisionId: f.saved.revision.id, targetId: 'body-0', generation: 2, input: f.input }), /recheck_requires_user/);
});

test('never-invoked disconnected intent releases only after authoritative fenced absence and rejects its delayed request', async () => {
  const f = await setup(); const create = f.main.createCheck.bind(f.main); let deadline: string | undefined;
  f.main.createCheck = async (_owner, _input, _key, boundedDeadline) => { deadline = boundedDeadline; throw new Error('never_invoked'); };
  await assert.rejects(admitConnectorTarget(f.lease, f.main, f.store, f.now()));
  await f.store.revokeConnection('alice', f.c.id, f.c.epoch);
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  assert.equal((await f.store.listAdmissionIntents()).length, 1);
  assert.equal(deadline, '2026-11-10T12:00:30.000Z');
  f.advance(30001);
  const lookup = f.main.lookupCheckAdmission.bind(f.main);
  f.main.lookupCheckAdmission = async () => { throw new Error('lookup_unavailable'); };
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  assert.equal((await f.store.listAdmissionIntents()).length, 1);
  f.main.lookupCheckAdmission = lookup;
  await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  assert.deepEqual(await f.store.listAdmissionIntents(), []);
  assert.equal((await f.database.query('SELECT reason FROM connector_jobs WHERE id=$1', [f.job.id])).rows[0].reason, 'admission_deadline_expired');
  await assert.rejects(create('alice', { ...f.input, url: '', promisedBenefit: '', intendedAction: '' }, f.job.admissionKey, deadline), /admission_deadline_expired/);
  let other = await f.store.createConnection('bob', { provider: 'gmail', providerAccountId: 'after-never-invoked', scope: ['inbox'] });
  other = await f.store.configureConnection(other, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
  const saved = await f.store.saveRevision(other, { providerItemId: 'mail', revisionHash: 'b'.repeat(64), receivedAt: f.now().toISOString(), text: 'other', urls: [], attachments: [] });
  await f.store.enqueueTarget(other, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: f.input });
  assert.equal((await f.store.leaseDueJob())?.ref.ownerId, 'bob');
});

test('ambiguous retries retain one immutable deadline and cannot refresh it into another admission', async () => {
  const f = await setup(), create = f.main.createCheck.bind(f.main), deadlines: (string | undefined)[] = [];
  f.main.createCheck = async (_owner, _input, _key, deadline) => { deadlines.push(deadline); throw new Error('unknown_transport_result'); };
  await assert.rejects(admitConnectorTarget(f.lease, f.main, f.store, f.now()));
  f.advance(1001); const retry = await f.store.leaseDueJob(); assert.ok(retry);
  await assert.rejects(admitConnectorTarget(retry, f.main, f.store, f.now()));
  assert.deepEqual(deadlines, ['2026-11-10T12:00:30.000Z', '2026-11-10T12:00:30.000Z']);
  f.advance(30000); f.main.createCheck = create;
  const result = await runConnectorTarget(retry, { mainStore: f.main, connectorStore: f.store, workerReady: true, now: f.now, run: async () => assert.fail('expired admission') });
  assert.equal(result.reason, 'admission_deadline_expired');
  assert.equal((await f.main.listChecks('alice', {})).total, 0);
  assert.deepEqual(await f.store.listAdmissionIntents(), []);
  assert.equal(await f.store.leaseDueJob(), null);
});

test('stale fenced-absence and terminal recovery cannot resolve a later proven-rejection retry window', async () => {
  const f = await setup();
  const old = await f.store.recordAdmissionIntent(f.lease);
  // Models a proven main pre-admission rejection, the only allowed reset path.
  await f.store.clearUncommittedAdmissionIntent(f.lease); f.advance(1);
  const current = await f.store.recordAdmissionIntent(f.lease);
  assert.notEqual(current.admissionDeadlineAt, old.admissionDeadlineAt);
  await assert.rejects(f.store.resolveUnavailableAdmission(old, 'admission_deadline_expired'), /stale_admission_intent/);
  await assert.rejects(f.store.recordRecoveredAdmission(old, 'stale-check', true), /stale_admission_intent/);
  assert.deepEqual(await f.store.listAdmissionIntents(), [current]);
});

test('late tombstone projection for a resolved attempt cannot overwrite its queued retry coverage', async () => {
  const f = await setup();
  const admitted = await admitConnectorTarget(f.lease, f.main, f.store, f.now()); assert.equal(admitted.status, 'admitted'); if (admitted.status !== 'admitted') return;
  const [stale] = await f.store.listAdmissionIntents(); assert.ok(stale);
  f.advance(300001); await reconcileConnectorJobs(f.now(), { mainStore: f.main, connectorStore: f.store });
  await f.main.deleteCheck('alice', admitted.check.id);
  await f.store.resolveUnavailableAdmission(stale, 'main_check_unavailable', admitted.check.id);
  const revision = await f.store.getRevision(f.c, f.saved.revision.id);
  assert.equal(revision?.manifest.targets[0].status, 'pending'); assert.equal(revision?.manifest.counts.pending, 1);
  assert.equal((await f.store.leaseDueJob())?.job.generation, 2);
});
