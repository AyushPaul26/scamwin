import type { CheckInput, CheckRecord, OfferIntent } from '../../lib/scamwin/contracts';
import type { OfficialCatalog, OfficialDocument, OfficialSource } from '../../lib/scamwin/official-verification-contracts';

export const officialNow = new Date('2026-11-10T12:00:00.000Z');
export const officialBoard: OfficialSource = { id: 'example-board', companyId: 'example-company', kind: 'greenhouse_job', purpose: 'careers', entryUrl: 'https://job-boards.greenhouse.io/examplecompany', boardToken: 'examplecompany', listingUrlTemplate: 'https://job-boards.greenhouse.io/examplecompany/jobs/{postId}', delegationEvidenceUrl: 'https://company.example/careers' };
export const officialEntry: OfficialSource = { id: 'example-careers', companyId: 'example-company', kind: 'official_entry', purpose: 'careers', entryUrl: 'https://company.example/careers' };
export const officialFixtureCatalog: OfficialCatalog = { version: 'official-fixture-1', companies: [{ id: 'example-company', name: 'Example Company', aliases: ['Example'], firstPartyHosts: ['company.example'], reviewedAt: '2026-11-10T10:00:00.000Z', reviewEvidenceUrl: 'https://company.example/careers', offerTypes: ['recruitment'], sources: [officialBoard, officialEntry] }] };
export const officialInput: CheckInput = { url: 'https://offer.example/job', message: 'A job invitation from Example Company', claimedCompany: 'Example', offerReference: '12345', promisedBenefit: 'A job', intendedAction: 'share_information', images: [] };
export const officialIntent: OfferIntent = { promisedBenefit: 'A job', claimedOrganization: 'Example Company', intendedAction: 'share_information', requestedActions: [], extractedCandidates: [{ kind: 'offer_type', value: 'recruitment', sourceRef: 'user_text' }], uncertainties: [] };
export const officialFixtureCheck = (): CheckRecord => ({ id: 'official-check', ownerId: 'owner', runId: 'official-run', generation: 1, revision: 1, state: 'completed', createdAt: officialNow.toISOString(), updatedAt: officialNow.toISOString(), expiresAt: '2026-12-10T12:00:00.000Z', submissionKey: 'test', input: structuredClone(officialInput), stages: [] });
export function officialFixtureDocument(source: OfficialSource): OfficialDocument {
  const job = source.kind === 'greenhouse_job';
  const url = job ? 'https://boards-api.greenhouse.io/v1/boards/examplecompany/jobs/12345' : source.entryUrl;
  return { sourceId: source.id, readUrl: url, finalReadUrl: url, status: 'ok', fetchedAt: officialNow.toISOString(), contentType: job ? 'application/json' : 'text/html', body: job ? JSON.stringify({ id: 12345, title: 'Software Engineer', company_name: 'Example Company', location: { name: 'Bengaluru' }, content: 'A published job opening.' }) : '<html><title>Official careers</title></html>', digest: 'a'.repeat(64), reasonCode: null };
}
