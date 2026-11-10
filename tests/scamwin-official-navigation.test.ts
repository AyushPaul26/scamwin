import assert from 'node:assert/strict';
import test from 'node:test';
import type { CheckRecord, Observation } from '../lib/scamwin/contracts';
import { createOfficialNextStepHandler } from '../lib/scamwin/official-next-step-server';
import { verifyOfficialOffer } from '../lib/scamwin/official-verification';
import { officialFixtureCatalog, officialFixtureCheck, officialFixtureDocument, officialIntent, officialNow } from './fixtures/scamwin-official-fixture';

async function fixture() {
  const check = officialFixtureCheck(); let sourceReads = 0; let id = 0;
  const observations = await verifyOfficialOffer({ input: check.input, intent: officialIntent, scope: { checkId: check.id, runId: check.runId }, signal: new AbortController().signal, pipelineDeadlineAtMs: officialNow.getTime() + 240000, checkExpiresAt: check.expiresAt }, {
    catalog: officialFixtureCatalog, reader: async source => { sourceReads++; return officialFixtureDocument(source); }, now: () => officialNow, makeId: () => `fixture-${++id}`,
  });
  sourceReads = 0;
  const stepId = String(observations.find(row => row.kind === 'official_next_step' && row.data.purpose === 'listing')!.data.stepId);
  const calls: string[] = [];
  const store = {
    getCheck: async (subject: string, checkId: string): Promise<CheckRecord | null> => { calls.push(`check:${subject}:${checkId}`); return subject === check.ownerId && checkId === check.id ? structuredClone(check) : null; },
    listObservations: async (subject: string, checkId: string): Promise<Observation[]> => { calls.push(`observations:${subject}:${checkId}`); return structuredClone(observations); },
  };
  const env = { SCAMWIN_OFFICIAL_VERIFICATION_ENABLED: 'true', APP_BASE_URL: 'https://app.example' };
  const deps = { authenticate: async () => ({ subject: 'owner', store }), apiFailure: (error: unknown) => Response.json({ code: (error as { code?: string }).code ?? 'service_unavailable' }, { status: (error as { code?: string }).code === 'unauthenticated' ? 401 : 503 }), catalog: structuredClone(officialFixtureCatalog), env, now: () => officialNow };
  const request = (suffix = '') => new Request(`https://attacker-controlled.example/api/scamwin/checks/${check.id}/official-next-step/${stepId}${suffix}`);
  const context = (id = check.id, step = stepId) => ({ params: Promise.resolve({ id, stepId: step }) });
  return { check, observations, stepId, store, env, deps, calls, request, context, sourceReads: () => sourceReads };
}

test('owned fresh step redirects 303 to the exact canonical URL with private no-store and no referrer', async () => {
  const f = await fixture(); let authenticated = 0;
  const handler = createOfficialNextStepHandler({ ...f.deps, authenticate: async () => { authenticated++; return f.deps.authenticate(); } });
  const response = await handler(f.request('?owner=somebody-else&url=https://evil.example'), f.context());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), 'https://job-boards.greenhouse.io/examplecompany/jobs/12345');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(authenticated, 1);
  assert.ok(f.calls.every(call => call.includes(':owner:official-check')));
  assert.equal(f.sourceReads(), 0);
  await handler(f.request(), f.context());
  assert.equal(f.sourceReads(), 0, 'repeated saved-result navigation makes no source reads');
});

test('unowned and unauthenticated requests retain 404 and 401 handling', async () => {
  const f = await fixture();
  const unowned = await createOfficialNextStepHandler({ ...f.deps, authenticate: async () => ({ subject: 'other-owner', store: f.store }) })(f.request(), f.context());
  assert.equal(unowned.status, 404); assert.equal(unowned.headers.get('Location'), null);
  assert.equal(f.calls.some(call => call.startsWith('observations:')), false);
  const unauthenticated = await createOfficialNextStepHandler({ ...f.deps, authenticate: async () => { throw { code: 'unauthenticated' }; } })(f.request(), f.context());
  assert.equal(unauthenticated.status, 401); assert.equal(unauthenticated.headers.get('Location'), null);
});

test('invalid owned steps return only to the fixed configured app path with the unavailable notice', async () => {
  const f = await fixture();
  const response = await createOfficialNextStepHandler(f.deps)(f.request(), f.context(f.check.id, 'missing-step'));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), 'https://app.example/checks/official-check?officialStep=unavailable');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  const missingCheck = await createOfficialNextStepHandler(f.deps)(f.request(), f.context('other-check'));
  assert.equal(missingCheck.status, 404);
});

test('flag off, revoked catalog, tampered or expired steps and nonterminal runs cannot navigate externally', async () => {
  const mutations: Array<(f: Awaited<ReturnType<typeof fixture>>) => void> = [
    f => { f.env.SCAMWIN_OFFICIAL_VERIFICATION_ENABLED = 'false'; },
    f => { f.env.SCAMWIN_OFFICIAL_VERIFICATION_ENABLED = 'TRUE'; },
    f => { f.deps.catalog.version = 'new-review'; },
    f => { f.deps.catalog.companies[0].sources.shift(); },
    f => { f.check.state = 'collecting'; },
    f => { f.check.state = 'canceled'; },
    f => { f.check.cancelRequestedAt = officialNow.toISOString(); },
    f => { f.check.runId = 'new-run'; },
    f => { f.observations.find(row => row.kind === 'official_next_step' && row.data.purpose === 'listing')!.data.canonicalUrl = 'https://job-boards.greenhouse.io/examplecompany/jobs/54321'; },
    f => { f.observations.find(row => row.kind === 'official_next_step' && row.data.purpose === 'listing')!.data.expiresAt = officialNow.toISOString(); },
  ];
  for (const mutate of mutations) {
    const f = await fixture(); mutate(f);
    const response = await createOfficialNextStepHandler(f.deps)(f.request(), f.context());
    assert.equal(response.headers.get('Location'), 'https://app.example/checks/official-check?officialStep=unavailable', String(mutate));
    assert.equal(f.sourceReads(), 0);
  }
});

test('deletion, cancellation or a newer run while observations load cannot resurrect a saved step', async () => {
  for (const change of ['deleted', 'canceled', 'new-run'] as const) {
    const f = await fixture(); let checkReads = 0;
    const store = { ...f.store, getCheck: async () => {
      checkReads++;
      if (checkReads === 1) return structuredClone(f.check);
      return change === 'deleted' ? null : { ...f.check, ...(change === 'canceled' ? { state: 'canceled' as const } : { runId: 'new-run' }) };
    } };
    const response = await createOfficialNextStepHandler({ ...f.deps, authenticate: async () => ({ subject: 'owner', store }) })(f.request(), f.context());
    assert.equal(response.status, change === 'deleted' ? 404 : 303);
    assert.notEqual(response.headers.get('Location'), 'https://job-boards.greenhouse.io/examplecompany/jobs/12345');
  }
});

test('invalid configured app origins cannot become fallback redirect targets', async () => {
  for (const base of ['https://user:pass@app.example', 'https://app.example/other', 'https://app.example?x=1', 'https://app.example#x', 'http://evil.example', 'javascript:alert(1)', '']) {
    const f = await fixture(); f.env.APP_BASE_URL = base;
    const response = await createOfficialNextStepHandler(f.deps)(f.request(), f.context(f.check.id, 'missing'));
    assert.equal(response.status, 503, base);
    assert.equal(response.headers.get('Location'), null);
  }
});
