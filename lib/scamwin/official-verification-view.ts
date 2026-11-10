import { observationSchema, type CheckRecord, type Observation } from './contracts';
import {
  officialCatalogSchema, officialObservationDataSchemas,
  type OfficialCatalog, type OfficialCompany, type OfficialCompanyData, type OfficialDestinationData,
  type OfficialDocumentData, type OfficialNextStepData, type OfficialOfferData, type OfficialSource,
  type OfficialStep, type OfficialVerificationData, type OfficialVerificationView, type PublicOfferReference,
} from './official-verification-contracts';
import { isOfficialCompanyCurrent, OFFICIAL_REVIEW_MS, resolveOfficialCompany } from './official-source-catalog';
import { buildOfficialNavigationUrl, buildOfficialReadUrl, isWithinOfficialSource } from './official-source-policy';

const LISTING_CURRENT_MS = 6 * 60 * 60 * 1000;
type DataByKind = {
  official_company: OfficialCompanyData; official_destination: OfficialDestinationData;
  official_document: OfficialDocumentData; official_offer: OfficialOfferData;
  official_verification: OfficialVerificationData; official_next_step: OfficialNextStepData;
};
type Kind = keyof DataByKind;
type Saved<K extends Kind = Kind> = { observation: Observation; data: DataByKind[K]; kind: K };
type Records = { [K in Kind]: Saved<K>[] };
const unavailable = { status: 'unavailable' } as const;
const ms = (value: string) => Date.parse(value);

function savedRecords(check: CheckRecord, observations: Observation[], now: Date): Records {
  const records: Records = { official_company: [], official_destination: [], official_document: [], official_offer: [], official_verification: [], official_next_step: [] };
  const counts = new Map<string, number>();
  for (const row of observations) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  for (const value of observations) {
    const envelope = observationSchema.safeParse(value);
    if (!envelope.success) continue;
    const row = envelope.data;
    if (counts.get(row.id) !== 1 || row.checkId !== check.id || row.runId !== check.runId || row.sourceKind !== 'official_source'
      || ms(row.observedAt) > now.getTime() || ms(row.observedAt) < ms(check.createdAt)
      || !Object.hasOwn(officialObservationDataSchemas, row.kind)) continue;
    const kind = row.kind as Kind;
    const data = officialObservationDataSchemas[kind].safeParse(row.data);
    if (data.success) (records[kind] as Saved[]).push({ observation: row, kind, data: data.data });
  }
  return records;
}

const allRecords = (records: Records): Saved[] => Object.values(records).flat();
function supporting(records: Records, row: Saved, ids: string[]): Saved[] | null {
  if (!ids.length || new Set(ids).size !== ids.length || ids.includes(row.observation.id)) return null;
  const found = ids.map(id => allRecords(records).find(candidate => candidate.observation.id === id));
  if (found.some(candidate => !candidate || candidate.kind === 'official_next_step'
    || candidate.data.catalogVersion !== row.data.catalogVersion || candidate.data.companyId !== row.data.companyId)) return null;
  return found as Saved[];
}

function catalogCompany(catalog: OfficialCatalog, data: OfficialCompanyData | undefined): OfficialCompany | null {
  if (!data?.companyId) return null;
  return catalog.companies.find(company => company.id === data.companyId) ?? null;
}
function companyAuthority(catalog: OfficialCatalog, record: Saved<'official_company'> | undefined, now: Date): OfficialCompany | null {
  if (!record || record.data.companyStatus !== 'recognized' || record.observation.status !== 'observed' || record.data.catalogVersion !== catalog.version) return null;
  const company = catalogCompany(catalog, record.data);
  if (!company || !isOfficialCompanyCurrent(company, now) || record.data.reviewedAt !== company.reviewedAt
    || record.data.reviewEvidenceUrl !== company.reviewEvidenceUrl || ms(company.reviewedAt) > ms(record.observation.observedAt)
    || record.data.sourceIds.some(id => !company.sources.some(source => source.id === id))
    || resolveOfficialCompany(record.data.name, catalog, now).company?.id !== company.id) return null;
  return company;
}

function reference(data: OfficialNextStepData): PublicOfferReference | null | undefined {
  const fields = [data.referenceKind, data.referenceValue, data.referenceOrigin];
  if (fields.every(value => value === null)) return null;
  if (fields.some(value => value === null)) return undefined;
  return { kind: data.referenceKind!, value: data.referenceValue!, origin: data.referenceOrigin! };
}
function validDocument(row: Saved<'official_document'>, source: OfficialSource, publicReference: PublicOfferReference | null, now: Date): boolean {
  const expected = buildOfficialReadUrl(source, publicReference);
  return expected !== null && row.data.sourceId === source.id && row.data.readUrl === expected
    && row.data.finalReadUrl !== null && isWithinOfficialSource(row.data.finalReadUrl, source, 'read')
    && ms(row.data.fetchedAt) <= ms(row.observation.observedAt) && ms(row.data.fetchedAt) <= now.getTime();
}
function offerDocuments(records: Records, row: Saved<'official_offer'>): Saved<'official_document'>[] | null {
  const cited = supporting(records, row, row.data.basedOnEvidenceIds);
  if (!cited) return null;
  const documents = cited.filter(candidate => candidate.kind === 'official_document') as Saved<'official_document'>[];
  return documents.length ? documents : null;
}
function eligibleCheck(check: CheckRecord, now: Date): boolean {
  return ['completed', 'partial'].includes(check.state) && !check.cancelRequestedAt
    && Number.isFinite(ms(check.createdAt)) && ms(check.createdAt) <= now.getTime()
    && Number.isFinite(ms(check.expiresAt)) && ms(check.expiresAt) > now.getTime();
}

function resolveSavedStep(check: CheckRecord, records: Records, row: Saved<'official_next_step'>, catalog: OfficialCatalog, now: Date): OfficialStep | null {
  const companyRow = records.official_company.length === 1 ? records.official_company[0] : undefined;
  const company = companyAuthority(catalog, companyRow, now), data = row.data;
  if (!eligibleCheck(check, now) || !company || data.companyId !== company.id || data.catalogVersion !== catalog.version
    || row.observation.status !== 'observed' || records.official_next_step.filter(candidate => candidate.data.stepId === data.stepId).length !== 1) return null;
  const source = company.sources.find(candidate => candidate.id === data.sourceId);
  const publicReference = reference(data);
  if (!source || publicReference === undefined) return null;
  const expected = buildOfficialNavigationUrl(source, publicReference, data.purpose);
  if (!expected || expected !== data.canonicalUrl || expected !== row.observation.data.canonicalUrl
    || new URL(expected).hostname !== data.hostname || !isWithinOfficialSource(expected, source, 'navigation')) return null;
  const cited = supporting(records, row, data.evidenceIds);
  if (!cited || cited.some(candidate => candidate.observation.status !== 'observed')) return null;
  let expiryLimit = Math.min(ms(company.reviewedAt) + OFFICIAL_REVIEW_MS, ms(check.expiresAt));
  if (data.purpose === 'listing') {
    if (data.basis !== 'live_listing' || !publicReference) return null;
    const offerRows = cited.filter(candidate => candidate.kind === 'official_offer') as Saved<'official_offer'>[];
    if (offerRows.length !== 1) return null;
    const offer = offerRows[0];
    if (!['matched_public_reference', 'details_differ'].includes(offer.data.offerStatus) || offer.data.sourceId !== source.id
      || offer.data.referenceKind !== publicReference.kind || offer.data.referenceValue !== publicReference.value
      || offer.data.canonicalListingUrl !== expected) return null;
    const documents = offerDocuments(records, offer);
    if (!documents || documents.length !== 1) return null;
    const document = documents[0];
    if (document.observation.status !== 'observed' || document.data.responseStatus !== 'ok'
      || !validDocument(document, source, publicReference, now)) return null;
    expiryLimit = Math.min(expiryLimit, ms(document.data.fetchedAt) + LISTING_CURRENT_MS);
    if (offer.data.validThrough !== null) expiryLimit = Math.min(expiryLimit, ms(offer.data.validThrough));
  } else {
    if (publicReference !== null || data.basis === 'live_listing' || data.purpose !== source.purpose) return null;
    if (data.basis === 'reviewed_entry' && !cited.some(candidate => candidate.observation.id === companyRow?.observation.id)) return null;
    if (data.basis === 'live_entry') {
      const documents = cited.filter(candidate => candidate.kind === 'official_document') as Saved<'official_document'>[];
      if (!documents.some(document => document.observation.status === 'observed' && document.data.responseStatus === 'ok'
        && validDocument(document, source, null, now))) return null;
    }
  }
  if (ms(data.expiresAt) > expiryLimit || ms(data.expiresAt) <= now.getTime()) return null;
  return { stepId: data.stepId, sourceId: data.sourceId, purpose: data.purpose, label: data.label, hostname: data.hostname,
    canonicalUrl: expected, publicReference, evidenceIds: data.evidenceIds, catalogVersion: data.catalogVersion, expiresAt: data.expiresAt, basis: data.basis };
}

/** Resolves only saved, current-run evidence; it never reads a source or follows a saved arbitrary URL. */
export function resolveOfficialStep(check: CheckRecord, observations: Observation[], stepId: string, catalog: OfficialCatalog, now: Date): { status: 'ready'; url: string } | { status: 'unavailable' } {
  const parsedCatalog = officialCatalogSchema.safeParse(catalog);
  if (!parsedCatalog.success || !Number.isFinite(now.getTime())) return unavailable;
  const records = savedRecords(check, observations, now);
  const rows = records.official_next_step.filter(row => row.data.stepId === stepId);
  if (rows.length !== 1) return unavailable;
  const step = resolveSavedStep(check, records, rows[0], parsedCatalog.data, now);
  return step ? { status: 'ready', url: step.canonicalUrl } : unavailable;
}

/** Pure historical projection. All URL strings in the DTO are inert data; navigation uses opaque step IDs. */
export function deriveOfficialVerification(check: CheckRecord, observations: Observation[], catalog: OfficialCatalog, now: Date): OfficialVerificationView {
  const parsedCatalog = officialCatalogSchema.safeParse(catalog);
  const currentCatalog = parsedCatalog.success ? parsedCatalog.data : { version: '', companies: [] };
  const records = savedRecords(check, observations, now);
  const companyRow = records.official_company.length === 1 ? records.official_company[0] : undefined;
  const company = companyAuthority(currentCatalog, companyRow, now);
  const companyStatus = companyRow?.data.companyStatus === 'recognized' && !company ? 'expired' : companyRow?.data.companyStatus ?? 'not_claimed';
  const destination = records.official_destination.length === 1 ? records.official_destination[0] : undefined;
  let destinationStatus = destination?.data.destinationStatus ?? 'not_provided';
  if (['first_party_source', 'reviewed_delegate'].includes(destinationStatus)) {
    const source = company?.sources.find(candidate => candidate.id === destination?.data.sourceId);
    const expectedStatus = company?.firstPartyHosts.includes(destination?.data.hostname ?? '') ? 'first_party_source' : 'reviewed_delegate';
    if (!source || !isWithinOfficialSource(check.input.url, source, 'navigation') || new URL(check.input.url).hostname !== destination?.data.hostname
      || destinationStatus !== expectedStatus) destinationStatus = 'unrecognized';
  }
  const offerRow = records.official_offer.length === 1 ? records.official_offer[0] : undefined;
  let offerStatus = offerRow?.data.offerStatus ?? 'unavailable';
  const documents = offerRow ? offerDocuments(records, offerRow) : null;
  if (['matched_public_reference', 'details_differ', 'explicitly_closed'].includes(offerStatus)) {
    const source = currentCatalog.companies.flatMap(candidate => candidate.sources).find(candidate => candidate.id === offerRow?.data.sourceId && candidate.companyId === offerRow?.data.companyId);
    const publicReference = offerRow?.data.referenceKind && offerRow.data.referenceValue ? { kind: offerRow.data.referenceKind, value: offerRow.data.referenceValue, origin: 'explicit_field' as const } : null;
    if (!source || !publicReference || !documents?.some(document => document.observation.status === 'observed' && document.data.responseStatus === 'ok'
      && validDocument(document, source, publicReference, now))) offerStatus = 'unavailable';
  }
  const validDocuments = records.official_document.filter(row => ms(row.data.fetchedAt) >= ms(check.createdAt)
    && ms(row.data.fetchedAt) <= ms(row.observation.observedAt) && ms(row.data.fetchedAt) <= now.getTime()
    && currentCatalog.companies.some(candidate => candidate.id === row.data.companyId && candidate.sources.some(source => source.id === row.data.sourceId)));
  // An entry read must not lend its more recent timestamp to a saved exact-listing fact.
  const relevantDocuments = documents?.length ? documents.filter(row => validDocuments.includes(row)) : validDocuments;
  const checkedAt = relevantDocuments.map(row => row.data.fetchedAt).sort().at(0) ?? null;
  const anyLive = relevantDocuments.some(row => ['ok', 'not_found'].includes(row.data.responseStatus));
  const fresh = anyLive && company !== null && relevantDocuments.every(row => row.data.catalogVersion === currentCatalog.version)
    && checkedAt !== null && now.getTime() < ms(checkedAt) + LISTING_CURRENT_MS;
  const freshness = fresh ? 'fresh' : anyLive ? 'stale' : company ? 'reference_only' : 'not_checked';
  const summary = records.official_verification.length === 1 ? records.official_verification[0] : undefined;
  const summaryCitations = summary ? supporting(records, summary, summary.data.basedOnEvidenceIds) : null;
  const explanation = summary && summaryCitations && summary.data.companyStatus === companyStatus && summary.data.destinationStatus === destinationStatus && summary.data.offerStatus === offerStatus
    ? summary.data.explanation
    : companyStatus === 'recognized' ? 'Reviewed company sources are available. Public listing evidence does not verify the sender or the requested action.'
      : 'Use independently located company contact details to verify this offer. No current reviewed company route is available.';
  const steps = parsedCatalog.success && eligibleCheck(check, now)
    ? records.official_next_step.map(row => resolveSavedStep(check, records, row, currentCatalog, now)).filter((step): step is OfficialStep => step !== null)
      .filter((step, index, list) => list.findIndex(candidate => candidate.canonicalUrl === step.canonicalUrl) === index).slice(0, 2)
      .map(step => ({ stepId: step.stepId, sourceId: step.sourceId, purpose: step.purpose, label: step.label, hostname: step.hostname,
        publicReference: step.publicReference, evidenceIds: step.evidenceIds, catalogVersion: step.catalogVersion, expiresAt: step.expiresAt, basis: step.basis }))
    : [];
  return {
    company: { status: companyStatus, name: companyRow?.data.name ?? null, evidenceIds: companyRow ? [companyRow.observation.id] : [] },
    destination: { status: destinationStatus, hostname: destination?.data.hostname ?? null, evidenceIds: destination ? [destination.observation.id] : [] },
    offer: { status: offerStatus, sourceId: offerRow?.data.sourceId ?? null, reference: offerRow?.data.referenceValue ?? null,
      title: offerRow?.data.title ?? null, location: offerRow?.data.location ?? null, validThrough: offerRow?.data.validThrough ?? null,
      quote: offerRow?.data.quote ?? null, differingFields: offerRow?.data.differingFields ?? [], reasonCode: offerRow?.data.reasonCode ?? 'not_checked',
      evidenceIds: offerRow ? [offerRow.observation.id, ...(documents?.map(row => row.observation.id) ?? [])] : [] },
    freshness, checkedAt, explanation, sourceEvidenceIds: validDocuments.map(row => row.observation.id), steps,
  };
}
