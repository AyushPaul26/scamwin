# Scamwin build ledger

Plan: `docs/superpowers/plans/2026-11-08-scamwin-web-app.md`, with the zero-cost Vercel amendment authoritative.

## Decisions and preflight

- Ruling: retain the current checkout and leave all changes uncommitted, as required by AGENTS.md; no branch/worktree/commit/push is authorized.
- Ruling: implement the approved all-online free-tier prototype, with arbitrary-host live collection disabled until its capability gate is independently established.
- Ruling: provider credentials are absent in this checkout. Build real adapters and mock-backed integration tests; show explicit unconfigured states and a separately labeled read-only synthetic demo. Never silently substitute a demo for a real investigation.
- Baseline install: plain `npm ci` failed with peer-graph/lock mismatch; `npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund` installed 1,317 locked packages successfully. Add `.npmrc` to make that resolution reproducible.
- Parallel file ownership: data agent owns contracts/schema/store/repository; UI agent owns consumer pages/components/design contracts; Web3 agent owns isolated contract package/ABI/normalization; root owns policy/providers/pipeline/server integration/deployment/testing.
- Existing Next.js and Trigger SDK bundled documentation is now available. Read relevant files before changing framework/worker code.

## Milestones

- [x] Typed domain contracts, strict input validation, real data adapter and isolated test store.
- [x] Evidence extraction, risk rules, bounded Cloudflare/Browserless/origin adapters.
- [x] Durable job lifecycle, cancellation and free-quota gates.
- [x] Consumer web app and explicit synthetic demo.
- [x] Private history/evidence/follow-up, consent/review/public warnings.
- [x] Registry contract, direct fresh reads and independent reader.
- [x] Retention/operations/configuration and Vercel preparation.
- [x] Final integrated tests/typecheck/build/browser QA after the operational controls and mobile consent-dialog fix.

## Implementation map

| Plan tasks | Current implementation |
| --- | --- |
| 1–3 | `lib/scamwin/contracts.ts`, `input.ts`, `store.ts`, `repository*.ts`, `lib/db/scamwin-schema.ts`, `dispatch.ts`, owner-only actions/API and dedicated Trigger investigation task |
| 4–7 | `policy.ts`, `origin-probe.ts`, `collector.ts`, `ai.ts`, `analysis.ts`, `pipeline.ts`; deterministic payment direction, source provenance, bounded external APIs and explicit unavailable states |
| 8 | `correlation.ts`, indexed owner-scoped HMAC fingerprints and curated `official-sources.ts`; no infrastructure-only campaign attribution |
| 9–11 | `components/scamwin`, consumer routes, Auth0 return flow, private history/evidence/follow-up and explicit consent/review/public-warning views |
| 12–13 | Isolated `web3` package, generated ABI, independent RPC reader, `registry.ts` and fenced offline-signing `publication.ts`; separate publisher-only Trigger project |
| 14 | Expiry-filtered reads, lazy 300-second run fencing, daily cleanup, admission/signing pause controls, private warning status and sanitized readiness/configuration |
| 15 | Local verification and independent integration reviews; real accounts/OAuth/Neon transport/remote browser/testnet acceptance remain pending owner configuration |
| 16 | Arbitrary-host rollout remains disabled intentionally under the free-tier amendment; no network-isolation proof or broad real-world accuracy claim |

## Integration decisions

- The original R2/Daytona/OpenAI paths were superseded by the accepted zero-cost amendment. Prepared raster bytes live in expiring Neon artifacts; no migration files were created.
- Reviewed app warnings and current on-chain assertions remain separate. Direct RPC reads replace continuous index polling in this prototype. One publisher project holds the test signing key; the analysis project never needs it.
- A failed Trigger dispatch ends that check explicitly rather than leaving it queued or silently retrying uncertain execution. A new check after configuration/quota recovery is a new admission.
- QR payloads are not machine-decoded in this version. Screenshot provenance is retained; model-guessed image data never becomes a structured payment recipient. Only parsed live checkpoint URIs qualify for the payment-direction rule.
- Existing OpenMods bot/chat sources remain in the checkout. Scamwin uses dedicated routes/tasks and does not call their paid provider runtime.
- The initial build created no branch, worktree, commit, push, cloud resource, schema push or chain broadcast. On 9 November 2026 the owner explicitly authorized committing/publishing the current `main` to `AyushPaul26/scamwin`. Hosting, database and chain deployment remain separate setup steps.

## Verification

- `npm run test:scamwin`: **82 tests passed**, zero failed/canceled. Includes typed inputs, policy/risk, provider failures, pipeline/cancellation, artifacts, private HMAC correlation, review/consent, quotas, outbox separation, operational pauses and real PostgreSQL SQL execution.
- PostgreSQL test uses PGlite 0.5.15: **487 actual store statements**, 14 schema-derived tables plus keys/indexes, zero external requests. It does not prove independent Neon-session concurrency or HTTP transport.
- `npm --prefix web3 test`: **11 passed**, including contract behavior and the independent RPC reader. App ABI exactly matches the compiled artifact (24 functions, seven events).
- Changed app/backend/worker/test ESLint check: exit 0. Production `next build` in `.next-verify`: exit 0, including framework TypeScript checking.
- Final production UI: **36 main-flow checks + 15 controls checks passed** at 1440/375/320px, both commands exit 0, zero browser runtime errors. Includes evidence disclosure, missing destination honesty, client validation, explicit action choice, unsaved-state/focus handling, signed-out server rejection, admin/reviewer/owner views and fresh consent. A production-only mobile dialog positioning defect was reproduced, fixed and verified with an explicit viewport-geometry assertion.
- Full repository suite: **175 tests, 155 passed, 19 failed, one canceled**. The failed/canceled test-name set exactly matches the pre-build baseline (**93 tests, 73 passed, 19 failed, one canceled**). All 82 added tests pass. The pre-existing failures concern the generic OpenMods bot/chat/Daytona/desktop/sandbox/usage runtime; no full-suite passing claim is made.
- Integration findings and corrections: `docs/scamwin-integration-review.md` and `docs/scamwin-persistence-review.md`.

Real Auth0 OAuth, remote Neon transport/concurrency, free-provider account/capability acceptance, hosted Vercel/Trigger behavior and Base Sepolia publication still require owner-supplied configuration. No deployment or real-service acceptance is inferred from local tests.

Initial verified preview: a local production bundle at `http://localhost:3001`. Source publication follows the owner's 9 November authorization; verify the current commit in `AyushPaul26/scamwin` before importing it into Vercel. Setup/run instructions are in `docs/scamwin-running.md`. The interactive demo is always marked synthetic and does not call external investigation providers.

Pre-publication verification on 9 November: 82 Scamwin tests and 11 Web3 tests passed again. Pending-file review found no real credentials; secret files, dependencies, build artifacts and the generated local `premium-audit.json` are excluded. This check did not audit the complete upstream Git history. No GitHub Actions workflows are present in the source checkout.
