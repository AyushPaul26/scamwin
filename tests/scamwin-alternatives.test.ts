import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfficialVerification } from '../components/scamwin/official-verification';
import { projectReviewedAlternatives, withReviewedAlternatives } from '../lib/scamwin/alternatives';
import { deriveOfficialVerification, resolveOfficialStep } from '../lib/scamwin/official-verification-view';
import { verifyOfficialOffer } from '../lib/scamwin/official-verification';
import type { Observation } from '../lib/scamwin/contracts';
import { officialFixtureCatalog, officialFixtureCheck, officialFixtureDocument, officialIntent, officialNow } from './fixtures/scamwin-official-fixture';

async function fixture() {
  const check = officialFixtureCheck();
  check.input.message = 'Example Company copied a genuine job listing and asks for an upfront payment.';
  check.input.intendedAction = 'pay'; check.intent = structuredClone(officialIntent);
  check.assessment = { schemaVersion: 1, risk: 'high_risk', summary: 'An upfront payment is requested.', findings: [], missingChecks: [], nextSteps: [] };
  let sequence = 0;
  const observations = await verifyOfficialOffer({ input: check.input, intent: check.intent, scope: { checkId: check.id, runId: check.runId }, signal: new AbortController().signal, pipelineDeadlineAtMs: officialNow.getTime() + 240_000, checkExpiresAt: check.expiresAt }, { catalog: officialFixtureCatalog, now: () => officialNow, makeId: () => `alternative-evidence-${++sequence}`, reader: async source => officialFixtureDocument(source) });
  const verification = deriveOfficialVerification(check, observations, officialFixtureCatalog, officialNow);
  return { check, observations, verification };
}

test('a copied genuine job listing offers reviewed routes without authenticating the personal offer or clearing payment risk', async () => {
  const evidence = await fixture(), before = structuredClone(evidence);
  const alternatives = projectReviewedAlternatives('recruitment', evidence, officialFixtureCatalog, officialNow);
  assert.equal(alternatives.length, 2);
  const listing = alternatives.find(item => item.stepPurpose === 'listing')!;
  assert.equal(listing.purpose, 'recruitment');
  assert.equal(listing.relationship, 'reviewed_delegate');
  assert.equal(listing.reviewedAt, '2026-11-10T10:00:00.000Z');
  assert.equal(listing.fetchedAt, '2026-11-10T12:00:00.000Z');
  assert.equal(listing.expiresAt, '2026-11-10T18:00:00.000Z');
  assert.ok(listing.authorityEvidenceIds.includes('alternative-evidence-1'));
  assert.ok(listing.authorityEvidenceIds.includes('alternative-evidence-3'));
  assert.equal(resolveOfficialStep(evidence.check, evidence.observations, listing.stepId, officialFixtureCatalog, officialNow).status, 'ready');
  assert.equal(alternatives.find(item => item.stepPurpose === 'careers')?.relationship, 'first_party');
  assert.equal(JSON.stringify(alternatives).includes('https://'), false, 'projection exposes opaque step IDs, never arbitrary destinations');
  assert.equal(alternatives.some(item => Object.hasOwn(item, 'risk') || Object.hasOwn(item, 'offerAuthentic')), false);
  assert.deepEqual(evidence, before, 'projection preserves assessment, intent and saved evidence');
});

test('unsupported shopping, refund, application and identity purposes never borrow reviewed careers sources', async () => {
  const evidence = await fixture();
  for (const goal of ['shopping', 'refund', 'application', 'identity_request', 'unknown'] as const) {
    assert.deepEqual(projectReviewedAlternatives(goal, evidence, officialFixtureCatalog, officialNow), []);
  }
});

test('unknown company and unrelated saved authority produce no alternatives even with a stale positive view', async () => {
  const evidence = await fixture();
  for (const mutate of [
    (rows: Observation[]) => { const company = rows.find(row => row.kind === 'official_company')!; Object.assign(company.data, { companyStatus: 'unlisted', companyId: null, name: 'Unknown Company' }); },
    (rows: Observation[]) => { for (const row of rows.filter(item => item.kind === 'official_next_step')) row.data.sourceId = 'unrelated-company-careers'; },
    (rows: Observation[]) => { for (const row of rows.filter(item => item.kind === 'official_next_step')) row.data.canonicalUrl = 'https://model-invented.example/jobs'; },
  ]) {
    const changed = structuredClone(evidence); mutate(changed.observations);
    assert.deepEqual(projectReviewedAlternatives('recruitment', changed, officialFixtureCatalog, officialNow), []);
  }
});

test('expired review, revoked authority, wrong run and expired check cannot reuse previously projected alternatives', async () => {
  const evidence = await fixture();
  const revoked = structuredClone(officialFixtureCatalog); revoked.companies[0].sources = [];
  assert.deepEqual(projectReviewedAlternatives('recruitment', evidence, revoked, officialNow), []);
  assert.deepEqual(projectReviewedAlternatives('recruitment', evidence, officialFixtureCatalog, new Date('2026-12-10T10:00:00.000Z')), []);
  for (const check of [{ ...evidence.check, runId: 'new-run' }, { ...evidence.check, expiresAt: officialNow.toISOString() }, { ...evidence.check, cancelRequestedAt: officialNow.toISOString() }]) {
    assert.deepEqual(projectReviewedAlternatives('recruitment', { ...evidence, check }, officialFixtureCatalog, officialNow), []);
  }
});

test('listing fetch time stays attached to that source and reviewed fallback never borrows another fetch', async () => {
  const evidence = await fixture();
  const entry = evidence.observations.find(row => row.kind === 'official_next_step' && row.data.purpose === 'careers')!;
  entry.data.basis = 'reviewed_entry'; entry.data.evidenceIds = ['alternative-evidence-1'];
  const result = projectReviewedAlternatives('recruitment', evidence, officialFixtureCatalog, officialNow);
  assert.equal(result.find(item => item.stepPurpose === 'careers')?.fetchedAt, null);
  const later = projectReviewedAlternatives('recruitment', evidence, officialFixtureCatalog, new Date('2026-11-10T18:00:00.000Z'));
  assert.deepEqual(later.map(item => item.stepPurpose), ['careers']);
});

test('alternatives flag is default false and never disables or mutates existing official next steps', async () => {
  const evidence = await fixture(), original = structuredClone(evidence.verification);
  for (const env of [{}, { SCAMWIN_ALTERNATIVES_ENABLED: 'false' }, { SCAMWIN_ALTERNATIVES_ENABLED: 'TRUE' }]) {
    assert.deepEqual(withReviewedAlternatives(evidence, officialFixtureCatalog, officialNow, env), original);
  }
  const enabled = withReviewedAlternatives(evidence, officialFixtureCatalog, officialNow, { SCAMWIN_ALTERNATIVES_ENABLED: 'true' });
  assert.equal(enabled.alternatives?.length, 2);
  assert.deepEqual(enabled.steps, original.steps);
  assert.equal(Object.hasOwn(evidence.verification, 'alternatives'), false);
  const refund = structuredClone(evidence); refund.check.input.message = 'A refund is promised'; refund.check.input.promisedBenefit = 'A refund'; refund.check.input.offerReference = ''; refund.check.intent = undefined;
  assert.deepEqual(withReviewedAlternatives(refund, officialFixtureCatalog, officialNow, { SCAMWIN_ALTERNATIVES_ENABLED: 'true' }).alternatives, []);
});

test('a pasted public job reference cannot turn a refund or unspecified user purpose into job seeking', async () => {
  const evidence = await fixture();
  for (const input of [
    { ...evidence.check.input, promisedBenefit: 'A refund', message: 'The recruiter promises a refund' },
    { ...evidence.check.input, promisedBenefit: '', message: 'Please check this link' },
  ]) {
    const changed = { ...evidence, check: { ...evidence.check, input } };
    assert.deepEqual(withReviewedAlternatives(changed, officialFixtureCatalog, officialNow, { SCAMWIN_ALTERNATIVES_ENABLED: 'true' }).alternatives, []);
  }
});

test('URL and reference tokens in message or benefit cannot create an otherwise unspecified recruitment purpose', async () => {
  const evidence = await fixture();
  for (const token of ['https://example.test/job/123', 'www.example.test/job/123', 'example.test/job/123', 'mailto:job@example.test', 'data:text/plain,job', 'job-123']) {
    for (const field of ['message', 'promisedBenefit'] as const) {
      const input = { ...evidence.check.input, message: '', promisedBenefit: '', offerReference: token === 'job-123' ? token : evidence.check.input.offerReference, [field]: `Please check ${token}` };
      const changed = { ...evidence, check: { ...evidence.check, input } };
      assert.deepEqual(withReviewedAlternatives(changed, officialFixtureCatalog, officialNow, { SCAMWIN_ALTERNATIVES_ENABLED: 'true' }).alternatives, [], `${field}: ${token}`);
    }
  }
});

test('URL path words cannot override a recruitment purpose stated outside the URL', async () => {
  const evidence = await fixture();
  for (const input of [
    { ...evidence.check.input, promisedBenefit: 'A job', message: 'Please check https://example.test/order/123' },
    { ...evidence.check.input, promisedBenefit: 'https://example.test/order/123', message: 'A recruitment invitation' },
  ]) {
    const changed = { ...evidence, check: { ...evidence.check, input } };
    const alternatives = withReviewedAlternatives(changed, officialFixtureCatalog, officialNow, { SCAMWIN_ALTERNATIVES_ENABLED: 'true' }).alternatives;
    assert.equal(alternatives?.length, 2);
    assert.ok(alternatives?.every(alternative => alternative.purpose === 'recruitment'));
  }
});

test('the existing Official next step card renders reviewed purpose and authority through the same opaque navigation route', async () => {
  const evidence = await fixture();
  const verification = withReviewedAlternatives(evidence, officialFixtureCatalog, officialNow, { SCAMWIN_ALTERNATIVES_ENABLED: 'true' });
  const html = renderToStaticMarkup(createElement(OfficialVerification, { checkId: evidence.check.id, verification, observations: evidence.observations }));
  assert.match(html, /Find a job through reviewed sources/);
  assert.match(html, /Reviewed partner route/);
  assert.match(html, /Authority reviewed/);
  assert.match(html, /Source fetched/);
  assert.equal((html.match(/<h3>Official next step<\/h3>/g) ?? []).length, 1);
  assert.match(html, /href="\/api\/scamwin\/checks\/official-check\/official-next-step\//);
  assert.doesNotMatch(html, /target="_blank"|href="https:\/\//);
  const empty = renderToStaticMarkup(createElement(OfficialVerification, { checkId: evidence.check.id, verification: { ...verification, alternatives: [] }, observations: evidence.observations }));
  assert.match(empty, /No reviewed alternative available/);
  assert.doesNotMatch(empty, /href="\/api\/scamwin\/checks\/official-check\/official-next-step\//);
  const original = renderToStaticMarkup(createElement(OfficialVerification, { checkId: evidence.check.id, verification: evidence.verification, observations: evidence.observations }));
  assert.doesNotMatch(original, /Find a job through reviewed sources|No reviewed alternative available/);
  assert.match(original, /href="\/api\/scamwin\/checks\/official-check\/official-next-step\//);
});
