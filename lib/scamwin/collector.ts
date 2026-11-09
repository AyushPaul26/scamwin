import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Browser } from 'playwright';
import type { Observation, PreparedImage } from './contracts';
import { approvedOrigins, isAllowedOrigin, normalizeTarget, parsePaymentUri, COLLECTOR_LIMITS, POLICY_VERSION } from './policy';

export type CollectionSource = { checkId: string; runId: string };
export type BrowserCollection = { observations: Observation[]; captures: PreparedImage[] };
type CollectionPhase = 'load_client' | 'connect_browser' | 'create_context' | 'configure_routes' | 'navigate' | 'read_page' | 'capture';
export type BrowserFailure = { phase: CollectionPhase; code: string; message: string };
type CollectorOptions = { env?: Record<string, string | undefined>; signal?: AbortSignal; connect?: (endpoint: string) => Promise<Browser>; onFailure?: (failure: BrowserFailure) => void };
function browserFailure(error: unknown, phase: CollectionPhase, env: Record<string, string | undefined>): BrowserFailure {
  const raw = error instanceof Error ? error.message : 'Unknown browser failure.';
  const code = /Cannot find module|MODULE_NOT_FOUND|Cannot find package/i.test(raw) ? 'module_missing' : /401|403|unauthorized|authentication/i.test(raw) ? 'provider_auth' : /429|capacity|concurrent|quota/i.test(raw) ? 'provider_capacity' : /timeout|timed out/i.test(raw) ? 'timeout' : /protocol|websocket|ECONN|socket/i.test(raw) ? 'connection_error' : 'browser_error';
  let message = raw;
  for (const [name, value] of Object.entries(env)) if (/TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL/i.test(name) && value) message = message.split(value).join('[redacted]');
  message = message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[redacted URL]').replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]').replace(/[\r\n\t]/g, ' ').slice(0, 500);
  return { phase, code, message };
}
function evidence(source: CollectionSource, url: string, kind: string, status: Observation['status'], data: Observation['data']): Observation {
  return { id: randomUUID(), ...source, kind, status, sourceKind: 'live_page', sourceRef: url, observedAt: new Date().toISOString(), data, collectorVersion: 'scamwin-browser-1', policyVersion: POLICY_VERSION };
}
export async function collectWebsite(url: string, source: CollectionSource, options: CollectorOptions = {}): Promise<BrowserCollection> {
  const env = options.env ?? process.env, captures: PreparedImage[] = [], observations: Observation[] = [];
  const disabled = (reason: string): BrowserCollection => ({ captures, observations: [evidence(source, url, 'page', 'not_checked', { reason })] });
  if (!url) return disabled('No website destination was selected.');
  let allowed: string[];
  try { normalizeTarget(url); allowed = approvedOrigins(env); } catch { return disabled('The destination or configured origin scope is invalid.'); }
  if (!isAllowedOrigin(url, allowed)) return disabled('Live browser collection is limited to explicitly approved operator-owned origins. This destination is outside the approved scope.');
  if (env.SCAMWIN_BROWSER_CAPABILITY_VERIFIED !== 'true') return disabled('The remote browser capability has not been verified. Live collection is disabled.');
  if (!env.BROWSERLESS_TOKEN) return disabled('The remote browser provider is not configured.');
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(COLLECTOR_LIMITS.milliseconds)]) : AbortSignal.timeout(COLLECTOR_LIMITS.milliseconds);
  let browser: Browser | undefined;
  let phase: CollectionPhase = 'load_client';
  const close = () => { void browser?.close().catch(() => undefined); };
  signal.addEventListener('abort', close, { once: true });
  try {
    const endpoint = new URL(env.BROWSERLESS_BASE_URL || 'https://production-sfo.browserless.io');
    if (endpoint.protocol !== 'https:' || !['production-sfo.browserless.io', 'production-lon.browserless.io', 'production-ams.browserless.io'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.pathname !== '/') return disabled('The browser endpoint must be an approved Browserless shared-fleet origin.');
    endpoint.protocol = 'wss:'; endpoint.pathname = '/chromium'; endpoint.searchParams.set('token', env.BROWSERLESS_TOKEN); endpoint.searchParams.set('timeout', String(COLLECTOR_LIMITS.milliseconds));
    const connect = options.connect ?? (async (address: string) => {
      phase = 'load_client';
      const { chromium } = await import('playwright');
      phase = 'connect_browser';
      return chromium.connectOverCDP(address, { timeout: 20_000 });
    });
    if (options.connect) phase = 'connect_browser';
    signal.throwIfAborted(); browser = await connect(endpoint.href); signal.throwIfAborted();
    phase = 'create_context';
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'block', acceptDownloads: false, permissions: [], ignoreHTTPSErrors: false });
    phase = 'configure_routes';
    let requests = 0, blocked = 0, documents = 0, transferred = 0, limited = false;
    await context.route('**/*', async route => {
      const request = route.request(); requests++;
      let redirects = 0; for (let prior = request.redirectedFrom(); prior; prior = prior.redirectedFrom()) redirects++;
      if (request.isNavigationRequest()) documents++;
      if (signal.aborted || requests > COLLECTOR_LIMITS.requests || documents > COLLECTOR_LIMITS.documents || redirects > COLLECTOR_LIMITS.redirects || !['GET', 'HEAD'].includes(request.method()) || !isAllowedOrigin(request.url(), allowed)) { blocked++; await route.abort('blockedbyclient'); return; }
      await route.continue();
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    context.on('page', popup => { if (popup !== page) void popup.close().catch(() => undefined); });
    page.on('download', download => { void download.cancel().catch(() => undefined); });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.dataReceived', event => { transferred += event.encodedDataLength || event.dataLength; if (transferred > COLLECTOR_LIMITS.bytes) { limited = true; void context.close().catch(() => undefined); } });
    phase = 'navigate';
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    signal.throwIfAborted();
    phase = 'read_page';
    const snapshot = await page.evaluate(() => ({
      title: document.title.slice(0, 500), text: (document.body?.innerText || '').slice(0, 32000),
      links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].slice(0, 200).map(a => ({ href: a.getAttribute('href') || '', text: (a.innerText || '').slice(0, 400), checkpoint: a.hasAttribute('data-scamwin-checkpoint') })),
      forms: [...document.querySelectorAll<HTMLFormElement>('form')].slice(0, 20).map(form => ({ action: form.action, method: form.method })),
      password: !!document.querySelector('input[type=password],input[autocomplete=one-time-code]'),
      mixed: [...document.querySelectorAll('[src]')].some(element => element.getAttribute('src')?.startsWith('http://')),
    }));
    observations.push(evidence(source, page.url(), 'page', 'observed', { title: snapshot.title, text: snapshot.text, finalUrl: page.url(), readable: !!snapshot.text.trim(), complete: !blocked && !limited, requestCount: requests, blockedRequests: blocked, transferredBytes: transferred }));
    for (const link of snapshot.links) {
      const payment = parsePaymentUri(link.href);
      if (payment) observations.push(evidence(source, page.url(), 'payment_action', 'observed', { ...payment, selectedCheckpoint: link.checkpoint, quote: link.text }));
    }
    if (snapshot.forms.length) observations.push(evidence(source, page.url(), 'form_destinations', 'observed', { destinations: snapshot.forms.map(form => form.action).slice(0, 20), methods: snapshot.forms.map(form => form.method).slice(0, 20) }));
    if (snapshot.password) observations.push(evidence(source, page.url(), 'sensitive_request', 'observed', { description: 'The visible page asks for a password or one-time code. Its identity needs independent verification; no values were entered.' }));
    observations.push(evidence(source, page.url(), 'action_review', 'observed', { complete: !blocked && !limited && !snapshot.password, credentialsEntered: false, submitted: false }));
    const headers = response ? await response.allHeaders() : {};
    observations.push(evidence(source, page.url(), 'security_headers', 'observed', { present: ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'permissions-policy'].filter(key => !!headers[key]), missing: ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'permissions-policy'].filter(key => !headers[key]), mixedContentReferences: snapshot.mixed, limitation: 'Observed response configuration only. Missing optional headers do not establish fraud or an exploitable vulnerability.' }));
    phase = 'capture';
    for (const quality of [40, 25, 15]) {
      const bytes = await page.screenshot({ type: 'jpeg', quality, fullPage: false, timeout: 5000 });
      if (bytes.length <= 160 * 1024) { captures.push({ name: 'website-observation.jpg', mediaType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` }); break; }
    }
    if (blocked || limited) observations.push(evidence(source, url, 'collection_scope', 'blocked', { reason: 'Some requests were blocked or exceeded the observation budget. Findings cover only the content actually observed.' }));
    return { observations, captures };
  } catch (error) {
    try { options.onFailure?.(browserFailure(error, phase, env)); } catch { /* Diagnostics cannot change collection results. */ }
    options.signal?.throwIfAborted();
    observations.push(evidence(source, url, 'page', 'unavailable', { reason: signal.aborted ? 'The remote observation reached its deadline.' : 'The remote observation was unavailable, blocked, or could not be completed. No payment or credentials were submitted.' }));
    return { observations, captures };
  } finally {
    signal.removeEventListener('abort', close);
    await browser?.close().catch(() => undefined);
  }
}

/** Operator-only, ephemeral browser check. It writes no application records. */
export async function handleBrowserHealth(request: Request, options: { env?: Record<string, string | undefined>; collect?: typeof collectWebsite } = {}) {
  const env = options.env ?? process.env;
  const secret = env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret ?? ''}`), actual = Buffer.from(request.headers.get('authorization') ?? '');
  const headers = { 'Cache-Control': 'no-store' };
  if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  let failure: BrowserFailure | undefined;
  try {
    const collection = await (options.collect ?? collectWebsite)('https://scamwin.vercel.app/lab/refund-checkpoint', { checkId: 'browser-health', runId: randomUUID() }, { env, signal: AbortSignal.timeout(60_000), onFailure: value => { failure = value; } });
    const healthy = collection.observations.some(item => item.kind === 'page' && item.status === 'observed') && !collection.observations.some(item => item.status === 'unavailable' || item.status === 'not_checked');
    return Response.json({ healthy, observations: collection.observations.length, captures: collection.captures.length, ...(!healthy ? { failure: failure ?? { phase: 'load_client', code: 'collection_disabled', message: 'Collection did not produce an available page observation.' } } : {}) }, { status: healthy ? 200 : 503, headers });
  } catch (error) {
    return Response.json({ healthy: false, observations: 0, captures: 0, failure: failure ?? browserFailure(error, 'connect_browser', env) }, { status: 503, headers });
  }
}
