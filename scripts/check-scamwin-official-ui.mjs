import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Synthetic browser fixtures only. Auth0, saved checks, public sources and
// the destination gate are intercepted; this is not a real OAuth acceptance run.
const base = new URL(process.argv[2] || 'http://localhost:3100');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Official UI checks require a localhost HTTP server.');
const output = resolve('.trigger/official-ui/screenshots');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let assertions = 0;
const errors = [], unexpected = [];
const sourceUrl = 'https://careers.synthetic-company.example/jobs/12345';
const stamp = '2026-11-10T08:30:00.000Z';
const stageNames = [['intake', 'Understanding your offer'], ['browser', 'Observing the website'], ['trust', 'Checking the connection'], ['registry', 'Checking shared warnings'], ['official', 'Checking official sources'], ['comparison', 'Comparing promise and request'], ['assessment', 'Preparing your result']];
const expected = (value, truth, message) => { assert.equal(value, truth, message); assertions++; };
function detailFrom(template) {
  const data = structuredClone(template);
  Object.assign(data.check, { id: 'synthetic-official', runId: 'synthetic-official-run', ownerId: 'synthetic-browser-owner', generation: 1, revision: 1, state: 'completed' });
  data.check.input.url = '';
  data.check.assessment.risk = 'high_risk';
  data.check.stages = stageNames.map(([id, label]) => ({ id, label, status: 'completed', startedAt: stamp, finishedAt: stamp }));
  data.artifacts = []; data.messages = []; data.warningSubmissions = []; data.liveView = undefined;
  const model = data.observations[0];
  for (const [index, kind] of ['official_company', 'official_destination', 'official_document'].entries()) data.observations.push({ ...model, id: `synthetic-official-evidence-${index + 1}`, checkId: data.check.id, runId: data.check.runId, kind, sourceKind: 'official_source', sourceRef: sourceUrl, observedAt: stamp, status: 'observed', data: { quote: 'Synthetic public listing evidence', readUrl: sourceUrl } });
  data.officialVerification = {
    company: { status: 'recognized', name: 'Synthetic Company', evidenceIds: ['synthetic-official-evidence-1'] },
    destination: { status: 'reviewed_delegate', hostname: 'careers.synthetic-company.example', evidenceIds: ['synthetic-official-evidence-2'] },
    offer: { status: 'matched_public_reference', sourceId: 'synthetic-source', reference: '12345', title: 'Synthetic support role', location: 'Pune', validThrough: null, quote: 'Synthetic public listing evidence', differingFields: [], reasonCode: 'matched', evidenceIds: ['synthetic-official-evidence-3'] },
    freshness: 'fresh', checkedAt: stamp, explanation: 'The published listing does not authenticate the sender or remove the observed fee request.', sourceEvidenceIds: ['synthetic-official-evidence-3'],
    steps: [{ stepId: 'opaque-synthetic-listing', sourceId: 'synthetic-source', purpose: 'listing', label: 'View the public listing', hostname: 'careers.synthetic-company.example', publicReference: null, evidenceIds: ['synthetic-official-evidence-3'], catalogVersion: 'synthetic-v1', expiresAt: '2026-11-11T08:30:00.000Z', basis: 'live_listing' }, { stepId: 'opaque-synthetic-careers', sourceId: 'synthetic-careers', purpose: 'careers', label: 'Open the reviewed careers page', hostname: 'synthetic-company.example', publicReference: null, evidenceIds: ['synthetic-official-evidence-1'], catalogVersion: 'synthetic-v1', expiresAt: '2026-12-01T08:30:00.000Z', basis: 'reviewed_entry' }],
  };
  return data;
}
try {
  const fixtureContext = await browser.newContext();
  const response = await fixtureContext.request.get(new URL('/api/scamwin/demo', base).href);
  expected(response.status(), 200, 'local synthetic demo fixture available');
  const template = await response.json(); await fixtureContext.close();
  for (const width of [1440, 375, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    let data = detailFrom(template), gateCalls = 0, actionCalls = 0, releaseAction;
    let actionHold = new Promise(resolveHold => { releaseAction = resolveHold; });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname === 'gc.kis.v2.scr.kaspersky-labs.com' && url.pathname.endsWith('/main.js')) return route.fulfill({ contentType: 'application/javascript', body: '// Synthetic UI check: environment script disabled.' });
      if (url.origin !== base.origin) { unexpected.push(url.origin); return route.abort('blockedbyclient'); }
      if (url.pathname === '/api/scamwin/bootstrap') return route.fulfill({ json: { configured: true, user: { name: 'Synthetic browser fixture', sub: 'synthetic-browser-owner' }, role: 'user', readiness: [] } });
      if (url.pathname === '/api/scamwin/checks/synthetic-official') return route.fulfill({ json: data });
      if (url.pathname.startsWith('/api/scamwin/checks/synthetic-official/official-next-step/')) { gateCalls++; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic gated destination</title><h1>Synthetic gated destination</h1>' }); }
      if (request.method() === 'POST' && url.pathname === '/checks' && request.headers()['next-action']) {
        const saved = structuredClone(data.check); saved.input = { url: '', message: '', promisedBenefit: '', intendedAction: '', images: [], claimedCompany: 'Reference-only Company', offerReference: '12345' };
        return route.fulfill({ contentType: 'text/x-component', body: '0:{\"a\":\"$@1\",\"f\":\"\",\"b\":\"development\"}\n1:' + JSON.stringify({ ok: true, data: { checks: [saved], total: 1, page: 1, pageSize: 20 } }) + '\n' });
      }
      if (request.method() === 'POST' && url.pathname === '/check' && request.headers()['next-action']) { actionCalls++; await actionHold; return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Synthetic save rejection' }); }
      if (!['GET', 'HEAD'].includes(request.method()) || url.pathname.startsWith('/api/scamwin/checks/')) { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    await page.goto(new URL('/check', base).href, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const disclosure = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Company and public offer reference' }) });
    await disclosure.locator('summary').waitFor();
    expected(await disclosure.getAttribute('open'), null, 'optional reference starts collapsed');
    await disclosure.locator('summary').focus(); await page.keyboard.press('Enter');
    const company = page.getByLabel('Claimed company', { exact: false }), reference = page.getByLabel('Public listing link or posting ID', { exact: false });
    await company.fill('Synthetic Company'); await reference.fill('12345');
    await company.focus(); await page.keyboard.press('Tab'); expected(await reference.evaluate(el => el === document.activeElement), true, 'public reference follows company in keyboard order');
    await page.getByText('Omit personal invitation codes and private links.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Check this offer', exact: false }).click();
    await page.getByRole('button', { name: 'Saving your check…', exact: false }).waitFor();
    expected(await company.isDisabled(), true, 'company disabled during save'); expected(await reference.isDisabled(), true, 'reference disabled during save');
    releaseAction(); await page.getByText('Your check hasn’t started', { exact: true }).waitFor();
    expected(await company.inputValue(), 'Synthetic Company', 'company survives synthetic server rejection'); expected(await reference.inputValue(), '12345', 'reference survives synthetic server rejection'); expected(actionCalls, 1, 'one attempted save');
    expected(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `intake fits ${width}px`);
    await page.goto(new URL('/checks/synthetic-official', base).href, { waitUntil: 'domcontentloaded' });
    const card = page.getByRole('region', { name: 'Company and offer verification', exact: true });
    await card.waitFor();
    for (const name of ['Company reference', 'Submitted destination', 'Exact offer']) await card.getByText(name, { exact: true }).waitFor();
    await card.getByText('Published listing found at the checked time.', { exact: true }).waitFor();
    await card.getByText('Reviewed route, not checked live.', { exact: true }).waitFor();
    await card.getByText('Checked live from a public listing.', { exact: true }).waitFor();
    expected(await card.locator('time').count() > 0, true, 'source time is machine-readable');
    expected(await page.getByRole('heading', { name: 'This action carries a high risk.', exact: true }).count(), 1, 'official listing retains high risk');
    const order = await page.evaluate(() => { const hero = document.querySelector('.sw-result-hero'), trace = document.querySelector('.sw-decision-comparison'), verification = document.querySelector('.sw-official-verification'), findings = document.querySelector('.sw-findings'); return [hero, trace, verification, findings].every(Boolean) && !!(hero.compareDocumentPosition(trace) & 4) && !!(trace.compareDocumentPosition(verification) & 4) && !!(verification.compareDocumentPosition(findings) & 4); });
    expected(order, true, 'risk and decision trace precede official card, which precedes findings');
    const step = card.getByRole('link', { name: 'View the public listing', exact: false });
    expected(await step.getAttribute('href'), '/api/scamwin/checks/synthetic-official/official-next-step/opaque-synthetic-listing', 'opaque route contains no destination URL'); expected(await step.getAttribute('target'), null, 'explicit step stays in this tab');
    expected(await card.locator('a[href^="http"]').count(), 0, 'source URLs are not direct external links'); expected(gateCalls, 0, 'destination gate is never prefetched'); expected(context.pages().length, 1, 'no automatic window');
    await page.screenshot({ path: resolve(output, `official-${width}.png`), fullPage: true });
    await card.screenshot({ path: resolve(output, `official-card-${width}.png`) });
    const citation = card.locator('a[href="#evidence-synthetic-official-evidence-3"]').first(); await citation.click(); expected(await page.locator('#evidence-synthetic-official-evidence-3').getAttribute('open'), '', 'source citation opens saved evidence');
    expected(await page.locator('a[href="' + sourceUrl + '"]').count(), 0, 'raw evidence source URL is inert');
    expected(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `result fits ${width}px`);
    expected(await page.locator('.sw-progress-stage').evaluateAll(nodes => nodes.map(node => node.dataset.stage).join(',')), stageNames.map(([id]) => id).join(','), 'official stage is seventh-stage sequence between registry and comparison');
    if (width === 1440) {
      const cases = [
        ['reference_needed', 'not_checked', 'Add a public listing link or posting ID to check this exact offer.'],
        ['unavailable', 'not_checked', 'The official source could not be checked.'],
        ['not_found_in_checked_source', 'fresh', 'Not found in the checked official source.'],
        ['details_differ', 'fresh', 'The public listing has details to compare.'],
        ['explicitly_closed', 'fresh', 'The official source explicitly marks this listing as closed.'],
        ['not_publicly_verifiable', 'reference_only', 'This private offer cannot be verified through a public listing.'],
      ];
      for (const [status, freshness, text] of cases) {
        data = detailFrom(template); Object.assign(data.officialVerification.offer, { status }); Object.assign(data.officialVerification, { freshness, steps: [] });
        await page.goto(new URL('/checks/synthetic-official', base).href, { waitUntil: 'domcontentloaded' }); await page.getByText(text, { exact: true }).waitFor();
        if (status === 'reference_needed') { const newCheck = page.getByRole('link', { name: 'Start a new check with the public reference', exact: true }); expected(await newCheck.getAttribute('href'), '/check', 'missing reference uses clean new-check route'); }
      }
      data = detailFrom(template); data.officialVerification.freshness = 'stale'; data.officialVerification.steps = [];
      await page.goto(new URL('/checks/synthetic-official?officialStep=unavailable', base).href, { waitUntil: 'domcontentloaded' }); await page.getByText('This official next step is unavailable.', { exact: true }).waitFor(); await page.getByText('Historical source check', { exact: true }).waitFor();
      data = detailFrom(template); data.officialVerification.company = { status: 'unlisted', name: 'Unknown Company', evidenceIds: [] }; data.officialVerification.steps = [];
      await page.goto(new URL('/checks/synthetic-official', base).href, { waitUntil: 'domcontentloaded' }); await page.getByText('No reviewed official sources for this company.', { exact: true }).waitFor(); expected(await card.locator('a[href*="official-next-step"]').count(), 0, 'unknown company has no guessed destination');
      await page.goto(new URL('/checks', base).href, { waitUntil: 'domcontentloaded' }); await page.locator('.sw-check-main').waitFor(); await page.locator('.sw-check-main strong').filter({ hasText: 'Reference-only Company' }).waitFor(); await page.getByText('Public reference: 12345', { exact: false }).waitFor(); expected(await page.locator('.sw-check-main').getAttribute('href'), '/checks/synthetic-official', 'reference-only history entry opens its saved check');
      data = detailFrom(template); await page.goto(new URL('/checks/synthetic-official', base).href, { waitUntil: 'domcontentloaded' }); await step.click(); await page.getByRole('heading', { name: 'Synthetic gated destination', exact: true }).waitFor(); expected(gateCalls, 1, 'only explicit click invokes gate'); expected(context.pages().length, 1, 'explicit click remains same-tab');
    }
    await context.close();
  }
  expected(errors.length, 0, `no page errors: ${errors.join('; ')}`); expected(unexpected.length, 0, `no real external or private traffic: ${unexpected.join('; ')}`);
  console.log(`Official verification UI: ${assertions} assertions passed. Synthetic sessions only; no real OAuth or source fetch. Screenshots: ${output}`);
} finally { await browser.close(); }
