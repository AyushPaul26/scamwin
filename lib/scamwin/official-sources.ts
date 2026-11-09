import type { Observation, OfferIntent } from './contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const referenceSchema = z.array(z.object({ organization: z.string().min(1).max(500), hostname: z.string().min(1).max(253), referenceUrl: z.string().url().max(4096), reviewedAt: z.string().datetime() }).strict()).max(100);
export function officialIdentity(intent: OfferIntent, url: string, source: { checkId: string; runId: string }, env: Record<string, string | undefined> = process.env): Observation[] {
  if (!intent.claimedOrganization || !url) return [];
  let references: z.infer<typeof referenceSchema> = [];
  try { references = referenceSchema.parse(JSON.parse(env.SCAMWIN_OFFICIAL_SOURCES_JSON || '[]')); } catch { /* Invalid configuration never establishes identity. */ }
  const reference = references.find(item => item.organization.toLowerCase() === intent.claimedOrganization?.toLowerCase() && Date.now() - Date.parse(item.reviewedAt) >= 0 && Date.now() - Date.parse(item.reviewedAt) < 30 * 86400000);
  const common = { ...source, sourceKind: 'official_source' as const, observedAt: new Date().toISOString(), collectorVersion: 'curated-reference-1', policyVersion: 'scamwin-fixture-v1' };
  if (!reference) return [{ ...common, id: randomUUID(), kind: 'official_identity', status: 'not_checked', sourceRef: 'curated-reference-list', data: { reason: 'No current, manually reviewed official reference is configured for the claimed organization.' } }];
  const matches = new URL(url).hostname.toLowerCase() === reference.hostname.toLowerCase();
  return [{ ...common, id: randomUUID(), kind: matches ? 'official_identity' : 'identity_mismatch', status: 'observed', sourceRef: reference.referenceUrl, data: { verified: matches, organization: reference.organization, officialHostname: reference.hostname, reviewedAt: reference.reviewedAt, description: matches ? 'The selected hostname matches the manually curated official reference. This does not validate the offer itself.' : 'The selected hostname differs from the manually curated official reference for the claimed organization. An authorized third party is still possible; verify independently.' } }];
}
