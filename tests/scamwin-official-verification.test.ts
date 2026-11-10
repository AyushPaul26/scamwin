import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveOfficialClaim, verifyOfficialOffer } from '../lib/scamwin/official-verification';
import { observationSchema } from '../lib/scamwin/contracts';
import { officialObservationDataSchemas, type OfficialReader } from '../lib/scamwin/official-verification-contracts';
import { officialBoard, officialFixtureCatalog, officialFixtureDocument, officialInput, officialIntent, officialNow } from './fixtures/scamwin-official-fixture';

function fixture(options: { remaining?: number; input?: typeof officialInput; reader?: OfficialReader; catalog?: typeof officialFixtureCatalog } = {}) {
  let sequence = 0;
  const controller = new AbortController();
  const calls: string[] = [];
  const reader: OfficialReader = async (source, _reference, { signal }) => { signal.throwIfAborted(); calls.push(source.id); return officialFixtureDocument(source); };
  return { calls, controller, run: () => verifyOfficialOffer({ input: options.input ?? officialInput, intent: officialIntent, scope: { checkId: 'official-check', runId: 'official-run' }, signal: controller.signal, pipelineDeadlineAtMs: officialNow.getTime() + (options.remaining ?? 240_000) }, { catalog: options.catalog ?? officialFixtureCatalog, reader: options.reader ?? reader, now: () => officialNow, makeId: () => `official-${++sequence}` }) };
}

test('exact official listing produces bounded flat private records and separately sourced next steps', async () => {
  const f = fixture(); const records = await f.run();
  assert.equal(records.length, 8);
  assert.equal(f.calls.length, 2);
  assert.equal(records.find(item => item.kind === 'official_company')?.data.companyStatus, 'recognized');
  assert.equal(records.find(item => item.kind === 'official_destination')?.data.destinationStatus, 'unrecognized');
  assert.equal(records.find(item => item.kind === 'official_offer')?.data.offerStatus, 'matched_public_reference');
  assert.equal(records.filter(item => item.kind === 'official_next_step').length, 2);
  for (const record of records) {
    assert.equal(observationSchema.safeParse(record).success, true);
    assert.equal(officialObservationDataSchemas[record.kind as keyof typeof officialObservationDataSchemas].safeParse(record.data).success, true);
    assert.equal(record.sourceKind, 'official_source');
    assert.equal(record.checkId, 'official-check'); assert.equal(record.runId, 'official-run');
    assert.equal('body' in record.data, false);
  }
});

test('unknown, ambiguous and expired references cannot make source requests or guessed links', async () => {
  for (const kind of ['unknown', 'ambiguous', 'expired']) {
    const catalog = structuredClone(officialFixtureCatalog);
    if (kind === 'ambiguous') catalog.companies.push({ ...catalog.companies[0], id: 'other', sources: [] });
    if (kind === 'expired') catalog.companies[0].reviewedAt = '2026-10-01T00:00:00.000Z';
    const f = fixture({ catalog, input: { ...officialInput, claimedCompany: kind === 'unknown' ? 'Unknown company' : 'Example' } });
    const records = await f.run();
    assert.equal(f.calls.length, 0);
    assert.equal(records.some(item => item.kind === 'official_next_step'), false);
    assert.notEqual(records.find(item => item.kind === 'official_company')?.data.companyStatus, 'recognized');
  }
});

test('official stage reserves finalization time at the exact headroom boundary', async () => {
  const late = fixture({ remaining: 54_999 }); const lateRecords = await late.run();
  assert.equal(late.calls.length, 0);
  assert.equal(lateRecords.find(item => item.kind === 'official_offer')?.data.offerStatus, 'unavailable');
  const enough = fixture({ remaining: 55_000 }); await enough.run();
  assert.equal(enough.calls.length, 2);
});

test('numeric posting ID cannot choose between two company boards', async () => {
  const catalog = structuredClone(officialFixtureCatalog);
  assert.equal(officialBoard.kind, 'greenhouse_job');
  if (officialBoard.kind !== 'greenhouse_job') throw Error('Expected the Greenhouse fixture');
  catalog.companies[0].sources.push({ ...officialBoard, id: 'another-board', boardToken: 'anotherboard', entryUrl: 'https://job-boards.greenhouse.io/anotherboard', listingUrlTemplate: 'https://job-boards.greenhouse.io/anotherboard/jobs/{postId}' });
  const f = fixture({ catalog }); const records = await f.run();
  assert.equal(records.find(item => item.kind === 'official_offer')?.data.offerStatus, 'reference_needed');
  assert.deepEqual(f.calls, ['example-careers'], 'may read reviewed fallback, never guess a board');
});

test('AI references never cause lookups and explicit company correction preserves uncertainty', () => {
  const claim = deriveOfficialClaim({ ...officialInput, claimedCompany: 'Different Co', offerReference: '' }, { ...officialIntent, extractedCandidates: [{ kind: 'public_offer_reference', value: '12345', sourceRef: 'user_text' }] }, officialFixtureCatalog);
  assert.equal(claim.organizationName, 'Different Co');
  assert.equal(claim.publicReference, null);
  assert.ok(claim.uncertainties.length);
});

test('source failures remain unavailable with a reviewed fallback, never an invented absence', async () => {
  const f = fixture({ reader: async () => { throw Error('Untrusted provider message'); } }); const records = await f.run();
  assert.equal(records.find(item => item.kind === 'official_offer')?.data.offerStatus, 'unavailable');
  assert.equal(records.some(item => JSON.stringify(item.data).includes('Untrusted provider message')), false);
  assert.equal(records.find(item => item.kind === 'official_next_step')?.data.basis, 'reviewed_entry');
});

test('cancellation aborts source collection instead of manufacturing an unavailable completion', async () => {
  const controller = new AbortController();
  await assert.rejects(verifyOfficialOffer({ input: officialInput, intent: officialIntent, scope: { checkId: 'c', runId: 'r' }, signal: controller.signal, pipelineDeadlineAtMs: officialNow.getTime() + 240_000 }, { catalog: officialFixtureCatalog, now: () => officialNow, makeId: () => 'id', reader: async () => { controller.abort(); throw Error('stop'); } }), /abort/i);
});

test('a public listing URL resolves its company without sending unrelated private query strings', () => {
  const input = { ...officialInput, claimedCompany: '', offerReference: '', url: 'https://job-boards.greenhouse.io/examplecompany/jobs/12345' };
  const claim = deriveOfficialClaim(input, null, officialFixtureCatalog);
  assert.equal(claim.organizationName, 'Example Company');
  assert.equal(claim.publicReference?.value, input.url);
  const privateReference = deriveOfficialClaim({ ...input, url: `${input.url}?invitation=secret` }, null, officialFixtureCatalog);
  assert.equal(privateReference.publicReference, null);
  const publicTracking = deriveOfficialClaim({ ...input, url: `${input.url}?gh_jid=12345` }, null, officialFixtureCatalog);
  assert.equal(publicTracking.publicReference?.value, input.url, 'matching public post parameter is removed, never forwarded');
  const differentId = deriveOfficialClaim({ ...input, url: `${input.url}?gh_jid=99999` }, null, officialFixtureCatalog);
  assert.equal(differentId.publicReference, null);
});

test('valid source dates and display fields fit saved contracts without discarding official evidence', async () => {
  for (const validThrough of ['2026-11-15', '2026-11-15T17:00:00+05:30']) {
    const f = fixture({ reader: async source => {
      const doc = officialFixtureDocument(source);
      if (source.kind === 'greenhouse_job') doc.body = JSON.stringify({ id: 12345, company_name: 'Example Company', title: 'T'.repeat(201), location: { name: 'L'.repeat(301) }, validThrough, content: 'A public posting.' });
      return doc;
    } });
    const records = await f.run();
    const fact = records.find(item => item.kind === 'official_offer')!;
    assert.equal(fact.data.offerStatus, 'matched_public_reference');
    assert.equal(String(fact.data.title).length, 200);
    assert.equal(String(fact.data.location).length, 300);
    assert.equal(fact.data.validThrough, validThrough.length === 10 ? '2026-11-15T23:59:59.999Z' : '2026-11-15T11:30:00.000Z');
    assert.ok(records.some(item => item.kind === 'official_next_step'));
  }
});

test('a successful listing API read does not pretend the separate careers entry was checked live', async () => {
  const catalog = structuredClone(officialFixtureCatalog);
  catalog.companies[0].sources = [officialBoard];
  const f = fixture({ catalog }); const records = await f.run();
  const entry = records.find(item => item.kind === 'official_next_step' && item.data.purpose === 'careers')!;
  assert.equal(entry.data.basis, 'reviewed_entry');
  assert.equal((entry.data.evidenceIds as string[]).some(id => records.find(item => item.id === id)?.kind === 'official_document'), false);
});
