# Scamwin Official Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the claimed company and exact public offer against reviewed official sources, then show a sourced official next step without weakening Scamwin's existing risk findings.

**Architecture:** A versioned catalogue establishes source authority; a separate bounded HTTPS reader and two exact-listing adapters collect public facts inside the existing Vercel worker. Save flat private observations and derive the result UI and owner-gated navigation from them. Keep Browserless containment, AI explanations, account ownership and Web3 review intact.

**Tech Stack:** Existing Next.js 16.4.2, React, TypeScript, Node 24, Zod, Auth0, Neon, Cloudflare Workers AI and Vercel; declare parse5 7.3.0 directly. Browserless and Base Sepolia retain their existing roles.

**Spec:** [Company, offer and next-step design](../specs/2026-11-10-scamwin-official-verification-design.md).

**Status:** Implemented locally under the user's subsequent approval. See [execution and verification record](../../scamwin-official-verification-progress.md) for test evidence, implementation decisions and pending release-only steps. Baseline: `c599bf38c49932ff05e2ea63a0c65eb21aeb660e`.

## Global Constraints

- Build company/offer verification and official next steps only. Resume analysis, job matching, job discovery and automatic applications stay deferred.
- Retain all-online Vercel execution and the existing free-service setup. Add no paid search provider, service credentials, extra model call or hidden fallback.
- Node remains `>=24 <25`; do not upgrade Next.js or unrelated libraries. Read installed Next.js documentation before future route/UI implementation, as required by `AGENTS.md`.
- Keep the browser's operator-owned approved origins unchanged. New public-source reading has its own catalogue-based HTTPS policy.
- Catalogue review: 30 days. Public listing current-use window: 6 hours. At most 2 documents, 4 requests including redirects, 1 redirect/document, 20 seconds/stage, 8 seconds/request, 256 KiB/body and 512 KiB/run. Require 55 seconds remaining in the existing 240-second pipeline before starting official collection, leaving at least 35 seconds after a full official stage for comparison/assessment. No retries, pagination or shared cache.
- Request identity encoding and reject compressed responses in v1. No arbitrary URLs, query propagation, cookies, login, scripts, forms, applications or payment actions.
- Keep observations flat, private and owner/run-bound. At most 8 official records/run, 800-character quotes, 8,000-character extracted text/source in memory; no raw HTML persistence. Existing retention remains unchanged. No schema or database change.
- No **Company verified**, **Safe job**, **Guaranteed genuine**, **100% safe** or trust percentage. Positive source facts never clear observed payment/credential risk; missing evidence never establishes fraud.
- Official navigation is explicit, same-tab and server-revalidated; no automatically opened tab or model-created actionable URL.
- Follow `DESIGN.md` and `UX-CONTRACT.md`; use the existing form, evidence, date, focus and responsive patterns.
- Do not create branches, worktrees, commits, pushes, deployments or production configuration changes automatically. Implementation was subsequently authorized; commit/push/deployment and production activation still require their own instruction. Leave implementation uncommitted unless the user specifically requests otherwise.

## Review Focus

1. A known ATS hostname with another company's tenant must remain unrecognized; test in Tasks 1 and 3.
2. A real copied listing combined with an observed scam fee must retain the action risk; test in Task 5.
3. A timeout, partial body, 404, stale catalogue or absent ID must not become fraud or an invented match; test in Tasks 2–4.
4. A saved step revoked or expired before click must not redirect elsewhere or cross account/run boundaries; test in Task 6.
5. New official evidence appended after 30 earlier records must reach follow-up context without extra browsing or unsupported citations; test in Task 5.

## File map and ownership

All paths below are relative to the `openmods` repository root. This is a planned file map, not a list of changes already made.

| New file | Responsibility |
| --- | --- |
| `lib/scamwin/official-verification-contracts.ts` | Browser-safe Zod schemas/types for catalogue entries, claims, facts, status unions, projection and step candidates. No environment or network imports. |
| `lib/scamwin/official-source-catalog.ts` | Versioned reviewed entries, alias resolution, review validity and typed source definitions. |
| `lib/scamwin/official-source-policy.ts` | Canonical source URL construction and exact origin/path/tenant validation. |
| `lib/scamwin/official-source-reader.ts` | DNS-pinned, bounded public HTTPS transport; no database/model/browser access. |
| `lib/scamwin/official-offer-adapters.ts` | Static HTML/JSON-LD and Greenhouse single-post parsing and deterministic comparisons. |
| `lib/scamwin/official-verification.ts` | Claim derivation, source selection, per-run budget and flat evidence production. |
| `lib/scamwin/official-verification-view.ts` | Pure saved-observation projection and current-catalogue step resolution. |
| `components/scamwin/official-verification.tsx` | Result card, evidence links and explicit official next-step links. |
| `app/api/scamwin/checks/[id]/official-next-step/[stepId]/route.ts` | Authenticated, no-store destination gate. |
| `scripts/check-scamwin-official-sources.ts` | Opt-in bounded live public-source acceptance check; no secrets/private inputs. |
| `scripts/check-scamwin-official-ui.mjs` | Fixture-driven desktop/mobile/keyboard acceptance checks. |
| `docs/scamwin-official-source-operations.md` | Source onboarding, feature flag, review/expiry and rollout instructions. |

Modify existing contracts/input/AI, pipeline/progress/analysis, detail route/result/intake/CSS, readiness/config examples, packaging tests and UX documentation only where the tasks below specify. Leave the old `official-sources.ts` available for flag-off rollback.

## Shared interface contract

Define/export these types in `official-verification-contracts.ts`; use the exact status values in spec section 7.

- `OfficialCatalog = { version: string; companies: OfficialCompany[] }`.
- `OfficialCompany = { id: string; name: string; aliases: string[]; firstPartyHosts: string[]; reviewedAt: string; reviewEvidenceUrl: string; offerTypes: OfferType[]; sources: OfficialSource[] }`.
- `OfferType = 'recruitment' | 'refund' | 'identity_request' | 'other' | 'unclear'`.
- `OfficialSource`: discriminated union of the three source kinds and fields in spec section 5; every member has `id`, `companyId`, `kind`, `entryUrl` and `purpose`; purpose is `careers | support | refund | identity_help`. Greenhouse adds `boardToken`, `listingUrlTemplate`, `delegationEvidenceUrl`; JSON-LD adds `listingOrigin`, `listingPathPrefix`, `relationshipEvidenceUrl`. Do not accept arbitrary regular-expression configuration.
- `PublicOfferReference = { kind: 'greenhouse_post_id' | 'canonical_listing_url'; value: string; origin: 'explicit_field' | 'submitted_url' }`.
- `OfficialClaim = { organizationName: string | null; offerType: OfferType; publicReference: PublicOfferReference | null; title: string | null; location: string | null; uncertainties: string[] }`.
- `OfficialScope = { checkId: string; runId: string }`.
- `OfficialReadBudget = { deadlineAtMs: number; documentsRemaining: number; requestsRemaining: number; bytesRemaining: number }` (one shared mutable budget per run).
- `OfficialDocument = { sourceId: string; readUrl: string; finalReadUrl: string; fetchedAt: string; status: 'ok' | 'not_found' | 'unavailable' | 'blocked'; contentType: string | null; body: string | null; digest: string | null; reasonCode: string | null }`. Read URLs describe the fetched resource, not the user-facing listing. A reader failure returns this bounded outcome; cancellation aborts rather than becoming an ordinary outcome.
- `OfficialOfferFact = { status: OfferStatus; sourceId: string | null; reference: string | null; title: string | null; location: string | null; validThrough: string | null; quote: string | null; canonicalUrl: string | null; differingFields: string[]; reasonCode: string }`.
- `OfficialStep = { stepId: string; sourceId: string; purpose: 'listing' | 'careers' | 'support' | 'refund' | 'identity_help'; label: string; hostname: string; canonicalUrl: string; publicReference: PublicOfferReference | null; evidenceIds: string[]; catalogVersion: string; expiresAt: string; basis: 'live_listing' | 'live_entry' | 'reviewed_entry' }`.
- `OfficialVerificationView = { company: { status: CompanyStatus; name: string | null; evidenceIds: string[] }; destination: { status: DestinationStatus; hostname: string | null; evidenceIds: string[] }; offer: Omit<OfficialOfferFact, 'canonicalUrl'> & { evidenceIds: string[] }; freshness: FreshnessStatus; checkedAt: string | null; explanation: string; sourceEvidenceIds: string[]; steps: Omit<OfficialStep, 'canonicalUrl'>[] }`.
- `OfficialReader = (source: OfficialSource, reference: PublicOfferReference | null, options: { signal: AbortSignal; budget: OfficialReadBudget }) => Promise<OfficialDocument>`.

Runtime observations use existing contracts. Nested objects in these in-memory types must be flattened into the specific records in Task 4 before saving. The response projection omits actionable destination URLs; the route resolves them on click. Catalogue/reader modules remain server-side even though their data schemas are pure.

## Task 1: Trust catalogue, input contracts and source scope

**Files:** Create contracts/catalogue/policy modules above and `tests/scamwin-official-catalog.test.ts`. Modify `lib/scamwin/contracts.ts`, `lib/scamwin/input.ts`, `tests/scamwin-input.test.ts`.

**Interfaces:**

- `resolveOfficialCompany(name: string | null, catalog: OfficialCatalog, now: Date): { status: CompanyStatus; company: OfficialCompany | null }`.
- `buildOfficialReadUrl(source: OfficialSource, reference: PublicOfferReference | null): string | null`: Greenhouse returns only its exact code-owned single-post API URL; static/entry sources return the scoped public page.
- `buildOfficialNavigationUrl(source: OfficialSource, reference: PublicOfferReference | null, purpose: OfficialStep['purpose']): string | null`: returns only the exact reviewed public listing or entry URL, never a read API URL.
- `isWithinOfficialSource(url: string, source: OfficialSource, use: 'read' | 'navigation'): boolean`: apply the corresponding distinct origin/path/template policy.
- Existing `CheckInput` gains optional `claimedCompany?: string`, `offerReference?: string`; shared Zod rules match spec section 6. Existing `OfferIntent` shape remains unchanged.

- [ ] **Write red tests:** alias collision returns `ambiguous`; unlisted and 31-day/future reviews cannot recognize authority; exact reviewed alias resolves; `company.example.evil.org`, unreviewed subdomain, wrong ATS board, encoded path escape and prefix-without-segment-boundary are rejected. Numeric Greenhouse post ID constructs distinct exact API-read and public-navigation URLs; neither validator authorizes the other. New optional fields are bounded and included in the combined 12,000-character limit; existing minimal inputs and public-reference-only submissions validate; company-only submission does not.
- [ ] **Confirm red:** run `node --import tsx --test tests/scamwin-official-catalog.test.ts tests/scamwin-input.test.ts`; expect new contract/scope assertions to fail before implementation.
- [ ] **Implement:** browser-safe schemas, deterministic alias matching, strict catalogue validation (100 companies, eight sources/company, 20 aliases/company) and canonical URL builders. Keep fixtures injected into tests; start production entries empty until reviewed in Task 7. Reject credentials, query strings/fragments and encoded separators/dot segments in source URLs. Normalize hostname with WHATWG URL, show ASCII hostname for IDNs, and compare literal canonical scope. Explicit numeric IDs may build Greenhouse URLs; returned/model URLs cannot widen scope.
- [ ] **Verify and review:** rerun the focused tests; require pass. Confirm no new schema/table, environment read or network import in shared contracts and no whole-ATS trust rule.

## Task 2: Bounded public HTTPS reader

**Files:** Create `lib/scamwin/official-source-reader.ts`, `tests/scamwin-official-reader.test.ts`. Read/reuse public-address validation from `lib/scamwin/origin-probe.ts` / `policy.ts` without changing browser allowlists.

**Interfaces:**

- Export `readOfficialSource: OfficialReader`.
- Export `createOfficialReader(deps: { resolve: typeof import('node:dns/promises').lookup; request: typeof import('node:https').request; now: () => number }): OfficialReader` for transport tests; production constructs native dependencies internally.
- Consume Task 1 URL builders, source types and one run budget. No caller-supplied raw URL transport entry point.

- [ ] **Write red tests:** timeout destroys the request/socket; cancellation aborts; private/mixed DNS answers and rebinding cannot reach a private socket; Host/SNI remain the original hostname with normal certificate checks; redirect-to-private/wrong-path/second-hop escapes fail. Assert limits at exactly 4 requests, 1 redirect/document, 256 KiB/body, 512 KiB/run and 20 seconds. Compressed, unsupported and partial bodies yield unavailable, not `not_found`; a complete 404 remains `not_found`. Assert no cookies/auth/private query, retry, proxy-env routing or automatic fetch fallback.
- [ ] **Confirm red:** run `node --import tsx --test tests/scamwin-official-reader.test.ts`; expect missing reader/new behavior failures.
- [ ] **Implement:** validate every hop, resolve and reject non-public answers, pin the selected address to the actual HTTPS connection, disable pooling/proxy routing for these requests, enforce an abortable wall-clock deadline across DNS/headers/body, and count redirects in the same shared budget. Use identity encoding and bound the raw body before UTF-8 parsing. Keep transport test seams narrow; test mocks do not weaken production TLS.
- [ ] **Verify and review:** rerun the reader tests; require pass. Inspect that a DNS precheck is not followed by a second uncontrolled resolution, and that no response body is logged or persisted.

## Task 3: Exact-listing adapters and claim derivation

**Files:** Create `lib/scamwin/official-offer-adapters.ts`, `tests/scamwin-official-offers.test.ts`; start `lib/scamwin/official-verification.ts`. Modify `package.json` / `package-lock.json` to declare `parse5: 7.3.0` directly, and `lib/scamwin/ai.ts` only for the existing extraction prompt/input.

**Interfaces:**

- `deriveOfficialClaim(input: CheckInput, intent: OfferIntent | null, catalog: OfficialCatalog): OfficialClaim` in `official-verification.ts`.
- `interpretOfficialOffer(claim: OfficialClaim, source: OfficialSource, document: OfficialDocument, now: Date): OfficialOfferFact` in adapters.
- Existing `extractOfferIntent(input, options): Promise<OfferIntent>` retains its signature/model-call count. Allow bounded candidate kinds `offer_type`, `job_title`, `job_location` in the current candidates array.

- [ ] **Write red tests:** explicit company overrides conflicting AI with an uncertainty; hallucinated model URL/reference cannot initiate lookup; wrong board and post/internal/requisition ID confusion cannot match. Multiple reviewed boards plus only a numeric ID yield `reference_needed` and zero speculative requests; an exact scoped listing URL selects one board. A complete exact post matches, a 404 says only `not_found_in_checked_source`, title-only says `reference_needed`, explicit past valid deadline says `explicitly_closed`, invalid/missing deadline does not. Conflicting JSON-LD objects, canonical/organization mismatch and malformed payload stay unresolved. Missing title/location is not a difference; literal differences carry quotes and fields. Private refund request yields `not_publicly_verifiable`.
- [ ] **Confirm red:** run `node --import tsx --test tests/scamwin-official-offers.test.ts`; expect new derivation/parser failures.
- [ ] **Implement:** public reference comes only from the optional explicit field or a source-scoped submitted URL. Extract a typed ID/URL without forwarding other input. Parse Greenhouse single-post JSON and static `JobPosting` JSON-LD with parse5; do not execute scripts or use returned HTML as JSX. Bound object traversal and reject conflicting candidates. Take canonical next-step destinations from Task 1, not arbitrary API/JSON-LD links. Preserve actual fetch time and exact source quotes. No pagination, title search, salary inference or extra AI request.
- [ ] **Verify and review:** focused tests pass; verify the lockfile still uses 7.3.0 and no unrelated dependency upgrade. Confirm a recognized company and published listing remain claims about a public source, not about the sender.

Pinned fixture assertions for the tests above (arrange a current fictional company/source and an injected clock in each test file):

```ts
// Task 1: 'shared ATS tenant does not establish another company relationship'
assert.equal(isWithinOfficialSource(wrongTenantUrl, source, 'navigation'), false);
// Task 1: 'API read scope cannot become a user-facing destination'
assert.equal(isWithinOfficialSource(buildOfficialReadUrl(source, reference)!, source, 'navigation'), false);
// Task 2: 'oversized response is unavailable rather than an absent posting'
assert.equal((await reader(source, reference, oversizeOptions)).status, 'unavailable');
// Task 3: '404 proves only absence from the checked source'
assert.equal(interpretOfficialOffer(claim, source, complete404, now).status, 'not_found_in_checked_source');
```

The variable names in these snippets are arranged test fixtures/transport mocks, not additional production interfaces. Implement the remaining named cases in each task with equivalent explicit assertions.

## Task 4: Orchestration, saved evidence and result projection

**Files:** Complete `official-verification.ts`; create `official-verification-view.ts`, `tests/scamwin-official-verification.test.ts`, `tests/scamwin-official-view.test.ts`. Existing store/schema stay unchanged.

**Interfaces:**

- `verifyOfficialOffer(args: { input: CheckInput; intent: OfferIntent | null; scope: OfficialScope; signal: AbortSignal; pipelineDeadlineAtMs: number }, deps: { catalog: OfficialCatalog; reader: OfficialReader; now: () => Date; makeId: () => string }): Promise<Observation[]>`.
- `deriveOfficialVerification(check: CheckRecord, observations: Observation[], catalog: OfficialCatalog, now: Date): OfficialVerificationView`.
- `resolveOfficialStep(check: CheckRecord, observations: Observation[], stepId: string, catalog: OfficialCatalog, now: Date): { status: 'ready'; url: string } | { status: 'unavailable' }`.

Define/export per-kind Zod data schemas in `official-verification-contracts.ts`. All kinds share `schemaVersion: 1`, `catalogVersion: string`, `companyId: string | null`, `reasonCode: string | null`; the existing observation envelope supplies ID, check/run, sourceRef, event time and versions. The exact additional flat keys are:

| Kind | Additional data keys |
| --- | --- |
| `official_company` | `companyStatus`, `name`, `reviewedAt`, `reviewEvidenceUrl`, `sourceIds: string[]` |
| `official_destination` | `destinationStatus`, `hostname`, `sourceId` |
| `official_document` | `sourceId`, `readUrl`, `finalReadUrl`, `fetchedAt`, `responseStatus`, `contentType`, `digest`, `quote` |
| `official_offer` | `offerStatus`, `sourceId`, `referenceKind`, `referenceValue`, `title`, `location`, `validThrough`, `canonicalListingUrl`, `quote`, `differingFields: string[]`, `basedOnEvidenceIds: string[]` |
| `official_verification` | `companyStatus`, `destinationStatus`, `offerStatus`, `freshness`, `checkedAt`, `explanation`, `basedOnEvidenceIds: string[]` |
| `official_next_step` | `stepId`, `sourceId`, `purpose`, `label`, `hostname`, `canonicalUrl`, `referenceKind`, `referenceValue`, `referenceOrigin`, `evidenceIds: string[]`, `expiresAt`, `basis` |

Use the earlier enum types for status/kind/origin/basis fields, nullable scalars for unavailable facts and ISO datetimes for times. IDs are at most 120 characters; names/titles/labels at most 200; location at most 300; hostnames at most 253; URLs/reference values at most 4096; reason codes at most 100; explanation at most 1500; quote at most 800; digest is null or a SHA-256 hex string. Every ID array has at most eight IDs; differing fields are only `title` and `location`. Enforce the existing observation schema as an outer boundary. Supporting evidence IDs must resolve within this owned check/run; summary/step references cannot cite themselves or arbitrary external records. Do not persist a `body` or nested `publicReference` object. Observation status describes collection availability, while the explicit data status describes the conclusion; unknown company is `not_checked`, blocked/unavailable source keeps that envelope status, and an observed absence/difference is not labeled fraud.

- [ ] **Write red tests:** all status unions project accurately; at most 2 source reads/8 official records; fewer than 55 seconds remaining skips external reads visibly, with boundary tests at 54,999/55,000 ms. Dedupe identical source URLs. Every record passes the existing observation schema and retains check/run/source/catalogue/time provenance. Stale or revoked references and unavailable reads never produce a fresh match. Listed job and reviewed fallback have distinct expiries/bases. Wrong check/run, tampered URL, changed catalogue version and deleted source cannot resolve a step. Unknown/ambiguous companies produce guidance with zero actionable links.
- [ ] **Confirm red:** run `node --import tsx --test tests/scamwin-official-verification.test.ts tests/scamwin-official-view.test.ts`; expect new exports/behavior failures.
- [ ] **Implement collection:** create one run budget, choose the exact listing first and relevant official entry second, and return up to eight flat observations: `official_company`, `official_destination`, `official_document` (up to two), `official_offer`, `official_verification`, `official_next_step` (up to two). Save failure categories explicitly; link supporting record IDs as primitive arrays. Return observations to the existing pipeline writer, never write directly to Neon. No network calls for ambiguous/expired/unlisted companies.
- [ ] **Implement projection and navigation resolution:** validate saved flat records, catalogue scope and original timestamps. Reconstruct a step's exact URL through `buildOfficialNavigationUrl` from its saved typed reference/purpose and require equality with the saved URL. The UI gets only owned current-run projection and opaque step IDs. Keep stale facts historical; disable expired listing steps without silently changing their destination. A reviewed-entry fallback may remain available with its own review-based expiry and honest wording. Use existing check expiry; cancellation cannot create an eligible step.
- [ ] **Verify and review:** focused tests pass, with injected clocks/IDs/readers. Confirm all quotations stay within 800 characters, bodies remain ephemeral, and no nested value or new database contract was introduced.

Pin `'changed catalogue revokes a saved official step'` with `assert.deepEqual(resolveOfficialStep(check, savedEvidence, stepId, changedCatalog, now), { status: 'unavailable' })`. Pin `'unknown company has no invented official destination'` with `assert.equal(deriveOfficialVerification(check, unknownEvidence, catalog, now).steps.length, 0)`.

## Task 5: Pipeline, risk rules, progress and evidence-only follow-up

**Files:** Modify `lib/scamwin/pipeline.ts`, `progress.ts`, `analysis.ts`, `ai.ts`, `app/scamwin/actions.ts`, `components/scamwin/investigation-progress.tsx`; extend `tests/scamwin-pipeline.test.ts`, `scamwin-progress.test.ts`, `scamwin-analysis.test.ts`, `scamwin-store.test.ts`; create `tests/scamwin-official-followup.test.ts`. Modify `publisher/scripts/build.mjs` / `tests/scamwin-publisher-http.test.mjs` only if the new pure contracts enter its explicit import closure.

**Interfaces:**

- `runInvestigation` dependency injection adds `verifyOfficial?: typeof verifyOfficialOffer`; supply catalogue/reader through a bounded internal adapter, not a raw URL argument.
- `investigationStages` adds `['official', 'Checking official sources']` between registry and comparison. Keep existing browser detail codes browser-only; a new detail writer is unnecessary for v1.
- Existing `assessEvidence(input, observations, intent)` consumes new official records while preserving its public signature and deterministic action-risk priority.
- Export `selectFollowupContext(assessment: Assessment, observations: Observation[]): { assessment: Assessment; observations: Observation[]; omittedCount: number }` from `ai.ts`; `answerFromEvidence` keeps its signature.

- [ ] **Write red tests:** enabled stage executes once before analyzing; disabled flag retains legacy `officialIdentity` without new reads; source failure cannot prevent assessment. Cancel, generation change and duplicate delivery prevent late evidence/final-state overwrite. Stream has already ended when official reads begin and no new browser is created. A genuine public job plus the existing outgoing refund/fee contradiction remains `high_risk`; missing/ambiguous/unavailable/closed listing alone never becomes high risk. Official-source-only warning submission stays rejected.
- [ ] **Write follow-up red tests:** place 35 target records before new official records; require official summary/source/match records inside the actual supplied subset, max 30 records and 64 KiB serialized context. Exclude records from other check/run IDs before selection in `followupAction`. Include only assessment findings fully supported by supplied records, report omitted coverage, validate citations against the supplied subset, and assert zero official-reader calls from follow-up. Keep `compareOfferWithEvidence` restricted to actual `live_page` evidence.
- [ ] **Confirm red:** run `node --import tsx --test tests/scamwin-pipeline.test.ts tests/scamwin-progress.test.ts tests/scamwin-analysis.test.ts tests/scamwin-store.test.ts tests/scamwin-official-followup.test.ts`.
- [ ] **Implement integration:** add abort-aware official stage while still collecting; use existing `add` and progress writer with generation fences. Reuse the original 240-second absolute deadline. Store missing official coverage without replacing action findings; replace the old positive `official_identity.verified` interpretation on the enabled path with the separate source/offer facts. Add cited differences as inferences only. Follow-up priority is the up-to-eight official records, then supported cited target evidence, then remaining recent records within both caps; trim optional context fields without modifying saved evidence.
- [ ] **Verify and review:** focused tests and `npm run test:scamwin` pass. Check publisher closure: shared pure contracts may be deliberately allowlisted if imported; catalogue, parser, reader, environment and routing modules must stay excluded. Run `npm --prefix publisher run build` and relevant publisher tests if the closure changed.

Pin `'copied real listing does not clear observed payment risk'` with `assert.equal(assessEvidence(input, [...feeEvidence, ...realListingEvidence], intent).risk, 'high_risk')`. Pin `'follow-up selects newly appended official evidence'` by asserting every expected official ID occurs in `selectFollowupContext(assessment, evidence).observations`, its length is at most 30, and `Buffer.byteLength(JSON.stringify(context), 'utf8') <= 65536`; the official reader call count must stay zero.

## Task 6: Intake, verification card and explicit official navigation

**Files:** Modify `components/scamwin/intake.tsx`, `result.tsx`, `app/scamwin.css`, `app/api/scamwin/checks/[id]/route.ts`; create the verification component, next-step route, `tests/scamwin-official-navigation.test.ts` and `scripts/check-scamwin-official-ui.mjs`. Update `UX-CONTRACT.md` / `DESIGN.md` only with final implemented behavior.

**Interfaces:**

- Add `officialVerification?: OfficialVerificationView` to the private detail response and its client `Detail` type. Derive it server-side from already owned check/observations; do not initiate official fetches from this GET.
- `OfficialVerification({ checkId, verification }: { checkId: string; verification: OfficialVerificationView })` renders the new result section.
- Next-step `GET(request: Request, context: { params: Promise<{ id: string; stepId: string }> }): Promise<Response>` consumes Task 4 resolution and existing Auth0/store functions.

- [ ] **Write red tests/checks:** own fresh step returns 303 to exact canonical URL with private/no-store and no-referrer headers; other owner/check/run, tampered/expired/revoked source and nonterminal check cannot redirect externally. Repeated saved-result reads make zero new official-source reads. Unknown company has no guessed link. The UI separately labels company, destination and offer and shows source/time/missing input. Optional intake fields preserve values on server rejection and do not require a resume. Check 320px/mobile/desktop, keyboard order, screen-reader labels and explicit same-tab navigation with no automatic window creation.
- [ ] **Confirm red:** run `node --import tsx --test tests/scamwin-official-navigation.test.ts`; run `node scripts/check-scamwin-official-ui.mjs` against synthetic local fixtures; expect new route/card assertions to fail initially.
- [ ] **Implement intake and result:** use existing React Hook Form/Zod and Base UI primitives; add optional expandable fields and helpful public-reference copy. Place the card below the decision comparison. Separate unavailable from mismatched, use existing formatted dates/citations, keep risk above verification and render no source HTML. Keep raw evidence source URLs inert text; only the explicit gated next-step links navigate externally. Display target domain/purpose and reviewed-versus-live basis before the link. Missing-reference copy links to `/check` with **Start a new check with the public reference**, without private query parameters; do not imply that Recheck edits its stored input.
- [ ] **Implement destination gate:** resolve owner server-side, load owned check/current observations, require completed/partial and feature enabled, invoke `resolveOfficialStep`, then return validated 303 with the specified headers. Use a plain anchor, no Next prefetch and no `target=_blank`. For invalid owned steps return to `/checks/{id}?officialStep=unavailable` using a fixed app origin/path and render a clear notice there. Use existing auth/not-found behavior otherwise. Do not accept an owner or destination URL parameter, refetch sources or silently substitute fallback destinations.
- [ ] **Verify and review:** navigation tests and fixture UI checks pass; rerun `npm run test:scamwin:browser`, `npm run test:scamwin:controls`, `npm run test:scamwin:live-ui` after meaningful UI changes. Distinguish synthetic session checks from real OAuth. Confirm a saved historical result cannot masquerade as a new verification and no official-source route can start Browserless.

## Task 7: Configuration, source review, acceptance and release handoff

**Files:** Modify `.env.example`, `scripts/check-scamwin-config.mjs`, `lib/scamwin/readiness.ts`, `tests/scamwin-config.test.ts`; create the operations document and `scripts/check-scamwin-official-sources.ts`; update catalogue entries only after manual review. Do not change `.env.local`, production variables or deploy during implementation without the appropriate user instruction.

**Interfaces:**

- Feature flag: `SCAMWIN_OFFICIAL_VERIFICATION_ENABLED === 'true'`; absent/other values disable the new path and official navigation. It belongs to the main app only.
- Acceptance CLI: `node --import tsx scripts/check-scamwin-official-sources.ts --company <catalogue-id> --post <public-post-id>`; explicit invocation only, at most one source check under the normal reader budget. Output status, public source ID, timestamps and budget usage; never private input or environment values.

- [ ] **Write red config/acceptance tests:** missing flag disables new reads; flag true with no current catalogue reports limited/unavailable coverage without breaking login or base checks. Configuration checks report presence/status only and make no network calls. Acceptance CLI refuses unknown/expired company and arbitrary URL/private reference inputs. Publisher build excludes new network modules. Add tests for source review expiry and catalogue version revocation if not already covered.
- [ ] **Confirm red:** run `node --import tsx --test tests/scamwin-config.test.ts tests/scamwin-official-catalog.test.ts tests/scamwin-official-navigation.test.ts`; expect new readiness/flag assertions to fail before implementation.
- [ ] **Implement operator setup:** document catalogue owner, dated first-party evidence, exact delegated tenant, canonical listing pattern, public source access constraints and 30-day review renewal. Review one real first-party company source and one delegated source before enabling production. Keep fixtures fictional and clearly labeled. Explain no new API keys, no additional Cloudflare request and no changes to Browserless permission flags. Readiness must distinguish configuration from an actual successful fetch.
- [ ] **Run final local verification:** `npm run test:scamwin`, `npm run lint`, `npm run build`, `npm --prefix publisher run build`; expected exit 0. Run the new official UI check and the existing affected UI suites. Fix and rerun only failures/newly affected checks. No database push or migration should occur.
- [ ] **Prepare a concrete release handoff:** list changed files, reviewed catalogue entries, test results, expected sources per check and rollback instructions. Only after implementation is requested and tested, follow the user's then-current commit/deployment authorization; do not infer it from earlier unrelated approvals. Main Vercel Production gets the new Config flag after source review; existing keys remain in place. Keep Preview fixture-only unless separately configured.
- [ ] **After authorized deployment, accept the feature:** explicitly run the bounded public-source CLI and an owned-account UI check for a real exact listing, an unknown organization, an unavailable source and a known controlled suspicious offer. Verify no extra browser, AI request, automatic navigation, private data in URLs/logs or warning publication. Disable the flag on a failing acceptance check; no paid fallback. Capture the actual source/check times and evidence IDs in the handoff rather than declaring configuration alone a success.

## Completion criteria

- A user can distinguish recognized company sources, reviewed partner routes and exact listing evidence, then choose a clearly sourced official next step.
- Risk, identity, offer match and coverage remain separate; a copied public listing cannot clear an unsafe requested action.
- Official lookups have bounded transport, no new provider keys, no background browsing on result/chat reads and no public-data leak from private inputs.
- Existing Auth0, Browserless/live-view, Neon evidence, quotas and Base Sepolia review/publication behavior continue to pass their checks.
- Resume and job matching features have not been added.

## Planning review record

The design has an implementing task for authority/scope (1), transport (2), offer interpretation (3), evidence/freshness (4), pipeline/risk/follow-up (5), user workflow/navigation (6) and setup/release (7). Shared names/signatures and the five Review Focus cases are pinned above. This checklist is a future execution guide, not a claim that implementation or its tests have already passed.
