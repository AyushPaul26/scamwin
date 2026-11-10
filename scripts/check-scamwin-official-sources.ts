/**
 * Explicit public-source check; no environment files, credentials or application writes.
 * node --import tsx scripts/check-scamwin-official-sources.ts --company figma --post <public-post-id>
 */
import { pathToFileURL } from 'node:url';
import { interpretOfficialOffer } from '../lib/scamwin/official-offer-adapters';
import { isOfficialCompanyCurrent, officialCatalog } from '../lib/scamwin/official-source-catalog';
import { readOfficialSource } from '../lib/scamwin/official-source-reader';
import { officialCatalogSchema, type OfferStatus, type OfficialCatalog, type OfficialDocument, type OfficialReader, type OfficialReadBudget } from '../lib/scamwin/official-verification-contracts';

type RefusalReason = 'invalid_arguments' | 'invalid_catalog' | 'unknown_company' | 'expired_company' | 'no_exact_post_source' | 'ambiguous_source';
type BudgetUsage = { documentsUsed: number; documentLimit: number; requestsUsed: number; requestLimit: number; bytesUsed: number; byteLimit: number; elapsedMs: number; stageLimitMs: number };
export type OfficialAcceptanceReport = {
  status: 'refused' | OfficialDocument['status']; reasonCode?: RefusalReason;
  companyId?: string; sourceId?: string; catalogVersion?: string; checkedAt?: string;
  fetchedAt?: string | null; offerStatus?: OfferStatus; budget?: BudgetUsage;
};
type AcceptanceResult = { exitCode: number; report: OfficialAcceptanceReport };
type AcceptanceDependencies = { catalog: OfficialCatalog; reader: OfficialReader; now: () => Date };

function parseArguments(argv: readonly string[]): { companyId: string; postId: string } | null {
  if (argv.length !== 4) return null;
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!['--company', '--post'].includes(flag) || values.has(flag) || !value) return null;
    values.set(flag, value);
  }
  const companyId = values.get('--company'), postId = values.get('--post');
  if (!companyId || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(companyId) || !postId || !/^[1-9][0-9]{0,19}$/.test(postId)) return null;
  return { companyId, postId };
}

/** Injected dependencies keep fixture acceptance offline and independent of application configuration. */
export async function runOfficialSourceAcceptance(argv: readonly string[], deps: AcceptanceDependencies): Promise<AcceptanceResult> {
  const refuse = (reasonCode: RefusalReason): AcceptanceResult => ({ exitCode: 1, report: { status: 'refused', reasonCode } });
  const args = parseArguments(argv);
  if (!args) return refuse('invalid_arguments');
  const parsed = officialCatalogSchema.safeParse(deps.catalog);
  if (!parsed.success) return refuse('invalid_catalog');
  const company = parsed.data.companies.find(item => item.id === args.companyId);
  if (!company) return refuse('unknown_company');
  const startedAt = deps.now();
  if (!isOfficialCompanyCurrent(company, startedAt)) return refuse('expired_company');
  const boards = company.sources.filter(source => source.kind === 'greenhouse_job');
  if (boards.length === 0) return refuse('no_exact_post_source');
  if (boards.length !== 1) return refuse('ambiguous_source');
  const source = boards[0];
  const reference = { kind: 'greenhouse_post_id' as const, value: args.postId, origin: 'explicit_field' as const };
  const budget: OfficialReadBudget = { deadlineAtMs: startedAt.getTime() + 20_000, documentsRemaining: 2, requestsRemaining: 4, bytesRemaining: 512 * 1024 };
  const usage = (): BudgetUsage => ({
    documentsUsed: 2 - budget.documentsRemaining, documentLimit: 2,
    requestsUsed: 4 - budget.requestsRemaining, requestLimit: 4,
    bytesUsed: 512 * 1024 - budget.bytesRemaining, byteLimit: 512 * 1024,
    elapsedMs: Math.max(0, deps.now().getTime() - startedAt.getTime()), stageLimitMs: 20_000,
  });
  const base = { companyId: company.id, sourceId: source.id, catalogVersion: parsed.data.version, checkedAt: startedAt.toISOString() };
  try {
    // Exactly one reader call: redirects use that reader's shared request/byte budget.
    const document = await deps.reader(source, reference, { signal: AbortSignal.timeout(20_000), budget });
    const offer = interpretOfficialOffer({ organizationName: company.name, offerType: 'recruitment', publicReference: reference, title: null, location: null, uncertainties: [] }, source, document, deps.now());
    return {
      exitCode: document.status === 'ok' && offer.status === 'matched_public_reference' ? 0 : 1,
      report: { ...base, status: document.status, fetchedAt: document.fetchedAt, offerStatus: offer.status, budget: usage() },
    };
  } catch {
    // Raw errors and response data can contain sensitive values; report only fixed categories.
    return { exitCode: 1, report: { ...base, status: 'unavailable', fetchedAt: null, offerStatus: 'unavailable', budget: usage() } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runOfficialSourceAcceptance(process.argv.slice(2), { catalog: officialCatalog, reader: readOfficialSource, now: () => new Date() }).then(result => {
    console.log(JSON.stringify(result.report));
    process.exitCode = result.exitCode;
  }).catch(() => {
    console.log(JSON.stringify({ status: 'unavailable' }));
    process.exitCode = 1;
  });
}
