# Scamwin Web App Implementation Plan

> **Current plan: all-online, ₹0 hackathon prototype.** Use Vercel Hobby, Cloudflare Workers AI Free, Browserless Free, Trigger.dev Free, Neon Free (including small private raster artifacts), Auth0 Free and Base Sepolia with free test ETH. The [current implementation/status summary](../../scamwin-current-plan.md) and [zero-spend Vercel amendment](2026-11-08-scamwin-zero-cost-vercel-amendment.md) govern this plan. No paid fallback, local investigation worker or mainnet funds are required. Evidence, authorization, consent and the closed arbitrary-host capability gate remain mandatory.

**Implementation status:** The main application and free-provider adapters are implemented and locally tested. This document remains a requirements/work checklist, not a claim that every checkbox or live acceptance check is complete. Remaining product work includes the automatic multi-link picker, elapsed-time counter, security impact/remediation presentation, user-visible cleanup tracking, live operations telemetry, populated official-reference directory and dedicated correction editor. Real OAuth, Neon transport/concurrency, remote-browser capabilities, hosted workers and testnet publication still require configured accounts and live verification. See the [build ledger](../../scamwin-build-progress.md) for recorded results.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document authorizes no implementation, provisioning, spending, deployment, branch, worktree or commit by itself.

**Goal:** Build a responsive Scamwin website that investigates suspicious offers through user intent, bounded technical observations, evidence-linked explanation, related cases and reviewed Web3 warnings.

**Architecture:** Extend OpenMods with a dedicated private-check domain and durable online investigation jobs. Vercel serves the interface and authorized API operations; Trigger.dev runs fixed evidence adapters using remote Browserless sessions and worker-only origin probes. Workers AI interprets evidence without broad shell/browser tools. Neon holds private data and expiring artifacts. A separate publisher-only Trigger project holds the test signing key; current chain reads and local reviewed warnings remain distinct.

**Tech Stack:** Node 24; existing Next.js 16.4.2, React 19.3.0, TypeScript, Tailwind 4, shadcn/Base UI and React Hook Form/Zod; Vercel Hobby; Auth0 Free; Neon Free/Drizzle including bounded private image artifacts; Trigger.dev Free 4.8.1; direct Cloudflare Workers AI Free REST inference; Browserless Free with Playwright 1.64.1; worker-only Node TLS tools; Solidity/OpenZeppelin/Hardhat 3/viem on Base Sepolia. Legacy OpenMods paid-provider integrations are outside the Scamwin runtime.

**Spec:** [Scamwin web app design](../specs/2026-11-08-scamwin-web-app-design.md). Read it with the current summary and budget amendment. Requirements below include unfinished work and later release gates; configuration presence and local tests are not live-service acceptance.

## Global Constraints

- Responsive web app; ordinary users do not create bots, connect wallets, configure agent groups or install an extension.
- Use Auth0; resolve ownership on the server. Retain existing shared forms/components and compatible Drizzle validation patterns.
- Node 24; retain the repository's locked dependency baseline. Check installed Next/Trigger/Playwright documentation and current free-provider capabilities before changing those integrations.
- URL 4,096 characters; combined text 12,000 characters; at most four source images of 10 MiB each, converted to still JPEG at most 160 KiB/image with a 2,048px starting longest-edge cap.
- One selected URL; two documents; three redirects; at most one configured fixture anchor navigation; 100 requests; 15 MiB received; 60 browser seconds; three screenshots; 100 KiB extracted text.
- 240-second active investigation deadline; 300-second worker lifetime including cleanup; global browser concurrency 2; one active check per owner.
- Pilot live network work uses exact operator-owned public origins/assets. Arbitrary public browsing is disabled until network-level release tests pass.
- No consumer payment, form completion, credential/OTP submission, wallet connection/signing, CAPTCHA bypass, downloads, endpoint enumeration or active scanner execution.
- Workers AI has two normal analysis calls, at most three with one shared schema repair, 30 seconds and 1,500 output tokens/call. Follow-up has a separate 30-second deadline and no execution/publication tools.
- Private case evidence is not copied into generic bot MEMORY.md or Trigger chat defaultStorage. Model output cannot create an observation or approve public sharing.
- Application admission caps: 10 investigation starts/day globally, 50/month globally, 3/day/account and one active check/account; 3 warning-review submissions/day/account. Follow-up caps are 20/day globally and 5/day/account. Reservations are atomic; provider quota failure overrides estimates and never starts paid usage.
- Progress polling: 2 seconds active, 10 seconds hidden/reconnecting. Registry reads are bounded and on demand, with daily reconciliation; a chain observation older than 60 seconds is stale. There is no continuous 15-second polling service.
- Base Sepolia 84532; exact public hostnames only; registry validity 1 hour–30 days, application default 7 days; no tokens/staking/user payments.
- Proposed retention targets: private artifacts 7 days, private checks/observations/follow-up 30 days, content-free audit 90 days. Verify provider handling before making public deletion/retention claims.
- Schema changes only through `npm run db:push` against the disposable development database; no migrations or backfills. No automatic branches, worktrees, commits or pushes.

## Review Focus

1. Screenshot-only and multiple/conflicting URLs: preserve provenance; never visit an unconfirmed inferred destination. Owned by Tasks 1, 6 and 9.
2. Apparently successful but intercepted/partial TLS or browser evidence: never label interception as origin trust or missing work as safe. Owned by Tasks 4, 5 and 7.
3. Browser/worker crash during dispatch, cancellation or deletion: no stale result or orphan resources; no duplicate external side effect. Owned by Tasks 3 and 14.
4. Shared legitimate infrastructure and tenant boundaries: no private-case disclosure or unsupported campaign attribution. Owned by Tasks 2, 8 and 11.
5. Reorg, publisher compromise or uncertain transaction broadcast: no stale active warning, duplicate publication or false finality. Owned by Tasks 12 and 13.

## File and responsibility map

All paths below are relative to the `openmods` checkout. This map names the current implementation; task-level file names below are the original conceptual work breakdown and can be consolidated into these modules. Existing unrelated legacy files are not part of the free Scamwin runtime.

| Area | Files |
| --- | --- |
| Domain contracts | `lib/scamwin/contracts.ts`, `input.ts`, `policy.ts`, `analysis.ts` |
| Private persistence | `lib/db/scamwin-schema.ts`, `lib/scamwin/store.ts`, `repository.ts`, `repository-core.ts`, `server.ts`, `dispatch.ts` |
| Artifact lifecycle | Private artifact methods/expiry in `lib/scamwin/store.ts`, authenticated `app/api/scamwin/artifacts/[id]/route.ts` |
| Technical collection | `lib/scamwin/origin-probe.ts`, `collector.ts`, deterministic parsers in `policy.ts`, `official-sources.ts`, `pipeline.ts` |
| AI/correlation | `lib/scamwin/ai.ts`, `analysis.ts`, `correlation.ts`, `pipeline.ts` |
| Public warning domain | Consent/review/roles in `store.ts`, `publication.ts`, `registry.ts`, `registry-normalization.ts` |
| Jobs | `src/scamwin-trigger/investigate.ts`, `maintenance.ts`; `src/scamwin-publisher/tasks.ts`; separate `scamwin.trigger.config.ts` and `scamwin.publisher.config.ts` |
| Web routes | `app/(scamwin)/check/`, `checks/`, `checks/[checkId]/`, `account/`; public `app/warnings/`; role-protected `app/review/`, `app/operations/`; `app/api/scamwin/` |
| Mutations | `app/scamwin/actions.ts` |
| Components | `components/scamwin/` containing shell, intake, progress, decision, journey, evidence, trust, related-cases, follow-up, history, warning and review components |
| Contract package | `web3/contracts/ThreatRegistryV1.sol`, `web3/test/ThreatRegistryV1.test.ts`, `web3/scripts/deploy.ts`, `web3/scripts/read-registry.ts`, `web3/hardhat.config.ts`, `web3/package.json` |
| Contract interface | `lib/scamwin/registry-abi.ts`, `web3/deployments/base-sepolia.json`, shared normalization vectors under `tests/fixtures/scamwin/` |
| Fixtures/checks | `tests/scamwin-*.test.ts` or `.test.mts`, `scripts/check-scamwin-browser.mjs`, `scripts/check-scamwin-network.mts`, `scripts/evaluate-scamwin.mts` |
| Runtime design contracts | `DESIGN.md`, `UX-CONTRACT.md`, `app/globals.css` during UI implementation; preserve existing baseline until accepted changes are implemented |

## Execution order and estimates

Pilot critical path: Tasks 1–9, 11–13 and minimum cleanup/release parts of 14–15. Task 10 follows a working result. Public-host rollout in Task 16 is a separate gate and is not promised inside 48 hours.

Suggested 48-hour split for 3–4 contributors:

| Hours | Main deliverable | Parallel work after interfaces are agreed |
| --- | --- | --- |
| 0–4 | Access checks, typed contracts, fixture scope and schema | Contract package/local tests, UI shell using agreed types |
| 4–12 | Authenticated intake, durable job/progress, artifact ownership | Owned fixtures, fixed collector and origin probes; contract lifecycle |
| 12–24 | Observations, action extraction, intent/explanation, real result | History/evidence screens; reviewed-warning consent/queue |
| 24–34 | Private exact-indicator matches and follow-up | Relay/indexer, independent reader, correction/retraction |
| 34–42 | End-to-end integration and failure/cleanup tests | Responsive/keyboard checks and evaluation fixtures |
| 42–48 | Fixes, deployment smoke tests, rehearsed demonstration | Final fixture evidence and live testnet verification |

If access/network enforcement or contract integration slips, cut optional live preview, QR decoding, graph view and broad reference lookup first. Do not cut ownership checks, evidence provenance, honest partial states, cleanup or testnet labeling. A solo builder should use milestones rather than promise the same work inside 48 hours.

## Task 1: Establish domain contracts and private schema

**Files:** Create `lib/scamwin/contracts.ts`, `input.ts`, `repository.ts`, `admission.ts`, `authorization.ts`, `lib/db/scamwin-schema.ts`; modify `lib/db/schema.ts`, `package.json`; test `tests/scamwin-input.test.ts`, `tests/scamwin-repository.test.mts`.

**Dependencies:** Read repository `AGENTS.md`, installed Next documentation and relevant Trigger skills. Verify Browserless Free account/session capabilities against owned fixtures; leave browser capability gates off if unproven. No paid-provider credentials are prerequisites.

**Interfaces:** Define `CheckInput`, `OfferIntent`, `Observation`, `Assessment`, `CheckView`, `ActionResult<T>` and state unions from the spec. `validateCheckInput(raw: unknown): CheckInput`; `createOwnedCheck(ownerId: string, input: CheckInput, submissionKey: string): Promise<{checkId: string; runId: string; generation: number}>`; `getCheckView(ownerId: string, checkId: string): Promise<CheckView | null>`; `admitCheck(ownerId: string, now: Date): Promise<AdmissionResult>`.

- [ ] Write input tests: empty input fails; message-only/image-only succeeds; text/URL/image limits match the spec; several extracted URLs require an explicit selection; duplicate scalar/file fields and browser-supplied ownership are rejected.
- [ ] Run `node --import tsx --test tests/scamwin-input.test.ts` and confirm failure for missing contracts, rather than an unrelated environment error.
- [ ] Define strict Zod schemas, typed sanitized errors, server-only authorization and all schema tables/indexes from spec section 9. Derive database inserts with compatible drizzle-zod; re-export through the configured schema entry.
- [ ] Implement atomic create/run/outbox insertion using the existing Neon/Drizzle batch pattern, unique owner/submission key, owner-filtered reads and atomic daily/monthly/active admission checks. Same submission key returns the same authorized check; conflicting payload with the same key is rejected.
- [ ] Add repository tests: owner B sees not-found for A's ID, same-key duplicate yields one case, UTC day/month-boundary admission uses server timestamps, reservations survive deletion, and a transaction failure leaves no partial run/outbox rows.
- [ ] Run the focused tests, then apply `npm run db:push` only to the confirmed disposable development database and run a read-only schema/atomicity smoke check. No migration/commit step.

**Deliverable:** An authenticated, private, deduplicated check can exist in storage without contacting a website or AI.

## Task 2: Store artifacts with owner-authorized access

**Files:** Create `lib/scamwin/artifacts.ts`, `app/api/scamwin/artifacts/[artifactId]/route.ts`; reuse `lib/chat-images.ts`; test `tests/scamwin-artifacts.test.mts`.

**Interfaces:** `putArtifact(ownerId: string, checkId: string, input: ArtifactUpload): Promise<ArtifactRef>`; `getOwnedArtifact(ownerId: string, artifactId: string): Promise<ArtifactRead | null>`; `purgeArtifacts(checkId: string): Promise<CleanupResult>`. `ArtifactRef` contains ID/type/bytes/hash/time, not a public URL.

- [ ] Write failing tests for signature/type mismatch, oversize prepared images, unowned check association, foreign reads, and sanitized storage failures.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-artifacts.test.mts`.
- [ ] Store validated, prepared raster bytes in separate owner/check/run-scoped Neon artifact rows with hashes, a 160 KiB/image ceiling, a 200 MiB global artifact cap and seven-day expiry. Intake artifact reservation/insertion is atomic with case creation. There is no required object-storage account, public bucket or original large-image upload.
- [ ] Implement authenticated artifact delivery with no-store/private caching, safe MIME/content disposition and not-found parity. Use raster screenshots; never render remote HTML/SVG or execute collected content in the app.
- [ ] Verify partial upload/purge retries are idempotent and no owner can discover another owner's object through substituted IDs; run focused tests.

**Deliverable:** Screenshots and collected evidence can be shown only to authorized viewers.

## Task 3: Add durable dispatch, progress and cancellation

**Files:** Create `lib/scamwin/lifecycle.ts`, `outbox.ts`, `src/trigger/scamwin-investigate.ts`, `scamwin-dispatch.ts`, `app/api/scamwin/checks/[checkId]/route.ts`, `app/scamwin/actions.ts`; test `tests/scamwin-lifecycle.test.mts`.

**Interfaces:** `createCheck(formData: FormData, submissionKey: string): Promise<ActionResult<{checkId: string}>>`; `transitionRun(runId: string, generation: number, from: CheckState[], to: CheckState, patch?: RunPatch): Promise<boolean>`; `cancelCheck(checkId: string): Promise<ActionResult<{state: CheckState}>>`; `runInvestigation(checkId: string, generation: number, signal: AbortSignal): Promise<void>`. These actions derive the owner server-side.

- [ ] Write failing transition tests for duplicate dispatch, stale generation, cancellation during each active stage, delayed completion after cancel, and crash between DB creation and Trigger dispatch.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-lifecycle.test.mts`.
- [ ] Implement the state machine, generation fencing, outbox leases, `scamwin:{checkId}:{generation}` dispatch idempotency and recovery of queued undispatched jobs.
- [ ] Configure a dedicated Trigger Free task/queue with global concurrency 2, a 240-second active deadline, 300-second task lifetime and explicit stage coverage. Task payload contains IDs only. Do not replay an uncertain remote browser session. The current prototype ends a failed dispatch explicitly and offers a new check after configuration/quota recovery instead of leaving an indefinite normal-looking queue.
- [ ] Implement cancel request before worker cancellation, sanitized polling reads, revisioned progress, and cleanup hooks. Never report cancellation as undoing completed external requests.
- [ ] Verify focused tests plus a mocked worker replay producing one authoritative terminal result and recoverable cleanup status.

**Deliverable:** A saved check starts once, exposes real stages and can be canceled without stale completion overwriting it.

## Task 4: Implement policy and origin HTTP/TLS probes

**Files:** Create `lib/scamwin/policy.ts`, `transport.ts`, `origin-probe.ts`; test `tests/scamwin-policy.test.ts`, `tests/scamwin-transport.test.mts`.

**Interfaces:** `normalizeWebTarget(input: string): WebTarget`; `authorizeTarget(target: WebTarget, policy: CollectionPolicy): Promise<AuthorizedTarget>`; `probeOrigin(target: AuthorizedTarget, signal: AbortSignal): Promise<OriginProbeResult>`; `collectOriginObservations(result: OriginProbeResult, source: ObservationSource): Observation[]`.

- [ ] Write failing tests for credential URLs, unsupported schemes/ports, local/reserved/IPv4-mapped IPv6, mixed public/private DNS, rebind/reconnect behavior, redirect revalidation and confusing IDNA/subdomain boundaries.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-policy.test.ts tests/scamwin-transport.test.mts`.
- [ ] Implement versioned exact-origin/asset scope, selected-URL validation and deterministic normalization. Do not auto-expand policy from AI/page content. The pilot permits only approved origins.
- [ ] Implement address-pinned connections with original Host/SNI, manual redirect handling, response/time/byte caps and verification enabled. Collect valid/expired/mismatched/unknown certificate facts without turning failure into a successful browser load.
- [ ] Add a proxy-interception counterexample test: browser-issued/intercepting CA facts cannot enter `sourceKind: origin_probe`. Test host validation against the configured origin name, not the pinned IP.
- [ ] Run focused tests and owned-fixture live probes only after scope approval. Return `not_checked` if the necessary outbound controls/account support are unavailable.

**Deliverable:** Trust facts come from the intended origin through a bounded transport, with an explicit unsupported state.

## Task 5: Add a fixed remote Browserless collector

**Files:** Create `lib/scamwin/case-sandbox.ts`, `collector.ts`, `scripts/scamwin-collector.mjs`, `scripts/check-scamwin-network.mts`; test `tests/scamwin-collector.test.mts`, `tests/scamwin-sandbox.test.mts`.

**Interfaces:** `createCaseSandbox(run: RunIdentity, policy: CollectionPolicy): Promise<CaseSandboxRef>`; `collectBrowserFacts(target: AuthorizedTarget, run: RunIdentity, signal: AbortSignal): Promise<BrowserCollection>`; `destroyCaseSandbox(ref: CaseSandboxRef): Promise<CleanupResult>`.

- [ ] Write failing tests for fresh-context isolation, denied redirects/subresources, resource limits, download/form/wallet/login boundaries, unknown popup, cancellation and sandbox-creation uncertainty.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-collector.test.mts tests/scamwin-sandbox.test.mts`.
- [ ] Connect to the configured Browserless Free shared-fleet endpoint and create a fresh nonpersistent browser context per attempt. Require the explicit capability gate and exact approved operator-owned origins before connecting. Keep the fixed Playwright collector in the worker; never expose generic bot execution, model-produced commands, user cookies or credentials to a page.
- [ ] Install context-wide request policies before page creation, block service workers/non-GET/HEAD/WebSockets/downloads/permissions, enforce every specified cap and close unexpected popups. Fixture anchor steps are explicitly configured, never chosen by unrestricted agent reasoning.
- [ ] Collect compressed raster screenshots, bounded text/DOM excerpts, redirects, visible forms/action destinations and allowed request metadata. Do not retain cookies/auth headers/response bodies indiscriminately. Persist permitted artifacts in Neon, close the remote session in `finally`/cancel cleanup, and use provider session timeout as a backstop.
- [ ] Exercise owned adversarial fixtures and prove denied destinations receive zero requests from redirect/frame/image/fetch/WebSocket/direct-network attempts. A mocked Playwright route test alone does not pass the network gate.

**Deliverable:** Real observations from approved sites, with per-case isolation and no generic execution surface exposed to the model/user.

## Task 6: Normalize evidence, requested actions and passive findings

**Files:** Create `lib/scamwin/extract.ts`, `evidence.ts`; extend `contracts.ts`; test `tests/scamwin-extraction.test.ts`, fixtures in `tests/fixtures/scamwin/`.

**Interfaces:** `buildObservations(input: CollectionBundle): Observation[]`; `extractIndicators(observations: Observation[]): IndicatorCandidate[]`; `parsePaymentUri(uri: string): PaymentIntent | null`; `collectConfigurationFindings(observations: Observation[]): ConfigurationFinding[]`.

- [ ] Write failing tests for incoming promise vs outgoing `upi:` payment URI, percent encoding, malformed/unsupported payment URI, optional unrelated donation link, exact form destination, and image text that is unreadable or conflicts with a live page.
- [ ] Run `node --import tsx --test tests/scamwin-extraction.test.ts`.
- [ ] Preserve typed facts, source kind/time, supporting quote/DOM reference, artifact hash and policy/collector versions. Separate user statements, rendered observations and inferred meanings.
- [ ] Extract exact domains/recipient strings/endpoints using deterministic parsers. Add QR decoding only if it yields a machine-decoded payload; otherwise display unreadable/not decoded and retain image provenance. Never use a model-guessed QR payload as a recipient.
- [ ] Implement passive response-header/mixed-content/redirect configuration findings with evidence, impact, fix and limitations. Avoid software/CVE claims without an exact supported version mapping; do not probe exposed endpoints or run installed scanners.
- [ ] Run tests proving valid TLS can accompany a deceptive payment flow, missing optional headers do not establish phishing, and shared issuer/CDN does not create a confirmed campaign.

**Deliverable:** Reusable typed facts exist independently of AI narrative.

## Task 7: Ground AI interpretation and apply the risk policy

**Files:** Create `lib/scamwin/intent.ts`, `assessment.ts`, `risk-policy.ts`; modify `src/trigger/scamwin-investigate.ts`; test `tests/scamwin-assessment.test.mts`, `scripts/evaluate-scamwin.mts`.

**Interfaces:** `extractOfferIntent(input: CheckInput, signal: AbortSignal): Promise<OfferIntent>`; `deriveRisk(intent: OfferIntent, observations: Observation[], context: RiskContext): RiskDecision`; `explainAssessment(input: AssessmentInput, signal: AbortSignal): Promise<Assessment>`; `validateEvidenceLinks(assessment: Assessment, observations: Observation[]): Assessment`.

- [ ] Write failing tests for invented evidence IDs, ungrounded recipients/claims, instructions embedded in page/image text, schema refusal/timeout, and each exact risk-policy precedence/coverage rule in spec section 7.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-assessment.test.mts`.
- [ ] Use direct Workers AI Free REST inference for intent extraction and evidence comparison. Allow only the configured approved model, parse/Zod-validate JSON, use deterministic risk assessment after interpretation and run tiny live model/image checks within free allowance. Do not require an old chat provider key or add a paid fallback.
- [ ] Give the analysis model evidence data only, no generic sandbox tools. Mark untrusted inputs clearly; reject unrecognized evidence IDs and unsupported factual claims. Apply deterministic risk policy after interpretation, preserving separate coverage and inference labels.
- [ ] Enforce that only explicit user intent plus the selected observed structured payment checkpoint satisfies the automatic action-mismatch high-risk rule. Semantic-only mismatch yields caution; partial coverage cannot yield an unsupported clean result.
- [ ] Run focused tests and a labeled fixture evaluation with extraction correctness, false high-risk outcomes, grounded evidence validity, inconclusive coverage and measured latency. Record actual results; do not claim a real-world detection percentage.

**Deliverable:** An understandable result whose factual statements can be traced back to observations.

## Task 8: Add official references and private/public correlation

**Files:** Create `lib/scamwin/correlation.ts`, `official-sources.ts`; test `tests/scamwin-correlation.test.mts`, `tests/scamwin-official-sources.test.ts`.

**Interfaces:** `findRelatedCases(ownerId: string, checkId: string): Promise<RelatedCase[]>`; `matchPublicWarnings(hostname: string): Promise<WarningLookup>`; `findOfficialReference(claim: string): OfficialReference | null`. `RelatedCase` includes exact indicator, observation refs, association type and limitations.

- [ ] Write failing tests for exact repeated recipient/endpoint, different same-CDN sites, certificate-issuer-only overlap, cross-owner matching, stale warnings and absent official-reference coverage.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-correlation.test.mts tests/scamwin-official-sources.test.ts`.
- [ ] Normalize private indicators with owner-scoped HMAC lookup and indexed exact matches; retrieve only owned cases. Public matches use reviewed sanitized records and fresh issuer status. No cross-user existence/count side channel.
- [ ] Add a curated official-source directory for fixture institutions/brands, with source URL and verification time. Broader web lookup is later scope; do not treat a search result, logo or similar domain as authoritative.
- [ ] Show “related by this observed indicator” rather than common operator/campaign certainty. Return no-match, unavailable and stale distinctly.
- [ ] Run tests showing the second scam fixture connects through a genuine repeated indicator while the benign same-CDN fixture remains unlinked.

**Deliverable:** A useful, explainable connection between cases without fabricated attribution or private-data disclosure.

## Task 9: Build the consumer web app and complete state handling

**Files:** Create `DESIGN.md`, `UX-CONTRACT.md`, `app/(scamwin)/layout.tsx`, `check/page.tsx`, `checks/page.tsx`, `checks/[checkId]/page.tsx`, `account/page.tsx`, components under `components/scamwin/`; modify `app/page.tsx`, auth return routing, shared navigation/tokens only where needed; create `scripts/check-scamwin-browser.mjs`.

**Interfaces:** Components consume `CheckInput`, `CheckView`, `Observation`, `Assessment`, `RelatedCase` and the owner-authorized actions/reads defined above. `createCheck` is the sole final submit; a form-derived inline restatement requires no extra AI endpoint.

- [ ] Write browser assertions for first visit → Auth0 return destination → new check, corrected inline intent, duplicate submission prevention, polling resume/cancel, every result coverage state, and owner-isolated history.
- [ ] Run the new browser script with mocked service adapters and synthetic local Auth0 sessions; expect missing-route/component failures initially. Keep real OAuth verification separate.
- [ ] Record existing visual tokens/shared primitives in DESIGN/UX contracts, then implement the landing page, shell and form. Keep the familiar Geist/charcoal baseline and make the promise/action/destination journey the signature element. No bot/avatar/wallet setup in consumer navigation.
- [ ] Implement progress with actual stage/elapsed state, 2s/10s polling, stale-response revision guards and terminal stop. Preserve input on local validation/provider failures; session reauthentication uses a separate tab before retrying in-memory input.
- [ ] Implement decision/evidence/coverage/trust/related-case sections, private paginated history, no-match/blocked/partial/inconclusive/failure states and recheck/delete controls. Show captured screenshots as static raster observations; optional live view remains read-only and gated.
- [ ] Test 320px/390px/desktop widths, short viewport, 200% zoom, keyboard/focus, reduced motion, field-linked errors, visible non-color status, long URLs, slow network, reload and out-of-order progress. Verify private search does not leak input in URL parameters.

**Deliverable:** An ordinary person can use the complete private check workflow through a responsive website.

## Task 10: Add evidence-grounded conversational follow-up

**Files:** Create `lib/scamwin/followup.ts`, `components/scamwin/followup.tsx`, owner-authorized streaming route/action; test `tests/scamwin-followup.test.mts`.

**Interfaces:** `answerFollowup(ownerId: string, checkId: string, text: string, signal: AbortSignal): Promise<FollowupStream>`; store messages in `scamwin_messages`, with accepted observation IDs. Chat rendering may reuse existing primitives but not generic bot tool permissions/storage.

- [ ] Write failing tests for foreign checks, invented evidence IDs, “scan this new host” requests, cancellation, unavailable model and reload history.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-followup.test.mts`.
- [ ] Implement a 30-second, bounded-text/turn follow-up over the check's validated observations and directory references. No network/shell/publisher tools; direct new destination checks to the intake flow.
- [ ] Save accepted conversation messages privately, render citations and keep stop/retry/reload semantics without duplicating a message on retries.
- [ ] Run focused tests and browser cases proving follow-up cannot change the saved verdict or silently start another collection job.

**Deliverable:** Users can ask what a finding means and what to verify next in the same case.

## Task 11: Add consent, review and public-warning lifecycle

**Files:** Create `lib/scamwin/roles.ts`, `review.ts`, `app/scamwin/review-actions.ts`, `app/review/page.tsx`, `app/warnings/page.tsx`, `app/warnings/[warningId]/page.tsx`, review/warning components; test `tests/scamwin-review.test.mts`.

**Interfaces:** `submitWarningForReview(checkId: string, draft: PublicWarningDraft, expectedRevision: number): Promise<ActionResult<{submissionId: string}>>`; `reviewWarning(submissionId: string, decision: ReviewDecision, expectedRevision: number): Promise<ActionResult<ReviewResult>>`; `requestRetraction(warningId: string, reason: string): Promise<ActionResult<ReviewResult>>`.

- [ ] Write failing tests for default-private checks, missing/revision-mismatched consent, unowned evidence references, reviewer seeing unshared raw data, nonreviewer approval, stale review version and accidentally broad shared-host warning.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-review.test.mts`.
- [ ] Implement exact public-payload preview and explicit consent bound to canonical payload hash/schema/draft revision; copy selected redacted evidence into an independent seven-day private review packet. A reviewer never receives the entire original check by role alone. Any material draft change returns to the owner for fresh consent.
- [ ] Implement reviewer queue/approve/reject/request-information with compare-and-set revisioning and audit reasons. Approval atomically saves the public sanitized revision plus a publication outbox entry.
- [ ] Add public feed/detail, expiry/correction/retraction/dispute states and warning labels “Reported by [publisher].” Keep review-approved app publication distinct from pending/unavailable chain proof. No public comments or popularity-as-truth voting.
- [ ] Run role/tenant/privacy tests and a browser test where rejected/pending drafts remain absent from public reads. Verify deleting the original withdraws pending review/revokes unleased publication, while published warning history remains independent and review evidence expires.

**Deliverable:** Warning sharing is an explicit moderated workflow, separate from private analysis.

## Task 12: Implement and test the registry and independent reader

**Files:** Create `web3/` package/config/contracts/tests/scripts, `lib/scamwin/registry-abi.ts`, normalization fixtures; test `web3/test/ThreatRegistryV1.test.ts`, `tests/scamwin-normalization.test.ts`.

**Interfaces:** Implement the exact `ThreatRegistryV1` methods/events/normalization in spec section 11. `normalizePublicHostname(input: string): string`; `indicatorId(hostname: string): Hex`; `readRegistryAssertion(deployment: RegistryDeployment, publisher: Address, hostname: string): Promise<RegistryAssertion>`.

- [ ] Create isolated Hardhat 3 + TypeScript/viem/Node test tooling with compatible pinned versions and compiler; write tests before contract bodies. Ordinary app dependencies remain separate.
- [ ] Run `npm --prefix web3 test`, expecting missing implementation failures initially.
- [ ] Implement issuer-isolated records, revision conflicts, operation replay protection, TTL boundaries, activation epochs, two-step owner, guardian suspension, issue pause and unblocked retraction/read behavior. No token/payable/arbitrary-call functionality.
- [ ] Test same-host different-publisher independence; disable/re-enable cannot reactivate old assertions; guardian cannot publish; expiry needs no transaction; event/state data matches normalization vectors.
- [ ] Generate the ABI into the application through a reproducible export script and implement a second reader using RPC/ABI/events only, without the Scamwin API or database.
- [ ] Run contract/normalization tests. Deploy only when an execution/release request authorizes it and necessary accounts are available. Store chain/address/deployment-block/compiler/ABI metadata; no private keys in artifacts.

**Deliverable:** A tested registry can be independently read; the meaning of issuer attribution and status is explicit.

## Task 13: Integrate publisher relay, indexer and registry UI

**Files:** Create `lib/scamwin/publication.ts`, `registry.ts`, `registry-index.ts`, `src/trigger/scamwin-publish.ts`, `scamwin-registry-sync.ts`, public warning lookup/status routes; test `tests/scamwin-publication.test.mts`, `tests/scamwin-registry-index.test.mts`.

**Interfaces:** `publishApprovedWarning(publicationId: string): Promise<PublicationResult>`; `reconcilePublication(publicationId: string): Promise<PublicationResult>`; `syncRegistry(deployment: RegistryDeployment): Promise<SyncResult>`; `lookupRegistry(hostname: string, now: Date): Promise<WarningLookup>`.

- [ ] Write failing tests for crash after broadcast/before DB save, unknown receipt, nonce conflict, replayed outbox, reverted tx, insufficient balance, stale RPC, duplicate logs, reorg and compromised issuer suspension.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-publication.test.mts tests/scamwin-registry-index.test.mts`.
- [ ] Implement a dedicated single-concurrency publisher task with only reviewed payloads and allowlisted chain/contract/functions. Obtain a compare-and-set signing lease against the exact current consent revision; simulate, reserve nonce/operation, record tx, and reconcile uncertain broadcasts before any retry. Once leased, surface publication-in-progress during deletion rather than promising that a broadcast cannot occur.
- [ ] Proposed testnet circuit breakers: at most 25 publication transactions/day, at most 0.001 test ETH estimated fee/transaction and 0.005 test ETH aggregate reserved+spent/day. Reject a transaction that cannot fit; do not silently raise caps. Keep a small separately funded signer, owner/guardian keys outside the analysis worker and signer secret out of all model/collector contexts.
- [ ] Use bounded on-demand direct registry reads for checks and warning details, and a daily publisher reconciliation task. Pin each read to one block and recheck its hash; derive current publisher epoch, suspension, expiry and retraction without treating a local review row as chain proof. Track included/safe/finalized separately and apply the 60-second freshness threshold. A continuous event indexer is not required by this free prototype; any later cached/indexed feed must add duplicate suppression and reorg replay before claiming current state.
- [ ] Verify public-warning display/lookup can fail independently while checks continue; demonstrate publish → second reader observes → retract → both readers update, on clearly labeled testnet/local blockchain.

**Deliverable:** Web3 warnings actually travel to another reader, with explicit failure, correction and freshness semantics.

## Task 14: Complete cleanup, retention and operations

**Files:** Create `lib/scamwin/retention.ts`, `src/trigger/scamwin-cleanup.ts`, protected operations/account controls; extend sanitized monitoring and startup checks; test `tests/scamwin-cleanup.test.mts`, `tests/scamwin-operations.test.mts`.

**Interfaces:** `deleteCheck(checkId: string): Promise<ActionResult<{cleanupState: CleanupState}>>`; `reconcileCaseResources(now: Date): Promise<CleanupSummary>`; `expirePrivateData(now: Date): Promise<CleanupSummary>`; `setOperationalPause(scope: PauseScope, paused: boolean): Promise<ActionResult<void>>`.

- [ ] Write failing tests for deletion during queued/provisioning/running work, failed sandbox deletion, lost create response, worker death, stale lease, orphan object, provider outage and cleanup that must not touch an existing bot computer. Cover deletion before review, before signing lease, after signing lease and after broadcast; verify the exact review-packet lifecycle from spec section 10.
- [ ] Run `node --experimental-test-module-mocks --import tsx --test tests/scamwin-cleanup.test.mts tests/scamwin-operations.test.mts`.
- [ ] Implement immediate owner-read hiding/cancel requests, idempotent Neon artifact/private-content cleanup and remote-session close/timeout. Fence overdue runs at 300 seconds on reads/admission and run daily online retention/outbox maintenance. No VM, object bucket or laptop service is required. User-visible cleanup tracking remains unfinished product work and must not be described as complete.
- [ ] Implement proposed 7/30/90-day app expiration targets with accurate provider caveats. Verify no case content is retained in generic bot memory/default chat storage; explain permanent public-chain history separately.
- [ ] Add reviewer/admin server-side roles, new-admission/new-signature pause controls, resource/feed health and sanitized timing/error codes. Configuration-readiness and pause controls are implemented; live queue/resource/usage telemetry remains unfinished. Do not invent costs or usage; expose only measured values and verified configuration. No raw messages/URLs/images/secrets in logs.
- [ ] Run failure/recovery tests, verify owner/private-data access denial after delete, and confirm retrying cleanup eventually removes only the intended artifacts/resources.

**Deliverable:** The app can stop work, remove private evidence and recover from failures without hidden orphan infrastructure.

## Task 15: Integrate, evaluate and prepare the release

**Files:** Maintain `README.md`, `docs/scamwin-running.md`, `docs/scamwin-setup-guide.md`, `docs/scamwin-current-plan.md`, `scamwin.env.example`, `scamwin.publisher.env.example`, `scripts/check-scamwin-config.mjs` and the separate investigation/publisher Trigger configs; complete browser/network/evaluation scripts. Vercel deployment uses the existing Next.js build, not the legacy hosting blueprint.

**Interfaces:** Readiness separates web liveness from dependency readiness. A public success state must correspond to persisted validated observations; no fixture substitution unless visibly in demo mode.

- [ ] Run focused unit/integration/contract tests; then `npm test`, `npx tsc --noEmit`, changed-file ESLint and `npm run build`. Existing unrelated baseline lint issues are recorded separately, never hidden as new passes.
- [ ] Run synthetic-session browser tests for success, invalid input, cancellation, partial/CAPTCHA/denied redirect, stale progress, session return, no match, consent/review rejection, provider outage and mobile/keyboard access.
- [ ] Run owned live-service checks for Auth0 Free OAuth, Workers AI model/image/JSON support, private Neon artifact access, Trigger Free dispatch/persistence, Browserless Free scope/session closure, origin TLS and Base Sepolia publication/retraction/independent reading. Keep all accounts on Free/Hobby with no automatic paid fallback. Local tests do not replace these checks.
- [ ] Evaluate the labeled fixture set and document observed outputs, false positives/unknowns, latency/usage and limitations. Include benign shared-CDN and valid-HTTPS deceptive page counterexamples.
- [ ] Prepare Vercel Node-24 environment placement, compatible web/worker versions, clean-development `db:push`, artifact expiry, registry manifest, separate publisher-only Trigger project, publisher/guardian separation, readiness checks and rollback. Use included free project URLs and free test ETH; no purchased domain or paid browser add-ons. Do not provision or deploy merely to update this document.
- [ ] On an authorized release, deploy compatible worker first, then web, verify real hosted OAuth/ownership and a complete check/publication workflow. Keep the arbitrary-host feature off until Task 16 passes. Preserve `/healthz` as process liveness, with separate operator readiness diagnostics.

**Deliverable:** A demonstrable web app whose limitations and live integration results are reviewable.

## Task 16: Gate the full public-origin rollout

This is a later release milestone. It is essential for unrestricted real-world browser investigation, not a label that can be enabled after a happy-path demo.

**Files:** Extend `lib/scamwin/policy.ts`, `transport.ts`, `case-sandbox.ts`, collector deployment configuration and network-test fixtures. Add `docs/scamwin-public-collector.md` with the measured network boundary and provider account/SDK versions.

**Interfaces:** `CollectionPolicy.mode` is `owned_fixture` by default; `public_origin` is accepted only when an operator-enabled capability record matches the verified collector image/policy/deployment. Input/model text cannot enable that mode.

- [ ] Prove all browser/probe traffic uses the controlled public-destination egress path; deny direct IPv4/IPv6/UDP/QUIC/WebRTC, local/control-plane/metadata and non-global mixed DNS answers. Pin the actual dialed address and preserve host/SNI.
- [ ] If the selected remote browser provider cannot prove this boundary within approved terms/capabilities, retain owned-fixture mode. A separate hardened collector and larger evaluation would require a new deployment/budget decision before public-host rollout. Do not silently add paid compute or treat request routing/prompts as network isolation.
- [ ] Test DNS rebinding, redirects, iframes, images, fetch, service workers, WebSockets, browser storage isolation, malicious HTML/prompt injection, limit exhaustion, process death and data exfiltration attempts using owned adversarial endpoints. Measure zero connections to denied destinations.
- [ ] Remove fixture-only CTA steps from public mode; observe initial render and automatic redirects, ending at credentials/payment/wallet/login/CAPTCHA boundaries. New public exploration features require separate policy/evaluation changes.
- [ ] Run a larger labeled authorized evaluation corpus, dependency/resource abuse checks, independent tenant-isolation review and actual provider permission verification. Publish accurate retention/provider handling and capability limits before accepting real sensitive public submissions.

**Deliverable:** A measured basis for enabling public-origin observation, with the same private-check UX and explicit limits.

## Configuration and deployment inventory

| Component | Configuration/secrets |
| --- | --- |
| Vercel Hobby web | Auth0 Free settings, APP_BASE_URL, DATABASE_URL, investigation and publisher project dispatch keys, Cloudflare account/token for bounded follow-up, public registry configuration and trusted admin subjects; never the wallet signing key |
| Investigation Trigger Free project | DATABASE_URL, Cloudflare account/token/allowed model, Browserless token/endpoint, exact approved origins and capability flags, private indicator HMAC secret and bounded job settings; no wallet signing key |
| Separate publisher Trigger Free project | Database/outbox access, Base Sepolia RPC, exact chain/contract/publisher settings, dedicated test-only signing key and fee caps; no browser or analysis credentials required |
| Direct registry reads / daily reconciliation | RPC and configured chain/contract/publisher; no wallet key for reads. Existing signed transactions remain eligible for reconciliation during a pause |
| Remote browser page/context | Fixed observation policy and selected approved URL only; no database, AI, Auth0 or wallet secrets are passed into page content |
| Daily cleanup task | DATABASE_URL for owned private artifacts/content and durable outbox recovery; remote sessions use explicit closure/provider timeout |

Use separate development and demo/production settings, private databases and chain manifests. Use the owner's two Trigger project references; cloned identifiers grant no access. The environment templates and `npm run check:scamwin` expose names/presence only, never values. Verify Free/Hobby account eligibility, recurring allowances, testnet faucets and capabilities without purchasing credits or enabling recharge. No laptop worker, paid AI/browser/hosting account, object bucket or mainnet balance is required. If a free allowance is unavailable, stop or mark that module unavailable.

## Acceptance checklist

- [ ] A standard user signs in and completes a private offer check without bot/wallet setup.
- [ ] Each material result statement cites an existing authorized observation.
- [ ] The refund fixture exposes the promised receipt vs selected outgoing-payment action with a real parsed destination.
- [ ] A valid certificate does not clear a deceptive flow; missing optional headers do not establish fraud.
- [ ] Incomplete/blocked/unreadable work stays partial/inconclusive and is never silently green.
- [ ] Exact related cases show their matching reason; another user's private case cannot be inferred or opened.
- [ ] Duplicate/retried/canceled work has one authoritative result and eventual cleanup.
- [ ] Public publication requires consent plus reviewer approval, and contains only the approved public scope.
- [ ] The independent reader sees a genuine registry assertion and its retraction; stale/unavailable data is labeled.
- [ ] Mobile, keyboard, session/reload, provider-outage and cancellation recovery paths work.
- [ ] Public-host mode stays disabled until measured egress and larger evaluation gates pass.

## How a person uses the finished web app

1. **Open Scamwin:** see a simple explanation, an example and Check an offer. A sample is labeled synthetic, so no one mistakes it for a live investigation.
2. **Sign in:** use Auth0 and return directly to the check form. There is no bot creation, technical configuration or wallet connection.
3. **Describe the offer:** paste a message, enter one selected URL manually, add screenshots if useful, and state the promise/intended action. An automatic picker for several extracted links remains unfinished.
4. **Check the details:** review the form-derived promise/action summary, correct it and press Check offer. A saved private check is created once.
5. **Watch progress:** see actual validation, observation, comparison and explanation stages. Cancel if needed, or leave and reopen from My checks. The app clearly states when a site/path cannot be visited.
6. **Read the decision:** understand the specific action risk first, followed by the journey, supporting screenshots/quotes, destinations and uncertainties. Expand certificate and website-security details only if wanted.
7. **Inspect connections:** view owned related cases and separately reviewed public warnings, each with an exact match reason, issuer and freshness. No match is not a safety guarantee.
8. **Ask a question:** ask what a finding means or what to verify next. Follow-up stays grounded in that check and does not secretly act on the suspected site.
9. **Return or recheck:** reopen the saved result, start a fresh check for changed evidence, or delete the private check. Retention/cleanup logic exists, while user-visible cleanup progress remains unfinished.
10. **Optionally help others:** preview a redacted public warning, consent to review and track the decision. An approved warning shows its publisher, expiry/correction history and real chain state, and another client can use it without seeing the original private message.
