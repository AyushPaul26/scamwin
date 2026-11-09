import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectWebsite, handleBrowserHealth } from '../lib/scamwin/collector';

test('browser health authenticates before invoking collection', async () => {
  let calls = 0;
  for (const authorization of ['', 'Bearer wrong']) {
    const response = await handleBrowserHealth(new Request('https://example.com/api/scamwin/browser-health', { headers: { authorization } }), { env: { CRON_SECRET: 'operator-secret' }, collect: async () => { calls++; throw Error('unexpected'); } });
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
});

test('browser health collects only its fixed fixture and returns counts', async () => {
  const response = await handleBrowserHealth(new Request('https://example.com/api/scamwin/browser-health?url=https://evil.example', { headers: { authorization: 'Bearer operator-secret' } }), { env: { CRON_SECRET: 'operator-secret' }, collect: async (url) => {
    assert.equal(url, 'https://scamwin.vercel.app/lab/refund-checkpoint');
    return { observations: [{ status: 'observed', kind: 'page' }], captures: [{ dataUrl: 'PRIVATE_CAPTURE' }] } as never;
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { healthy: true, observations: 1, captures: 1 });
});

test('collector reports bounded redacted failure metadata without storing diagnostics', async () => {
  let failure: unknown;
  const result = await collectWebsite('https://scamwin.vercel.app/lab/refund-checkpoint', { checkId: 'health', runId: 'health' }, {
    env: { BROWSERLESS_TOKEN: 'PRIVATE_TOKEN', CRON_SECRET: 'OPERATOR_SECRET', SCAMWIN_APPROVED_ORIGINS: 'https://scamwin.vercel.app', SCAMWIN_BROWSER_CAPABILITY_VERIFIED: 'true' },
    connect: async () => { throw Error('Failed PRIVATE_TOKEN OPERATOR_SECRET wss://example.com/chromium?token=PRIVATE_TOKEN Bearer HIDDEN_TOKEN ' + 'x'.repeat(600)); },
    onFailure: value => { failure = value; },
  });
  assert.equal((failure as { phase: string }).phase, 'connect_browser');
  assert.ok((failure as { message: string }).message.length <= 500);
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_TOKEN|OPERATOR_SECRET|HIDDEN_TOKEN|wss:\/\//);
  assert.doesNotMatch(JSON.stringify(result), /phase|PRIVATE_TOKEN|OPERATOR_SECRET|Failed/);
  assert.equal(result.observations[0].status, 'unavailable');
});
