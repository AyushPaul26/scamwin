import type { CheckRecord, Observation, OfferIntent } from './contracts';
import { assessEvidence } from './analysis';

export const demoScenarios = [{ id: 'refund', label: 'Refund with a payment request' }, { id: 'legitimate', label: 'Consistent offer, completed checks' }, { id: 'limited', label: 'Limited evidence' }];
/** Read-only, synthetic fixtures. Never selected as a provider fallback. */
export function getDemo(scenario: string = 'refund') {
  const selected = demoScenarios.some(s => s.id === scenario) ? scenario : 'refund';
  const timestamp = '2026-11-08T08:00:00.000Z', checkId = `demo-${selected}`, runId = `demo-run-${selected}`;
  const intent: OfferIntent = { promisedBenefit: selected === 'refund' ? 'Receive a refund of ₹2,499' : 'Read the community event information', claimedOrganization: null, intendedAction: selected === 'refund' ? 'receive_money' : 'read_information', requestedActions: selected === 'refund' ? ['Open the refund page', 'Use the payment link'] : ['Read information'], extractedCandidates: [], uncertainties: [] };
  const input = { url: selected === 'refund' ? 'https://refund.example.com/' : 'https://events.example.com/', message: selected === 'refund' ? 'Your refund of ₹2,499 is ready. Open the page and complete verification.' : 'Read the schedule for our community event.', promisedBenefit: intent.promisedBenefit || '', intendedAction: intent.intendedAction || '', images: [] };
  const observation = (id: string, kind: string, data: Observation['data'], sourceKind: Observation['sourceKind'] = 'live_page', status: Observation['status'] = 'observed'): Observation => ({ id: `${runId}-${id}`, checkId, runId, kind, status, sourceKind, sourceRef: input.url, observedAt: timestamp, data, collectorVersion: 'synthetic-demo-1', policyVersion: 'synthetic-demo-1' });
  const observations: Observation[] = [observation('url', 'url_validation', { selected: true }, 'user_text')];
  if (selected === 'limited') observations.push(observation('page', 'page', { reason: 'Synthetic example: the page could not be observed within the allowed scope.' }, 'live_page', 'not_checked'));
  else {
    observations.push(observation('page', 'page', { title: selected === 'refund' ? 'Refund verification' : 'Community event schedule', text: selected === 'refund' ? 'To verify your refund, pay ₹1 to refund-check@upi. This is a synthetic example.' : 'Community event. Saturday, 10am. Free entry. No payment or credentials requested. This is a synthetic example.', finalUrl: input.url, readable: true, complete: true }), observation('tls', 'tls', { valid: true, limitation: 'Synthetic certificate observation for demonstration.' }, 'origin_probe'), observation('actions', 'action_review', { complete: true, submitted: false }), observation('registry', 'registry_lookup', { fresh: true, warnings: 0, synthetic: true }, 'registry'));
    if (selected === 'refund') observations.push(observation('payment', 'payment_action', { direction: 'outgoing', recipient: 'refund-check@upi', amount: '1', currency: 'INR', selectedCheckpoint: true, quote: 'Pay ₹1 to verify your refund' }));
  }
  const check: CheckRecord = { id: checkId, ownerId: 'synthetic-demo', submissionKey: checkId, input, runId, state: selected === 'limited' ? 'partial' : 'completed', generation: 1, revision: 5, createdAt: timestamp, updatedAt: timestamp, expiresAt: '2099-01-01T00:00:00.000Z', intent, assessment: assessEvidence(input, observations, intent), stages: [{ id: 'intake', label: 'Read the offer', status: 'completed' }, { id: 'evidence', label: 'Observe the destination', status: selected === 'limited' ? 'unavailable' : 'completed' }, { id: 'assessment', label: 'Compare the action', status: 'completed' }], relatedCases: [] };
  return { check, observations, artifacts: [], messages: [], relatedCases: [], scenarios: demoScenarios, synthetic: true as const };
}
