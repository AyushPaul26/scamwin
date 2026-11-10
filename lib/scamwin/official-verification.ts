import { observationSchema, type CheckInput, type Observation, type OfferIntent } from './contracts';
import { resolveOfficialCompany, OFFICIAL_REVIEW_MS } from './official-source-catalog';
import { buildOfficialNavigationUrl, buildOfficialReadUrl, isWithinOfficialSource } from './official-source-policy';
import { interpretOfficialOffer } from './official-offer-adapters';
import { officialCatalogSchema, officialObservationDataSchemas, offerTypeSchema, parseOfficialUrl, type DestinationStatus, type OfficialCatalog, type OfficialClaim, type OfficialDocument, type OfficialOfferFact, type OfficialReader, type OfficialScope, type OfficialSource, type OfficialStep, type PublicOfferReference } from './official-verification-contracts';

export const OFFICIAL_LISTING_MS = 6 * 60 * 60 * 1000;
const safeCatalog = (catalog: OfficialCatalog): OfficialCatalog => officialCatalogSchema.safeParse(catalog).success ? catalog : { version: 'invalid-catalog', companies: [] };

function publicListingReference(value: string, origin: PublicOfferReference['origin'], catalog: OfficialCatalog): PublicOfferReference | null {
  let url = parseOfficialUrl(value);
  // Some public Greenhouse links repeat their numeric post ID in gh_jid. Only
  // this exact public identity may be removed; private/arbitrary queries fail.
  if (!url) {
    try {
      const candidate = new URL(value);
      if ([...candidate.searchParams.keys()].length !== 1 || candidate.searchParams.getAll('gh_jid').length !== 1) return null;
      const id = /\/jobs\/([0-9]{1,120})$/.exec(candidate.pathname)?.[1];
      if (!id || candidate.searchParams.get('gh_jid') !== id) return null;
      candidate.search = '';
      url = parseOfficialUrl(candidate.href);
      if (!url || !catalog.companies.some(company => company.sources.some(source => source.kind === 'greenhouse_job' && buildOfficialNavigationUrl(source, { kind: 'canonical_listing_url', value: url!.href, origin }, 'listing') === url!.href))) return null;
    } catch { return null; }
  }
  const reference: PublicOfferReference = { kind: 'canonical_listing_url', value: url.href, origin };
  return catalog.companies.some(company => company.sources.some(source => source.kind !== 'official_entry' && buildOfficialNavigationUrl(source, reference, 'listing'))) ? reference : null;
}

export function deriveOfficialClaim(input: CheckInput, intent: OfferIntent | null, rawCatalog: OfficialCatalog): OfficialClaim {
  const catalog = safeCatalog(rawCatalog), explicit = input.claimedCompany?.trim().slice(0, 200) || null;
  let organizationName = explicit || intent?.claimedOrganization?.trim().slice(0, 200) || null;
  const uncertainties = (intent?.uncertainties ?? []).slice(0, 18);
  if (explicit && intent?.claimedOrganization && explicit.toLowerCase() !== intent.claimedOrganization.toLowerCase()) uncertainties.push('The explicit company name differs from the extracted claim. The explicit value was used as a claim, not proof.');
  const referenceText = input.offerReference?.trim() ?? '';
  const publicReference: PublicOfferReference | null = referenceText
    ? /^[0-9]{1,120}$/.test(referenceText) ? { kind: 'greenhouse_post_id', value: referenceText, origin: 'explicit_field' } : publicListingReference(referenceText, 'explicit_field', catalog)
    : publicListingReference(input.url, 'submitted_url', catalog);
  if (!organizationName && publicReference?.kind === 'canonical_listing_url') {
    const matches = catalog.companies.filter(company => company.sources.some(source => source.kind !== 'official_entry' && buildOfficialNavigationUrl(source, publicReference, 'listing')));
    if (matches.length === 1) organizationName = matches[0].name;
  }
  const candidates = intent?.extractedCandidates.filter(candidate => ['user_text', 'user_image'].includes(candidate.sourceRef)) ?? [];
  const type = offerTypeSchema.safeParse(candidates.find(candidate => candidate.kind === 'offer_type')?.value);
  const content = `${input.message} ${input.promisedBenefit}`;
  const offerType = type.success ? type.data : publicReference || /\b(job|recruitment|recruiter|internship|hiring|vacancy)\b/i.test(content) ? 'recruitment' : /\brefund\b/i.test(content) ? 'refund' : /\b(KYC|identity verification)\b/i.test(content) ? 'identity_request' : 'unclear';
  const candidateValue = (kind: string, max: number) => candidates.find(candidate => candidate.kind === kind)?.value.trim().slice(0, max) || null;
  if (referenceText && !publicReference) uncertainties.push('The reference was not a supported public listing link or numeric posting ID. It was not sent to a source.');
  return { organizationName, offerType, publicReference, title: candidateValue('job_title', 200), location: candidateValue('job_location', 300), uncertainties: uncertainties.slice(0, 20) };
}

type VerificationArgs = { input: CheckInput; intent: OfferIntent | null; scope: OfficialScope; signal: AbortSignal; pipelineDeadlineAtMs: number; checkExpiresAt?: string };
type VerificationDeps = { catalog: OfficialCatalog; reader: OfficialReader; now: () => Date; makeId: () => string };

/** Server worker only. No external lookup is selected from AI-created URLs. */
export async function verifyOfficialOffer(args: VerificationArgs, deps: VerificationDeps): Promise<Observation[]> {
  args.signal.throwIfAborted();
  const catalog = safeCatalog(deps.catalog), now = deps.now(), claim = deriveOfficialClaim(args.input, args.intent, catalog);
  const resolved = resolveOfficialCompany(claim.organizationName, catalog, now), company = resolved.company;
  const records: Observation[] = [];
  const shared = { schemaVersion: 1, catalogVersion: catalog.version, companyId: company?.id ?? null, reasonCode: null };
  function add(kind: keyof typeof officialObservationDataSchemas, data: Observation['data'], status: Observation['status'] = 'observed', sourceRef = `catalog:${catalog.version}`): Observation {
    args.signal.throwIfAborted();
    const parsed = officialObservationDataSchemas[kind].parse({ ...shared, ...data });
    const observation = observationSchema.parse({ id: deps.makeId(), ...args.scope, kind, sourceKind: 'official_source', sourceRef, status, observedAt: deps.now().toISOString(), collectorVersion: 'scamwin-official-1', policyVersion: 'scamwin-official-v1', data: parsed });
    records.push(observation); return observation;
  }
  const companyRecord = add('official_company', { companyStatus: resolved.status, name: company?.name ?? claim.organizationName, reviewedAt: company?.reviewedAt ?? null, reviewEvidenceUrl: company?.reviewEvidenceUrl ?? null, sourceIds: company?.sources.map(source => source.id) ?? [], reasonCode: resolved.status }, company ? 'observed' : 'not_checked');
  let hostname: string | null = null;
  try { hostname = args.input.url ? new URL(args.input.url).hostname : null; } catch { /* Invalid input never establishes a destination. */ }
  const destinationSource = company?.sources.find(source => isWithinOfficialSource(args.input.url, source, 'navigation'));
  const destinationStatus: DestinationStatus = !hostname ? 'not_provided' : destinationSource ? company!.firstPartyHosts.includes(hostname) ? 'first_party_source' : 'reviewed_delegate' : company?.firstPartyHosts.includes(hostname) ? 'known_domain_unreviewed_path' : 'unrecognized';
  const destinationRecord = add('official_destination', { destinationStatus, hostname, sourceId: destinationSource?.id ?? null }, hostname ? 'observed' : 'not_applicable');
  let fact: OfficialOfferFact = { status: claim.offerType === 'recruitment' ? 'reference_needed' : 'not_publicly_verifiable', sourceId: null, reference: claim.publicReference?.value ?? null, title: null, location: null, validThrough: null, quote: null, canonicalUrl: null, differingFields: [], reasonCode: company ? 'public_reference_needed' : resolved.status };
  if (claim.offerType === 'unclear' && !claim.organizationName) fact = { ...fact, status: 'not_applicable', reasonCode: 'no_public_offer_claim' };
  const documents: { source: OfficialSource; document: OfficialDocument; record: Observation }[] = [];
  const listingSources = company?.sources.filter(source => source.kind !== 'official_entry' && buildOfficialReadUrl(source, claim.publicReference) && claim.publicReference !== null) ?? [];
  const listingSource = listingSources.length === 1 ? listingSources[0] : undefined;
  const purpose = claim.offerType === 'refund' ? 'refund' : claim.offerType === 'identity_request' ? 'identity_help' : claim.offerType === 'recruitment' ? 'careers' : 'support';
  const fallback = company?.sources.find(source => source.kind === 'official_entry' && source.purpose === purpose)
    ?? company?.sources.find(source => source.kind !== 'greenhouse_job' && source.purpose === purpose)
    ?? (claim.offerType === 'recruitment' ? company?.sources.find(source => source.purpose === 'careers') : undefined);
  const canRead = Boolean(company && args.pipelineDeadlineAtMs - now.getTime() >= 55_000);
  const budget = { deadlineAtMs: Math.min(now.getTime() + 20_000, args.pipelineDeadlineAtMs - 35_000), documentsRemaining: 2, requestsRemaining: 4, bytesRemaining: 512 * 1024 };
  const seen = new Set<string>();
  if (company && !canRead) fact = { ...fact, status: 'unavailable', reasonCode: 'finalization_headroom' };
  if (listingSources.length > 1) fact = { ...fact, status: 'reference_needed', reasonCode: 'ambiguous_company_board' };
  const controller = new AbortController();
  const timeout = canRead ? setTimeout(() => controller.abort(), Math.max(0, budget.deadlineAtMs - now.getTime())) : null;
  const signal = AbortSignal.any([args.signal, controller.signal]);
  try {
    if (canRead) for (const source of [listingSource, fallback].filter((item): item is OfficialSource => !!item)) {
      args.signal.throwIfAborted();
      const reference = source === listingSource ? claim.publicReference : null;
      const url = buildOfficialReadUrl(source, reference);
      if (!url || seen.has(url) || documents.length >= 2) continue;
      seen.add(url);
      let document: OfficialDocument;
      try { document = await deps.reader(source, reference, { signal, budget }); }
      catch { args.signal.throwIfAborted(); document = { sourceId: source.id, readUrl: url, finalReadUrl: url, fetchedAt: deps.now().toISOString(), status: 'unavailable', contentType: null, body: null, digest: null, reasonCode: 'source_unavailable' }; }
      args.signal.throwIfAborted();
      if (source === listingSource) {
        const interpreted = interpretOfficialOffer({ ...claim, organizationName: company!.name }, source, document, deps.now());
        // The adapter compares full bounded source fields; only the saved display
        // values are clipped. Canonicalize valid deadlines without changing their
        // instant (a date-only deadline lasts through that entire UTC day).
        const deadline = interpreted.validThrough;
        fact = { ...interpreted, title: interpreted.title?.slice(0, 200) ?? null, location: interpreted.location?.slice(0, 300) ?? null, validThrough: deadline ? new Date(deadline.length === 10 ? `${deadline}T23:59:59.999Z` : deadline).toISOString() : null };
      }
      const record = add('official_document', { sourceId: source.id, readUrl: parseOfficialUrl(document.readUrl)?.href ?? null, finalReadUrl: parseOfficialUrl(document.finalReadUrl)?.href ?? null, fetchedAt: document.fetchedAt, responseStatus: document.status, contentType: document.contentType?.slice(0, 200) ?? null, digest: document.digest, quote: source === listingSource ? fact.quote : null, reasonCode: document.reasonCode }, document.status === 'ok' || document.status === 'not_found' ? 'observed' : document.status);
      documents.push({ source, document, record });
    }
  } finally { if (timeout) clearTimeout(timeout); }
  const offerEvidence = documents.filter(item => item.source === listingSource).map(item => item.record.id);
  const offerRecord = add('official_offer', { offerStatus: fact.status, sourceId: fact.sourceId, referenceKind: claim.publicReference?.kind ?? null, referenceValue: claim.publicReference?.value ?? null, title: fact.title, location: fact.location, validThrough: fact.validThrough, canonicalListingUrl: fact.canonicalUrl, quote: fact.quote, differingFields: fact.differingFields, basedOnEvidenceIds: offerEvidence, reasonCode: fact.reasonCode }, fact.status === 'unavailable' ? 'unavailable' : fact.status === 'reference_needed' || !company ? 'not_checked' : 'observed');
  const checkedAt = documents.find(item => item.source === listingSource)?.document.fetchedAt ?? documents[0]?.document.fetchedAt ?? null;
  const freshness = documents.some(item => item.document.status === 'ok') ? 'fresh' : company ? 'reference_only' : 'not_checked';
  const explanations: Record<string, string> = {
    matched_public_reference: 'A matching public listing was found at the checked time. This does not authenticate the sender or a personal offer, and does not clear risky requests.',
    details_differ: 'The exact public listing was found, but the supplied role or location differs. Review the cited details independently; a difference alone does not prove fraud.',
    explicitly_closed: 'The checked official source states a closure or a deadline that has passed. This does not establish who sent the offer.',
    not_found_in_checked_source: 'This posting was not found in the source that was checked. That does not prove fraud or that the posting never existed.',
    reference_needed: listingSources.length > 1 ? 'More than one reviewed hiring board could apply. Start a new check with the exact public listing link.' : 'Start a new check with the public listing link or posting ID to check this exact offer.',
    not_publicly_verifiable: 'Public instructions cannot confirm personal eligibility or a private offer. Use the reviewed official route to verify independently.',
    unavailable: 'The public offer could not be checked completely. Unavailable coverage is not a positive signal or proof of fraud.',
    not_applicable: 'No supported public offer reference was identified in this submission.',
  };
  add('official_verification', { companyStatus: resolved.status, destinationStatus, offerStatus: fact.status, freshness, checkedAt, explanation: company ? explanations[fact.status] : resolved.status === 'ambiguous' ? 'The company name matches more than one reviewed organization. No official destination was guessed.' : resolved.status === 'expired' ? 'The company source review has expired. No current company or offer confirmation was made.' : 'No current reviewed company source was resolved. Verify the organization independently; no official link was guessed.', basedOnEvidenceIds: [companyRecord.id, destinationRecord.id, ...documents.map(item => item.record.id), offerRecord.id] });
  if (company) {
    const reviewExpiry = Date.parse(company.reviewedAt) + OFFICIAL_REVIEW_MS;
    const checkExpiry = args.checkExpiresAt ? Date.parse(args.checkExpiresAt) : reviewExpiry;
    function step(source: OfficialSource, purpose: OfficialStep['purpose'], basis: OfficialStep['basis'], evidenceIds: string[], reference: PublicOfferReference | null, limit: number) {
      const canonicalUrl = buildOfficialNavigationUrl(source, reference, purpose), expiry = Math.min(reviewExpiry, checkExpiry, limit);
      if (!canonicalUrl || !Number.isFinite(expiry) || expiry <= deps.now().getTime()) return;
      add('official_next_step', { stepId: deps.makeId(), sourceId: source.id, purpose, label: purpose === 'listing' ? 'View the official public listing' : purpose === 'careers' ? 'Visit the reviewed careers page' : 'Visit the reviewed official help page', hostname: new URL(canonicalUrl).hostname, canonicalUrl, referenceKind: reference?.kind ?? null, referenceValue: reference?.value ?? null, referenceOrigin: reference?.origin ?? null, evidenceIds, expiresAt: new Date(expiry).toISOString(), basis });
    }
    const listingDocument = documents.find(item => item.source === listingSource);
    if (listingSource && listingDocument && ['matched_public_reference', 'details_differ'].includes(fact.status)) step(listingSource, 'listing', 'live_listing', [companyRecord.id, listingDocument.record.id, offerRecord.id], claim.publicReference, Math.min(Date.parse(listingDocument.document.fetchedAt) + OFFICIAL_LISTING_MS, fact.validThrough ? Date.parse(fact.validThrough) : Infinity));
    if (fallback) {
      const doc = documents.find(item => item.source === fallback && item.document.status === 'ok' && item.document.readUrl === fallback.entryUrl && item.document.finalReadUrl === fallback.entryUrl);
      step(fallback, fallback.purpose, doc ? 'live_entry' : 'reviewed_entry', [companyRecord.id, ...(doc ? [doc.record.id] : [])], null, Infinity);
    }
  }
  return records;
}
