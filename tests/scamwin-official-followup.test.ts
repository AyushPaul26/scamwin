import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerFromEvidence, extractOfferIntent, selectFollowupContext } from '../lib/scamwin/ai';
import type { Assessment, Observation } from '../lib/scamwin/contracts';

const assessment: Assessment = { schemaVersion: 1, risk: 'needs_caution', summary: 'Review the observed request.', findings: [], missingChecks: [], nextSteps: [] };
const observation = (id: string, official = false): Observation => ({ id, checkId: 'check', runId: 'run', kind: official ? 'official_verification' : 'page', sourceKind: official ? 'official_source' : 'live_page', sourceRef: official ? 'catalog:example' : 'https://example.com/', status: 'observed', observedAt: '2026-11-10T00:00:00Z', data: { explanation: official ? 'The exact public listing was found.' : 'Some observed page text.' }, collectorVersion: 'test', policyVersion: 'test' });
const env = { CLOUDFLARE_ACCOUNT_ID: 'test-account', CLOUDFLARE_API_TOKEN: 'test-token' };

test('follow-up includes newly appended official facts and only findings supported by its supplied subset', () => {
  const observations = Array.from({ length: 35 }, (_, index) => observation(`page-${index}`));
  observations.push(observation('official-summary', true), { ...observation('official-source', true), kind: 'official_document', data: { quote: 'Published listing 12345' } });
  const context = selectFollowupContext({ ...assessment, findings: [{ id: 'supported', classification: 'observation', statement: 'Official listing found.', evidenceIds: ['official-source'] }, { id: 'unknown', classification: 'inference', statement: 'Not supported in this context.', evidenceIds: ['not-saved'] }] }, observations);
  const supplied = new Set(context.observations.map(item => item.id));
  assert.ok(supplied.has('official-summary'));
  assert.ok(supplied.has('official-source'));
  assert.ok(context.observations.length <= 30);
  assert.ok(context.omittedCount >= 7);
  assert.deepEqual(context.assessment.findings.map(item => item.id), ['supported']);
  assert.ok(context.assessment.findings.every(item => item.evidenceIds.every(id => supplied.has(id))));
});

test('follow-up enforces a UTF-8 byte budget without changing saved evidence or losing bounded official facts', () => {
  const observations: Observation[] = Array.from({ length: 45 }, (_, index) => ({ ...observation(`large-${index}`), data: { text: 'उ'.repeat(30_000) } }));
  observations.push({ ...observation('official-fact', true), data: { quote: 'The official quote remains.', explanation: 'A bounded conclusion.' } });
  const original = JSON.stringify(observations);
  const context = selectFollowupContext(assessment, observations);
  assert.ok(Buffer.byteLength(JSON.stringify(context), 'utf8') <= 65_536);
  assert.equal(context.observations.find(item => item.id === 'official-fact')?.data.quote, 'The official quote remains.');
  assert.equal(JSON.stringify(observations), original);
});

test('follow-up validates citations against evidence actually sent, not omitted saved records', async () => {
  const observations = Array.from({ length: 40 }, (_, index) => observation(`page-${index}`));
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    const context = JSON.parse(request.messages.at(-1).content);
    assert.ok(context.observations.length <= 30);
    const ids = new Set(context.observations.map((item: { id: string }) => item.id));
    const omitted = observations.find(item => !ids.has(item.id))!;
    return Response.json({ success: true, result: { response: { answer: 'An unsupported citation.', evidenceIds: [omitted.id] } } });
  };
  await assert.rejects(answerFromEvidence('What was checked?', assessment, observations, { env, fetcher }), /outside|provided|supplied/i);
  assert.equal(calls, 1, 'one existing model request, with no extra lookups');
});

test('offer extraction includes explicit company/reference as untrusted claims in the existing model call', async () => {
  let calls = 0;
  await extractOfferIntent({ url: '', message: 'A job invitation', promisedBenefit: '', intendedAction: '', images: [], claimedCompany: 'Example Company', offerReference: '12345' }, { env, fetcher: async (_url, init) => {
    calls++;
    const body = String(init?.body);
    assert.match(body, /Example Company/);
    assert.match(body, /12345/);
    return Response.json({ success: true, result: { response: { promisedBenefit: null, claimedOrganization: 'Example Company', intendedAction: null, requestedActions: [], extractedCandidates: [], uncertainties: [] } } });
  } });
  assert.equal(calls, 1);
});
