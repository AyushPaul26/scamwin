import { assessmentSchema, type Assessment, type CheckInput, type Observation, type OfferIntent } from './contracts';
import { extractUrlSignals } from './policy';

export function assessEvidence(input: CheckInput, observations: readonly Observation[], intent?: OfferIntent): Assessment {
  const observed = observations.filter(item => item.status === 'observed');
  const findings: Assessment['findings'] = [];
  const missingChecks: string[] = [];
  const find = (kind: string) => observed.find(item => item.kind === kind);
  const payment = observed.find(item => item.kind === 'payment_action' && item.sourceKind === 'live_page' && item.data.direction === 'outgoing' && item.data.selectedCheckpoint === true && typeof item.data.recipient === 'string');
  const receivingOnly = input.intendedAction === 'receive_money';
  const warning = observed.find(item => item.kind === 'registry_warning' && item.sourceKind === 'registry' && item.data.active === true && item.data.fresh === true && item.data.trusted === true);
  const tls = observed.find(item => item.kind === 'tls' && item.sourceKind === 'origin_probe');
  let caution = false;
  if (payment && receivingOnly) findings.push({ id: 'payment-direction', statement: `The selected action requests an outgoing payment to ${payment.data.recipient}, while your stated intention is to receive money. This establishes the direction of that action, not the identity or guilt of the recipient.`, classification: 'observation', evidenceIds: [payment.id] });
  if (warning) findings.push({ id: 'publisher-warning', statement: `An active warning for this exact hostname was observed from ${String(warning.data.publisher ?? 'a configured publisher')}. It is a publisher assertion, not a blockchain guarantee of fraud.`, classification: 'observation', evidenceIds: [warning.id] });
  for (const item of observed) {
    if (item.kind === 'semantic_mismatch' || item.kind === 'sensitive_request' || item.kind === 'identity_mismatch') {
      caution = true;
      findings.push({ id: `concern-${item.id}`, statement: String(item.data.description ?? 'A requested action needs independent verification.'), classification: 'inference', evidenceIds: [item.id] });
    }
    if (item.kind === 'tls' && item.sourceKind === 'origin_probe' && item.data.valid === false) {
      caution = true;
      findings.push({ id: `transport-${item.id}`, statement: 'The origin HTTPS identity or certificate validation failed. This is a transport-security issue; it does not by itself establish a scam.', classification: 'observation', evidenceIds: [item.id] });
    }
    if (item.kind === 'url_signals' && Array.isArray(item.data.codes) && item.data.codes.length) {
      caution = true;
      findings.push({ id: `address-${item.id}`, statement: 'The address contains signals worth checking against an official source. URL wording alone is not proof of fraud.', classification: 'inference', evidenceIds: [item.id] });
    }
  }
  if (!input.url) missingChecks.push('No destination URL was explicitly selected. Website and certificate checks were not performed.');
  if (!find('url_validation')) missingChecks.push('Public URL validation is incomplete.');
  if (!observed.some(item => item.kind === 'page' && item.sourceKind === 'live_page' && item.data.readable === true && item.data.complete === true)) missingChecks.push('The selected website was not completely observed within permitted scope.');
  if (!tls || tls.data.valid !== true) missingChecks.push('Origin HTTPS validation was not successfully completed.');
  if (!find('action_review') || find('action_review')?.data.complete !== true) missingChecks.push('Relevant requested actions could not all be reviewed.');
  if (!observed.some(item => item.kind === 'registry_lookup' && item.sourceKind === 'registry' && item.data.fresh === true)) missingChecks.push('A fresh shared-warning lookup is unavailable.');
  if (intent?.claimedOrganization && !observed.some(item => item.kind === 'official_identity' && item.sourceKind === 'official_source' && item.data.verified === true)) missingChecks.push('The claimed organization has not been independently confirmed from a curated official source.');
  for (const item of observations.filter(item => ['blocked', 'unavailable', 'not_checked'].includes(item.status))) {
    const description = typeof item.data.reason === 'string' ? item.data.reason : `${item.kind} was ${item.status.replaceAll('_', ' ')}.`;
    if (!missingChecks.includes(description)) missingChecks.push(description);
  }
  const risk = payment && receivingOnly || warning ? 'high_risk' : caution ? 'needs_caution' : missingChecks.length ? 'inconclusive' : 'no_observed_red_flags';
  const summary = risk === 'high_risk' ? 'There is evidence of risk associated with this action. Review the specific findings before proceeding.'
    : risk === 'needs_caution' ? 'Some observations need independent verification before you act.'
    : risk === 'inconclusive' ? 'Important parts of this offer could not be checked. The available evidence is not enough to clear the action.'
    : 'No red flags were observed in the completed checks. This is not a guarantee that the offer is genuine.';
  return assessmentSchema.parse({ schemaVersion: 1, risk, summary, findings, missingChecks: missingChecks.slice(0, 30), nextSteps: ['Pause before making a payment or sharing credentials.', 'Find the organization’s official website or contact independently of this offer.', 'Compare the exact recipient and requested action with the official instructions.'] });
}
export function validateAssessmentEvidence(assessment: unknown, allowedIds: readonly string[]): Assessment {
  const parsed = assessmentSchema.parse(assessment), allowed = new Set(allowedIds);
  for (const finding of parsed.findings) {
    if (!finding.evidenceIds.length || finding.evidenceIds.some(id => !allowed.has(id))) throw new Error('Explanation contains an unsupported evidence reference.');
  }
  return parsed;
}
export function userUrlObservation(input: CheckInput, source: Pick<Observation, 'checkId' | 'runId'>): Observation[] {
  if (!input.url) return [];
  const now = new Date().toISOString(), common = { ...source, sourceRef: input.url, sourceKind: 'user_text' as const, observedAt: now, status: 'observed' as const, collectorVersion: 'scamwin-1', policyVersion: 'scamwin-fixture-v1' };
  const signals = extractUrlSignals(input.url);
  return [{ ...common, id: `${source.runId}-url`, kind: 'url_validation', data: { selected: true } }, { ...common, id: `${source.runId}-signals`, kind: 'url_signals', data: { codes: signals.map(s => s.code), descriptions: signals.map(s => s.summary) } }];
}
