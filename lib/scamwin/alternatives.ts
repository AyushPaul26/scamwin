import type { CheckRecord, Observation } from './contracts';
import { officialCatalogSchema, officialDocumentDataSchema, type OfficialCatalog, type OfficialStep, type OfficialVerificationView } from './official-verification-contracts';
import { deriveOfficialVerification, resolveOfficialStep } from './official-verification-view';

export type AlternativeGoal = 'recruitment' | 'recruitment_support' | 'shopping' | 'refund' | 'application' | 'identity_request' | 'unknown';
export type AlternativeProjection = {
  purpose: AlternativeGoal; stepPurpose: OfficialStep['purpose']; stepId: string; sourceId: string;
  label: string; hostname: string; relationship: 'first_party' | 'reviewed_delegate';
  authorityEvidenceIds: string[]; reviewedAt: string; fetchedAt: string | null;
  expiresAt: string; basis: OfficialStep['basis']; catalogVersion: string;
};
export type ReviewedAlternativeEvidence = {
  check: CheckRecord; observations: readonly Observation[]; verification: OfficialVerificationView;
};

/** Intent selects a purpose, never an authority or a destination. No source is fetched here.
 * Ownership remains enforced by the private read and the existing click-time server gate.
 */
export function projectReviewedAlternatives(goal: AlternativeGoal, evidence: ReviewedAlternativeEvidence, catalog: OfficialCatalog, now: Date): AlternativeProjection[] {
  if (!['recruitment', 'recruitment_support'].includes(goal) || !Number.isFinite(now.getTime())) return [];
  const parsed = officialCatalogSchema.safeParse(catalog);
  if (!parsed.success) return [];
  const observations = [...evidence.observations];
  // Recheck saved authority instead of trusting a previously rendered or model-created view.
  const current = deriveOfficialVerification(evidence.check, observations, parsed.data, now);
  if (current.company.status !== 'recognized') return [];
  return current.steps.flatMap(step => {
    if (!evidence.verification.steps.some(saved => saved.stepId === step.stepId)
      || !(goal === 'recruitment' ? ['listing', 'careers', 'support'] : ['support']).includes(step.purpose)) return [];
    const resolved = resolveOfficialStep(evidence.check, observations, step.stepId, parsed.data, now);
    const company = parsed.data.companies.find(candidate => candidate.sources.some(source => source.id === step.sourceId));
    if (resolved.status !== 'ready' || !company?.offerTypes.includes('recruitment')) return [];
    const cited = new Set([...step.evidenceIds, ...(step.purpose === 'listing' ? current.offer.evidenceIds : [])]);
    const documents = step.basis === 'reviewed_entry' ? [] : observations.flatMap(row => {
      if (row.kind !== 'official_document' || !cited.has(row.id) || !current.sourceEvidenceIds.includes(row.id)) return [];
      const data = officialDocumentDataSchema.safeParse(row.data);
      return data.success && data.data.sourceId === step.sourceId && data.data.responseStatus === 'ok' ? [{ id: row.id, fetchedAt: data.data.fetchedAt }] : [];
    });
    if (step.basis !== 'reviewed_entry' && documents.length === 0) return [];
    return [{ purpose: goal, stepPurpose: step.purpose, stepId: step.stepId, sourceId: step.sourceId,
      label: step.label, hostname: step.hostname, relationship: company.firstPartyHosts.includes(step.hostname) ? 'first_party' as const : 'reviewed_delegate' as const,
      authorityEvidenceIds: [...new Set([...current.company.evidenceIds, ...step.evidenceIds, ...documents.map(document => document.id)])],
      reviewedAt: company.reviewedAt, fetchedAt: documents.map(document => document.fetchedAt).sort().at(0) ?? null,
      expiresAt: step.expiresAt, basis: step.basis, catalogVersion: step.catalogVersion }];
  });
}

/** Optional view-time enrichment; v1 saved observations and the original feature stay unchanged. */
export function withReviewedAlternatives(evidence: ReviewedAlternativeEvidence, catalog: OfficialCatalog, now: Date, env: Record<string, string | undefined>): OfficialVerificationView {
  if (env.SCAMWIN_ALTERNATIVES_ENABLED !== 'true') return evidence.verification;
  // References identify resources, not intent. Exclude submitted references and
  // URL tokens wherever they occur before interpreting the remaining prose.
  const input = evidence.check.input;
  let content = `${input.promisedBenefit} ${input.message}`.toLowerCase();
  for (const reference of [input.url, input.offerReference]) {
    if (reference?.trim()) content = content.split(reference.trim().toLowerCase()).join(' ');
  }
  content = content.replace(/\b(?:[a-z][a-z\d+.-]*:|www\.)[^\s<>"']+|\b(?:[a-z\d-]+\.)+[a-z]{2,}(?:[/?#][^\s<>"']*)?/g, ' ');
  const goal: AlternativeGoal = /\b(refund|reimbursement)\b/i.test(content) ? 'refund'
    : /\b(KYC|identity verification)\b/i.test(content) ? 'identity_request'
    : /\b(shopping|purchase|order|delivery|discount)\b/i.test(content) ? 'shopping'
    : /\b(job|recruitment|recruiter|internship|hiring|vacancy|career)\b/i.test(content) ? 'recruitment' : 'unknown';
  return { ...evidence.verification, alternatives: projectReviewedAlternatives(goal, evidence, catalog, now) };
}
