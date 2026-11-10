import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectorTestStore } from './utils/scamwin-connector-test-db';
import type { ConnectorStore } from '../lib/scamwin/connectors/contracts';

async function queueAutomaticJob(store: ConnectorStore, owner: string, account: string, receivedAt = '2026-11-10T12:00:00.000Z') {
  const c0 = await store.createConnection(owner, { provider: 'gmail', providerAccountId: account, scope: ['inbox'] });
  const settings = { mode: 'all_new' as const, scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 as const };
  const connection = await store.configureConnection(c0, settings);
  const saved = await store.saveRevision(connection, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt, text: 'hello', urls: [], attachments: [] });
  const job = await store.enqueueTarget(connection, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { message: 'hello', url: null, images: [] } });
  return { connection, settings, job };
}

test('saved owner and epoch guard reads, edits create revisions, and identical delivery is deduplicated', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    let c = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account-1', scope: ['inbox'] });
    assert.equal(c.mode, 'manual'); assert.ok(!('encryptedGrant' in c));
    c = await store.configureConnection(c, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const input = { providerItemId: 'mail-1', deliveryId: 'event-1', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'hello', urls: [], attachments: [] };
    const first = await store.saveRevision(c, input), duplicate = await store.saveRevision(c, input);
    assert.equal(first.revision.id, duplicate.revision.id);
    const edit = await store.saveRevision(c, { ...input, deliveryId: 'event-2', revisionHash: 'b'.repeat(64), text: 'edited' });
    assert.equal(edit.item.id, first.item.id); assert.notEqual(edit.revision.id, first.revision.id);
    assert.equal(await store.getItem({ ...c, ownerId: 'bob' }, first.item.id), null);
    await assert.rejects(store.saveRevision({ ...c, ownerId: 'bob' }, input), /connection_unavailable/);
    await store.revokeConnection('alice', c.id, c.epoch);
    assert.equal(await store.getItem(c, first.item.id), null);
    await assert.rejects(store.saveRevision(c, input), /connection_unavailable/);
  } finally { await close(); }
});
test('provider page cursor commits atomically, only final range advances cursor, and stale sync fence fails', async () => {
  const { store, close, advance } = await createConnectorTestStore();
  try {
    const c0 = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account-2', scope: ['inbox'] });
    const c = await store.configureConnection(c0, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const lease = await store.leaseConnection(c, 1000); assert.ok(lease);
    await store.persistProviderPage(c, lease, { items: [{ id: 'mail-1', version: '1', receivedAt: '2026-11-10T12:00:00.000Z' }], pageState: 'next-page', complete: false, gaps: [] });
    assert.deepEqual(await store.readSyncCursor(c), { cursor: null, pageState: 'next-page' });
    await assert.rejects(store.persistProviderPage(c, lease, { items: [], pageState: null, finalCursor: 'bad', complete: false, gaps: [] }), /invalid_provider_page/);
    advance(1001); const newer = await store.leaseConnection(c, 1000); assert.ok(newer);
    await assert.rejects(store.persistProviderPage(c, lease, { items: [], pageState: null, finalCursor: 'old', complete: true, gaps: [] }), /stale_lease/);
    await store.persistProviderPage(c, newer, { items: [], pageState: null, finalCursor: 'finished', complete: true, gaps: [] });
    assert.deepEqual(await store.readSyncCursor(c), { cursor: 'finished', pageState: null });
  } finally { await close(); }
});
test('manual and paused ingestion discard bodies and preactivation history stays outside coverage', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    const manual = await store.createConnection('alice', { provider: 'telegram', providerAccountId: 'account-3', scope: ['chat'] });
    const input = { providerItemId: 'p', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'private ignored body', urls: [], attachments: [] };
    await assert.rejects(store.saveRevision(manual, input), /background_import_disabled/);
    const c = await store.configureConnection(manual, { mode: 'all_new', scope: ['chat'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    await assert.rejects(store.saveRevision(c, { ...input, receivedAt: '2026-11-09T12:00:00.000Z' }), /before_activation/);
  } finally { await close(); }
});
test('jobs preserve admission input, fence recovered workers, and suppress deleted/expired check recreation', async () => {
  const { store, close, advance } = await createConnectorTestStore();
  try {
    const c0 = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account-4', scope: ['inbox'] });
    const c = await store.configureConnection(c0, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const saved = await store.saveRevision(c, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'hello', urls: [], attachments: [] });
    const job = await store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { message: 'hello', url: null, images: [] } });
    const repeated = await store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { message: 'hello', url: null, images: [] } });
    assert.equal(job.id, repeated.id);
    await assert.rejects(store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { message: 'changed', url: null, images: [] } }), /immutable_input/);
    const old = await store.leaseDueJob(1000); assert.ok(old);
    assert.equal((await store.readJobInput(old)).message, 'hello');
    await store.recordAdmission(old, 'check-1'); advance(1001);
    const next = await store.leaseDueJob(1000); assert.ok(next); assert.equal(next.job.checkId, 'check-1');
    await assert.rejects(store.finishJob(old, { status: 'completed', childState: 'completed' }), /stale_lease/);
    await store.finishJob(next, { status: 'suppressed', reason: 'owner_deleted' });
    await assert.rejects(store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 2, input: { message: 'hello', url: null, images: [] } }), /recheck_requires_user/);
  } finally { await close(); }
});
test('private grants and one-time OAuth flows cannot cross owner or epoch', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    const c = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account-5', scope: ['inbox'] });
    await store.saveGrant(c, { accessToken: 'secret-token', scopes: ['read'] });
    assert.equal((await store.readGrant(c))?.accessToken, 'secret-token');
    assert.equal(await store.readGrant({ ...c, ownerId: 'bob' }), null);
    await assert.rejects(store.createConnection('bob', { provider: 'gmail', providerAccountId: 'account-5', scope: ['inbox'] }), /provider_account_owned/);
    await store.saveOAuthFlow('alice', { state: 'a'.repeat(32), provider: 'gmail', redirectUri: 'https://scamwin.test/callback', verifier: 'pkce-secret', connectionId: c.id, expectedEpoch: c.epoch });
    assert.equal(await store.consumeOAuthFlow('bob', 'a'.repeat(32)), null);
    assert.equal((await store.consumeOAuthFlow('alice', 'a'.repeat(32)))?.verifier, 'pkce-secret');
    assert.equal(await store.consumeOAuthFlow('alice', 'a'.repeat(32)), null);
    await store.revokeConnection('alice', c.id, c.epoch);
    assert.equal(await store.readGrant(c), null);
  } finally { await close(); }
});
test('content expires independently at 30 days while bounded metadata expires at 90 days', async () => {
  const { store, close, advance } = await createConnectorTestStore();
  try {
    const c0 = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account-6', scope: ['inbox'] });
    const c = await store.configureConnection(c0, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const saved = await store.saveRevision(c, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'body', urls: [], attachments: [] });
    advance(30 * 86400000 + 1); await store.purgeExpired();
    assert.equal(await store.readRevisionContent(c, saved.revision.id), null);
    assert.ok(await store.getItem(c, saved.item.id));
    advance(60 * 86400000); await store.purgeExpired();
    assert.equal(await store.getItem(c, saved.item.id), null);
  } finally { await close(); }
});

test('pause preserves backlog/cursor/epoch, mode change reseals grant, and later edit references survive acknowledgement', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    const c0 = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account-7', scope: ['inbox'] });
    await store.saveGrant(c0, { accessToken: 'preserved-grant', scopes: ['read'] });
    const settings = { mode: 'all_new' as const, scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 as const };
    const c = await store.configureConnection(c0, settings);
    assert.equal((await store.readGrant(c))?.accessToken, 'preserved-grant');
    const sync = await store.leaseConnection(c); assert.ok(sync);
    await store.persistProviderPage(c, sync, { items: [{ id: 'm', version: '1', receivedAt: '2026-11-10T12:00:00.000Z' }, { id: 'm', version: '2', receivedAt: '2026-11-10T12:00:00.000Z' }], complete: true, pageState: null, finalCursor: 'cursor-1', gaps: [] });
    await store.acknowledgeProviderItem(c, { id: 'm', version: '1', receivedAt: '2026-11-10T12:00:00.000Z' });
    assert.deepEqual((await store.listPendingProviderItems(c)).items.map(x => x.version), ['2']);
    const saved = await store.saveRevision(c, { providerItemId: 'm', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'hello', urls: [], attachments: [] });
    await store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { message: 'hello', url: null, images: [] } });
    const paused = await store.configureConnection(c, { ...settings, paused: true });
    assert.equal(paused.epoch, c.epoch); assert.equal(await store.leaseDueJob(), null);
    assert.deepEqual(await store.readSyncCursor(paused), { cursor: 'cursor-1', pageState: null });
    const resumed = await store.configureConnection(paused, settings);
    assert.equal(resumed.epoch, c.epoch); assert.ok(await store.leaseDueJob());
    await assert.rejects(store.persistProviderPage(c, sync, { items: [], complete: true, pageState: null, finalCursor: 'stale', gaps: [] }), /stale_lease/);
  } finally { await close(); }
});
test('automatic reservations are durable/idempotent, owner-wide across connections, and globally serialized', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    async function add(owner: string, account: string) {
      const c0 = await store.createConnection(owner, { provider: 'gmail', providerAccountId: account, scope: ['inbox'] });
      const c = await store.configureConnection(c0, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
      const saved = await store.saveRevision(c, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'hello', urls: [], attachments: [] });
      await store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { message: 'hello', url: null, images: [] } });
    }
    await add('alice', 'a1');
    const first = await store.leaseDueJob(); assert.ok(first);
    assert.equal(await store.leaseDueJob(), null);
    assert.deepEqual(await store.reserveAutomaticQuota(first), { allowed: true, alreadyReserved: false });
    assert.deepEqual(await store.reserveAutomaticQuota(first), { allowed: true, alreadyReserved: true });
    await assert.rejects(store.finishJob(first, { status: 'completed', childState: 'completed' }), /admission_required/);
    await store.recordAdmission(first, 'check-first');
    await store.finishJob(first, { status: 'completed', childState: 'completed' });
    await add('alice', 'a2');
    const second = await store.leaseDueJob(); assert.ok(second);
    assert.deepEqual(await store.reserveAutomaticQuota(second), { allowed: false, reason: 'automatic_owner_day', alreadyReserved: false });
    await store.finishJob(second, { status: 'deferred', reason: 'owner_quota', retryAt: '2026-11-11T00:00:00.000Z' });
    for (let i = 0; i < 7; i++) {
      await add(`owner-${i}`, `account-${i}`); const lease = await store.leaseDueJob(); assert.ok(lease);
      assert.equal((await store.reserveAutomaticQuota(lease)).allowed, true);
      await store.recordAdmission(lease, `check-${i}`);
      await store.finishJob(lease, { status: 'completed', childState: 'completed' });
    }
    await add('ninth', 'ninth-account'); const ninth = await store.leaseDueJob(); assert.ok(ninth);
    assert.deepEqual(await store.reserveAutomaticQuota(ninth), { allowed: false, reason: 'automatic_global_day', alreadyReserved: false });
  } finally { await close(); }
});

test('a paused owner retains the global slot while its original execution lease remains valid', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    const alice = await queueAutomaticJob(store, 'alice', 'pause-alice');
    const first = await store.leaseDueJob(); assert.ok(first);
    await store.recordAdmission(first, 'paused-check');
    await store.configureConnection(alice.connection, { ...alice.settings, paused: true });
    await queueAutomaticJob(store, 'bob', 'pause-bob');
    assert.equal((await store.readJobInput(first)).message, 'hello');
    assert.equal(await store.leaseDueJob(), null);
    // Already-admitted work may finish, but pause cannot authorize another admission.
    await assert.rejects(store.recordAdmission(first, 'paused-check'), /connection_paused/);
    await store.finishJob(first, { status: 'completed', childState: 'completed' });
    const bob = await store.leaseDueJob(); assert.ok(bob); assert.equal(bob.ref.ownerId, 'bob');
  } finally { await close(); }
});

for (const [label, current] of [['day', '2026-11-11T12:00:00.000Z'], ['month', '2026-12-01T12:00:00.000Z']] as const) {
  test(`an unadmitted reservation is charged once to its new UTC ${label} window`, async () => {
    const { store, close, advance, database } = await createConnectorTestStore();
    try {
      await queueAutomaticJob(store, 'alice', `rollover-${label}`);
      const first = await store.leaseDueJob(); assert.ok(first);
      assert.deepEqual(await store.reserveAutomaticQuota(first), { allowed: true, alreadyReserved: false });
      advance(Date.parse(current) - Date.parse('2026-11-10T12:00:00.000Z'));
      const recovered = await store.leaseDueJob(); assert.ok(recovered); assert.equal(recovered.job.checkId, null);
      assert.deepEqual(await store.reserveAutomaticQuota(recovered), { allowed: true, alreadyReserved: false });
      assert.deepEqual(await store.reserveAutomaticQuota(recovered), { allowed: true, alreadyReserved: true });
      const counters = await database.query('SELECT id,used FROM connector_quotas WHERE id IN ($1,$2) ORDER BY id', [`global-day:${current.slice(0, 10)}`, `global-month:${current.slice(0, 7)}`]);
      assert.deepEqual(counters.rows, [{ id: `global-day:${current.slice(0, 10)}`, used: 1 }, { id: `global-month:${current.slice(0, 7)}`, used: 1 }]);
      await store.recordAdmission(recovered, `check-${label}`);
      await store.finishJob(recovered, { status: 'completed', childState: 'completed' });
      await queueAutomaticJob(store, 'alice', `second-${label}`, current);
      const second = await store.leaseDueJob(); assert.ok(second);
      assert.deepEqual(await store.reserveAutomaticQuota(second), { allowed: false, reason: 'automatic_owner_day', alreadyReserved: false });
    } finally { await close(); }
  });
}

test('already-admitted recovery preserves quota idempotency across UTC day and month rollover', async () => {
  const { store, close, advance, database } = await createConnectorTestStore();
  try {
    await queueAutomaticJob(store, 'alice', 'admitted-rollover');
    const first = await store.leaseDueJob(); assert.ok(first);
    assert.deepEqual(await store.reserveAutomaticQuota(first), { allowed: true, alreadyReserved: false });
    await store.recordAdmission(first, 'already-admitted-check');
    advance(Date.parse('2026-12-01T12:00:00.000Z') - Date.parse('2026-11-10T12:00:00.000Z'));
    const recovered = await store.leaseDueJob(); assert.ok(recovered); assert.equal(recovered.job.checkId, 'already-admitted-check');
    assert.deepEqual(await store.reserveAutomaticQuota(recovered), { allowed: true, alreadyReserved: true });
    assert.deepEqual((await database.query('SELECT id FROM connector_quotas WHERE id IN ($1,$2)', ['global-day:2026-12-01', 'global-month:2026-12'])).rows, []);
  } finally { await close(); }
});

for (const [current, counter, used, reason] of [
  ['2026-11-11T12:00:00.000Z', 'global-day:2026-11-11', 8, 'automatic_global_day'],
  ['2026-12-01T12:00:00.000Z', 'global-month:2026-12', 40, 'automatic_global_month'],
] as const) {
  test(`an unadmitted recovered reservation respects an exhausted ${counter} counter`, async () => {
    const { store, close, advance, database } = await createConnectorTestStore();
    try {
      await queueAutomaticJob(store, 'alice', counter);
      const first = await store.leaseDueJob(); assert.ok(first);
      await store.reserveAutomaticQuota(first);
      advance(Date.parse(current) - Date.parse('2026-11-10T12:00:00.000Z'));
      // Fixture for quota already consumed by other owners in the new window.
      await database.query('INSERT INTO connector_quotas (id,used,expires_at) VALUES ($1,$2,$3)', [counter, used, '2027-01-01T00:00:00.000Z']);
      const recovered = await store.leaseDueJob(); assert.ok(recovered);
      assert.deepEqual(await store.reserveAutomaticQuota(recovered), { allowed: false, reason, alreadyReserved: false });
      assert.deepEqual(await store.reserveAutomaticQuota(recovered), { allowed: false, reason, alreadyReserved: false });
      assert.deepEqual((await database.query('SELECT used FROM connector_quotas WHERE id=$1', [counter])).rows, [{ used }]);
    } finally { await close(); }
  });
}
test('bounded alert/activity projections enforce ownership and omit imported content and secrets', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    const c0 = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account-8', scope: ['inbox'] });
    const c = await store.configureConnection(c0, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const saved = await store.saveRevision(c, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'private body', urls: [], attachments: [] });
    const alert = await store.saveAlert(c, { revisionId: saved.revision.id, kind: 'coverage', reason: 'pending_targets', counts: { discovered: 1, checked: 0, pending: 1, unsupported: 0 } });
    assert.equal((await store.listAlerts('alice')).items.length, 1);
    assert.equal((await store.listAlerts('bob')).items.length, 0);
    assert.equal(await store.markAlertSeen('bob', alert.id), false);
    assert.equal(await store.markAlertSeen('alice', alert.id), true);
    const projection = JSON.stringify({ connections: await store.listConnections('alice'), items: await store.listItems(c), revision: await store.getRevision(c, saved.revision.id), alerts: await store.listAlerts('alice'), activity: await store.listActivity('alice') });
    assert.ok(!projection.includes('private body')); assert.ok(!projection.includes('encrypted'));
    await assert.rejects(store.listAlerts('alice', { limit: 51 }));
  } finally { await close(); }
});

test('reconnect verifies the saved provider account, changes epoch, keeps history and never revives old work', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    const c0 = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'verified-account', scope: ['inbox'] });
    const c = await store.configureConnection(c0, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const saved = await store.saveRevision(c, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'history', urls: [], attachments: [] });
    await store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { message: 'history', url: null, images: [] } });
    const { connection: disconnected } = await store.revokeConnection('alice', c.id, c.epoch);
    await store.saveOAuthFlow('alice', { state: 'r'.repeat(32), provider: 'gmail', redirectUri: 'https://scamwin.test/callback', verifier: 'reconnect-pkce', connectionId: disconnected.id, expectedEpoch: disconnected.epoch });
    assert.equal((await store.consumeOAuthFlow('alice', 'r'.repeat(32)))?.expectedEpoch, disconnected.epoch);
    const grant = { accessToken: 'new-provider-token', scopes: ['read'] };
    await assert.rejects(store.reconnectConnection('bob', disconnected.id, disconnected.epoch, 'verified-account', grant), /connection_unavailable/);
    await assert.rejects(store.reconnectConnection('alice', disconnected.id, disconnected.epoch, 'other-account', grant), /provider_account_mismatch/);
    const restored = await store.reconnectConnection('alice', disconnected.id, disconnected.epoch, 'verified-account', grant);
    assert.equal(restored.epoch, disconnected.epoch + 1); assert.equal(restored.mode, 'manual'); assert.equal(restored.activationAt, null);
    assert.equal(await store.readGrant(c), null); assert.equal((await store.readGrant(restored))?.accessToken, 'new-provider-token');
    assert.ok(await store.getItem(restored, saved.item.id)); assert.equal(await store.leaseDueJob(), null);
    await assert.rejects(store.reconnectConnection('alice', disconnected.id, disconnected.epoch, 'verified-account', grant), /connection_unavailable/);
    assert.ok((await store.listActivity('alice')).items.some(a => a.reason === 'reconnect_coverage_gap'));
  } finally { await close(); }
});

test('provider cursors expire within metadata retention and OAuth flows expire without replay', async () => {
  const { store, close, advance } = await createConnectorTestStore();
  try {
    const c0 = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account-expiry', scope: ['inbox'] });
    const c = await store.configureConnection(c0, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const lease = await store.leaseConnection(c); assert.ok(lease);
    await store.persistProviderPage(c, lease, { items: [], complete: true, pageState: null, finalCursor: 'private-cursor', gaps: [] });
    await store.saveOAuthFlow('alice', { state: 'b'.repeat(32), provider: 'gmail', redirectUri: 'https://scamwin.test/callback', verifier: 'pkce' });
    advance(10 * 60000 + 1); assert.equal(await store.consumeOAuthFlow('alice', 'b'.repeat(32)), null);
    advance(90 * 86400000); await store.purgeExpired();
    assert.deepEqual(await store.readSyncCursor(c), { cursor: null, pageState: null });
  } finally { await close(); }
});

test('revision content cannot be explicitly erased while manifest targets still need it', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    const c0 = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'account-erasure', scope: ['inbox'] });
    const c = await store.configureConnection(c0, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const saved = await store.saveRevision(c, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'context', urls: ['https://example.org/'], attachments: [] });
    await assert.rejects(store.eraseTerminalRevisionContent(c, saved.revision.id), /targets_pending/);
    await store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { message: 'context', url: null, images: [] } });
    const first = await store.leaseDueJob(); assert.ok(first); await store.recordAdmission(first, 'check-body'); await store.finishJob(first, { status: 'completed', childState: 'completed' });
    await assert.rejects(store.eraseTerminalRevisionContent(c, saved.revision.id), /targets_pending/);
    await store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'url-0', generation: 1, input: { message: 'context', url: 'https://example.org/', images: [] } });
    const second = await store.leaseDueJob(); assert.ok(second); await store.recordAdmission(second, 'check-url'); await store.finishJob(second, { status: 'completed', childState: 'completed' });
    await store.eraseTerminalRevisionContent(c, saved.revision.id);
    assert.equal(await store.readRevisionContent(c, saved.revision.id), null);
  } finally { await close(); }
});
