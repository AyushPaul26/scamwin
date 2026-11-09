import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebTools, publicWebUrl } from '../lib/web-tools';
const options = { toolCallId: 'web', messages: [], context: {} };
test('public URLs reject local hosts, IPs, credentials and non-web protocols', () => {
  for (const url of ['http://localhost', 'http://127.0.0.1', 'http://[::1]', 'file:///tmp/x', 'https://user:pass@example.com', 'http://metadata.google.internal']) {
    assert.throws(() => publicWebUrl(url));
  }
  assert.equal(publicWebUrl('https://example.com/a#b'), 'https://example.com/a');
});
test('long pages are completely retrievable in bounded chunks without another scrape', async () => {
  let calls = 0; let auth = 0;
  const read = createWebTools(async () => { auth++; }, async () => { calls++; return { markdown: 'x'.repeat(21000), metadata: { title: 'Example' } }; }).readWebPage;
  const first = await read.execute!({ url: 'https://example.com', offset: 0 }, options);
  assert.ok('content' in first); assert.equal(first.content?.length, 18000); assert.equal(first.nextOffset, 18000);
  const second = await read.execute!({ url: 'https://example.com', offset: 18000 }, options);
  assert.ok('content' in second); assert.equal(second.content?.length, 3000); assert.equal(second.nextOffset, null); assert.equal(calls, 1); assert.equal(auth, 3);
});
test('authorization and stop prevent network calls; provider errors are sanitized', async () => {
  let calls = 0;
  const scrape = async () => { calls++; throw new Error('secret-token'); };
  const denied = createWebTools(async () => { throw new Error('Denied'); }, scrape).readWebPage;
  await assert.rejects(async () => denied.execute!({ url: 'https://example.com', offset: 0 }, options));
  const read = createWebTools(async () => {}, scrape).readWebPage;
  await assert.rejects(async () => read.execute!({ url: 'https://example.com', offset: 0 }, { ...options, abortSignal: AbortSignal.abort() }));
  assert.equal(calls, 0);
  const result = await read.execute!({ url: 'https://example.com', offset: 0 }, options);
  assert.ok('error' in result); assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});
