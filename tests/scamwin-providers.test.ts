import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { requestModelJson, ProviderError, extractOfferIntent } from '../lib/scamwin/ai';
import { collectWebsite } from '../lib/scamwin/collector';

const input = { url: 'https://example.com/', message: 'A refund offer', promisedBenefit: 'Receive money', intendedAction: 'receive_money', images: [] };

test('missing AI credentials never calls a provider or fabricates an answer', async () => {
  let called = false;
  await assert.rejects(requestModelJson('system', 'input', z.object({ message: z.string() }), { env: {}, fetcher: async () => { called = true; throw Error('unexpected'); } }), (e: unknown) => e instanceof ProviderError && e.code === 'not_configured');
  assert.equal(called, false);
});

test('AI responses are schema validated and one repair is bounded', async () => {
  let calls = 0;
  const result = await requestModelJson('system', 'input', z.object({ message: z.string() }).strict(), {
    env: { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'private' },
    fetcher: async () => { calls++; return Response.json({ success: true, result: { response: calls === 1 ? '{"invalid":true}' : '{"message":"ready"}' } }); },
  });
  assert.equal(result.message, 'ready'); assert.equal(calls, 2);
});

test('Cloudflare object responses produce a validated offer without a repair request', async () => {
  const offer = {
    claimedOrganization: 'Cedar Demo Society', promisedBenefit: 'free event pass',
    intendedAction: 'send a one-time code', requestedActions: ['send a one-time code'],
    extractedCandidates: [{ kind: 'organization', value: 'Cedar Demo Society', sourceRef: 'user_text' }],
    uncertainties: [],
  };
  let calls = 0;
  const result = await extractOfferIntent(input, {
    env: { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'private' }, allowRepair: false,
    fetcher: async () => { calls++; return Response.json({ success: true, result: { response: offer, usage: { prompt_tokens: 181, completion_tokens: 114 } } }); },
  });
  assert.deepEqual(result, offer);
  assert.equal(calls, 1);
});

test('AI still accepts fenced JSON string responses', async () => {
  const result = await requestModelJson('system', 'input', z.object({ message: z.string() }).strict(), {
    env: { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'private' }, allowRepair: false,
    fetcher: async () => Response.json({ success: true, result: { response: '```json\n{"message":"ready"}\n```' } }),
  });
  assert.deepEqual(result, { message: 'ready' });
});

test('object responses retain strict validation and never retry when repairs are disabled', async () => {
  for (const response of [null, [], 1, true, { message: 1 }, { message: 'ready', unexpected: true }]) {
    let calls = 0;
    await assert.rejects(requestModelJson('system', 'input', z.object({ message: z.string() }).strict(), {
      env: { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'private' }, allowRepair: false,
      fetcher: async () => { calls++; return Response.json({ success: true, result: { response } }); },
    }), (error: unknown) => error instanceof ProviderError && error.code === 'invalid_response');
    assert.equal(calls, 1);
  }
});

test('object responses exceeding the response size budget are rejected', async () => {
  await assert.rejects(requestModelJson('system', 'input', z.object({ message: z.string() }).strict(), {
    env: { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'private' }, allowRepair: false,
    fetcher: async () => Response.json({ success: true, result: { response: { message: 'x'.repeat(80_001) } } }),
  }), (error: unknown) => error instanceof ProviderError && error.code === 'invalid_response');
});

test('invalid object responses receive at most one repair request', async () => {
  let calls = 0;
  const result = await requestModelJson('system', 'input', z.object({ message: z.string() }).strict(), {
    env: { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'private' },
    fetcher: async () => { calls++; return Response.json({ success: true, result: { response: calls === 1 ? { message: 1 } : { message: 'ready' } } }); },
  });
  assert.deepEqual(result, { message: 'ready' });
  assert.equal(calls, 2);
});

test('quota failures are explicit and contain no provider token or raw error payload', async () => {
  await assert.rejects(extractOfferIntent(input, { env: { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'SECRET_MARKER' }, fetcher: async () => new Response('SECRET_MARKER', { status: 429 }) }), (e: unknown) => e instanceof ProviderError && e.code === 'quota_paused' && !e.message.includes('SECRET_MARKER'));
});

test('unapproved destinations cannot open a remote browser even with a token', async () => {
  let connected = false;
  const result = await collectWebsite(input.url, { checkId: 'case', runId: 'run' }, {
    env: { BROWSERLESS_TOKEN: 'secret', SCAMWIN_APPROVED_ORIGINS: 'https://lab.example.com' },
    connect: async () => { connected = true; throw Error('unexpected'); },
  });
  assert.equal(connected, false);
  assert.equal(result.observations[0].status, 'not_checked');
  assert.match(String(result.observations[0].data.reason), /scope|approved/i);
});

test('approved scope without verified capability stays disabled', async () => {
  const result = await collectWebsite('https://lab.example.com', { checkId: 'case', runId: 'run' }, { env: { BROWSERLESS_TOKEN: 'secret', SCAMWIN_APPROVED_ORIGINS: 'https://lab.example.com' } });
  assert.equal(result.observations[0].status, 'not_checked');
});
