import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Observation } from '../lib/scamwin/contracts';
import { deriveDecisionComparison } from '../lib/scamwin/decision-comparison';
import { getDemo } from '../lib/scamwin/demo';
import { DecisionComparison } from '../components/scamwin/decision-comparison';
import { EvidenceRecord, FindingEvidence } from '../components/scamwin/finding-evidence';

const fixture = () => getDemo('refund');
const observation = (kind: string, data: Observation['data'], overrides: Partial<Observation> = {}): Observation => ({
  id: kind, checkId: 'demo-refund', runId: 'demo-run-refund', kind, status: 'observed', sourceKind: 'live_page',
  sourceRef: 'https://refund.example.com/', observedAt: '2026-11-08T08:00:00.000Z', data,
  collectorVersion: 'test', policyVersion: 'test', ...overrides,
});

test('refund comparison preserves the user promise and cites the selected outgoing request', () => {
  const { check, observations } = fixture();
  const saved = structuredClone(check);
  const result = deriveDecisionComparison(check, observations);
  assert.equal(result.promise.text, 'Receive a refund of ₹2,499');
  assert.equal(result.promise.provenance, 'user_stated');
  assert.equal(result.intention.text, 'Receive money');
  assert.equal(result.intention.provenance, 'user_stated');
  assert.match(result.request.text, /outgoing payment/i);
  assert.match(result.request.text, /1 INR/);
  assert.equal(result.request.quote, 'Pay ₹1 to verify your refund');
  assert.deepEqual(result.request.evidenceIds, ['demo-run-refund-payment']);
  assert.equal(result.observedDestination.text, 'refund-check@upi');
  assert.equal(result.mismatch?.classification, 'observation');
  assert.deepEqual(check, saved, 'comparison must not mutate the saved risk or other check data');
});

test('explicit user intention wins when the model contradicts it', () => {
  const { check, observations } = fixture();
  check.intent = { ...check.intent!, intendedAction: 'pay_money', promisedBenefit: 'Model promise' };
  const result = deriveDecisionComparison(check, observations);
  assert.equal(result.intention.text, 'Receive money');
  assert.equal(result.promise.text, 'Receive a refund of ₹2,499');
});

test('consistent observed page does not invent an action from its text or clean assessment', () => {
  const { check, observations } = getDemo('legitimate');
  const result = deriveDecisionComparison(check, observations);
  assert.equal(result.intention.text, 'Read information');
  assert.equal(result.request.provenance, 'unknown');
  assert.equal(result.observedDestination.text, 'events.example.com');
  assert.equal(result.mismatch, null);
});

test('text-only input and a submitted URL cannot establish an observed request or destination', () => {
  const { check } = fixture();
  check.input.url = '';
  const supplied = observation('submitted_offer', { intendedAction: 'receive_money', promisedBenefit: check.input.promisedBenefit }, { sourceKind: 'user_text' });
  const result = deriveDecisionComparison(check, [supplied]);
  assert.equal(result.request.provenance, 'unknown');
  assert.equal(result.observedDestination.provenance, 'unknown');
  assert.deepEqual(result.promise.evidenceIds, ['submitted_offer']);
  check.input.url = 'https://unvisited.example.com/';
  assert.equal(deriveDecisionComparison(check, []).observedDestination.provenance, 'unknown');
});

test('model-only intention and extracted promise keep their provenance', () => {
  const { check } = fixture();
  check.input.promisedBenefit = '';
  check.input.intendedAction = '';
  const result = deriveDecisionComparison(check, []);
  assert.equal(result.promise.provenance, 'extracted');
  assert.equal(result.intention.provenance, 'inferred');
});

test('inferred request cites both interpretation and its underlying saved page', () => {
  const { check } = fixture();
  const page = observation('page', { finalUrl: 'https://refund.example.com/observed', text: 'Verify first' });
  const inferred = observation('semantic_mismatch', { description: 'Verification appears inconsistent with the promise.', quote: 'Verify first', basedOnEvidenceId: page.id });
  check.assessment!.findings = [{ id: 'concern-semantic_mismatch', statement: 'Verification needs checking.', classification: 'inference', evidenceIds: [inferred.id] }];
  const result = deriveDecisionComparison(check, [page, inferred]);
  assert.equal(result.request.provenance, 'inferred');
  assert.deepEqual(result.request.evidenceIds, ['semantic_mismatch', 'page']);
  assert.equal(result.mismatch?.classification, 'inference');
  assert.deepEqual(result.mismatch?.evidenceIds, ['semantic_mismatch', 'page']);
});

test('uncited inference cannot substitute for an observation or create a confirmed mismatch', () => {
  const { check } = fixture();
  const inferred = observation('semantic_mismatch', { description: 'Pay someone', basedOnEvidenceId: 'absent' });
  const result = deriveDecisionComparison(check, [inferred]);
  assert.equal(result.request.provenance, 'unknown');
  assert.equal(result.observedDestination.provenance, 'unknown');
  assert.equal(result.mismatch, null);
});

test('unselected, unavailable, screenshot and foreign-run payments are ineligible', () => {
  const { check } = fixture();
  const payment = observation('payment_action', { direction: 'outgoing', recipient: 'a@upi', amount: '25', currency: 'INR', selectedCheckpoint: true });
  for (const item of [
    { ...payment, data: { ...payment.data, selectedCheckpoint: false } },
    { ...payment, status: 'unavailable' as const },
    { ...payment, sourceKind: 'user_image' as const },
    { ...payment, runId: 'old-run' },
    { ...payment, checkId: 'other-check' },
    { ...payment, data: { ...payment.data, direction: 'incoming' } },
  ]) {
    const result = deriveDecisionComparison(check, [item]);
    assert.equal(result.request.provenance, 'unknown');
    assert.equal(result.observedDestination.provenance, 'unknown');
    assert.equal(result.mismatch, null);
  }
});

test('sensitive fields and forms describe observed controls without implying submitted values', () => {
  const { check } = fixture();
  const sensitive = deriveDecisionComparison(check, [observation('sensitive_request', { description: 'Password or one-time code field visible.' })]);
  assert.equal(sensitive.request.provenance, 'observed');
  assert.match(sensitive.request.text, /password or one-time code/i);
  assert.match(sensitive.request.text, /no values were entered/i);
  const form = deriveDecisionComparison(check, [observation('form_destinations', { destinations: ['https://collector.example/submit'], methods: ['post'] })]);
  assert.equal(form.request.provenance, 'observed');
  assert.match(form.request.text, /no submission/i);
  assert.equal(form.observedDestination.provenance, 'unknown', 'a form action is not the observed journey destination');
});

test('expired captures do not erase saved facts or supply missing destination facts', () => {
  const { check, observations } = fixture();
  const capture = observation('capture', { sha256: 'saved-hash' }, { artifactId: 'expired-image' });
  const result = deriveDecisionComparison(check, [...observations, capture]);
  assert.equal(result.request.provenance, 'observed');
  assert.equal(result.observedDestination.text, 'refund-check@upi');
  const missing = deriveDecisionComparison(check, [capture]);
  assert.equal(missing.observedDestination.provenance, 'unknown');
});

test('an outgoing payment without a saved finding does not invent a mismatch', () => {
  const { check, observations } = fixture();
  delete check.assessment;
  assert.equal(deriveDecisionComparison(check, observations).mismatch, null);
});

test('missing evidence stays unknown even when AI requestedActions has confident wording', () => {
  const { check } = fixture();
  check.intent!.requestedActions = ['Pay ₹50 to invented@upi'];
  const result = deriveDecisionComparison(check, []);
  assert.equal(result.request.provenance, 'unknown');
  assert.deepEqual(result.request.evidenceIds, []);
  assert.equal(result.observedDestination.text, 'Destination not observed');
});

test('comparison renders three labelled fields with escaped evidence quotes and citations', () => {
  const { check, observations } = fixture();
  observations.find(o => o.kind === 'payment_action')!.data.quote = '<script>private text</script>';
  const html = renderToStaticMarkup(createElement(DecisionComparison, { comparison: deriveDecisionComparison(check, observations), observations }));
  for (const label of ['The promise', 'Your intended action', 'Observed request']) assert.ok(html.includes(label));
  assert.ok(html.includes('href="#evidence-demo-run-refund-payment"'));
  assert.ok(html.includes('&lt;script&gt;private text&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('findings link underlying page evidence while keeping semantic comparison labelled inference', () => {
  const base = observation('page', { text: 'Observed' });
  const inference = observation('semantic_mismatch', { description: 'Interpretation', basedOnEvidenceId: base.id });
  const html = renderToStaticMarkup(createElement(FindingEvidence, { finding: { id: 'finding', statement: 'Needs checking', classification: 'inference', evidenceIds: [inference.id] }, observations: [base, inference] }));
  assert.ok(html.includes('Inference from evidence'));
  assert.ok(html.includes('href="#evidence-page"'));
  assert.ok(html.includes('href="#evidence-semantic_mismatch"'));
});

const privateArtifact = { id: 'image', checkId: 'demo-refund', runId: 'demo-run-refund', name: 'capture.jpg', mediaType: 'image/jpeg' as const, kind: 'capture' as const, byteLength: 20, sha256: 'hash', createdAt: '2026-11-08T08:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', url: '/api/scamwin/artifacts/image' };

test('capture shows only the owner endpoint inline, and keeps the evidence anchor and metadata', () => {
  const capture = observation('capture', { sha256: 'hash' }, { artifactId: 'image' });
  const html = renderToStaticMarkup(createElement(EvidenceRecord, { observation: capture, number: 2, artifacts: [privateArtifact] }));
  assert.ok(html.includes('Captured screenshot'));
  assert.ok(html.includes('src="/api/scamwin/artifacts/image"'));
  assert.ok(html.includes('id="evidence-capture"'));
  assert.ok(html.includes('Collector test'));
  assert.ok(html.includes('Enlarge captured screenshot'));
});

test('expired, demo and non-owner artifact URLs never render a private image', () => {
  const capture = observation('capture', {}, { artifactId: 'image' });
  for (const props of [
    { artifacts: [{ ...privateArtifact, expiresAt: '2000-01-01T00:00:00.000Z' }] },
    { artifacts: [privateArtifact], demo: true },
    { artifacts: [{ ...privateArtifact, url: 'https://untrusted.example/image' }] },
    { artifacts: [{ ...privateArtifact, url: 'data:image/jpeg;base64,PRIVATE' }] },
  ]) {
    const html = renderToStaticMarkup(createElement(EvidenceRecord, { observation: capture, number: 1, ...props }));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('PRIVATE'));
    assert.ok(html.includes('id="evidence-capture"'), 'saved record survives missing image');
  }
});
