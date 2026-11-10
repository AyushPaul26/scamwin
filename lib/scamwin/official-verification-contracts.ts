import { z } from "zod";
import type { AlternativeProjection } from './alternatives';

// This module is browser safe: authority and transport live in separate modules.
export const companyStatusSchema = z.enum(["recognized", "ambiguous", "unlisted", "expired", "not_claimed"]);
export const destinationStatusSchema = z.enum(["first_party_source", "reviewed_delegate", "known_domain_unreviewed_path", "unrecognized", "not_provided"]);
export const offerStatusSchema = z.enum(["matched_public_reference", "details_differ", "explicitly_closed", "not_found_in_checked_source", "reference_needed", "not_publicly_verifiable", "unavailable", "not_applicable"]);
export const freshnessStatusSchema = z.enum(["fresh", "stale", "reference_only", "not_checked"]);
export const offerTypeSchema = z.enum(["recruitment", "refund", "identity_request", "other", "unclear"]);
export const officialPurposeSchema = z.enum(["careers", "support", "refund", "identity_help"]);
export const officialStepPurposeSchema = z.enum(["listing", "careers", "support", "refund", "identity_help"]);
export const publicReferenceKindSchema = z.enum(["greenhouse_post_id", "canonical_listing_url"]);
export const publicReferenceOriginSchema = z.enum(["explicit_field", "submitted_url"]);
export const officialStepBasisSchema = z.enum(["live_listing", "live_entry", "reviewed_entry"]);
export const officialResponseStatusSchema = z.enum(["ok", "not_found", "unavailable", "blocked"]);
export type CompanyStatus = z.infer<typeof companyStatusSchema>;
export type DestinationStatus = z.infer<typeof destinationStatusSchema>;
export type OfferStatus = z.infer<typeof offerStatusSchema>;
export type FreshnessStatus = z.infer<typeof freshnessStatusSchema>;
export type OfferType = z.infer<typeof offerTypeSchema>;

const idSchema = z.string().min(1).max(120);
const text200 = z.string().min(1).max(200);
const isoTime = z.string().datetime();
const idsSchema = z.array(idSchema).max(8);
const publicHost = (host: string) => host.length <= 253 && host.includes(".") && !/^\d+(?:\.\d+)*$/.test(host) && !/(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(host) && host.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part));

/** Parse an unambiguous, public-shaped HTTPS URL without resolving DNS. */
export function parseOfficialUrl(value: string): URL | null {
  if (!value || value.length > 4096 || /[\s\\?#]/.test(value)) return null;
  // Reject escaped separators, dot segments and nested escapes before WHATWG normalization.
  if (/%(?:2e|2f|5c|25|00)/i.test(value)) return null;
  const rawPath = /^https:\/\/[^/]+(\/.*)?$/i.exec(value)?.[1] ?? "";
  if (rawPath.split("/").some((segment) => segment === "." || segment === "..")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !publicHost(url.hostname) || url.hostname.endsWith(".")) return null;
    return url;
  } catch { return null; }
}

export const officialUrlSchema = z.string().max(4096).refine((value) => parseOfficialUrl(value) !== null, "Use an exact public HTTPS URL without credentials, queries, fragments or escaped path separators.").transform((value) => parseOfficialUrl(value)!.href);
export const officialHostnameSchema = z.string().min(1).max(253).transform((value, ctx) => {
  if (/[\s\/:@?#\\]/.test(value)) { ctx.addIssue({ code: "custom", message: "Use a hostname only." }); return z.NEVER; }
  const parsed = parseOfficialUrl(`https://${value}/`);
  if (!parsed) { ctx.addIssue({ code: "custom", message: "Use a public hostname." }); return z.NEVER; }
  return parsed.hostname;
});
const originSchema = officialUrlSchema.refine((value) => new URL(value).pathname === "/", "Use an exact HTTPS origin.").transform((value) => new URL(value).origin);
const pathPrefixSchema = z.string().min(1).max(4096).refine((value) => value.startsWith("/") && !value.includes("//") && parseOfficialUrl(`https://scope.example${value}`)?.pathname === value, "Use a literal path prefix.");
const listingTemplateSchema = z.string().min(1).max(4096).refine((value) => value.split("{postId}").length === 2 && !/[{}]/.test(value.replace("{postId}", "")) && parseOfficialUrl(value.replace("{postId}", "12345")) !== null, "Use one numeric {postId} placeholder in an exact public listing URL.");
const sourceFields = { id: idSchema, companyId: idSchema, entryUrl: officialUrlSchema, purpose: officialPurposeSchema };
const officialEntrySchema = z.object({ ...sourceFields, kind: z.literal("official_entry") }).strict();
const greenhouseSourceSchema = z.object({ ...sourceFields, kind: z.literal("greenhouse_job"), boardToken: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/), listingUrlTemplate: listingTemplateSchema, delegationEvidenceUrl: officialUrlSchema }).strict().superRefine((source, ctx) => {
  const listing = parseOfficialUrl(source.listingUrlTemplate.replace("{postId}", "12345"));
  const entry = parseOfficialUrl(source.entryUrl);
  if (!listing || !entry || !["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(listing.hostname) || listing.pathname !== `/${source.boardToken}/jobs/12345` || entry.origin !== listing.origin || ![`/${source.boardToken}`, `/${source.boardToken}/`].includes(entry.pathname) || source.purpose !== "careers") ctx.addIssue({ code: "custom", message: "Review one exact Greenhouse tenant, listing template and careers entry." });
});
const jsonLdSourceSchema = z.object({ ...sourceFields, kind: z.literal("jobposting_jsonld"), listingOrigin: originSchema, listingPathPrefix: pathPrefixSchema, relationshipEvidenceUrl: officialUrlSchema }).strict().superRefine((source, ctx) => {
  if (source.purpose !== "careers") ctx.addIssue({ code: "custom", message: "A JobPosting source must have careers purpose." });
});
export const officialSourceSchema = z.discriminatedUnion("kind", [officialEntrySchema, greenhouseSourceSchema, jsonLdSourceSchema]);
export type OfficialSource = z.infer<typeof officialSourceSchema>;
export const officialCompanySchema = z.object({
  id: idSchema, name: text200, aliases: z.array(text200).max(20), firstPartyHosts: z.array(officialHostnameSchema).min(1).max(20), reviewedAt: isoTime, reviewEvidenceUrl: officialUrlSchema, offerTypes: z.array(offerTypeSchema).min(1).max(5), sources: z.array(officialSourceSchema).max(8),
}).strict().superRefine((company, ctx) => {
  const firstParty = (url: string) => company.firstPartyHosts.includes(new URL(url).hostname);
  if (!firstParty(company.reviewEvidenceUrl)) ctx.addIssue({ code: "custom", path: ["reviewEvidenceUrl"], message: "Review evidence must be on an exact first-party hostname." });
  for (const source of company.sources) {
    if (source.companyId !== company.id) ctx.addIssue({ code: "custom", path: ["sources"], message: "Source company IDs must match." });
    const evidenceUrl = source.kind === "greenhouse_job" ? source.delegationEvidenceUrl : source.kind === "jobposting_jsonld" ? source.relationshipEvidenceUrl : source.entryUrl;
    if (!firstParty(evidenceUrl)) ctx.addIssue({ code: "custom", path: ["sources"], message: "Source authority evidence must be first-party." });
  }
  if (new Set(company.sources.map((source) => source.id)).size !== company.sources.length) ctx.addIssue({ code: "custom", path: ["sources"], message: "Source IDs must be unique." });
});
export type OfficialCompany = z.infer<typeof officialCompanySchema>;
export const officialCatalogSchema = z.object({ version: idSchema, companies: z.array(officialCompanySchema).max(100) }).strict().superRefine((catalog, ctx) => {
  const ids = catalog.companies.map((company) => company.id);
  const sourceIds = catalog.companies.flatMap((company) => company.sources.map((source) => source.id));
  if (new Set(ids).size !== ids.length || new Set(sourceIds).size !== sourceIds.length) ctx.addIssue({ code: "custom", message: "Company and source IDs must be unique across the catalogue." });
});
export type OfficialCatalog = z.infer<typeof officialCatalogSchema>;

export const publicOfferReferenceSchema = z.object({ kind: publicReferenceKindSchema, value: z.string().min(1).max(4096), origin: publicReferenceOriginSchema }).strict();
export type PublicOfferReference = z.infer<typeof publicOfferReferenceSchema>;
export const officialClaimSchema = z.object({ organizationName: text200.nullable(), offerType: offerTypeSchema, publicReference: publicOfferReferenceSchema.nullable(), title: text200.nullable(), location: z.string().max(300).nullable(), uncertainties: z.array(z.string().max(1000)).max(20) }).strict();
export type OfficialClaim = z.infer<typeof officialClaimSchema>;
export type OfficialScope = { checkId: string; runId: string };
export type OfficialReadBudget = { deadlineAtMs: number; documentsRemaining: number; requestsRemaining: number; bytesRemaining: number };
export type OfficialDocument = { sourceId: string; readUrl: string; finalReadUrl: string; fetchedAt: string; status: "ok" | "not_found" | "unavailable" | "blocked"; contentType: string | null; body: string | null; digest: string | null; reasonCode: string | null };
export type OfficialOfferFact = { status: OfferStatus; sourceId: string | null; reference: string | null; title: string | null; location: string | null; validThrough: string | null; quote: string | null; canonicalUrl: string | null; differingFields: string[]; reasonCode: string };
export type OfficialStep = { stepId: string; sourceId: string; purpose: z.infer<typeof officialStepPurposeSchema>; label: string; hostname: string; canonicalUrl: string; publicReference: PublicOfferReference | null; evidenceIds: string[]; catalogVersion: string; expiresAt: string; basis: z.infer<typeof officialStepBasisSchema> };
export type OfficialVerificationView = { company: { status: CompanyStatus; name: string | null; evidenceIds: string[] }; destination: { status: DestinationStatus; hostname: string | null; evidenceIds: string[] }; offer: Omit<OfficialOfferFact, "canonicalUrl"> & { evidenceIds: string[] }; freshness: FreshnessStatus; checkedAt: string | null; explanation: string; sourceEvidenceIds: string[]; steps: Omit<OfficialStep, "canonicalUrl">[]; alternatives?: AlternativeProjection[] };
export type OfficialReader = (source: OfficialSource, reference: PublicOfferReference | null, options: { signal: AbortSignal; budget: OfficialReadBudget }) => Promise<OfficialDocument>;

// Saved data has a deliberately flat shape; the observation envelope owns run and owner scope.
const commonData = { schemaVersion: z.literal(1), catalogVersion: idSchema, companyId: idSchema.nullable(), reasonCode: z.string().max(100).nullable() };
const optionalUrl = officialUrlSchema.nullable();
const optionalQuote = z.string().max(800).nullable();
export const officialCompanyDataSchema = z.object({ ...commonData, companyStatus: companyStatusSchema, name: text200.nullable(), reviewedAt: isoTime.nullable(), reviewEvidenceUrl: optionalUrl, sourceIds: idsSchema }).strict();
export const officialDestinationDataSchema = z.object({ ...commonData, destinationStatus: destinationStatusSchema, hostname: officialHostnameSchema.nullable(), sourceId: idSchema.nullable() }).strict();
export const officialDocumentDataSchema = z.object({ ...commonData, sourceId: idSchema, readUrl: optionalUrl, finalReadUrl: optionalUrl, fetchedAt: isoTime, responseStatus: officialResponseStatusSchema, contentType: z.string().max(200).nullable(), digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), quote: optionalQuote }).strict();
export const officialOfferDataSchema = z.object({ ...commonData, offerStatus: offerStatusSchema, sourceId: idSchema.nullable(), referenceKind: publicReferenceKindSchema.nullable(), referenceValue: z.string().max(4096).nullable(), title: text200.nullable(), location: z.string().max(300).nullable(), validThrough: isoTime.nullable(), canonicalListingUrl: optionalUrl, quote: optionalQuote, differingFields: z.array(z.enum(["title", "location"])).max(2), basedOnEvidenceIds: idsSchema }).strict();
export const officialVerificationDataSchema = z.object({ ...commonData, companyStatus: companyStatusSchema, destinationStatus: destinationStatusSchema, offerStatus: offerStatusSchema, freshness: freshnessStatusSchema, checkedAt: isoTime.nullable(), explanation: z.string().max(1500), basedOnEvidenceIds: idsSchema }).strict();
export const officialNextStepDataSchema = z.object({ ...commonData, stepId: idSchema, sourceId: idSchema, purpose: officialStepPurposeSchema, label: text200, hostname: officialHostnameSchema, canonicalUrl: officialUrlSchema, referenceKind: publicReferenceKindSchema.nullable(), referenceValue: z.string().max(4096).nullable(), referenceOrigin: publicReferenceOriginSchema.nullable(), evidenceIds: idsSchema, expiresAt: isoTime, basis: officialStepBasisSchema }).strict();
export const officialObservationDataSchemas = { official_company: officialCompanyDataSchema, official_destination: officialDestinationDataSchema, official_document: officialDocumentDataSchema, official_offer: officialOfferDataSchema, official_verification: officialVerificationDataSchema, official_next_step: officialNextStepDataSchema } as const;
export type OfficialCompanyData = z.infer<typeof officialCompanyDataSchema>;
export type OfficialDestinationData = z.infer<typeof officialDestinationDataSchema>;
export type OfficialDocumentData = z.infer<typeof officialDocumentDataSchema>;
export type OfficialOfferData = z.infer<typeof officialOfferDataSchema>;
export type OfficialVerificationData = z.infer<typeof officialVerificationDataSchema>;
export type OfficialNextStepData = z.infer<typeof officialNextStepDataSchema>;
