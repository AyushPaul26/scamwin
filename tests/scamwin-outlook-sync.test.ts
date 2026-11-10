import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { OutlookAdapter } from '../lib/scamwin/connectors/providers/outlook';
import { ProviderHttpClient } from '../lib/scamwin/connectors/provider-http';
import { GmailAdapter } from '../lib/scamwin/connectors/providers/gmail';
import type { SavedConnection, SyncBudget, SyncCursor } from '../lib/scamwin/connectors/contracts';

const now = Date.parse('2026-11-10T12:00:00Z');
const signal = new AbortController().signal;
const connection: SavedConnection = { id: 'c', ownerId: 'owner', epoch: 2, provider: 'outlook', mode: 'all_new', status: 'active', scope: ['folder:inbox-id'], scopeVersion: 1, rules: {}, activationAt: '2026-11-10T11:00:00Z', automaticDailyLimit: 1, createdAt: '2026-11-10T11:00:00Z', updatedAt: '2026-11-10T11:00:00Z' };
const budget: SyncBudget = { deadlineAtMs: now + 55000, maxItemIds: 50, maxBodies: 10, maxBodyBytes: 262144 };
const root = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages/delta';
const fresh = { id: 'A/B+=', parentFolderId: 'inbox-id', changeKey: 'rev1', receivedDateTime: '2026-11-10T12:00:01Z' };
const message = { ...fresh, subject: 'Routine notice', from: { emailAddress: { address: 'claim@example.com' } }, body: { contentType: 'text', content: 'Hello, routine message https://example.com/a' }, hasAttachments: false };
function harness(handler: (url: URL, init: RequestInit) => unknown | Response | Promise<unknown | Response>, known: string[] = []) {
  const requests: string[] = [];
  const adapter = new OutlookAdapter({ now: () => new Date(now), accessToken: async c => { assert.equal(c.ownerId, 'owner'); return 'fixture-token'; }, isKnownItem: async (_c, id) => known.includes(id), revoke: async () => ({ status: 'revoked' }), fetch: async (input, init) => {
    const url = new URL(String(input)); requests.push(url.href);
    assert.equal(url.origin, 'https://graph.microsoft.com'); assert.equal(init?.redirect, 'error');
    assert.match(new Headers(init?.headers).get('Prefer') ?? '', /IdType="ImmutableId"/);
    const value = await handler(url, init!); return value instanceof Response ? value : Response.json(value);
  } });
  return { adapter, requests };
}
const advance = (cursor: SyncCursor, page: { finalCursor?: string; pageState: string | null }): SyncCursor => ({ cursor: page.finalCursor ?? cursor.cursor, pageState: page.pageState });

test('bootstrap skips history, preserves arrivals and follows empty pages with exact opaque query', async () => {
  const opaque = root + '?$skiptoken=a%2Bb%20c%2f%3D&x=1';
  let calls = 0;
  const { adapter, requests } = harness(() => ++calls === 1 ? { value: [{ ...fresh, id: 'old', receivedDateTime: '2020-01-01T00:00:00Z' }], '@odata.nextLink': opaque } : calls === 2 ? { value: [], '@odata.nextLink': root + '?$skiptoken=second' } : { value: [fresh], '@odata.deltaLink': root + '?$deltatoken=done' });
  let cursor = await adapter.activate(connection, signal);
  const first = await adapter.pullChanges(connection, cursor, budget, signal); assert.deepEqual(first.items, []); assert.equal(first.complete, false);
  cursor = advance(cursor, first); const empty = await adapter.pullChanges(connection, cursor, budget, signal); assert.deepEqual(empty.items, []);
  const last = await adapter.pullChanges(connection, advance(cursor, empty), budget, signal);
  assert.deepEqual(last.items.map(i => i.id), ['A/B+=']); assert.equal(last.complete, true); assert.equal(requests[1], opaque);
  assert.ok(requests.every(u => !u.includes('body') && !u.includes('latest') && !u.includes('%24filter')));
});
test('selected folders have independent cursors and mailbox/recursive/hidden claims fail closed', async () => {
  const { adapter, requests } = harness(url => ({ value: [], '@odata.deltaLink': url.origin + url.pathname + '?$deltatoken=' + (url.pathname.includes('other') ? 'b' : 'a') }));
  const c = { ...connection, scope: ['folder:inbox-id', 'folder:other'] };
  const cursor = await adapter.activate(c, signal); const first = await adapter.pullChanges(c, cursor, budget, signal); assert.equal(first.complete, false);
  const second = await adapter.pullChanges(c, advance(cursor, first), budget, signal); assert.equal(second.complete, true);
  await adapter.pullChanges(c, { cursor: second.finalCursor!, pageState: null }, budget, signal);
  assert.match(requests[2], /inbox-id\/messages\/delta\?\$deltatoken=a$/);
  for (const value of ['all_mail', 'recursive:inbox', 'hidden:all', 'Mail.Read']) await assert.rejects(adapter.activate({ ...connection, scope: [value] }, signal), { code: 'invalid_scope' });
});
test('old known edits and folder removals retain immutable identities without treating moves as deletion', async () => {
  const { adapter } = harness(() => ({ value: [{ ...fresh, id: 'known', receivedDateTime: '2020-01-01T00:00:00Z', changeKey: 'edited' }, { id: 'moved', '@removed': { reason: 'deleted' } }], '@odata.deltaLink': root + '?$deltatoken=done' }), ['known', 'moved']);
  const cursor = await adapter.activate(connection, signal);
  const outcome = await adapter.pullChangesWithReconciliation(connection, cursor, budget, signal);
  assert.equal(outcome.page.items[0].id, 'known'); assert.equal(outcome.page.items[0].version, 'edited');
  assert.deepEqual(outcome.removals, [{ id: 'moved', folderId: 'inbox-id', kind: 'removed_from_folder' }]);
  assert.ok(outcome.page.gaps.some(g => g.reason === 'folder_removal_requires_reconciliation'));
});
test('expired delta creates a resumable reconciliation gap and rebootstrap excludes old unknown mail', async () => {
  let calls = 0;
  const { adapter } = harness(() => ++calls === 1 ? { value: [], '@odata.deltaLink': root + '?$deltatoken=expired' } : calls === 2 ? new Response(null, { status: 410 }) : { value: [{ ...fresh, id: 'old', receivedDateTime: '2020-01-01T00:00:00Z' }, fresh], '@odata.deltaLink': root + '?$deltatoken=renewed' });
  const initial = await adapter.activate(connection, signal); const complete = await adapter.pullChanges(connection, initial, budget, signal);
  const current = { cursor: complete.finalCursor!, pageState: null };
  const reset = await adapter.pullChanges(connection, current, budget, signal); assert.equal(reset.complete, false); assert.ok(reset.gaps.some(g => g.reason === 'delta_expired'));
  const resumed = await adapter.pullChanges(connection, advance(current, reset), budget, signal); assert.deepEqual(resumed.items.map(i => i.id), ['A/B+=']); assert.equal(resumed.complete, true);
});
test('untrusted returned links cannot send bearer tokens off exact folder resource', async () => {
  for (const link of ['https://evil.test/v1.0/me/mailFolders/inbox-id/messages/delta?$skiptoken=x', root.replace('inbox-id', 'other') + '?$skiptoken=x', root + '?$skiptoken=x#secret', root.replace('https://', 'https://user@') + '?$skiptoken=x', root.replace('/v1.0/', '/beta/') + '?$skiptoken=x']) {
    const { adapter, requests } = harness(() => ({ value: [], '@odata.nextLink': link }));
    const cursor = await adapter.activate(connection, signal);
    await assert.rejects(adapter.pullChanges(connection, cursor, budget, signal), { code: 'invalid_cursor' }); assert.equal(requests.length, 1);
  }
});
test('cursor owner epoch and application folder selection are bound before authorization', async () => {
  const { adapter, requests } = harness(() => { throw new Error('unexpected'); }); const cursor = await adapter.activate(connection, signal);
  for (const c of [{ ...connection, ownerId: 'other' }, { ...connection, epoch: 3 }, { ...connection, scope: ['folder:other'] }]) await assert.rejects(adapter.pullChanges(c, cursor, budget, signal), { code: 'invalid_cursor' });
  await assert.rejects(adapter.pullChanges({ ...connection, status: 'disconnected' }, cursor, budget, signal), { code: 'source_unavailable' }); assert.equal(requests.length, 0);
});
test('manual polling does no HTTP and default Inbox resolves its actual folder id', async () => {
  const { adapter, requests } = harness(url => url.pathname.endsWith('/inbox') ? { id: 'actualInbox' } : { value: [], '@odata.deltaLink': 'https://graph.microsoft.com' + url.pathname + '?$deltatoken=end' });
  const c = { ...connection, scope: ['inbox'] }; const cursor = await adapter.activate(c, signal); assert.match(requests[0], /mailFolders\/inbox/);
  const count = requests.length; const page = await adapter.pullChanges({ ...c, mode: 'manual' }, cursor, budget, signal); assert.equal(page.complete, true); assert.equal(requests.length, count);
});
test('routine text and inert HTML preserve link destinations and untrusted source dates', async () => {
  const { adapter, requests } = harness(() => ({ ...message, body: { contentType: 'html', content: '<script>doBad()</script><p>Notice <a href="https://different.example/pay">example.com</a></p><img src="https://tracker.example/pixel">' } }));
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: '2026-11-10T12:00:10Z' }, signal);
  assert.ok(item.urls.includes('https://different.example/pay')); assert.ok(!item.text.includes('doBad')); assert.ok(!item.urls.includes('https://tracker.example/pixel'));
  assert.equal(item.receivedAt, '2026-11-10T12:00:10Z'); assert.match(item.text, /Untrusted message claims/); assert.match(item.text, /2026-11-10T12:00:01Z/);
  assert.ok(requests[0].includes('A%2FB%2B%3D'));
});
test('omitted protected body and attachment state never become complete empty content', async () => {
  const { adapter } = harness(() => ({ ...fresh, subject: 'Protected' }));
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal);
  assert.equal(item.extraction?.coverage, 'unavailable'); assert.equal(item.text, ''); assert.ok(item.extraction?.diagnostics.some(d => d.reason === 'body_unavailable'));
});
test('decoded byte and URL limits produce partial coverage', async () => {
  const content = 'é'.repeat(140000) + Array.from({ length: 210 }, (_, i) => ` https://example.com/${i}`).join('');
  const { adapter } = harness(() => ({ ...message, body: { contentType: 'text', content } }));
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal);
  assert.ok(Buffer.byteLength(item.text) <= 262144); assert.ok(item.urls.length <= 200); assert.equal(item.extraction?.coverage, 'partial'); assert.ok(item.extraction?.diagnostics.some(d => d.reason === 'text_byte_limit'));
});
test('attachments are bounded metadata and only source-authorized raster files can be fetched', async () => {
  const metadata = [{ id: 'image/id', '@odata.type': '#microsoft.graph.fileAttachment', contentType: 'image/png', name: 'image.png', size: 4 }, { id: 'pdf', '@odata.type': '#microsoft.graph.fileAttachment', contentType: 'application/pdf', name: 'offer.pdf', size: 4 }, { id: 'cloud', '@odata.type': '#microsoft.graph.referenceAttachment', contentType: 'image/png', name: 'cloud', size: 4 }];
  const { adapter, requests } = harness(url => url.pathname.endsWith('/attachments') ? { value: metadata, '@odata.nextLink': 'https://graph.microsoft.com' + url.pathname + '?$skiptoken=more' } : url.pathname.includes('/attachments/') ? { ...metadata[0], contentBytes: 'AQIDBA==' } : { ...message, hasAttachments: true });
  const ref = { id: fresh.id, receivedAt: connection.activationAt! }; const item = await adapter.readItem(connection, ref, signal);
  assert.deepEqual(item.attachments.map(a => a.supported), [true, false, false]); assert.equal(item.extraction?.coverage, 'partial');
  assert.ok(item.extraction?.diagnostics.some(d => d.reason === 'attachment_page_limit'));
  const bytes = await adapter.readAttachment(connection, ref, item.attachments[0], { maxBytes: 4, deadlineAtMs: now + 5000 }, signal); assert.deepEqual([...bytes], [1, 2, 3, 4]);
  const before = requests.length; await assert.rejects(adapter.readAttachment(connection, ref, item.attachments[1], { maxBytes: 4, deadlineAtMs: now + 5000 }, signal), { code: 'attachment_unavailable' }); assert.equal(requests.length, before);
});
test('out of scope moved messages and unavailable attachments fail closed', async () => {
  const { adapter } = harness(() => ({ ...message, parentFolderId: 'outside' })); const ref = { id: fresh.id, receivedAt: connection.activationAt! };
  await assert.rejects(adapter.readItem(connection, ref, signal), { code: 'source_unavailable' });
  await assert.rejects(adapter.readAttachment(connection, ref, { id: 'fake', name: 'x', mediaType: 'image/png', supported: true }, { maxBytes: 10, deadlineAtMs: now + 1000 }, signal), { code: 'attachment_unavailable' });
});
test('selected metadata lists selected folder only and keeps body fetching explicit', async () => {
  const { adapter, requests } = harness(url => ({ value: [{ ...fresh, subject: 'Routine notice', from: message.from }], ...(url.searchParams.has('$skiptoken') ? {} : { '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages?$skiptoken=next%20page' }) }));
  const page = await adapter.listSelected(connection, null, signal); assert.equal(page.items[0].subject, 'Routine notice'); assert.ok(page.nextPageToken);
  await adapter.listSelected(connection, page.nextPageToken, signal); assert.match(requests[1], /\?\$skiptoken=next%20page$/); assert.ok(!requests[0].includes('body'));
});
test('429 backoff, tenant access denial and expired grant remain sanitized provider-local errors', async () => {
  for (const [status, code] of [[429, 'provider_backoff'], [403, 'provider_denied'], [401, 'reconnect_required']] as const) {
    const { adapter } = harness(() => new Response('private provider error', { status, headers: { 'Retry-After': '7' } })); const cursor = await adapter.activate(connection, signal);
    await assert.rejects(adapter.pullChanges(connection, cursor, budget, signal), error => { assert.equal((error as { code: string }).code, code); assert.ok(!String(error).includes('private')); if (status === 429) assert.equal((error as { retryAfterMs: number }).retryAfterMs, 7000); return true; });
  }
});
test('trusted transport Prefer is fixed and raw query cannot coexist with query or inject headers', async () => {
  let calls = 0;
  const http = new ProviderHttpClient({ origin: 'https://graph.microsoft.com', allowedPath: /^\/v1.0\/me\/messages$/, prefer: ['immutable_ids', 'outlook_html', 'page_size_50'], fetch: async (input, init) => {
    calls++; assert.equal(String(input), 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=a%20b%2f'); const headers = new Headers(init?.headers); assert.equal(headers.get('Authorization'), 'Bearer fixture'); assert.match(headers.get('Prefer')!, /outlook.body-content-type="html"/); return Response.json({});
  } });
  await http.json('/v1.0/me/messages', 'fixture', { signal, maxBytes: 100, rawQuery: '$skiptoken=a%20b%2f' });
  for (const options of [{ rawQuery: 'x=1', query: new URLSearchParams() }, { rawQuery: 'x=1#fragment' }, { rawQuery: 'x=1\r\nAuthorization:bad' }]) await assert.rejects(http.json('/v1.0/me/messages', 'fixture', { signal, maxBytes: 100, ...options }));
  assert.equal(calls, 1);
});
test('only an exact bounded Graph expiry error resets delta; unknown and oversized errors stay rejected', async () => {
  for (const [body, expected] of [[JSON.stringify({ error: { code: 'syncStateNotFound', message: 'private-token' } }), 'cursor_expired'], [JSON.stringify({ error: { code: 'unknown', message: 'syncStateNotFound private-token' } }), 'provider_rejected'], ['x'.repeat(9000), 'provider_rejected']] as const) {
    const http = new ProviderHttpClient({ origin: 'https://graph.microsoft.com', allowedPath: /^\/v1.0\/me\/messages$/, classifyError: (status, code) => status === 400 && code === 'syncStateNotFound' ? 'cursor_expired' : undefined, fetch: async () => new Response(body, { status: 400 }) });
    await assert.rejects(http.json('/v1.0/me/messages', 'secret', { signal, maxBytes: 100 }), error => { assert.equal((error as { code: string }).code, expected); assert.ok(!String(error).includes('private-token')); return true; });
  }
});
test('selected listing rejects a forged folder even when a valid connection binding is copied', async () => {
  const { adapter, requests } = harness(() => ({ value: [fresh], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages?$skiptoken=next' }));
  const first = await adapter.listSelected(connection, null, signal); const forged = JSON.parse(first.nextPageToken!); forged.folders = ['outside']; forged.link = 'https://graph.microsoft.com/v1.0/me/mailFolders/outside/messages?$skiptoken=stolen';
  await assert.rejects(adapter.listSelected(connection, JSON.stringify(forged), signal), { code: 'invalid_cursor' }); assert.equal(requests.length, 1);
});
test('body access checks current folder metadata before requesting message content', async () => {
  const { adapter, requests } = harness(url => { assert.equal(url.searchParams.get('$select'), 'id,parentFolderId'); return { ...fresh, parentFolderId: 'outside' }; });
  await assert.rejects(adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal), { code: 'source_unavailable' }); assert.equal(requests.length, 1);
});
test('scope changing after authorization discards body before yielding content', async () => {
  let calls = 0; const { adapter } = harness(() => ++calls === 1 ? fresh : { ...message, parentFolderId: 'outside' });
  await assert.rejects(adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal), { code: 'source_unavailable' });
});
test('unchanged body keeps its revision hash across read-state/change-key/provider-modified-time updates', async () => {
  let edited = false; const { adapter } = harness(() => ({ ...message, changeKey: edited ? 'v2' : 'v1', lastModifiedDateTime: edited ? '2026-11-10T13:00:00Z' : '2026-11-10T12:00:00Z' }));
  const ref = { id: fresh.id, receivedAt: connection.activationAt! }; const first = await adapter.readItem(connection, ref, signal); edited = true; const second = await adapter.readItem(connection, ref, signal); assert.equal(first.revisionHash, second.revisionHash);
});
test('inline-only images trigger provider attachment metadata even when hasAttachments is false', async () => {
  const { adapter } = harness(url => url.pathname.endsWith('/attachments') ? { value: [{ id: 'inline', '@odata.type': '#microsoft.graph.fileAttachment', contentType: 'image/png', name: 'inline.png', size: 100, isInline: true }] } : { ...message, hasAttachments: false, body: { contentType: 'html', content: '<p>Invoice</p><img src="cid:invoice">' } });
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal); assert.equal(item.attachments.length, 1); assert.equal(item.extraction?.coverage, 'partial');
});
test('later removal in the same delta page wins over an earlier update for that immutable ID', async () => {
  const { adapter } = harness(() => ({ value: [fresh, { id: fresh.id, '@removed': { reason: 'deleted' } }], '@odata.deltaLink': root + '?$deltatoken=end' }));
  const outcome = await adapter.pullChangesWithReconciliation(connection, await adapter.activate(connection, signal), budget, signal); assert.deepEqual(outcome.page.items, []); assert.equal(outcome.removals[0].id, fresh.id);
});
test('more than 5000 bootstrap metadata entries are drained without a received-date filter or old body imports', async () => {
  let page = 0; const { adapter, requests } = harness(() => {
    const current = page++; return current < 101 ? { value: Array.from({ length: 50 }, (_, i) => ({ ...fresh, id: `old-${current}-${i}`, receivedDateTime: '2020-01-01T00:00:00Z' })), '@odata.nextLink': root + '?$skiptoken=' + page } : { value: [fresh], '@odata.deltaLink': root + '?$deltatoken=end' };
  });
  let cursor = await adapter.activate(connection, signal); let imported = 0, complete = false;
  for (let i = 0; i < 102; i++) { const result = await adapter.pullChanges(connection, cursor, budget, signal); imported += result.items.length; cursor = advance(cursor, result); complete = result.complete; }
  assert.equal(complete, true); assert.equal(imported, 1); assert.equal(requests.length, 102); assert.ok(requests.every(url => !url.includes('filter') && !url.includes('body')));
});
test('intra-page budgets persist offset and reject changed provider pages without losing cursor', async () => {
  let changed = false; const { adapter } = harness(() => ({ value: [{ ...fresh, id: changed ? 'changed' : 'one' }, { ...fresh, id: 'two' }, { ...fresh, id: 'three' }], '@odata.deltaLink': root + '?$deltatoken=end' }));
  const cursor = await adapter.activate(connection, signal); const small = { ...budget, maxItemIds: 2 } as unknown as SyncBudget;
  const first = await adapter.pullChanges(connection, cursor, small, signal); assert.deepEqual(first.items.map(i => i.id), ['one', 'two']); assert.equal(first.complete, false);
  const second = await adapter.pullChanges(connection, advance(cursor, first), small, signal); assert.deepEqual(second.items.map(i => i.id), ['three']); assert.equal(second.complete, true);
  changed = true; await assert.rejects(adapter.pullChanges(connection, advance(cursor, first), small, signal), { code: 'checkpoint_changed' });
});
test('HTTP400 syncStateNotFound reboots delta while an unknown400 does not reset a cursor', async () => {
  for (const code of ['syncStateNotFound', 'InvalidRequest']) {
    let calls = 0; const { adapter } = harness(() => ++calls === 1 ? { value: [], '@odata.deltaLink': root + '?$deltatoken=end' } : Response.json({ error: { code, message: 'private' } }, { status: 400 }));
    const first = await adapter.pullChanges(connection, await adapter.activate(connection, signal), budget, signal); const current = { cursor: first.finalCursor!, pageState: null };
    if (code === 'syncStateNotFound') { const result = await adapter.pullChanges(connection, current, budget, signal); assert.ok(result.gaps.some(g => g.reason === 'delta_expired')); }
    else await assert.rejects(adapter.pullChanges(connection, current, budget, signal), { code: 'provider_rejected' });
  }
});
test('200 distinct URLs and twenty attachment metadata records cap extraction with explicit omissions', async () => {
  const { adapter } = harness(url => url.pathname.endsWith('/attachments') ? { value: Array.from({ length: 25 }, (_, i) => ({ id: `a${i}`, '@odata.type': '#microsoft.graph.itemAttachment', name: 'nested message', size: 1 })) } : { ...message, hasAttachments: true, body: { contentType: 'text', content: Array.from({ length: 205 }, (_, i) => `https://example.com/${i}`).join('\n') } });
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal); assert.equal(item.urls.length, 200); assert.equal(item.attachments.length, 20); assert.equal(item.extraction?.overflow.urls, 5); assert.equal(item.extraction?.overflow.attachments, 5); assert.equal(item.extraction?.coverage, 'partial');
});
test('balanced destination parentheses are preserved while prose punctuation is removed', async () => {
  const { adapter } = harness(() => ({ ...message, body: { contentType: 'text', content: 'See https://example.com/a_(b). Then https://example.org/x.' } }));
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal); assert.deepEqual(item.urls, ['https://example.com/a_(b)', 'https://example.org/x']);
});
test('denied attachment metadata is an explicit body coverage gap and body omission is never complete', async () => {
  const { adapter } = harness(url => url.pathname.endsWith('/attachments') ? new Response(null, { status: 403 }) : { ...message, hasAttachments: true });
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal); assert.match(item.text, /Routine notice/); assert.equal(item.extraction?.coverage, 'partial'); assert.ok(item.extraction?.diagnostics.some(d => d.reason === 'attachments_unavailable'));
});
test('provider-authorized image bytes reject forged references, mismatched source attachment or oversized content', async () => {
  const metadata = { id: 'raster', '@odata.type': '#microsoft.graph.fileAttachment', contentType: 'image/png', name: 'a.png', size: 4 };
  let tamper = false; const { adapter } = harness(url => url.pathname.endsWith('/attachments') ? { value: [metadata] } : url.pathname.includes('/attachments/') ? { ...metadata, id: tamper ? 'other' : 'raster', contentBytes: 'AQIDBAU=' } : { ...message, hasAttachments: true });
  const ref = { id: fresh.id, receivedAt: connection.activationAt! }; const item = await adapter.readItem(connection, ref, signal);
  await assert.rejects(adapter.readAttachment(connection, ref, { ...item.attachments[0], id: 'forged' }, { maxBytes: 4, deadlineAtMs: now + 5000 }, signal), { code: 'attachment_unavailable' });
  await assert.rejects(adapter.readAttachment(connection, ref, item.attachments[0], { maxBytes: 4, deadlineAtMs: now + 5000 }, signal), { code: 'attachment_unavailable' }); tamper = true;
  await assert.rejects(adapter.readAttachment(connection, ref, item.attachments[0], { maxBytes: 10, deadlineAtMs: now + 5000 }, signal), { code: 'attachment_unavailable' });
});
test('revoke delegates only the authorized connection and does not require Graph write/send permissions', async () => {
  let revoked: SavedConnection | null = null; const adapter = new OutlookAdapter({ accessToken: async () => { throw new Error('unexpected'); }, revoke: async c => { revoked = c; return { status: 'unavailable', reason: 'local_grant_erased' }; }, fetch: async () => { throw new Error('unexpected'); } });
  assert.deepEqual(await adapter.revoke(connection, signal), { status: 'unavailable', reason: 'local_grant_erased' }); assert.equal(revoked, connection);
});
test('Outlook outage leaves independently constructed Gmail polling available', async () => {
  const { adapter } = harness(() => { throw new Error('outage private content'); }); const cursor = await adapter.activate(connection, signal); await assert.rejects(adapter.pullChanges(connection, cursor, budget, signal), { code: 'provider_network' });
  const gmail = new GmailAdapter({ accessToken: async () => 'fixture', revoke: async () => ({ status: 'revoked' }), now: () => new Date(now), fetch: async () => Response.json({ historyId: '200', history: [] }) });
  const result = await gmail.pullChanges({ ...connection, provider: 'gmail', scope: ['inbox'] }, { cursor: '100', pageState: null }, budget, signal); assert.equal(result.complete, true); assert.equal(result.finalCursor, '200');
});
test('remote HTML image references remain unrequested and report missing image coverage', async () => {
  const { adapter, requests } = harness(() => ({ ...message, body: { contentType: 'html', content: '<p>Offer</p><img src="https://private.example/secret.png">' } }));
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal); assert.equal(item.extraction?.coverage, 'partial'); assert.ok(item.extraction?.diagnostics.some(d => d.reason === 'remote_image_unavailable')); assert.ok(requests.every(url => url.startsWith('https://graph.microsoft.com/')));
});
test('a wide inert HTML tree advertises traversal limits without throwing or loading resources', async () => {
  const { adapter } = harness(() => ({ ...message, body: { contentType: 'html', content: '<span>x</span>'.repeat(35000) } }));
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal); assert.equal(item.extraction?.coverage, 'partial'); assert.ok(item.extraction?.diagnostics.some(d => d.reason === 'html_node_limit'));
});
test('oversized body response and expired deadline yield explicit unavailable/timeout errors', async () => {
  const { adapter, requests } = harness(url => url.searchParams.get('$select') === 'id,parentFolderId' ? fresh : new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal), { code: 'source_unavailable' });
  const count = requests.length; await assert.rejects(adapter.pullChanges(connection, await adapter.activate(connection, signal), { ...budget, deadlineAtMs: now - 1 }, signal), { code: 'provider_timeout' }); assert.equal(requests.length, count);
});
test('pilot is fixture-only, exercises bootstrap and content, and refuses a live-account switch', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-scamwin-outlook-pilot.ts', ...args], { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 });
  const fixture = run(); assert.equal(fixture.status, 0, fixture.stderr); const report = JSON.parse(fixture.stdout); assert.equal(report.mode, 'fixture_readiness'); assert.equal(report.liveConnectionVerified, false); assert.equal(report.roundsComplete, 2); assert.equal(report.bodies, 4); assert.equal(report.multiLink, 2);
  const live = run('--live'); assert.equal(live.status, 1); assert.equal(JSON.parse(live.stderr).code, 'live_pilot_not_authorized');
});
test('missing inline attachment metadata cannot make a referenced image look fully extracted', async () => {
  const { adapter } = harness(url => url.pathname.endsWith('/attachments') ? { value: [] } : { ...message, body: { contentType: 'html', content: '<img src="cid:missing">' } });
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal); assert.equal(item.extraction?.coverage, 'partial'); assert.ok(item.extraction?.diagnostics.some(d => d.reason === 'inline_attachments_unavailable'));
});
test('inert noscript and object fallback anchors retain actual destinations without loading object content', async () => {
  const { adapter } = harness(() => ({ ...message, body: { contentType: 'html', content: '<noscript><a href="https://example.com/fallback">Fallback</a></noscript><object data="https://remote.example/a.pdf"><a href="https://example.org/object">Read offer</a></object>' } }));
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal); assert.deepEqual(item.urls, ['https://example.com/fallback', 'https://example.org/object']); assert.equal(item.extraction?.coverage, 'partial');
});
test('bounded source context reports truncated subject metadata as partial coverage', async () => {
  const { adapter } = harness(() => ({ ...message, subject: 'é'.repeat(3000) }));
  const item = await adapter.readItem(connection, { id: fresh.id, receivedAt: connection.activationAt! }, signal); assert.equal(item.extraction?.coverage, 'partial'); assert.ok(item.extraction?.diagnostics.some(d => d.reason === 'metadata_byte_limit')); assert.ok(item.extraction!.overflow.textBytes > 0);
});
for (const includePage of [false, true]) test(`delta rejects a copied binding with modified ${includePage ? 'base and page' : 'base'} folders before polling`, async () => {
    const { adapter, requests } = harness(url => ({ value: [{ ...fresh, id: 'outside-message', parentFolderId: 'outside' }], '@odata.deltaLink': url.origin + url.pathname + '?$deltatoken=outside' }));
    const cursor = await adapter.activate(connection, signal); const forged = JSON.parse(cursor.cursor!); forged.folders = [{ id: 'outside', link: null }]; const serialized = JSON.stringify(forged);
    await assert.rejects(adapter.pullChanges(connection, { cursor: serialized, pageState: includePage ? serialized : null }, budget, signal), { code: 'invalid_cursor' });
    assert.deepEqual(requests, []);
});
test('delta independently rejects changed page folders while the valid selected base is retained', async () => {
  const { adapter, requests } = harness(url => ({ value: [{ ...fresh, id: 'outside-message', parentFolderId: 'outside' }], '@odata.deltaLink': url.origin + url.pathname + '?$deltatoken=outside' }));
  const cursor = await adapter.activate(connection, signal); const forged = JSON.parse(cursor.cursor!); forged.folders = [{ id: 'outside', link: null }];
  await assert.rejects(adapter.pullChanges(connection, { cursor: cursor.cursor, pageState: JSON.stringify(forged) }, budget, signal), { code: 'invalid_cursor' }); assert.deepEqual(requests, []);
});
test('delta revalidates a copied checkpoint against the actual resolved Inbox folder before polling', async () => {
  const { adapter, requests } = harness(url => url.pathname.endsWith('/inbox') ? { id: 'actualInbox' } : { value: [{ ...fresh, id: 'outside-message', parentFolderId: 'outside' }], '@odata.deltaLink': url.origin + url.pathname + '?$deltatoken=outside' });
  const c = { ...connection, scope: ['inbox'] }; const cursor = await adapter.activate(c, signal); const forged = JSON.parse(cursor.cursor!); forged.folders = [{ id: 'outside', link: null }];
  await assert.rejects(adapter.pullChanges(c, { cursor: JSON.stringify(forged), pageState: null }, budget, signal), { code: 'invalid_cursor' }); assert.ok(requests.every(url => new URL(url).pathname === '/v1.0/me/mailFolders/inbox'));
});
for (const moveAt of ['attachment_metadata', 'attachment_content']) test(`attachment bytes are discarded when the source moves during ${moveAt}`, async () => {
    const metadata = { id: 'raster', '@odata.type': '#microsoft.graph.fileAttachment', contentType: 'image/png', name: 'a.png', size: 4 };
    let reading = false, moved = false, contentReads = 0, membershipReads = 0;
    const { adapter } = harness(url => {
      if (url.pathname.endsWith('/attachments')) { if (reading && moveAt === 'attachment_metadata') moved = true; return { value: [metadata] }; }
      if (url.pathname.endsWith('/attachments/raster')) { contentReads++; if (moveAt === 'attachment_content') moved = true; return { ...metadata, contentBytes: 'AQIDBA==' }; }
      if (reading) membershipReads++;
      return { ...message, hasAttachments: true, parentFolderId: moved ? 'outside' : 'inbox-id' };
    });
    const ref = { id: fresh.id, receivedAt: connection.activationAt! }; const item = await adapter.readItem(connection, ref, signal); reading = true;
    await assert.rejects(adapter.readAttachment(connection, ref, item.attachments[0], { maxBytes: 4, deadlineAtMs: now + 5000 }, signal), { code: 'attachment_unavailable' });
    assert.equal(contentReads, 1); assert.equal(membershipReads, 2);
});
for (const operation of ['sync', 'attachment']) test(`stalled Inbox resolution during ${operation} aborts at the remaining five-millisecond budget`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stalling = false, markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const observed: { signal?: AbortSignal; paths: string[] } = { paths: [] };
  const adapter = new OutlookAdapter({ now: () => new Date(now), timeoutMs: 80, accessToken: async () => 'fixture', revoke: async () => ({ status: 'revoked' }), fetch: async (input, init) => {
    observed.paths.push(new URL(String(input)).pathname);
    if (!stalling) return Response.json({ id: 'actualInbox' });
    observed.signal = init?.signal ?? undefined; markStarted();
    return new Promise<Response>(() => {});
  } });
  const c = { ...connection, scope: ['inbox'] }; const cursor = await adapter.activate(c, signal); stalling = true;
  const pending = operation === 'sync' ? adapter.pullChanges(c, cursor, { ...budget, deadlineAtMs: now + 5 }, signal) : adapter.readAttachment(c, { id: fresh.id, receivedAt: connection.activationAt! }, { id: 'fixture-image', name: 'fixture.png', supported: true, mediaType: 'image/png', byteLength: 4 }, { maxBytes: 4, deadlineAtMs: now + 5 }, signal);
  const rejected = assert.rejects(pending, { code: 'provider_timeout' });
  await started;
  t.mock.timers.tick(5); const abortedAtDeadline = observed.signal?.aborted;
  // Also settle the old 80ms path so the RED run leaves no hanging operation.
  t.mock.timers.tick(75); await rejected;
  assert.equal(abortedAtDeadline, true);
  assert.deepEqual(observed.paths, ['/v1.0/me/mailFolders/inbox', '/v1.0/me/mailFolders/inbox']);
});
