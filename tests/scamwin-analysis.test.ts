import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTarget, isAllowedOrigin, parsePaymentUri, extractUrlSignals } from '../lib/scamwin/policy';
import { assessEvidence, validateAssessmentEvidence } from '../lib/scamwin/analysis';
import type { Observation, ObservationStatus } from '../lib/scamwin/contracts';

test('URL intake refuses credentials, local/IP/ambiguous schemes and enforces exact collection origins', () => {
  for (const input of ['http://127.0.0.1', 'http://2130706433', 'http://[::1]', 'https://user:secret@example.com', 'file:///etc/passwd', 'https://test.local', 'https://metadata.google.internal']) {
    assert.throws(() => normalizeTarget(input));
  }
  assert.equal(normalizeTarget('https://Example.com/a#fragment').url, 'https://example.com/a');
  assert.equal(isAllowedOrigin('https://lab.example/a', ['https://lab.example']), true);
  assert.equal(isAllowedOrigin('https://lab.example.attacker.test/', ['https://lab.example']), false);
  assert.equal(isAllowedOrigin('https://sub.lab.example/', ['https://lab.example']), false);
  assert.equal(extractUrlSignals('https://secure-login-refund.example/').some(signal => signal.code === 'identity_language'), true);
});

test('a payment URI is parsed as an outgoing request without inventing the recipient', () => {
  assert.deepEqual(parsePaymentUri('upi://pay?pa=demo%40upi&am=499&cu=INR'), { direction: 'outgoing', recipient: 'demo@upi', amount: '499', currency: 'INR' });
  assert.equal(parsePaymentUri('upi://pay?pa=a@upi&pa=b@upi'), null);
  assert.equal(parsePaymentUri('upi://pay?pa=a@upi&am=-1'), null);
  assert.equal(parsePaymentUri('https://example.com/pay'), null);
});

const input = { url: 'https://refund.example/', message: 'Your refund is ready', promisedBenefit: 'Receive a refund', intendedAction: 'receive_money', images: [] };
const observation = (id: string, kind: string, data: Observation['data'], status: ObservationStatus = 'observed'): Observation => ({
  id, checkId: 'case', runId: 'run', kind, status, sourceKind: 'live_page', sourceRef: 'https://refund.example/', observedAt: '2026-11-08T00:00:00Z', data, collectorVersion: '1', policyVersion: '1',
});

test('observed selected outgoing payment contradicts explicit receiving intent even with valid TLS', () => {
  const observations = [observation('payment', 'payment_action', { direction: 'outgoing', recipient: 'demo@upi', selectedCheckpoint: true }), observation('tls', 'tls', { valid: true })];
  const result = assessEvidence(input, observations);
  assert.equal(result.risk, 'high_risk');
  assert.ok(result.findings.some(f => f.evidenceIds.includes('payment')));
  assert.ok(result.missingChecks.length > 0, 'risk and incomplete coverage remain separate');
});

test('an unrelated payment link, missing headers or urgency do not establish fraud', () => {
  const result = assessEvidence(input, [observation('donation', 'payment_action', { direction: 'outgoing', recipient: 'charity@upi', selectedCheckpoint: false }), observation('headers', 'security_headers', { missing: ['permissions-policy'] })]);
  assert.equal(result.risk, 'inconclusive');
});

test('screenshot-only or unavailable browser evidence cannot produce a clean result', () => {
  assert.equal(assessEvidence({ ...input, url: '' }, []).risk, 'inconclusive');
  assert.equal(assessEvidence(input, [observation('browser', 'page', {}, 'blocked')]).risk, 'inconclusive');
});

test('unknown or unauthorized evidence references cannot enter a saved explanation', () => {
  const result = assessEvidence(input, [observation('known', 'page', { text: 'An offer' })]);
  assert.throws(() => validateAssessmentEvidence({ ...result, findings: [{ id: 'invented', statement: 'Proven scam', classification: 'observation', evidenceIds: ['absent'] }] }, ['known']));
});

test('official offer differences are cited inferences; source matches cannot clear action risk', () => {
  const official = { ...observation('official-offer', 'official_offer', { schemaVersion: 1, catalogVersion: 'test', companyId: 'company', reasonCode: 'title_differs', offerStatus: 'details_differ', sourceId: 'source', referenceKind: 'greenhouse_post_id', referenceValue: '12345', title: 'Software Engineer', location: null, validThrough: null, canonicalListingUrl: 'https://job-boards.greenhouse.io/company/jobs/12345', quote: 'Software Engineer', differingFields: ['title'], basedOnEvidenceIds: [] }), sourceKind: 'official_source' as const };
  const result = assessEvidence(input, [official]);
  assert.equal(result.risk, 'needs_caution');
  assert.ok(result.findings.some(item => item.classification === 'inference' && item.evidenceIds.includes(official.id)));
  const matched = { ...official, data: { ...official.data, offerStatus: 'matched_public_reference', differingFields: [] } };
  assert.equal(assessEvidence(input, [matched, observation('payment', 'payment_action', { direction: 'outgoing', recipient: 'test@example', selectedCheckpoint: true })]).risk, 'high_risk');
});

test('missing, closed and unavailable official offers do not alone establish fraud', () => {
  for (const status of ['not_found_in_checked_source', 'explicitly_closed', 'unavailable', 'reference_needed']) {
    const item = { ...observation('offer', 'official_offer', { offerStatus: status }), sourceKind: 'official_source' as const };
    assert.notEqual(assessEvidence(input, [item]).risk, 'high_risk');
  }
});
