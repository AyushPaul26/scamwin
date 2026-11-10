import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GmailAdapter } from '../lib/scamwin/connectors/providers/gmail';
import { ProviderHttpClient } from '../lib/scamwin/connectors/provider-http';
import { providerItemSchema, type SavedConnection } from '../lib/scamwin/connectors/contracts';

const now = Date.parse('2026-11-10T12:00:00Z'), signal = new AbortController().signal;
const c: SavedConnection = { id: 'c', ownerId: 'o', epoch: 1, provider: 'gmail', mode: 'manual', status: 'active', scope: ['inbox'], scopeVersion: 1, rules: {}, activationAt: null, automaticDailyLimit: 1, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
const reference = { id: 'm1', receivedAt: '2026-11-10T11:00:00Z' };
const encoded = (s: string) => Buffer.from(s).toString('base64url');
function setup(reply: (u: URL) => Response | unknown) {
  const urls: URL[] = [];
  const adapter = new GmailAdapter({ now: () => new Date(now), accessToken: async () => 'private-fixture-token', revoke: async () => ({ status: 'revoked' }), fetch: async (input, init) => { const u = new URL(String(input)); urls.push(u); assert.equal(init?.redirect, 'error'); const v = reply(u); return v instanceof Response ? v : Response.json(v); } });
  return { adapter, urls };
}
test('text-only routine email uses persisted observation time, retaining backdated claims without changing revision on replay', async () => {
  const { adapter } = setup(() => ({ id: 'm1', labelIds: ['INBOX'], internalDate: '1', payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Routine' }], body: { data: encoded('Hello from a routine email') } } }));
  const a = await adapter.readItem(c, reference, signal), b = await adapter.readItem(c, reference, signal);
  assert.match(a.text, /Hello from a routine email/); assert.equal(a.receivedAt, reference.receivedAt); assert.match(a.text, /providerInternalDateMs: 1/); assert.equal(a.revisionHash, b.revisionHash); assert.ok(providerItemSchema.safeParse(a).success);
  const replay = await adapter.readItem(c, { ...reference, receivedAt: '2026-11-10T11:30:00Z' }, signal); assert.equal(replay.revisionHash, a.revisionHash);
});
test('nested MIME preserves hidden HTML link destinations and unsupported coverage', async () => {
  const { adapter } = setup(() => ({ id: 'm1', labelIds: ['INBOX'], internalDate: String(now), payload: { mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: encoded('Readable plain') } }, { mimeType: 'text/html', body: { data: encoded('<a hidden href="https://actual.test/claim?x=1">click</a>') } }] }, { partId: '2', mimeType: 'application/pdf', filename: 'doc.pdf', body: { attachmentId: 'pdf1', size: 5 } }] } }));
  const item = await adapter.readItem(c, reference, signal);
  assert.deepEqual(item.urls, ['https://actual.test/claim?x=1']); assert.equal(item.attachments[0].supported, false); assert.equal(item.extraction?.coverage, 'partial'); assert.ok(item.extraction?.diagnostics.some(x => x.reason === 'unsupported_content'));
});
test('long Gmail attachment IDs fit the shared contract through source-scoped references', async () => {
  const longId = 'a'.repeat(400);
  const { adapter, urls } = setup(u => u.pathname.includes('/attachments/') ? { data: encoded('abc'), size: 3 } : { id: 'm1', labelIds: ['INBOX'], internalDate: String(now), payload: { mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain', body: { data: encoded('Read the attached image') } }, { partId: '2', mimeType: 'image/png', filename: 'a.png', body: { attachmentId: longId, size: 3 } }] } });
  const item = await adapter.readItem(c, reference, signal); assert.ok(providerItemSchema.safeParse(item).success); assert.ok(item.attachments[0].id.length < 200);
  const bytes = await adapter.readAttachment(c, reference, item.attachments[0], { maxBytes: 10, deadlineAtMs: now + 10000 }, signal);
  assert.equal(bytes.length, 3); assert.ok(urls.at(-1)!.pathname.endsWith(`/attachments/${longId}`));
});
test('detached-only text returns an explicitly unavailable envelope for the private source ledger', async () => {
  const { adapter, urls } = setup(() => ({ id: 'm1', labelIds: ['INBOX'], internalDate: String(now), payload: { partId: '0', mimeType: 'text/plain', body: { attachmentId: 'detached', size: 20 } } }));
  const item = await adapter.readItem(c, reference, signal);
  assert.equal(item.extraction?.coverage, 'unavailable'); assert.ok(item.extraction.diagnostics.some(d => d.reason === 'detached_body')); assert.equal(item.text, ''); assert.ok(providerItemSchema.safeParse(item).success);
  assert.ok(urls.every(u => !u.pathname.includes('/attachments/')));
});
test('image-only email retains a pending-capable raster reference without fabricating text extraction', async () => {
  const { adapter } = setup(() => ({ id: 'm1', labelIds: ['INBOX'], internalDate: String(now), payload: { partId: '0', mimeType: 'image/png', filename: 'claim.png', body: { attachmentId: 'image1', size: 50 } } }));
  const item = await adapter.readItem(c, reference, signal);
  assert.equal(item.text, ''); assert.equal(item.extraction?.coverage, 'unavailable'); assert.equal(item.attachments.length, 1); assert.equal(item.attachments[0].supported, true); assert.ok(providerItemSchema.safeParse(item).success);
});
test('deleted, denied, expired-token and oversized items fail with private typed errors', async () => {
  for (const [status, code] of [[404, 'source_unavailable'], [403, 'source_unavailable'], [401, 'reconnect_required']] as const) {
    const { adapter } = setup(() => new Response('private message body', { status }));
    await assert.rejects(adapter.readItem(c, reference, signal), (e: unknown) => { assert.equal((e as { code: string }).code, code); assert.ok(!String(e).includes('private')); return true; });
  }
  const { adapter } = setup(u => u.searchParams.get('format') === 'metadata' ? { id: 'm1', labelIds: ['INBOX'] } : new Response(' '.repeat(3 * 1024 * 1024)));
  await assert.rejects(adapter.readItem(c, reference, signal), { code: 'source_unavailable' });
});
test('429 and 503 preserve bounded Retry-After without leaking provider data', async () => {
  for (const status of [429, 503]) {
    const { adapter } = setup(() => new Response('secret', { status, headers: { 'Retry-After': '120' } }));
    await assert.rejects(adapter.readItem(c, reference, signal), { code: 'provider_backoff', retryAfterMs: 120000 });
  }
});
test('selected listing fetches metadata only and supports empty paging', async () => {
  const { adapter, urls } = setup(u => u.pathname.endsWith('/messages') ? { messages: [{ id: 'm1' }], nextPageToken: 'next1' } : { id: 'm1', labelIds: ['INBOX'], internalDate: String(now), payload: { headers: [{ name: 'Subject', value: 'Select me' }] } });
  const page = await adapter.listSelected(c, null, signal);
  assert.equal(page.items[0].id, 'm1'); assert.equal(page.items[0].subject, 'Select me'); assert.equal(page.items[0].receivedAt, '2026-11-10T12:00:00.000Z'); assert.ok(page.nextPageToken);
  assert.equal(urls[1].searchParams.get('format'), 'metadata'); assert.ok(urls.every(u => !u.search.includes('full')));
});
test('single-label selected listing omits messages moved out of scope before metadata arrives', async () => {
  const { adapter, urls } = setup(u => u.pathname.endsWith('/messages') ? { messages: [{ id: 'm1' }], nextPageToken: 'next1' } : { id: 'm1', labelIds: ['SENT'], payload: { headers: [{ name: 'Subject', value: 'Moved out of inbox' }] } });
  const page = await adapter.listSelected(c, null, signal);
  assert.deepEqual(page.items, []); assert.equal(page.nextPageToken, 'next1'); assert.ok(urls.every(u => u.searchParams.get('format') !== 'full'));
});
test('manual selected listing does not treat provider backdated timestamps as admission time', async () => {
  const { adapter } = setup(u => u.pathname.endsWith('/messages') ? { messages: [{ id: 'm1' }] } : { id: 'm1', internalDate: '1', labelIds: ['INBOX'] });
  const selected = await adapter.listSelected(c, null, signal);
  assert.equal(selected.items[0].receivedAt, '2026-11-10T12:00:00.000Z');
});
test('attachment structure request omits body data at every supported MIME depth', async () => {
  const { adapter, urls } = setup(u => u.pathname.includes('/attachments/') ? { data: encoded('abc'), size: 3 } : { id: 'm1', labelIds: ['INBOX'], payload: { mimeType: 'image/png', body: { attachmentId: 'att', size: 3 } } });
  await adapter.readAttachment(c, reference, { id: 'gmail-bc588d08df73c2d3785eb57210236daf355f38436966f058597a93000df7c54f', name: 'a.png', mediaType: 'image/png', supported: true }, { maxBytes: 10, deadlineAtMs: now + 10000 }, signal);
  const fields = urls.find(u => u.searchParams.get('format') === 'full')!.searchParams.get('fields')!;
  assert.ok(fields.includes('parts(partId,mimeType,body(attachmentId,size),parts(')); assert.ok(!fields.includes(',parts)')); assert.ok(!fields.includes('data'));
});
test('attachment loader verifies message membership before loading encoded fixed endpoint', async () => {
  const { adapter, urls } = setup(u => u.pathname.includes('/attachments/') ? { data: encoded('raster'), size: 6 } : { id: 'm1', labelIds: ['INBOX'], payload: { mimeType: 'multipart/mixed', parts: [{ partId: '2', mimeType: 'image/png', filename: 'photo.png', body: { attachmentId: 'att1', size: 6 } }] } });
  const attachment = { id: 'gmail-f9d8e85dcb30f52647054e48591f828819a40591e1fe9dec3df8aa57467822af', name: 'photo.png', mediaType: 'image/png', supported: true, byteLength: 6 };
  const bytes = await adapter.readAttachment(c, reference, attachment, { maxBytes: 100, deadlineAtMs: now + 10000 }, signal);
  assert.equal(Buffer.from(bytes).toString(), 'raster'); assert.equal(urls.at(-1)?.pathname, '/gmail/v1/users/me/messages/m1/attachments/att1');
  await assert.rejects(adapter.readAttachment(c, reference, { ...attachment, id: 'other' }, { maxBytes: 100, deadlineAtMs: now + 10000 }, signal), { code: 'attachment_unavailable' });
  await assert.rejects(adapter.readAttachment(c, reference, { ...attachment, mediaType: 'application/pdf' }, { maxBytes: 100, deadlineAtMs: now + 10000 }, signal), { code: 'attachment_unavailable' });
});
test('out of scope and forged source IDs cannot trigger body or attachment content requests', async () => {
  const { adapter, urls } = setup(() => ({ id: 'm1', labelIds: ['SENT'] }));
  await assert.rejects(adapter.readItem(c, reference, signal), { code: 'source_unavailable' });
  await assert.rejects(adapter.readAttachment(c, reference, { id: 'att1', name: 'image.png', mediaType: 'image/png', supported: true }, { maxBytes: 100, deadlineAtMs: now + 10000 }, signal), { code: 'attachment_unavailable' });
  assert.ok(urls.every(u => u.searchParams.get('format') === 'metadata'));
});
test('scope changing between metadata and full response discards the item explicitly', async () => {
  const { adapter } = setup(u => ({ id: 'm1', labelIds: u.searchParams.get('format') === 'metadata' ? ['INBOX'] : ['SENT'], payload: { mimeType: 'text/plain', body: { data: encoded('sensitive') } } }));
  await assert.rejects(adapter.readItem(c, reference, signal), { code: 'source_unavailable' });
});
test('HTTP client rejects arbitrary URLs and bounds streaming without Response.json', async () => {
  let calls = 0;
  const client = new ProviderHttpClient({ origin: 'https://gmail.googleapis.com', allowedPath: /^\/gmail\/v1\/users\/me\/profile$/, fetch: async () => { calls++; return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65)); controller.close(); } })); } });
  await assert.rejects(client.json('https://evil.test', 'token', { signal, maxBytes: 64 }), { code: 'invalid_provider_path' }); assert.equal(calls, 0);
  await assert.rejects(client.json('/gmail/v1/users/me/profile', 'token', { signal, maxBytes: 64 }), { code: 'response_too_large' });
});
test('HTTP path validation rejects URL-normalized traversal before sending credentials', async () => {
  let calls = 0;
  const client = new ProviderHttpClient({ origin: 'https://gmail.googleapis.com', allowedPath: /^\/gmail\/v1\/users\/me\/messages\/[A-Za-z0-9_%=-]+$/, fetch: async () => { calls++; return Response.json({}); } });
  await assert.rejects(client.json('/gmail/v1/users/me/messages/%2e%2e', 'token', { signal, maxBytes: 64 }), { code: 'invalid_provider_path' });
  assert.equal(calls, 0);
});
test('provider token service failures cannot leak raw credential error details', async () => {
  const adapter = new GmailAdapter({ accessToken: async () => { throw new Error('secret grant payload'); }, revoke: async () => ({ status: 'revoked' }) });
  await assert.rejects(adapter.readItem(c, reference, signal), e => { assert.equal((e as { code: string }).code, 'provider_network'); assert.ok(!String(e).includes('secret')); return true; });
});
test('HTTP timeout stays active until stream completion and caller abort is propagated', async () => {
  const client = new ProviderHttpClient({ origin: 'https://gmail.googleapis.com', allowedPath: /^\/profile$/, timeoutMs: 20, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('{')); } })) });
  await assert.rejects(client.json('/profile', 'token', { signal, maxBytes: 64 }), { code: 'provider_timeout' });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(client.json('/profile', 'token', { signal: abort.signal, maxBytes: 64 }), { code: 'provider_aborted' });
});
test('redirect statuses and malformed JSON never expose untrusted details', async () => {
  for (const response of [new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }), new Response('secret malformed')]) {
    const client = new ProviderHttpClient({ origin: 'https://gmail.googleapis.com', allowedPath: /^\/profile$/, fetch: async () => response });
    await assert.rejects(client.json('/profile', 'token', { signal, maxBytes: 64 }), e => { assert.ok(!String(e).includes('secret')); return true; });
  }
});
