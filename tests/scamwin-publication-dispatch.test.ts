import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const secret = 'synthetic-dispatch-secret-32-characters';
const configured = { SCAMWIN_PUBLICATION_BACKEND: 'vercel', SCAMWIN_PUBLISHER_BASE_URL: 'https://synthetic-publisher.vercel.app', SCAMWIN_PUBLISHER_DISPATCH_SECRET: secret };
async function boundary() {
  const module = await import('../lib/scamwin/publication-dispatch').catch(() => null);
  assert.ok(module?.dispatchVercelPublication, 'Publication HTTP dispatcher must be available');
  assert.ok(module?.publicationBackend, 'Publication backend selector must be available');
  return module;
}

test('publication requires an explicit backend and dedicated Trigger credentials', async () => {
  const { publicationBackend } = await boundary();
  assert.equal(publicationBackend({}), null);
  assert.equal(publicationBackend({ SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY: 'synthetic' }), null);
  assert.equal(publicationBackend({ SCAMWIN_PUBLICATION_BACKEND: 'invalid', SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY: 'synthetic' }), null);
  assert.equal(publicationBackend({ SCAMWIN_PUBLICATION_BACKEND: 'vercel' }), 'vercel');
  assert.equal(publicationBackend({ SCAMWIN_PUBLICATION_BACKEND: 'trigger', TRIGGER_SECRET_KEY: 'investigation-only' }), null);
  assert.equal(publicationBackend({ SCAMWIN_PUBLICATION_BACKEND: 'trigger', SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY: 'synthetic' }), 'trigger');
});

test('missing publisher configuration never sends a request or falls back to Trigger', async () => {
  const { dispatchVercelPublication } = await boundary();
  for (const env of [{}, { ...configured, SCAMWIN_PUBLISHER_BASE_URL: '' }, { ...configured, SCAMWIN_PUBLISHER_DISPATCH_SECRET: 'short' }, { ...configured, SCAMWIN_PUBLICATION_BACKEND: 'trigger', SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY: 'synthetic' }]) {
    assert.deepEqual(await dispatchVercelPublication({ env, fetcher: async () => { assert.fail('unconfigured dispatch attempted HTTP'); } }), { ok: false, status: 'unconfigured' });
  }
});

test('dispatch rejects non-Vercel, non-HTTPS and ambiguous publisher origins', async () => {
  const { dispatchVercelPublication } = await boundary();
  for (const url of ['http://synthetic-publisher.vercel.app', 'https://example.com', 'https://vercel.app', 'https://publisher.vercel.app.attacker.example', 'https://user:pass@publisher.vercel.app', 'https://publisher.vercel.app/api/relay', 'https://publisher.vercel.app/?redirect=1', 'https://publisher.vercel.app/#fragment', 'https://publisher.vercel.app/?', 'https://publisher.vercel.app/#', 'https://publisher.vercel.app:8443', 'not-a-url']) {
    assert.deepEqual(await dispatchVercelPublication({ env: { ...configured, SCAMWIN_PUBLISHER_BASE_URL: url }, fetcher: async () => { assert.fail('invalid publisher origin attempted HTTP'); } }), { ok: false, status: 'unconfigured' }, url);
  }
});

test('publisher dispatch sends a bodyless authenticated POST and prohibits redirects', async () => {
  const { dispatchVercelPublication } = await boundary();
  let requests = 0;
  const result = await dispatchVercelPublication({ env: configured, fetcher: async (url, init) => {
    requests++;
    assert.equal(String(url), 'https://synthetic-publisher.vercel.app/api/relay');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${secret}`);
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response('ignored publisher response', { status: 200 });
  } });
  assert.deepEqual(result, { ok: true, status: 'dispatched' });
  assert.equal(requests, 1);
});

test('HTTP failures and thrown secrets produce only bounded sanitized statuses', async () => {
  const { dispatchVercelPublication } = await boundary();
  for (const status of [302, 401, 429, 500]) {
    assert.deepEqual(await dispatchVercelPublication({ env: configured, fetcher: async () => new Response(secret, { status }) }), { ok: false, status: 'unavailable' });
  }
  assert.deepEqual(await dispatchVercelPublication({ env: configured, fetcher: async () => { throw new Error(`sensitive stack ${secret}`); } }), { ok: false, status: 'unavailable' });
});

test('publisher dispatch aborts its deadline and returns gracefully', async () => {
  const { dispatchVercelPublication } = await boundary();
  let aborted = false;
  const result = await dispatchVercelPublication({ env: configured, timeoutMs: 5, fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error(secret)); }, { once: true });
  }) });
  assert.equal(aborted, true);
  assert.deepEqual(result, { ok: false, status: 'unavailable' });
});

test('main website configuration refuses a publisher signing key without exposing it', () => {
  const cleanEnv = { ...process.env };
  delete cleanEnv.SCAMWIN_PUBLISHER_PRIVATE_KEY;
  const evaluate = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', "try { await import('./next.config.ts'); process.stdout.write('accepted'); } catch { process.stdout.write('rejected'); }"], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8', timeout: 20_000 });
  const allowed = evaluate(cleanEnv);
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, 'accepted');
  const refused = evaluate({ ...cleanEnv, SCAMWIN_PUBLISHER_PRIVATE_KEY: 'synthetic-main-site-key-must-never-be-used' });
  assert.equal(refused.status, 0);
  assert.equal(refused.stdout, 'rejected');
  assert.equal(refused.stderr.includes('synthetic-main-site-key-must-never-be-used'), false);
});
