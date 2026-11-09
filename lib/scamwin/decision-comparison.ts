import type { Assessment, CheckRecord, Observation } from './contracts';

export type DecisionProvenance = 'user_stated' | 'extracted' | 'observed' | 'inferred' | 'unknown';
export type DecisionField = { text: string; provenance: DecisionProvenance; evidenceIds: string[]; quote?: string };
export type DecisionComparison = {
  promise: DecisionField; intention: DecisionField; request: DecisionField; observedDestination: DecisionField;
  mismatch: { text: string; classification: Assessment['findings'][number]['classification']; evidenceIds: string[] } | null;
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const unknown = (label: string): DecisionField => ({ text: label, provenance: 'unknown', evidenceIds: [] });
const actionLabels: Record<string, string> = {
  receive_money: 'Receive money', pay_money: 'Send or pay money', share_information: 'Share information',
  read_information: 'Read information', other: 'Something else / unsure',
};
const actionLabel = (value: string) => actionLabels[value] || value;
function observedHost(value: unknown): string {
  try {
    const url = new URL(text(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.host : '';
  } catch { return ''; }
}

/** A cited restatement of saved evidence. It never assesses or changes risk. */
export function deriveDecisionComparison(check: CheckRecord, observations: readonly Observation[]): DecisionComparison {
  const saved = observations.filter(o => o.checkId === check.id && o.runId === check.runId && o.status === 'observed');
  const live = saved.filter(o => o.sourceKind === 'live_page');
  const submission = saved.find(o => o.kind === 'submitted_offer' && o.sourceKind === 'user_text');
  const promise = text(check.input.promisedBenefit), intention = text(check.input.intendedAction);
  const extractedPromise = text(check.intent?.promisedBenefit), inferredIntention = text(check.intent?.intendedAction);
  const result: DecisionComparison = {
    promise: promise ? { text: promise, provenance: 'user_stated', evidenceIds: submission && submission.data.promisedBenefit === check.input.promisedBenefit ? [submission.id] : [] }
      : extractedPromise ? { text: extractedPromise, provenance: 'extracted', evidenceIds: [] } : unknown('Promise not established'),
    intention: intention ? { text: actionLabel(intention), provenance: 'user_stated', evidenceIds: submission && submission.data.intendedAction === check.input.intendedAction ? [submission.id] : [] }
      : inferredIntention ? { text: actionLabel(inferredIntention), provenance: 'inferred', evidenceIds: [] } : unknown('Intended action not stated'),
    request: unknown('Request not observed'), observedDestination: unknown('Destination not observed'), mismatch: null,
  };
  const payment = live.find(o => o.kind === 'payment_action' && o.data.selectedCheckpoint === true && o.data.direction === 'outgoing');
  const sensitive = live.find(o => o.kind === 'sensitive_request');
  const form = live.find(o => o.kind === 'form_destinations' && Array.isArray(o.data.destinations) && o.data.destinations.length > 0);
  // The interpretation and its actual page record must both exist in this run.
  const semantic = live.find(o => o.kind === 'semantic_mismatch' && text(o.data.description)
    && live.some(base => base.id === o.data.basedOnEvidenceId && base.kind !== 'semantic_mismatch'));
  if (payment) {
    const amount = typeof payment.data.amount === 'number' || typeof payment.data.amount === 'string' ? String(payment.data.amount) : '';
    const amountText = /^\d+(?:\.\d+)?$/.test(amount) && Number(amount) > 0 ? ` of ${amount}${text(payment.data.currency) ? ` ${text(payment.data.currency)}` : ''}` : '';
    const recipient = text(payment.data.recipient);
    result.request = { text: `Outgoing payment${amountText}${recipient ? ` to ${recipient}` : ''} requested. No payment was made.`, provenance: 'observed', evidenceIds: [payment.id], ...(text(payment.data.quote) ? { quote: text(payment.data.quote) } : {}) };
    if (recipient) result.observedDestination = { text: recipient, provenance: 'observed', evidenceIds: [payment.id] };
  } else if (sensitive) {
    result.request = { text: 'A password or one-time code field was observed. No values were entered.', provenance: 'observed', evidenceIds: [sensitive.id] };
  } else if (form) {
    result.request = { text: 'A form was observed. No submission was performed.', provenance: 'observed', evidenceIds: [form.id] };
  } else if (semantic) {
    result.request = { text: text(semantic.data.description), provenance: 'inferred', evidenceIds: [semantic.id, text(semantic.data.basedOnEvidenceId)], ...(text(semantic.data.quote) ? { quote: text(semantic.data.quote) } : {}) };
  }
  if (result.observedDestination.provenance === 'unknown') {
    const page = live.find(o => o.kind === 'page' && observedHost(o.data.finalUrl));
    if (page) result.observedDestination = { text: observedHost(page.data.finalUrl), provenance: 'observed', evidenceIds: [page.id] };
  }
  const finding = check.assessment?.findings.find(f =>
    (payment && f.id === 'payment-direction' && f.classification === 'observation' && f.evidenceIds.includes(payment.id))
    || (semantic && f.classification === 'inference' && f.evidenceIds.includes(semantic.id)));
  if (finding) {
    const evidenceIds = finding.evidenceIds.filter(id => saved.some(o => o.id === id));
    if (semantic && evidenceIds.includes(semantic.id)) evidenceIds.push(text(semantic.data.basedOnEvidenceId));
    result.mismatch = { text: finding.statement, classification: finding.classification, evidenceIds: [...new Set(evidenceIds)] };
  }
  return result;
}
