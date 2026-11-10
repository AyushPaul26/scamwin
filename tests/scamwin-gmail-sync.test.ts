import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GmailAdapter } from '../lib/scamwin/connectors/providers/gmail';
import type { SavedConnection, SyncBudget, SyncCursor } from '../lib/scamwin/connectors/contracts';

const now = Date.parse('2026-11-10T12:00:00Z');
const signal = new AbortController().signal;
const connection: SavedConnection = { id: 'c', ownerId: 'o', epoch: 1, provider: 'gmail', mode: 'all_new', status: 'active', scope: ['inbox'], scopeVersion: 1, rules: {}, activationAt: '2026-11-09T12:00:00Z', automaticDailyLimit: 1, createdAt: '2026-11-09T12:00:00Z', updatedAt: '2026-11-09T12:00:00Z' };
const budget: SyncBudget = { deadlineAtMs: now + 55000, maxItemIds: 50, maxBodies: 10, maxBodyBytes: 262144 };
function harness(handler: (url: URL, init: RequestInit) => unknown | Response | Promise<unknown | Response>) {
  const paths: string[] = [];
  const adapter = new GmailAdapter({ now: () => new Date(now), accessToken: async () => 'fixture-token', revoke: async () => ({ status: 'revoked' }), fetch: async (input, init) => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    assert.equal(url.origin, 'https://gmail.googleapis.com'); assert.equal(init?.redirect, 'error');
    const result = await handler(url, init!); return result instanceof Response ? result : Response.json(result);
  } });
  return { adapter, paths };
}
const history = (ids: string[], nextPageToken?: string) => ({ historyId: '200', ...(nextPageToken ? { nextPageToken } : {}), history: [{ id: '150', messagesAdded: ids.map(id => ({ message: { id, labelIds: ['INBOX'] } })) }] });

test('one history record exceeding 50 IDs checkpoints and replays without losing IDs', async () => {
  const ids = Array.from({ length: 123 }, (_, i) => `m${i}`);
  const { adapter, paths } = harness(() => history(ids));
  let cursor: SyncCursor = { cursor: '100', pageState: null }; const seen: string[] = [];
  const first = await adapter.pullChanges(connection, cursor, budget, signal);
  assert.equal(first.items.length, 50); assert.equal(first.complete, false); assert.equal(first.finalCursor, undefined);
  assert.deepEqual(await adapter.pullChanges(connection, cursor, budget, signal), first);
  for (let i = 0; i < 3; i++) {
    const page = await adapter.pullChanges(connection, cursor, budget, signal); seen.push(...page.items.map(x => x.id));
    cursor = { cursor: page.finalCursor ?? '100', pageState: page.pageState };
    if (page.complete) { assert.equal(page.finalCursor, '200'); break; }
  }
  assert.deepEqual(seen, ids); assert.ok(paths.every(path => path.startsWith('/gmail/v1/users/me/history?')));
});
test('history ignores generic messages and deduplicates messagesAdded without suspicion filtering', async () => {
  const { adapter } = harness(() => ({ historyId: '200', history: [{ id: '150', messages: [{ id: 'ignored' }], messagesAdded: ['routine', 'routine', 'other'].map(id => ({ message: { id, labelIds: ['INBOX'] } })) }] }));
  const page = await adapter.pullChanges(connection, { cursor: '100', pageState: null }, budget, signal);
  assert.deepEqual(page.items.map(x => x.id), ['routine', 'other']);
});
test('empty intermediate history pages retain the next token', async () => {
  const { adapter, paths } = harness(url => url.searchParams.has('pageToken') ? history(['later']) : { historyId: '200', nextPageToken: 'next_A', history: [] });
  const first = await adapter.pullChanges(connection, { cursor: '100', pageState: null }, budget, signal);
  assert.equal(first.complete, false);
  const final = await adapter.pullChanges(connection, { cursor: '100', pageState: first.pageState }, budget, signal);
  assert.deepEqual(final.items.map(x => x.id), ['later']); assert.ok(paths[1].includes('pageToken=next_A'));
});
test('activation samples current profile and includes causal arrivals even with an old message Date', async () => {
  const { adapter, paths } = harness(url => url.pathname.endsWith('/profile') ? { historyId: '101' } : history(['new-import-old-date']));
  const cursor = await adapter.activate(connection, signal); assert.deepEqual(cursor, { cursor: '101', pageState: null });
  const page = await adapter.pullChanges(connection, cursor, budget, signal);
  assert.equal(page.items[0].id, 'new-import-old-date'); assert.ok(paths[1].includes('startHistoryId=101'));
});
test('Manual pull performs no token or HTTP/body work', async () => {
  const { adapter, paths } = harness(() => { throw new Error('unexpected request'); });
  const page = await adapter.pullChanges({ ...connection, mode: 'manual' }, { cursor: '100', pageState: null }, budget, signal);
  assert.deepEqual(page.items, []); assert.equal(paths.length, 0);
});
test('scope filters are label unions while readonly is an account-wide grant', async () => {
  const { adapter } = harness(() => ({ historyId: '200', history: [{ messagesAdded: [{ message: { id: 'yes', labelIds: ['INBOX'] } }, { message: { id: 'no', labelIds: ['SENT'] } }] }] }));
  const page = await adapter.pullChanges(connection, { cursor: '100', pageState: null }, budget, signal);
  assert.deepEqual(page.items.map(x => x.id), ['yes']);
});
test('explicit all-mail includes spam/trash and selected label scopes use OR', async () => {
  const { adapter } = harness(() => ({ historyId: '200', history: [{ messagesAdded: [{ message: { id: 'inbox', labelIds: ['INBOX'] } }, { message: { id: 'custom', labelIds: ['Label_7'] } }, { message: { id: 'spam', labelIds: ['SPAM'] } }] }] }));
  const all = await adapter.pullChanges({ ...connection, scope: ['all_mail'] }, { cursor: '100', pageState: null }, budget, signal);
  assert.deepEqual(all.items.map(x => x.id), ['inbox', 'custom', 'spam']);
  const selected = await adapter.pullChanges({ ...connection, scope: ['inbox', 'label:Label_7'] }, { cursor: '100', pageState: null }, budget, signal);
  assert.deepEqual(selected.items.map(x => x.id), ['inbox', 'custom']);
  await assert.rejects(adapter.pullChanges({ ...connection, scope: ['https://www.googleapis.com/auth/gmail.readonly'] }, { cursor: '100', pageState: null }, budget, signal), { code: 'invalid_scope' });
});
test('new IDs with missing label metadata produce an explicit coverage gap', async () => {
  const { adapter } = harness(() => ({ historyId: '200', history: [{ messagesAdded: [{ message: { id: 'unknown' } }] }] }));
  const page = await adapter.pullChanges(connection, { cursor: '100', pageState: null }, budget, signal);
  assert.equal(page.items.length, 0); assert.deepEqual(page.gaps, [{ reason: 'scope_metadata_unavailable', count: 1 }]);
});
test('malformed cursors and pagination URLs fail before another provider request', async () => {
  const { adapter, paths } = harness(() => ({ historyId: '200', nextPageToken: 'https://evil.test/token' }));
  for (const cursor of ['https://evil.test', 'after:0', '-1']) await assert.rejects(adapter.pullChanges(connection, { cursor, pageState: null }, budget, signal), { code: 'invalid_cursor' });
  assert.equal(paths.length, 0);
  await assert.rejects(adapter.pullChanges(connection, { cursor: '100', pageState: null }, budget, signal), { code: 'invalid_cursor' });
});
test('history404 stores bounded reconciliation and follows all recovery pages', async () => {
  const { adapter, paths } = harness(url => {
    if (url.pathname.endsWith('/history')) return new Response(null, { status: 404 });
    if (url.pathname.endsWith('/profile')) return { historyId: '300' };
    assert.equal(url.searchParams.get('q'), 'after:1794225600 before:1794312001');
    return url.searchParams.has('pageToken') ? { messages: [{ id: 'recovered2' }] } : { messages: [{ id: 'recovered1' }], nextPageToken: 'recover2' };
  });
  const first = await adapter.pullChanges(connection, { cursor: '100', pageState: null }, budget, signal);
  assert.equal(first.complete, false); assert.ok(first.gaps.some(x => x.reason === 'history_expired'));
  const second = await adapter.pullChanges(connection, { cursor: '100', pageState: first.pageState }, budget, signal);
  assert.equal(second.complete, false); assert.deepEqual(second.items.map(x => x.id), ['recovered1']);
  const third = await adapter.pullChanges(connection, { cursor: '100', pageState: second.pageState }, budget, signal);
  assert.equal(third.finalCursor, '300'); assert.deepEqual(third.items.map(x => x.id), ['recovered2']);
  assert.ok(paths.every(x => !x.includes('format=full')));
});
test('recovery upper bound follows delayed profile completion and survives resumed paging', async () => {
  let clock = now;
  const queries: string[] = [];
  const adapter = new GmailAdapter({ now: () => new Date(clock), accessToken: async () => 'fixture-token', revoke: async () => ({ status: 'revoked' }), fetch: async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/history')) return new Response(null, { status: 404 });
    if (url.pathname.endsWith('/profile')) {
      // A normally dated message arrives three seconds into five seconds of profile work.
      await Promise.resolve(); clock = now + 5000; return Response.json({ historyId: '300' });
    }
    const query = url.searchParams.get('q')!; queries.push(query);
    if (url.searchParams.has('pageToken')) return Response.json({ messages: [{ id: 'later-page' }] });
    const before = Number(query.match(/before:(\d+)/)![1]);
    const arrivalIsCovered = 1794312003 < before;
    return Response.json({ messages: arrivalIsCovered ? [{ id: 'arrived-during-profile' }] : [], nextPageToken: 'resume_recovery' });
  } });
  const initial = await adapter.pullChanges(connection, { cursor: '100', pageState: null }, budget, signal);
  clock = now + 20000;
  const first = await adapter.pullChanges(connection, { cursor: '100', pageState: initial.pageState }, budget, signal);
  assert.deepEqual(first.items.map(item => item.id), ['arrived-during-profile']);
  const second = await adapter.pullChanges(connection, { cursor: '100', pageState: first.pageState }, budget, signal);
  assert.deepEqual(second.items.map(item => item.id), ['later-page']); assert.equal(second.finalCursor, '300');
  assert.deepEqual(queries, ['after:1794225600 before:1794312006', 'after:1794225600 before:1794312006']);
});
test('changed history page cannot silently shift a persisted intra-page offset', async () => {
  let changed = false;
  const { adapter } = harness(() => history(Array.from({ length: 60 }, (_, i) => `m${i + (changed ? 1 : 0)}`)));
  const page = await adapter.pullChanges(connection, { cursor: '100', pageState: null }, budget, signal); changed = true;
  await assert.rejects(adapter.pullChanges(connection, { cursor: '100', pageState: page.pageState }, budget, signal), { code: 'checkpoint_changed' });
});
test('expired deadline does no requests', async () => {
  const { adapter, paths } = harness(() => ({}));
  await assert.rejects(adapter.pullChanges(connection, { cursor: '100', pageState: null }, { ...budget, deadlineAtMs: now - 1 }, signal), { code: 'provider_timeout' });
  assert.equal(paths.length, 0);
});

export { connection, budget, now, signal, harness };
