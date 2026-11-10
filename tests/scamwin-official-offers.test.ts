import assert from 'node:assert/strict';
import {test} from 'node:test';
import {interpretOfficialOffer} from '../lib/scamwin/official-offer-adapters';
import type {OfficialClaim, OfficialDocument, OfficialSource} from '../lib/scamwin/official-verification-contracts';

const now = new Date('2026-11-10T10:00:00.000Z');
const greenhouse: OfficialSource = {
  id: 'fixture-greenhouse', companyId: 'fixture', kind: 'greenhouse_job', purpose: 'careers',
  entryUrl: 'https://boards.greenhouse.io/fixture', boardToken: 'fixture',
  listingUrlTemplate: 'https://boards.greenhouse.io/fixture/jobs/{postId}',
  delegationEvidenceUrl: 'https://fixture.example/careers',
};
const staticSource: OfficialSource = {
  id: 'fixture-static', companyId: 'fixture', kind: 'jobposting_jsonld', purpose: 'careers',
  entryUrl: 'https://fixture.example/careers', listingOrigin: 'https://fixture.example',
  listingPathPrefix: '/careers/jobs/', relationshipEvidenceUrl: 'https://fixture.example/careers',
};
const claim: OfficialClaim = {
  organizationName: 'Fixture Company', offerType: 'recruitment',
  publicReference: {kind: 'greenhouse_post_id', value: '12345', origin: 'explicit_field'},
  title: 'Software Engineer', location: 'Bengaluru', uncertainties: [],
};
const staticClaim: OfficialClaim = {
  ...claim, publicReference: {kind: 'canonical_listing_url', value: 'https://fixture.example/careers/jobs/12345', origin: 'submitted_url'},
};
function document(body: string | null, overrides: Partial<OfficialDocument> = {}): OfficialDocument {
  return {
    sourceId: greenhouse.id, readUrl: 'https://boards-api.greenhouse.io/v1/boards/fixture/jobs/12345',
    finalReadUrl: 'https://boards-api.greenhouse.io/v1/boards/fixture/jobs/12345',
    fetchedAt: '2026-11-10T09:59:00.000Z', status: 'ok', contentType: 'application/json',
    body, digest: 'fixture-digest', reasonCode: null, ...overrides,
  };
}
function greenhouseDocument(overrides: Record<string, unknown> = {}): OfficialDocument {
  return document(JSON.stringify({id: 12345, internal_job_id: 555, requisition_id: 'REQ-555',
    title: 'Software Engineer', location: {name: 'Bengaluru'}, content: '<p>Build useful software.</p>', ...overrides}));
}
function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {'@context': 'https://schema.org', '@type': 'JobPosting',
    identifier: { '@type': 'PropertyValue', name: 'Fixture Company', value: '12345'},
    hiringOrganization: {'@type': 'Organization', name: 'Fixture Company'},
    url: 'https://fixture.example/careers/jobs/12345', title: 'Software Engineer',
    jobLocation: {'@type': 'Place', address: {'@type': 'PostalAddress', addressLocality: 'Bengaluru'}},
    description: '<p>Build useful software.</p>', ...overrides};
}
function staticDocument(objects: unknown = job(), extra = ''): OfficialDocument {
  return document(`<html><head><link rel="canonical" href="https://fixture.example/careers/jobs/12345"></head><body>${extra}<script type="application/ld+json">${JSON.stringify(objects)}</script></body></html>`, {
    sourceId: staticSource.id, readUrl: 'https://fixture.example/careers/jobs/12345',
    finalReadUrl: 'https://fixture.example/careers/jobs/12345', contentType: 'text/html; charset=utf-8',
  });
}

test('exact Greenhouse public post matches and ignores returned absolute_url as a destination', () => {
  const fact = interpretOfficialOffer(claim, greenhouse, greenhouseDocument({absolute_url: 'https://attacker.example/pay'}), now);
  assert.equal(fact.status, 'matched_public_reference');
  assert.equal(fact.reference, '12345');
  assert.equal(fact.canonicalUrl, 'https://boards.greenhouse.io/fixture/jobs/12345');
  assert.equal(fact.title, 'Software Engineer');
});
test('Greenhouse returned internal/requisition ID never substitutes for the public post ID', () => {
  for (const payload of [{id: 98765, internal_job_id: 12345}, {internal_job_id: 12345, requisition_id: '12345'}]) {
    const fact = interpretOfficialOffer(claim, greenhouse, document(JSON.stringify(payload)), now);
    assert.equal(fact.status, 'unavailable');
    assert.equal(fact.canonicalUrl, null);
  }
});
test('another Greenhouse board cannot establish the reviewed tenant relationship', () => {
  const fact = interpretOfficialOffer(claim, greenhouse, greenhouseDocument(), now);
  assert.equal(fact.status, 'matched_public_reference');
  const wrongBoard = document(greenhouseDocument().body, {finalReadUrl: 'https://boards-api.greenhouse.io/v1/boards/other/jobs/12345'});
  assert.equal(interpretOfficialOffer(claim, greenhouse, wrongBoard, now).status, 'unavailable');
  const wrongReference = {...claim, publicReference: {kind: 'canonical_listing_url' as const, value: 'https://boards.greenhouse.io/other/jobs/12345', origin: 'submitted_url' as const}};
  assert.equal(interpretOfficialOffer(wrongReference, greenhouse, greenhouseDocument(), now).status, 'reference_needed');
});
test('exact reviewed Greenhouse listing URL identifies the same public post', () => {
  const urlClaim: OfficialClaim = {...claim, publicReference: {kind: 'canonical_listing_url', value: 'https://boards.greenhouse.io/fixture/jobs/12345', origin: 'submitted_url'}};
  assert.equal(interpretOfficialOffer(urlClaim, greenhouse, greenhouseDocument(), now).status, 'matched_public_reference');
});
test('title alone needs a public reference', () => {
  assert.equal(interpretOfficialOffer({...claim, publicReference: null}, greenhouse, greenhouseDocument(), now).status, 'reference_needed');
});
test('404 proves only absence from the checked source', () => {
  const fact = interpretOfficialOffer(claim, greenhouse, document(null, {status: 'not_found', reasonCode: 'http_404'}), now);
  assert.equal(fact.status, 'not_found_in_checked_source');
  assert.equal(fact.canonicalUrl, null);
});
test('partial, blocked and malformed payloads never become an absent or closed posting', () => {
  for (const doc of [document(null, {status: 'unavailable', reasonCode: 'partial_body'}), document(null, {status: 'blocked'}), document('{"id":12345'), document('null'), document('[]'), document('{}')]) {
    assert.equal(interpretOfficialOffer(claim, greenhouse, doc, now).status, 'unavailable');
  }
});
test('document source and requested resource must match the exact lookup', () => {
  for (const override of [{sourceId: 'another-source'}, {readUrl: 'https://boards-api.greenhouse.io/v1/boards/other/jobs/12345'}, {contentType: 'text/html'}]) {
    assert.equal(interpretOfficialOffer(claim, greenhouse, {...greenhouseDocument(), ...override}, now).status, 'unavailable');
  }
});
test('missing title or location is not a literal conflict', () => {
  assert.equal(interpretOfficialOffer(claim, greenhouse, greenhouseDocument({title: undefined, location: undefined}), now).status, 'matched_public_reference');
  assert.equal(interpretOfficialOffer({...claim, title: null, location: null}, greenhouse, greenhouseDocument(), now).status, 'matched_public_reference');
});
test('literal title and location differences retain bounded supporting source quotes', () => {
  const fact = interpretOfficialOffer(claim, greenhouse, greenhouseDocument({title: 'Senior Engineer', location: {name: 'Remote'}, content: `<p>${'Useful work. '.repeat(200)}</p>`}), now);
  assert.equal(fact.status, 'details_differ');
  assert.deepEqual(fact.differingFields, ['title', 'location']);
  assert.match(fact.quote!, /Senior Engineer/);
  assert.match(fact.quote!, /Remote/);
  assert.ok(fact.quote!.length <= 800);
});
test('literal comparisons normalize case and whitespace without semantic matching', () => {
  assert.equal(interpretOfficialOffer(claim, greenhouse, greenhouseDocument({title: '  SOFTWARE\nEngineer ', location: {name: 'BENGALURU'}}), now).status, 'matched_public_reference');
  assert.equal(interpretOfficialOffer({...claim, location: 'Bangalore'}, greenhouse, greenhouseDocument(), now).status, 'details_differ');
});
test('a valid explicit past deadline closes an identified public listing', () => {
  const fact = interpretOfficialOffer(staticClaim, staticSource, staticDocument(job({validThrough: '2026-11-09T23:59:59Z'})), now);
  assert.equal(fact.status, 'explicitly_closed');
  assert.equal(fact.validThrough, '2026-11-09T23:59:59Z');
  assert.match(fact.quote!, /2026-11-09T23:59:59Z/);
});
test('missing, invalid and ambiguous deadlines cannot establish closure', () => {
  for (const deadline of [undefined, 'yesterday', '2026-02-30T00:00:00Z', ['2020-01-01', '2030-01-01']]) {
    const fact = interpretOfficialOffer(staticClaim, staticSource, staticDocument(job({validThrough: deadline})), now);
    assert.equal(fact.status, 'matched_public_reference');
    assert.equal(fact.validThrough, null);
  }
});
test('date-only deadline remains valid through the stated day', () => {
  assert.equal(interpretOfficialOffer(staticClaim, staticSource, staticDocument(job({validThrough: '2026-11-10'})), now).status, 'matched_public_reference');
});
test('an explicit closure in the identified posting is retained', () => {
  assert.equal(interpretOfficialOffer(staticClaim, staticSource, staticDocument(job({description: '<p>Applications for this job are closed.</p>'})), now).status, 'explicitly_closed');
});
test('static JobPosting graph matches a consistent identifier organization and canonical URL', () => {
  const fact = interpretOfficialOffer(staticClaim, staticSource, staticDocument({'@graph': [job()]}), now);
  assert.equal(fact.status, 'matched_public_reference');
  assert.equal(fact.canonicalUrl, 'https://fixture.example/careers/jobs/12345');
  assert.equal(fact.location, 'Bengaluru');
});
test('static JobPosting exact canonical identifier URL is supported', () => {
  assert.equal(interpretOfficialOffer(staticClaim, staticSource, staticDocument(job({identifier: 'https://fixture.example/careers/jobs/12345'})), now).status, 'matched_public_reference');
});
test('conflicting static JobPosting objects remain unresolved', () => {
  const fact = interpretOfficialOffer(staticClaim, staticSource, staticDocument([job(), job({title: 'Different position'})]), now);
  assert.equal(fact.status, 'unavailable');
  assert.equal(fact.reasonCode, 'ambiguous_jobposting');
  assert.equal(fact.canonicalUrl, null);
});
test('duplicate identical static objects do not fabricate ambiguity', () => {
  assert.equal(interpretOfficialOffer(staticClaim, staticSource, staticDocument([job(), job()]), now).status, 'matched_public_reference');
});
test('canonical, organization and public identifier mismatches remain unresolved', () => {
  for (const values of [{url: 'https://fixture.example/careers/jobs/98765'}, {url: 'https://attacker.example/job/12345'}, {hiringOrganization: {name: 'Another Company'}}, {identifier: '98765'}, {identifier: undefined}]) {
    const fact = interpretOfficialOffer(staticClaim, staticSource, staticDocument(job(values)), now);
    assert.equal(fact.status, 'unavailable');
    assert.equal(fact.canonicalUrl, null);
  }
});
test('conflicting HTML canonical link remains unresolved despite matching JSON-LD', () => {
  const doc = staticDocument();
  doc.body = doc.body!.replace('<link rel="canonical" href="https://fixture.example/careers/jobs/12345">', '<link rel="canonical" href="https://fixture.example/careers/jobs/98765">');
  assert.equal(interpretOfficialOffer(staticClaim, staticSource, doc, now).status, 'unavailable');
});
test('dynamic scripts are never executed or mistaken for JSON-LD evidence', () => {
  const doc = staticDocument({}, '<script>throw new Error("must never execute")</script><p>Software Engineer</p>');
  assert.equal(interpretOfficialOffer(staticClaim, staticSource, doc, now).status, 'unavailable');
});
test('malformed JSON-LD stays unavailable even alongside a valid object', () => {
  const doc = staticDocument(job(), '<script type="application/ld+json">{"@type":</script>');
  assert.equal(interpretOfficialOffer(staticClaim, staticSource, doc, now).status, 'unavailable');
});
test('oversized or excessive-depth documents cannot produce positive or negative facts', () => {
  const tooLarge = greenhouseDocument({content: 'x'.repeat(262144)});
  assert.equal(interpretOfficialOffer(claim, greenhouse, tooLarge, now).status, 'unavailable');
  let nested: unknown = job();
  for (let i = 0; i < 80; i += 1) nested = {'@graph': [nested]};
  assert.equal(interpretOfficialOffer(staticClaim, staticSource, staticDocument(nested), now).status, 'unavailable');
});
test('Greenhouse nested payloads have the same bounded traversal policy', () => {
  let nested: unknown = {name: 'Bengaluru'};
  for (let i = 0; i < 80; i += 1) nested = [nested];
  assert.equal(interpretOfficialOffer(claim, greenhouse, greenhouseDocument({location: nested}), now).status, 'unavailable');
});
test('closure quotes contain the actual closure even after a long description', () => {
  const fact = interpretOfficialOffer(staticClaim, staticSource, staticDocument(job({description: `<p>${'Build software. '.repeat(100)}Applications for this job are closed.</p>`})), now);
  assert.equal(fact.status, 'explicitly_closed');
  assert.match(fact.quote!, /Applications for this job are closed\./);
  assert.ok(fact.quote!.length <= 800);
});
test('private refund and identity requests cannot be verified by a public job listing', () => {
  for (const offerType of ['refund', 'identity_request'] as const) {
    assert.equal(interpretOfficialOffer({...claim, offerType}, greenhouse, greenhouseDocument(), now).status, 'not_publicly_verifiable');
  }
});
test('unclassified claims and reviewed entry pages do not imply an exact job match', () => {
  assert.equal(interpretOfficialOffer({...claim, offerType: 'unclear'}, greenhouse, greenhouseDocument(), now).status, 'not_applicable');
  const entry: OfficialSource = {id: 'entry', companyId: 'fixture', kind: 'official_entry', purpose: 'careers', entryUrl: 'https://fixture.example/careers'};
  assert.equal(interpretOfficialOffer(claim, entry, document(null), now).status, 'reference_needed');
});
