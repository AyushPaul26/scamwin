import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyDispatch } from '../lib/scamwin/connectors/crypto';
import worker, { runConnectorSchedule, type SchedulerDependencies, type SchedulerEnv } from '../workers/scamwin-connectors/src/index';

const secret = 'scheduler-test-only-secret-32-characters-λ';
const env: SchedulerEnv = {
  SCAMWIN_CONNECTOR_SCHEDULER_ENABLED: 'true',
  SCAMWIN_CONNECTOR_APP_ORIGIN: 'https://scamwin.vercel.app',
  SCAMWIN_CONNECTOR_DISPATCH_SECRET: secret,
};
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function hooks(fetcher: SchedulerDependencies['fetch']) {
  let now = 1_794_268_800_000;
  let sequence = 0;
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; ms: number }>();
  const dependencies: SchedulerDependencies = {
    fetch: fetcher,
    now: () => now,
    randomUUID: () => sequence++ === 0 ? firstId : secondId,
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout(token) { timers.delete(token as number); },
  };
  return { dependencies, timers, advance(ms: number) { now += ms; } };
}

test('default scheduled handler and every non-true gate perform no dispatch', async () => {
  assert.deepEqual(await worker.scheduled({}, {}), { status: 'disabled' });
  for (const gate of [undefined, '', 'false', '1', 'TRUE']) {
    const h = hooks(async () => { assert.fail('disabled scheduler fetched'); });
    assert.deepEqual(await runConnectorSchedule({ ...env, SCAMWIN_CONNECTOR_SCHEDULER_ENABLED: gate }, h.dependencies), { status: 'disabled' });
    assert.equal(h.timers.size, 0);
  }
});

test('invalid or private origins and insufficient secrets never dispatch', async () => {
  const origins = [undefined, '', 'http://scamwin.vercel.app', 'https://user:password@scamwin.vercel.app',
    'https://scamwin.vercel.app/path', 'https://scamwin.vercel.app?x=1', 'https://scamwin.vercel.app#x',
    'https://scamwin.vercel.app?', 'https://scamwin.vercel.app#', 'https://scamwin.vercel.app:443',
    'https://scamwin.vercel.app:8443', 'https://localhost', 'https://foo.local', 'https://foo.internal',
    'https://home.arpa', 'https://router.home.arpa',
    'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://169.254.169.254',
    'https://10.0.0.1', 'https://192.168.1.1', 'https://172.16.0.1', ' https://scamwin.vercel.app'];
  const h = hooks(async () => { assert.fail('invalid scheduler configuration fetched'); });
  for (const origin of origins) {
    assert.deepEqual(await runConnectorSchedule({ ...env, SCAMWIN_CONNECTOR_APP_ORIGIN: origin }, h.dependencies), { status: 'invalid_configuration' });
  }
  for (const value of [undefined, '', 's'.repeat(31), '😀'.repeat(16), 'λ'.repeat(31)]) {
    assert.deepEqual(await runConnectorSchedule({ ...env, SCAMWIN_CONNECTOR_DISPATCH_SECRET: value }, h.dependencies), { status: 'invalid_configuration' });
  }
});

test('fixed POST stages have interoperable exact-byte signatures at their actual call time', async () => {
  const captured: { url: string; init: RequestInit; time: number }[] = [];
  let actualTime = 1_794_268_800_000;
  const h = hooks(async (url, init) => {
    captured.push({ url: String(url), init: init!, time: actualTime });
    h.advance(56_000); actualTime += 56_000;
    return new Response('{}', { status: 200 });
  });
  const result = await runConnectorSchedule({ ...env, SCAMWIN_CONNECTOR_APP_ORIGIN: `${env.SCAMWIN_CONNECTOR_APP_ORIGIN}/` }, h.dependencies);
  assert.deepEqual(result, { status: 'completed', tick: { status: 'ok', httpStatus: 200 }, drain: { status: 'ok', httpStatus: 200 } });
  assert.equal(captured.length, 2);
  const key = createHash('sha256').update(secret, 'utf8').digest();
  for (const [index, action, id] of [[0, 'tick', firstId], [1, 'drain', secondId]] as const) {
    const request = captured[index];
    assert.equal(request.url, `https://scamwin.vercel.app/api/scamwin/connectors/${action}`);
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.redirect, 'error');
    assert.ok(request.init.signal instanceof AbortSignal);
    assert.equal(request.init.body, JSON.stringify({ version: 1, action, deliveryId: id }));
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('Cache-Control'), 'no-store');
    const signature = headers.get('X-Scamwin-Dispatch-Signature')!;
    assert.match(signature, /^\d{13}\.[a-f0-9]{64}$/);
    assert.equal(Number(signature.slice(0, 13)), request.time);
    assert.equal(verifyDispatch(String(request.init.body), signature, key, request.time), true);
    assert.equal(verifyDispatch(String(request.init.body).replace(action, action === 'tick' ? 'drain' : 'tick'), signature, key, request.time), false);
  }
  assert.equal(h.timers.size, 0);
});

test('tick headers and body are awaited before drain, and drain completion is awaited', async () => {
  const tickHeaders = deferred<Response>(), tickStarted = deferred<void>(), drainStarted = deferred<void>();
  const drainResponse = deferred<Response>();
  let releaseTickBody!: () => void;
  let calls = 0, finished = false;
  const h = hooks(async () => {
    if (++calls === 1) { tickStarted.resolve(); return tickHeaders.promise; }
    drainStarted.resolve(); return drainResponse.promise;
  });
  const running = runConnectorSchedule(env, h.dependencies).then((result) => { finished = true; return result; });
  await tickStarted.promise;
  assert.equal(calls, 1); assert.equal(finished, false);
  tickHeaders.resolve(new Response(new ReadableStream({ start(controller) { releaseTickBody = () => controller.close(); } })));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(finished, false);
  releaseTickBody(); await drainStarted.promise;
  assert.equal(calls, 2); assert.equal(finished, false);
  drainResponse.resolve(new Response(null, { status: 204 }));
  assert.equal((await running).status, 'completed'); assert.equal(finished, true);
});

test('tick network and HTTP failures still drain once without retries or secret reflection', async () => {
  for (const failure of ['network', 'http'] as const) {
    let calls = 0;
    const h = hooks(async () => {
      if (++calls === 1) {
        if (failure === 'network') throw new Error(`${secret} https://user:password@private.invalid`);
        return new Response(secret, { status: 503 });
      }
      return new Response(secret);
    });
    const result = await runConnectorSchedule(env, h.dependencies);
    assert.deepEqual(result, { status: 'completed', tick: failure === 'network'
      ? { status: 'failed', reason: 'transport_error' }
      : { status: 'failed', reason: 'http_error', httpStatus: 503 }, drain: { status: 'ok', httpStatus: 200 } });
    assert.equal(calls, 2); assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('header wait and streamed body share bounded deadlines even when fetch ignores abort', async () => {
  for (const phase of ['headers', 'body'] as const) {
    const stageStarted = [deferred<void>(), deferred<void>()];
    const bodyRead = [deferred<void>(), deferred<void>()];
    const signals: AbortSignal[] = [];
    let calls = 0, canceled = 0;
    const h = hooks(async (_url, init) => {
      const index = calls++; signals.push(init!.signal!); stageStarted[index].resolve();
      if (phase === 'headers') return new Promise<Response>(() => {});
      return new Response(new ReadableStream({
        pull() { bodyRead[index].resolve(); },
        cancel() { canceled++; return new Promise<void>(() => {}); },
      }, { highWaterMark: 0 }));
    });
    const running = runConnectorSchedule(env, h.dependencies);
    await stageStarted[0].promise;
    if (phase === 'body') await bodyRead[0].promise;
    assert.equal(h.timers.size, 1);
    const tickTimer = [...h.timers.values()][0]; assert.equal(tickTimer.ms, 60_000); tickTimer.callback();
    await stageStarted[1].promise;
    if (phase === 'body') await bodyRead[1].promise;
    assert.equal(signals[0].aborted, true); assert.equal(h.timers.size, 1);
    const drainTimer = [...h.timers.values()][0]; assert.equal(drainTimer.ms, 305_000); drainTimer.callback();
    assert.deepEqual(await running, { status: 'completed', tick: { status: 'failed', reason: 'timeout' }, drain: { status: 'failed', reason: 'timeout' } });
    assert.equal(signals[1].aborted, true); assert.equal(h.timers.size, 0);
    if (phase === 'body') assert.equal(canceled, 2);
  }
});

test('8KiB response boundary counts streamed bytes and cancels oversized responses', async () => {
  for (const [bytes, advertised] of [[8192, false], [8193, false], [8193, true]] as const) {
    let calls = 0, canceled = 0;
    const h = hooks(async () => {
      if (++calls === 2) return new Response(null, { status: 204 });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        if (bytes <= 8192) controller.close();
      }, cancel() { canceled++; } }), { headers: advertised ? { 'Content-Length': String(bytes) } : {} });
    });
    const result = await runConnectorSchedule(env, h.dependencies);
    assert.ok('tick' in result);
    assert.deepEqual(result.tick, bytes <= 8192 ? { status: 'ok', httpStatus: 200 } : { status: 'failed', reason: 'response_too_large' });
    assert.equal(canceled, bytes <= 8192 ? 0 : 1);
    assert.equal(calls, 2);
  }
});
