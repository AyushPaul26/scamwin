import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type RequestOptions, type ServerOptions } from 'node:https';
import { type IncomingMessage, type ServerResponse, type ClientRequest } from 'node:http';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import { createHash } from 'node:crypto';
import type { lookup } from 'node:dns/promises';
import { createOfficialReader } from '../lib/scamwin/official-source-reader';
import type { OfficialReadBudget, OfficialSource, PublicOfferReference } from '../lib/scamwin/official-verification-contracts';

// Public, test-only self-signed CA/key. The HTTPS harness keeps native certificate checks enabled.
const certificate = `-----BEGIN CERTIFICATE-----
MIIC/TCCAeWgAwIBAgIUKl5aRXgzgS/HcnE12FgxJ1jv8MowDQYJKoZIhvcNAQEL
BQAwHjEcMBoGA1UEAwwTY2FyZWVycy5leGFtcGxlLm9yZzAeFw0yMDAxMDEwMDAw
MDBaFw00MDAxMDEwMDAwMDBaMB4xHDAaBgNVBAMME2NhcmVlcnMuZXhhbXBsZS5v
cmcwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC5aLwqBb6U4ZgvSjEG
Ce5SnswvzK8FxFNtxUgWEi5ISKRRtjfjd0BnrGvBenb7EMwxDKV/C0jcaw+k7E6V
euyiWPQfcr2HYp3rWRiuv/pvpQnGe6fS/5v9x5MASqYx12TpQRZsH+lH7uVYl1Hq
5NJj0HBsT1acAmBceYSMW/mMnGMiZexwaOWdSmvc7fnYwym8GFROe6bX3BBHfHim
vNk5OWYuKn+9qLfE2MwYP62DVj0mhY48ZsE2PF9srb85PMk/uTM/HVQKkif+qHvW
QFy9KanMNfZ1Ztx3vwvaRtnM4U4S6U5W3SvehC+toM1hYEexCXA06ZYXRLlhMlwa
ldypAgMBAAGjMzAxMB4GA1UdEQQXMBWCE2NhcmVlcnMuZXhhbXBsZS5vcmcwDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAJQCJ5kYQlO3ON7MfIlTg
nVdKBhKBvoXM5DSE3kZA7fM6bEWNm4MZfXnsKh6wgxCeO55J5/8L/HM91KqdCQgC
7iB76eWgMpPZ5bK920oRlP2NRS9gqo9NVzpPtxz36nVox/PKAqa9biconaoDyNe3
bPoip1uD/sT9HX6mfpJQPf75wtpEqMyEmEFINj0ZrBl/eblr9s0oYkcKzyau03gp
hTGs/dQ/RQ00IUYs6IXNh43SAof+5HzUSFQb/4jtW+/cYMe0/d67f4dNIHkYd06O
pinWMnXBB+UsoF/yy9O1OO5XegoUDsOUkMnzrRAOfnNK/erENdQOFEBSzA8LSpzr
lQ==
-----END CERTIFICATE-----`;
const key = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5aLwqBb6U4Zgv
SjEGCe5SnswvzK8FxFNtxUgWEi5ISKRRtjfjd0BnrGvBenb7EMwxDKV/C0jcaw+k
7E6VeuyiWPQfcr2HYp3rWRiuv/pvpQnGe6fS/5v9x5MASqYx12TpQRZsH+lH7uVY
l1Hq5NJj0HBsT1acAmBceYSMW/mMnGMiZexwaOWdSmvc7fnYwym8GFROe6bX3BBH
fHimvNk5OWYuKn+9qLfE2MwYP62DVj0mhY48ZsE2PF9srb85PMk/uTM/HVQKkif+
qHvWQFy9KanMNfZ1Ztx3vwvaRtnM4U4S6U5W3SvehC+toM1hYEexCXA06ZYXRLlh
MlwaldypAgMBAAECggEAFJ9fKodoCtRK4pusd0D8hqkOChUItKoBI5kJaxcLmdOm
n0YW0lCt07o8ZBFUkZltNNl0wPxG1ul7nHsCRKMfFfGx+ZuAFEJ2UTqgQbOtzeQ8
AZ04bgIrXh9oLOSgtrOAEGfCcDVec7dRQDjYjjl0Y1DIaGustP6YrECB60DBsY90
9Jn3JzadMA3lkpjWabT896VwuveUg842J7dAfDFwJYZzOV0LqURdfWeNnUot66z0
ko25UdRve9j/GSX5nKufqMxzvsr5B/JvHlvk3l2bSLyxOUbNalgynMCp4gpMNnEU
xg7utjj61vi537OXJRYBOe9n0+j6YrAaDEJtQdKP5wKBgQDnGCWKfnnbDnrK7HAS
x/tgmzK0ZL5cgXIu+/vBp1unJ1Imh1HxaNRoM/HVMr+BqiNZvEw0CO0NL9mGfLcT
dy5B4hs0xHuCkNZhCdVwg9WbvKyDhdr8rZfMnCPC9Eim8bAneWTwASOHh0UnspBi
SMOc++PboQfRT/y1NQ8TAD7LKwKBgQDNZCQwzqo2IndISB3sCIfqZienGR8h7+kr
l3xsWqOce1hAurs7Eh6vEAyPBR1xwgZLyc68SVz3ASdyDReaeXCfRFPbNgB82+1u
4pjhEI1bwmG5Esg9438G+Xcx+eGsUw92znyiAPVuDGxAmFiKZgbNlTgPsZ3xiCNG
BoI6rYM9ewKBgQC3IL1vGHa8Dqdj8yWE3JDpp1Lw/PyVFcdEUE7a0SKiPViuS4G2
Clp4EOHNDyAPQqIs1DiW65PeZVK9bkst074GW4UvtZwihWA9GavYM8CsX0FeIE6+
+VlXvUvhi++ey9vKDDrerihXl+xHXwtntz28Qyf3vY4SYo5hkqBVcFZSbQKBgQCH
2sZJdlmF5zRJHlKUbmwgciOmVmqOUxdDGzdUoHt6JOgSILF5eBnNp+r2quZ3+WOa
u8jAKDKSuzOxL9G9/res0VA6PjUCYaJiZwXCUOV/nUpwVWkX7qN2JIpgBy3rgyFG
b3xm2AV/Hj54V4yxNp0nXJ0xXEXhni/ewK1hTKXzgwKBgEVCrYiIkFHdmu03ggra
aS+BjR7UJ3Kw7UWohv8ac+bcs36o52R0WfjHIU1FoivfumTqPFAvQCplCUHp4rGu
OiAOiy++5+aM3tbz8JiJ4X54gch5mH8dcWsHxPr3TyeE42Cf7eZXXDPEr/HtTEMh
RWkOipp7VVLO/L08HyqqF8Wy
-----END PRIVATE KEY-----`;

const epoch = Date.parse('2026-11-10T00:00:00Z');
const source: OfficialSource = { id: 'fixture-jobs', companyId: 'fixture', kind: 'jobposting_jsonld', purpose: 'careers', entryUrl: 'https://careers.example.org/careers', listingOrigin: 'https://careers.example.org', listingPathPrefix: '/jobs/', relationshipEvidenceUrl: 'https://careers.example.org/about' };
const reference: PublicOfferReference = { kind: 'canonical_listing_url', value: 'https://careers.example.org/jobs/42', origin: 'explicit_field' };
const options = (budget: OfficialReadBudget = newBudget()) => ({ signal: new AbortController().signal, budget });
const newBudget = (): OfficialReadBudget => ({ deadlineAtMs: epoch + 20_000, documentsRemaining: 2, requestsRemaining: 4, bytesRemaining: 512 * 1024 });
const publicDns = (async () => [{ address: '93.184.216.34', family: 4 }]) as unknown as typeof lookup;

async function harness(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void, extra: ServerOptions = {}) {
  const sockets = new Set<Duplex>();
  const server = createServer({ key, cert: certificate, ...extra }, handler);
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const requests: ClientRequest[] = [];
  const errors: string[] = [];
  const routedRequest = ((configuration: RequestOptions, callback: (response: IncomingMessage) => void) => {
    // Only the validated literal IP may reach this local test route. No hostname lookup is possible.
    assert.ok(['93.184.216.34', '2606:4700:4700::1111'].includes(String(configuration.hostname)), 'HTTPS must use the pinned public IP');
    assert.equal(configuration.agent, false);
    assert.equal(configuration.rejectUnauthorized, true);
    const actual = request({ ...configuration, hostname: '127.0.0.1', port: address.port, ca: certificate }, callback);
    actual.on('error', error => errors.push(error.message));
    requests.push(actual);
    return actual;
  }) as typeof request;
  return { request: routedRequest, requests, errors, reader: createOfficialReader({ resolve: publicDns, request: routedRequest, now: () => epoch }) };
}

test('native HTTPS preserves Host, SNI and certificate identity without a second DNS lookup or private headers', async t => {
  let received = 0;
  const transport = await harness(t, (req, res) => {
    received++;
    assert.equal(req.headers.host, 'careers.example.org');
    assert.equal((req.socket as TLSSocket & { servername: string }).servername, 'careers.example.org');
    assert.equal(req.url, '/jobs/42');
    assert.equal(req.method, 'GET');
    assert.equal(req.headers['accept-encoding'], 'identity');
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['proxy-authorization'], undefined);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h1>Public posting</h1>');
  });
  let dnsCalls = 0;
  const reader = createOfficialReader({ resolve: (async () => ++dnsCalls === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]) as unknown as typeof lookup, request: transport.request, now: () => epoch });
  const document = await reader(source, reference, options());
  assert.equal(document.status, 'ok', JSON.stringify({ document, errors: transport.errors }));
  assert.equal(document.body, '<h1>Public posting</h1>');
  assert.equal(document.digest, createHash('sha256').update('<h1>Public posting</h1>').digest('hex'));
  assert.equal(document.readUrl, 'https://careers.example.org/jobs/42');
  assert.equal(document.finalReadUrl, 'https://careers.example.org/jobs/42');
  assert.equal(document.fetchedAt, '2026-11-10T00:00:00.000Z');
  assert.equal(received, 1);
});

test('native TLS rejects a certificate for another reviewed hostname', async t => {
  let received = 0;
  const transport = await harness(t, (_req, res) => { received++; res.end('must not be read'); });
  const wrong = { ...source, listingOrigin: 'https://jobs.example.org', entryUrl: 'https://jobs.example.org/careers', relationshipEvidenceUrl: 'https://jobs.example.org/about' };
  const document = await transport.reader(wrong, { ...reference, value: 'https://jobs.example.org/jobs/42' }, options());
  assert.equal(document.status, 'unavailable');
  assert.equal(document.body, null);
  assert.equal(received, 0);
});

for (const records of [
  [{ address: '127.0.0.1', family: 4 }],
  [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }],
  [{ address: '::1', family: 6 }],
  [{ address: '::ffff:192.168.1.1', family: 6 }],
  [{ address: '169.254.169.254', family: 4 }],
  [{ address: '192.0.2.1', family: 4 }],
  [{ address: '93.184.216.34', family: 6 }],
  [],
]) test(`non-public, mixed or malformed DNS answers are blocked: ${JSON.stringify(records)}`, async () => {
  const reader = createOfficialReader({ resolve: (async () => records) as unknown as typeof lookup, request: (() => { assert.fail('Forbidden DNS must not reach a socket'); }) as typeof request, now: () => epoch });
  const document = await reader(source, reference, options());
  assert.equal(document.status, 'blocked'); assert.equal(document.body, null);
});

test('public IPv6 is pinned without resolving again', async t => {
  const transport = await harness(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('ok'); });
  const reader = createOfficialReader({ resolve: (async () => [{ address: '2606:4700:4700::1111', family: 6 }]) as unknown as typeof lookup, request: transport.request, now: () => epoch });
  assert.equal((await reader(source, reference, options())).status, 'ok');
});

test('a DNS rebind on an in-scope redirect cannot open a private socket', async t => {
  let received = 0, lookups = 0;
  const transport = await harness(t, (_req, res) => { received++; res.writeHead(302, { Location: '/jobs/43' }); res.end(); });
  const reader = createOfficialReader({ resolve: (async () => ++lookups === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '10.0.0.2', family: 4 }]) as unknown as typeof lookup, request: transport.request, now: () => epoch });
  assert.equal((await reader(source, reference, options())).status, 'blocked');
  assert.equal(received, 1);
});

for (const location of ['https://127.0.0.1/jobs/43', 'https://other.example.org/jobs/43', '/admin', '/jobs-evil/43', '/jobs/43?invitation=private', '/jobs/%2e%2e/admin']) {
  test(`an out-of-scope redirect is blocked before another connection: ${location}`, async t => {
    let received = 0;
    const transport = await harness(t, (_req, res) => { received++; res.writeHead(302, { Location: location }); res.end(); });
    const document = await transport.reader(source, reference, options());
    assert.equal(document.status, 'blocked'); assert.equal(received, 1);
  });
}

test('one in-scope redirect per document consumes exactly four requests across two documents', async t => {
  let received = 0;
  const transport = await harness(t, (req, res) => {
    received++;
    if (req.url === '/jobs/42') { res.writeHead(302, { Location: '/jobs/43', 'Set-Cookie': 'private=secret; Secure' }); res.end(); }
    else { assert.equal(req.headers.cookie, undefined); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('ok'); }
  });
  const budget = newBudget();
  const first = await transport.reader(source, reference, options(budget));
  assert.equal(first.status, 'ok'); assert.equal(first.finalReadUrl, 'https://careers.example.org/jobs/43');
  assert.equal((await transport.reader(source, reference, options(budget))).status, 'ok');
  assert.equal((await transport.reader(source, reference, options(budget))).status, 'unavailable');
  assert.equal(budget.requestsRemaining, 0); assert.equal(budget.documentsRemaining, 0); assert.equal(received, 4);
});

test('a second redirect is blocked rather than retried', async t => {
  let received = 0;
  const transport = await harness(t, (_req, res) => { received++; res.writeHead(302, { Location: '/jobs/43' }); res.end(); });
  const document = await transport.reader(source, reference, options());
  assert.equal(document.status, 'blocked'); assert.equal(received, 2);
});

test('the last available request cannot be exceeded by a redirect', async t => {
  let received = 0;
  const transport = await harness(t, (_req, res) => { received++; res.writeHead(302, { Location: '/jobs/43' }); res.end(); });
  const budget = { ...newBudget(), requestsRemaining: 1 };
  assert.equal((await transport.reader(source, reference, options(budget))).status, 'unavailable');
  assert.equal(budget.requestsRemaining, 0); assert.equal(received, 1);
});

test('exactly 256 KiB per body and 512 KiB total remain readable', async t => {
  const body = 'x'.repeat(256 * 1024);
  const transport = await harness(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(body); });
  const budget = newBudget();
  assert.equal((await transport.reader(source, reference, options(budget))).body?.length, 262144);
  assert.equal((await transport.reader(source, reference, options(budget))).body?.length, 262144);
  assert.equal(budget.bytesRemaining, 0);
});

test('oversized response is unavailable rather than an absent posting', async t => {
  const transport = await harness(t, (_req, res) => { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('x'.repeat(256 * 1024 + 1)); });
  const document = await transport.reader(source, reference, options());
  assert.equal(document.status, 'unavailable'); assert.equal(document.body, null); assert.equal(document.digest, null);
  assert.equal(transport.requests[0].destroyed, true);
});

test('the shared remaining byte budget stops a smaller response', async t => {
  const transport = await harness(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('four'); });
  const budget = { ...newBudget(), bytesRemaining: 3 };
  assert.equal((await transport.reader(source, reference, options(budget))).status, 'unavailable');
  assert.equal(budget.bytesRemaining, 0);
});

for (const [headers, body] of [
  [{ 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }, 'compressed'],
  [{ 'Content-Type': 'text/html', 'Content-Encoding': 'br' }, 'compressed'],
  [{ 'Content-Type': 'application/pdf' }, 'unsupported'],
  [{ 'Content-Type': 'text/html; charset=iso-8859-1' }, 'unsupported'],
  [{ 'Content-Type': 'text/html; charset = iso-8859-1' }, 'unsupported'],
  [{ 'Content-Type': 'text/html' }, Buffer.from([0xff, 0xfe])],
] as const) test(`unsupported or encoded responses cannot establish posting absence: ${JSON.stringify(headers)}`, async t => {
  const transport = await harness(t, (_req, res) => { res.writeHead(404, headers); res.end(body); });
  const document = await transport.reader(source, reference, options());
  assert.equal(document.status, 'unavailable'); assert.equal(document.body, null);
});

test('a truncated 404 is unavailable while a complete 404 means not found', async t => {
  const transport = await harness(t, (req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/html', 'Content-Length': 10 });
    if (req.url === '/jobs/42') { res.write('short'); setImmediate(() => res.destroy()); }
    else res.end('not found!');
  });
  assert.equal((await transport.reader(source, reference, options())).status, 'unavailable');
  const document = await transport.reader(source, { ...reference, value: 'https://careers.example.org/jobs/43' }, options());
  assert.equal(document.status, 'not_found'); assert.equal(document.body, 'not found!');
});

test('cancellation after headers rejects and destroys the native request and socket', async t => {
  let headersSent!: () => void;
  const ready = new Promise<void>(resolve => { headersSent = resolve; });
  const transport = await harness(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('partial'); headersSent(); });
  const controller = new AbortController();
  const pending = transport.reader(source, reference, { ...options(), signal: controller.signal });
  await ready;
  const aborted = assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
  controller.abort();
  await aborted;
  assert.equal(transport.requests[0].destroyed, true);
  assert.equal(transport.requests[0].socket?.destroyed, true);
});

test('cancellation during DNS prevents a late resolver from opening a connection', async () => {
  let release!: (value: { address: string; family: number }[]) => void;
  const resolution = new Promise<{ address: string; family: number }[]>(resolve => { release = resolve; });
  const reader = createOfficialReader({ resolve: (() => resolution) as unknown as typeof lookup, request: (() => { assert.fail('Cancelled DNS must not open a connection'); }) as typeof request, now: () => epoch });
  const controller = new AbortController();
  const pending = reader(source, reference, { ...options(), signal: controller.signal });
  const aborted = assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
  controller.abort(); await aborted;
  release([{ address: '93.184.216.34', family: 4 }]);
  await new Promise<void>(resolve => setImmediate(resolve));
});

test('the eight-second wall-clock request limit destroys a hanging body', async t => {
  let headersSent!: () => void;
  const ready = new Promise<void>(resolve => { headersSent = resolve; });
  const transport = await harness(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('partial'); headersSent(); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = transport.reader(source, reference, options());
  await ready;
  t.mock.timers.tick(7999);
  assert.equal(transport.requests[0].destroyed, false);
  t.mock.timers.tick(1);
  const document = await pending;
  assert.equal(document.status, 'unavailable'); assert.equal(document.body, null);
  assert.equal(transport.requests[0].destroyed, true); assert.equal(transport.requests[0].socket?.destroyed, true);
});

test('the shared twenty-second deadline includes DNS, headers and later documents', async t => {
  let received = 0, current = epoch;
  const transport = await harness(t, (_req, res) => { received++; current = epoch + 20_000; res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('late'); });
  const reader = createOfficialReader({ resolve: publicDns, request: transport.request, now: () => current });
  const budget = newBudget();
  assert.equal((await reader(source, reference, options(budget))).status, 'unavailable');
  assert.equal((await reader(source, reference, options(budget))).status, 'unavailable');
  assert.equal(received, 1);
});

test('no DNS or request starts at the exact stage deadline', async () => {
  const reader = createOfficialReader({ resolve: (() => { assert.fail('Expired stage must not resolve DNS'); }) as typeof lookup, request: (() => { assert.fail('Expired stage must not connect'); }) as typeof request, now: () => epoch + 20_000 });
  assert.equal((await reader(source, reference, options())).status, 'unavailable');
});

test('unreviewed reference queries and unsupported source definitions never reach transport', async () => {
  const reader = createOfficialReader({ resolve: (() => { assert.fail('Invalid scope must not resolve DNS'); }) as typeof lookup, request, now: () => epoch });
  assert.equal((await reader(source, { ...reference, value: 'https://careers.example.org/jobs/42?email=private' }, options())).status, 'blocked');
  assert.equal((await reader({ ...source, entryUrl: 'http://careers.example.org/careers' }, reference, options())).status, 'blocked');
});

test('DNS time counts toward the same eight-second request limit as the body', async t => {
  let release!: (value: { address: string; family: number }[]) => void;
  const resolution = new Promise<{ address: string; family: number }[]>(resolve => { release = resolve; });
  let headersSent!: () => void;
  const ready = new Promise<void>(resolve => { headersSent = resolve; });
  const transport = await harness(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('partial'); headersSent(); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reader = createOfficialReader({ resolve: (() => resolution) as unknown as typeof lookup, request: transport.request, now: () => epoch });
  const pending = reader(source, reference, options());
  t.mock.timers.tick(7000);
  release([{ address: '93.184.216.34', family: 4 }]);
  await ready;
  t.mock.timers.tick(999);
  assert.equal(transport.requests[0].destroyed, false);
  t.mock.timers.tick(1);
  assert.equal((await pending).status, 'unavailable');
  assert.equal(transport.requests[0].socket?.destroyed, true);
});

test('the last request is limited to the remaining four seconds of the stage', async t => {
  let headersSent!: () => void;
  const ready = new Promise<void>(resolve => { headersSent = resolve; });
  const transport = await harness(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('partial'); headersSent(); });
  const reader = createOfficialReader({ resolve: publicDns, request: transport.request, now: () => epoch + 16000 });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = reader(source, reference, options());
  await ready;
  t.mock.timers.tick(3999);
  assert.equal(transport.requests[0].destroyed, false);
  t.mock.timers.tick(1);
  assert.equal((await pending).status, 'unavailable');
  assert.equal(transport.requests[0].socket?.destroyed, true);
});

test('an HTTP failure is unavailable with no retry or automatic fallback', async t => {
  let received = 0;
  const transport = await harness(t, (_req, res) => { received++; res.writeHead(503, { 'Content-Type': 'text/html' }); res.end('try again'); });
  const budget = newBudget();
  const document = await transport.reader(source, reference, options(budget));
  assert.equal(document.status, 'unavailable'); assert.equal(document.body, null);
  assert.equal(received, 1); assert.equal(budget.requestsRemaining, 3);
});

test('a compressed redirect is unavailable before its destination is requested', async t => {
  let received = 0;
  const transport = await harness(t, (req, res) => {
    received++;
    if (req.url === '/jobs/42') { res.writeHead(302, { Location: '/jobs/43', 'Content-Encoding': 'gzip' }); res.end('encoded'); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('posting'); }
  });
  assert.equal((await transport.reader(source, reference, options())).status, 'unavailable');
  assert.equal(received, 1);
});
