import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation } from '../lib/scamwin/contracts';
import { deriveOfficialVerification, resolveOfficialStep } from '../lib/scamwin/official-verification-view';
import { officialFixtureCatalog, officialFixtureCheck, officialNow } from './fixtures/scamwin-official-fixture';

const common = { schemaVersion: 1, catalogVersion: officialFixtureCatalog.version, companyId: 'example-company', reasonCode: null };
const listingUrl = 'https://job-boards.greenhouse.io/examplecompany/jobs/12345';
const readUrl = 'https://boards-api.greenhouse.io/v1/boards/examplecompany/jobs/12345';
function savedEvidence(): Observation[] {
  const rows = [
    ['company', 'official_company', { ...common, companyStatus: 'recognized', name: 'Example Company', reviewedAt: '2026-11-10T10:00:00.000Z', reviewEvidenceUrl: 'https://company.example/careers', sourceIds: ['example-board', 'example-careers'] }],
    ['destination', 'official_destination', { ...common, destinationStatus: 'unrecognized', hostname: 'offer.example', sourceId: null }],
    ['document', 'official_document', { ...common, sourceId: 'example-board', readUrl, finalReadUrl: readUrl, fetchedAt: officialNow.toISOString(), responseStatus: 'ok', contentType: 'application/json', digest: 'a'.repeat(64), quote: 'Software Engineer in Bengaluru' }],
    ['offer', 'official_offer', { ...common, offerStatus: 'matched_public_reference', sourceId: 'example-board', referenceKind: 'greenhouse_post_id', referenceValue: '12345', title: 'Software Engineer', location: 'Bengaluru', validThrough: null, canonicalListingUrl: listingUrl, quote: 'Software Engineer in Bengaluru', differingFields: [], basedOnEvidenceIds: ['document'] }],
    ['summary', 'official_verification', { ...common, companyStatus: 'recognized', destinationStatus: 'unrecognized', offerStatus: 'matched_public_reference', freshness: 'fresh', checkedAt: officialNow.toISOString(), explanation: 'Published listing found at the checked time. This does not verify the sender.', basedOnEvidenceIds: ['company', 'destination', 'document', 'offer'] }],
    ['listing-step', 'official_next_step', { ...common, stepId: 'listing-step-id', sourceId: 'example-board', purpose: 'listing', label: 'Independently verify this published listing', hostname: 'job-boards.greenhouse.io', canonicalUrl: listingUrl, referenceKind: 'greenhouse_post_id', referenceValue: '12345', referenceOrigin: 'explicit_field', evidenceIds: ['company', 'document', 'offer'], expiresAt: '2026-11-10T18:00:00.000Z', basis: 'live_listing' }],
    ['entry-step', 'official_next_step', { ...common, stepId: 'entry-step-id', sourceId: 'example-careers', purpose: 'careers', label: 'Reviewed careers route, not checked live', hostname: 'company.example', canonicalUrl: 'https://company.example/careers', referenceKind: null, referenceValue: null, referenceOrigin: null, evidenceIds: ['company'], expiresAt: '2026-12-10T10:00:00.000Z', basis: 'reviewed_entry' }],
  ] as const;
  return rows.map(([id, kind, data]) => ({ id, kind, data: structuredClone(data), checkId: 'official-check', runId: 'official-run', status: 'observed', sourceKind: 'official_source', sourceRef: '', observedAt: officialNow.toISOString(), collectorVersion: 'official-test-1', policyVersion: 'official-test-1' })) as Observation[];
}

test('saved facts project separately with citations and no actionable canonical URL', () => {
  const view = deriveOfficialVerification(officialFixtureCheck(), savedEvidence(), officialFixtureCatalog, officialNow);
  assert.equal(view.company.status, 'recognized');
  assert.equal(view.destination.status, 'unrecognized');
  assert.equal(view.offer.status, 'matched_public_reference');
  assert.equal(view.freshness, 'fresh');
  assert.equal(view.checkedAt, officialNow.toISOString());
  assert.deepEqual(view.offer.evidenceIds, ['offer', 'document']);
  assert.deepEqual(view.sourceEvidenceIds, ['document']);
  assert.equal(view.steps.length, 2);
  assert.equal(Object.hasOwn(view.offer, 'canonicalUrl'), false);
  assert.ok(view.steps.every(step => !Object.hasOwn(step, 'canonicalUrl')));
  assert.deepEqual(resolveOfficialStep(officialFixtureCheck(), savedEvidence(), 'listing-step-id', officialFixtureCatalog, officialNow), { status: 'ready', url: listingUrl });
});

test('a six-hour-old listing stays historical while the reviewed fallback retains its own expiry', () => {
  const later = new Date('2026-11-10T18:00:00.000Z');
  const view = deriveOfficialVerification(officialFixtureCheck(), savedEvidence(), officialFixtureCatalog, later);
  assert.equal(view.offer.status, 'matched_public_reference');
  assert.equal(view.freshness, 'stale');
  assert.equal(view.checkedAt, officialNow.toISOString());
  assert.deepEqual(view.steps.map(step => step.stepId), ['entry-step-id']);
  assert.deepEqual(resolveOfficialStep(officialFixtureCheck(), savedEvidence(), 'listing-step-id', officialFixtureCatalog, later), { status: 'unavailable' });
});

test('a newly checked fallback cannot refresh an older listing fact', () => {
  const rows = savedEvidence();
  rows.push({ ...structuredClone(rows[2]), id: 'entry-document', observedAt: '2026-11-10T17:59:00.000Z', data: { ...rows[2].data, sourceId: 'example-careers', readUrl: 'https://company.example/careers', finalReadUrl: 'https://company.example/careers', fetchedAt: '2026-11-10T17:59:00.000Z' } });
  const view = deriveOfficialVerification(officialFixtureCheck(), rows, officialFixtureCatalog, new Date('2026-11-10T18:00:00.000Z'));
  assert.equal(view.freshness, 'stale');
  assert.equal(view.checkedAt, officialNow.toISOString());
});

test('changed catalogue revokes a saved official step', () => {
  const changedCatalog = { ...officialFixtureCatalog, version: 'changed' };
  assert.deepEqual(resolveOfficialStep(officialFixtureCheck(), savedEvidence(), 'listing-step-id', changedCatalog, officialNow), { status: 'unavailable' });
  assert.equal(deriveOfficialVerification(officialFixtureCheck(), savedEvidence(), changedCatalog, officialNow).freshness, 'stale');
});

test('wrong identity, malformed records, missing citations, source revocation and URL tampering deny saved steps', () => {
  const mutations: Array<(rows: Observation[]) => void> = [
    rows => { rows[5].checkId = 'other'; },
    rows => { rows[5].runId = 'old-run'; },
    rows => { rows[5].sourceKind = 'user_text'; },
    rows => { rows[5].data.canonicalUrl = 'https://job-boards.greenhouse.io/examplecompany/jobs/54321'; },
    rows => { rows[5].data.canonicalUrl = readUrl; },
    rows => { rows[5].data.hostname = 'evil.example'; },
    rows => { rows[5].data.referenceOrigin = null; },
    rows => { rows[5].data.evidenceIds = ['listing-step']; },
    rows => { rows[5].data.evidenceIds = ['not-in-this-check']; },
    rows => { rows[5].data.expiresAt = '2026-11-10T18:00:00.001Z'; },
    rows => { rows[2].runId = 'old-run'; },
    rows => { rows[2].data.responseStatus = 'unavailable'; },
    rows => { rows[2].data.readUrl = 'https://boards-api.greenhouse.io/v1/boards/other/jobs/12345'; },
    rows => { rows[2].observedAt = '2026-11-10T12:00:00.001Z'; },
    rows => { rows[3].data.offerStatus = 'explicitly_closed'; },
    rows => { rows[3].data.referenceValue = '54321'; },
    rows => { rows[3].data.basedOnEvidenceIds = ['offer']; },
    rows => { rows.push(structuredClone(rows[5])); },
    rows => { rows[5].data.body = 'unapproved nested/source data'; },
  ];
  for (const mutate of mutations) {
    const rows = savedEvidence(); mutate(rows);
    assert.deepEqual(resolveOfficialStep(officialFixtureCheck(), rows, 'listing-step-id', officialFixtureCatalog, officialNow), { status: 'unavailable' }, String(mutate));
  }
  const revoked = structuredClone(officialFixtureCatalog); revoked.companies[0].sources.shift();
  assert.deepEqual(resolveOfficialStep(officialFixtureCheck(), savedEvidence(), 'listing-step-id', revoked, officialNow), { status: 'unavailable' });
});

test('step expiry is bounded by the check, review, fetched time and explicit deadline', () => {
  const check = officialFixtureCheck(); check.expiresAt = '2026-11-10T17:00:00.000Z';
  assert.deepEqual(resolveOfficialStep(check, savedEvidence(), 'listing-step-id', officialFixtureCatalog, officialNow), { status: 'unavailable' });
  const review = structuredClone(officialFixtureCatalog); review.companies[0].reviewedAt = '2026-10-11T13:00:00.000Z';
  const rows = savedEvidence(); rows[0].data.reviewedAt = review.companies[0].reviewedAt;
  assert.deepEqual(resolveOfficialStep(officialFixtureCheck(), rows, 'listing-step-id', review, officialNow), { status: 'unavailable' });
  const deadline = savedEvidence(); deadline[3].data.validThrough = '2026-11-10T13:00:00.000Z';
  assert.deepEqual(resolveOfficialStep(officialFixtureCheck(), deadline, 'listing-step-id', officialFixtureCatalog, officialNow), { status: 'unavailable' });
  const timely = savedEvidence(); timely[3].data.validThrough = '2026-11-10T13:00:00.000Z'; timely[5].data.expiresAt = '2026-11-10T13:00:00.000Z';
  assert.equal(resolveOfficialStep(officialFixtureCheck(), timely, 'listing-step-id', officialFixtureCatalog, officialNow).status, 'ready');
});

test('nonterminal, canceled, expired and old-run checks never expose an eligible step', () => {
  for (const state of ['queued', 'collecting', 'analyzing', 'cancel_requested', 'canceled', 'failed', 'blocked'] as const) {
    const check = { ...officialFixtureCheck(), state };
    assert.deepEqual(resolveOfficialStep(check, savedEvidence(), 'listing-step-id', officialFixtureCatalog, officialNow), { status: 'unavailable' });
    assert.equal(deriveOfficialVerification(check, savedEvidence(), officialFixtureCatalog, officialNow).steps.length, 0);
  }
  for (const check of [{ ...officialFixtureCheck(), cancelRequestedAt: officialNow.toISOString() }, { ...officialFixtureCheck(), runId: 'new-run' }, { ...officialFixtureCheck(), expiresAt: officialNow.toISOString() }]) {
    assert.deepEqual(resolveOfficialStep(check, savedEvidence(), 'listing-step-id', officialFixtureCatalog, officialNow), { status: 'unavailable' });
  }
});

test('unknown company has no invented official destination', () => {
  for (const companyStatus of ['ambiguous', 'unlisted', 'expired', 'not_claimed'] as const) {
    const rows = savedEvidence(); rows[0].data.companyStatus = companyStatus; rows[0].data.companyId = null;
    const view = deriveOfficialVerification(officialFixtureCheck(), rows, officialFixtureCatalog, officialNow);
    assert.equal(view.company.status, companyStatus);
    assert.equal(view.steps.length, 0);
    assert.notEqual(view.freshness, 'fresh');
  }
});

test('all nonpositive offer statuses remain separate from missing or unavailable coverage', () => {
  for (const status of ['details_differ', 'explicitly_closed', 'not_found_in_checked_source', 'reference_needed', 'not_publicly_verifiable', 'unavailable', 'not_applicable'] as const) {
    const rows = savedEvidence(); rows[3].data.offerStatus = status; rows[4].data.offerStatus = status;
    const view = deriveOfficialVerification(officialFixtureCheck(), rows, officialFixtureCatalog, officialNow);
    assert.equal(view.offer.status, status);
    if (status !== 'details_differ') assert.equal(view.steps.some(step => step.purpose === 'listing'), false);
  }
  const rows = savedEvidence(); rows[2].data.responseStatus = 'unavailable'; rows[2].status = 'unavailable';
  assert.equal(deriveOfficialVerification(officialFixtureCheck(), rows, officialFixtureCatalog, officialNow).offer.status, 'unavailable');
});

test('affirmative submitted-destination facts retain exact first-party versus delegated classification', () => {
  for (const [url, sourceId, hostname, status] of [
    ['https://company.example/careers', 'example-careers', 'company.example', 'first_party_source'],
    [listingUrl, 'example-board', 'job-boards.greenhouse.io', 'reviewed_delegate'],
  ] as const) {
    const check = officialFixtureCheck(); check.input.url = url;
    const rows = savedEvidence(); Object.assign(rows[1].data, { sourceId, hostname, destinationStatus: status });
    assert.equal(deriveOfficialVerification(check, rows, officialFixtureCatalog, officialNow).destination.status, status);
    rows[1].data.destinationStatus = status === 'first_party_source' ? 'reviewed_delegate' : 'first_party_source';
    assert.equal(deriveOfficialVerification(check, rows, officialFixtureCatalog, officialNow).destination.status, 'unrecognized');
  }
});
