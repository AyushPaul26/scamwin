import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, probeOrigin } from '../lib/scamwin/origin-probe';
test('origin probe blocks private, mapped, link-local, documentation and reserved DNS addresses', () => {
  for (const address of ['127.0.0.1','10.1.2.3','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','fe80::1','192.0.2.1','203.0.113.9','0.0.0.0']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('origin probe never resolves out of scope destinations', async () => {
  let called = false;
  const observation = await probeOrigin('https://example.com/', { checkId: 'c', runId: 'r' }, { env: {}, resolve: (async () => { called = true; throw Error(); }) as never });
  assert.equal(called, false); assert.equal(observation.status, 'not_checked');
});
test('mixed public/private DNS is blocked before any connection', async () => {
  const observation = await probeOrigin('https://example.com/', { checkId: 'c', runId: 'r' }, { env: { SCAMWIN_ORIGIN_PROBE_ENABLED: 'true', SCAMWIN_APPROVED_ORIGINS: 'https://example.com' }, resolve: (async () => [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]) as never });
  assert.equal(observation.status, 'blocked');
});
test('a stalled DNS lookup respects cancellation without opening a socket', async () => {
  const controller = new AbortController();
  const probe = probeOrigin('https://example.com', {checkId:'c',runId:'r'}, {signal:controller.signal,env:{SCAMWIN_ORIGIN_PROBE_ENABLED:'true',SCAMWIN_APPROVED_ORIGINS:'https://example.com'},resolve:(() => new Promise(() => {})) as never});
  controller.abort();
  await assert.rejects(probe, {name:'AbortError'});
});
test('a plaintext URL is not presented as a performed origin TLS test', async () => {
  const observation=await probeOrigin('http://example.com',{checkId:'c',runId:'r'},{env:{}});
  assert.equal(observation.status,'not_checked'); assert.equal(observation.data.valid,undefined);
});
