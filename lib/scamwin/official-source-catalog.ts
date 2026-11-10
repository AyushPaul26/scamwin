import { officialCatalogSchema, type CompanyStatus, type OfficialCatalog, type OfficialCompany } from "./official-verification-contracts";

export const OFFICIAL_REVIEW_MS = 30 * 24 * 60 * 60 * 1000;
// Entries must be added only with dated, manually reviewed first-party evidence.
export const officialCatalog: OfficialCatalog = officialCatalogSchema.parse({ version: "2026-11-10.1", companies: [
  {
    id: 'figma', name: 'Figma', aliases: [], firstPartyHosts: ['www.figma.com'], reviewedAt: '2026-11-09T20:20:00.000Z', reviewEvidenceUrl: 'https://www.figma.com/careers/', offerTypes: ['recruitment'],
    sources: [
      { id: 'figma-careers', companyId: 'figma', kind: 'official_entry', purpose: 'careers', entryUrl: 'https://www.figma.com/careers/' },
      // The first-party careers page links to this exact tenant's postings.
      { id: 'figma-greenhouse', companyId: 'figma', kind: 'greenhouse_job', purpose: 'careers', entryUrl: 'https://job-boards.greenhouse.io/figma', boardToken: 'figma', listingUrlTemplate: 'https://job-boards.greenhouse.io/figma/jobs/{postId}', delegationEvidenceUrl: 'https://www.figma.com/careers/' },
    ],
  },
  {
    id: 'tcs', name: 'Tata Consultancy Services', aliases: ['TCS'], firstPartyHosts: ['www.tcs.com'], reviewedAt: '2026-11-09T20:20:00.000Z', reviewEvidenceUrl: 'https://www.tcs.com/careers', offerTypes: ['recruitment'],
    sources: [{ id: 'tcs-careers', companyId: 'tcs', kind: 'official_entry', purpose: 'careers', entryUrl: 'https://www.tcs.com/careers' }],
  },
  {
    id: 'infosys', name: 'Infosys', aliases: [], firstPartyHosts: ['www.infosys.com'], reviewedAt: '2026-11-09T20:20:00.000Z', reviewEvidenceUrl: 'https://www.infosys.com/careers/', offerTypes: ['recruitment'],
    sources: [
      { id: 'infosys-careers', companyId: 'infosys', kind: 'official_entry', purpose: 'careers', entryUrl: 'https://www.infosys.com/careers/' },
      { id: 'infosys-recruitment-help', companyId: 'infosys', kind: 'official_entry', purpose: 'support', entryUrl: 'https://www.infosys.com/careers/apply/recruitment-fraud-alert.html' },
    ],
  },
  {
    id: 'cloudflare', name: 'Cloudflare', aliases: [], firstPartyHosts: ['www.cloudflare.com'], reviewedAt: '2026-11-09T20:20:00.000Z', reviewEvidenceUrl: 'https://www.cloudflare.com/careers/jobs/', offerTypes: ['recruitment'],
    sources: [{ id: 'cloudflare-careers', companyId: 'cloudflare', kind: 'official_entry', purpose: 'careers', entryUrl: 'https://www.cloudflare.com/careers/jobs/' }],
  },
] });
export function isOfficialCompanyCurrent(company: OfficialCompany, now: Date): boolean {
  const age = now.getTime() - Date.parse(company.reviewedAt);
  return Number.isFinite(age) && age >= 0 && age < OFFICIAL_REVIEW_MS;
}
const aliasKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
export function resolveOfficialCompany(name: string | null, catalog: OfficialCatalog, now: Date): { status: CompanyStatus; company: OfficialCompany | null } {
  if (!name?.trim()) return { status: "not_claimed", company: null };
  const parsed = officialCatalogSchema.safeParse(catalog);
  if (!parsed.success) return { status: "unlisted", company: null };
  const key = aliasKey(name);
  const matches = parsed.data.companies.filter((company) => [company.name, ...company.aliases].some((alias) => aliasKey(alias) === key));
  if (matches.length > 1) return { status: "ambiguous", company: null };
  if (!matches.length) return { status: "unlisted", company: null };
  if (!isOfficialCompanyCurrent(matches[0], now)) return { status: "expired", company: null };
  return { status: "recognized", company: matches[0] };
}
