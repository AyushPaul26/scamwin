# Scamwin Live Investigation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. This request authorizes planning only; do not begin application implementation from this document alone.

**Goal:** Automatically show the current owner a genuine watch-only browser stream, factual investigation progress and an evidence-linked promise/intention/request comparison in the existing Scamwin check page.

**Architecture:** Mint a LiveURL from the same Browserless page already inspected by the Vercel worker. Keep the temporary locator encrypted in an owner/run-scoped Neon table, release it through a private endpoint and reuse existing progress/result polling alongside the provider's direct stream. Keep the existing investigation rules and separate consent/review/publication workflow.

**Tech Stack:** Existing Next.js 16, React 19, TypeScript, Node 24, Vercel after(), Auth0, Neon/PostgreSQL, Drizzle, Playwright/CDP, Browserless LiveURL, Node crypto, Base UI and app/scamwin.css. No new external provider or Trigger.dev dependency.

**Spec:** [Selected live investigation design](../specs/2026-11-09-scamwin-live-investigation-ui-design.md). Read the complete spec, DESIGN.md, UX-CONTRACT.md and AGENTS.md before execution.

## Global constraints

- Implement actual LiveURL streaming, automatically expanded inside the existing check page. Screenshots are a clearly labelled end/failure fallback, not simulated live frames.
- Preserve 1200 by 800 remote viewport, 60-second browser budget, 240-second pipeline budget and 300-second check/invocation bounds. Do not add display-padding waits, a second inspection session or automatic paid fallback.
- Preserve server-derived ownership, approved-origin/GET-HEAD collection restrictions, risk/coverage separation and explicit publication consent/review.
- The encryption module resolves its key only when live viewing is used; importing shared storage/schema code in the isolated publisher must not require the new main-app secret.
- Reuse the current charcoal/Geist/blue/pink tokens, Base UI controls, reduced-motion behavior and 320px document layout.
- Schema application uses npm run db:push only, with a clean isolated development database for tests. No migration files or backfill. Review production schema push before execution; do not approve any unrelated table/data deletion for this UI feature.
- User-approved planning scope creates only this plan and its design brief. Do not create branches, commits, force-pushes, deploys or application changes automatically. Execution/release must follow the user's subsequent instructions and AGENTS.md.

## Review focus

1. A copied, stale or cross-account viewer locator must not be issued through the app, included in other payloads or retained after cleanup; Tasks 2 and 3 test these boundaries.
2. Cancellation or a delayed collector callback must not resurrect a viewer or overwrite a newer run; Tasks 2 and 4 test generation/session/revision fencing.
3. A browser can finish before the page receives its first frame; Tasks 4 and 5 test accurate capture/ended states without extra browsing time.
4. Concurrent visibility/poll requests can return out of order; Task 5 tests that stale responses neither replace data nor stop current polling.
5. A real selected intention can contradict a model inference; Task 6 tests provenance and evidence links rather than silently replacing the user's choice.

## Ownership and files

| Area | Files | Responsibility |
| --- | --- | --- |
| Provider adapter | New lib/scamwin/live-view-provider.ts | Typed CDP boundary, bounded mint/close/events, trusted regional viewer URL validation |
| Secret protection | New lib/scamwin/live-view-crypto.ts | AES-256-GCM sealing/opening with scope-bound authenticated data |
| Data contracts | lib/scamwin/contracts.ts; new lib/scamwin/live-view-contracts.ts | Stage fields, private live-session records, sanitized owner response |
| Persistence | lib/db/scamwin-schema.ts; lib/scamwin/store.ts | Temporary encrypted rows and atomic lifecycle cleanup |
| Owner endpoint | New app/api/scamwin/checks/[id]/live-view/route.ts | Authenticated, side-effect-free locator delivery |
| Execution | lib/scamwin/collector.ts; lib/scamwin/pipeline.ts; new lib/scamwin/progress.ts | Same-page live hooks and serialized factual progress |
| Presentation | components/scamwin/result.tsx; new live-inspection.tsx, investigation-progress.tsx, decision-comparison.tsx, finding-evidence.tsx | Stable viewer, progress, trace and inline evidence |
| Client state | New hooks/use-scamwin-live-view.ts; DetailLoader in result.tsx | Run-bound locator fetching, stale-response protection and teardown |
| Comparison model | New lib/scamwin/decision-comparison.ts | Pure evidence-cited presentation model, not a new risk engine |
| Styling and setup | app/scamwin.css; DESIGN.md; UX-CONTRACT.md; scamwin.env.example; live setup guide | Existing visual system, two new app settings and release instructions |

## Task 1: Verify the same-session LiveURL capability

**Files:** Create lib/scamwin/live-view-provider.ts, scripts/check-scamwin-live-view.ts, tests/scamwin-live-view-provider.test.ts. Read collector.ts and installed Next route/after/header docs; do not introduce an alternate browser client.

**Interfaces:** Export createWatchOnlyLiveView(cdp, options) returning { liveURL, liveURLId, timeoutMs, targetId }; closeWatchOnlyLiveView(cdp, liveURLId); isApprovedLiveViewUrl(value, providerOrigin). Use a small typed CDP adapter for Browserless extensions rather than weakening Playwright types throughout the codebase.

- [x] Write provider tests asserting one existing page/CDP session, explicit interactable:false, resizable:false, mode:tab, showBrowserInterface:false, type:jpeg, quality:50, captureScale:1, no instructions and timeout bounded by the remaining collector budget.
- [x] Add rejection tests for provider errors, invalid returned lifetimes, non-HTTPS/unapproved hosts, credentials/custom ports, non-live paths and a returned URL containing the provider token. Assert close is bounded/idempotent and raw locator values never enter diagnostic messages.
- [x] Run node --import tsx --test tests/scamwin-live-view-provider.test.ts; confirm the new adapter tests fail before implementation, then implement the boundary and confirm they pass.
- [x] Add an explicit operator capability script: use existing server credentials and the approved refund fixture, mint from that one page, print only supported/readOnly/bounded-lifetime flags, then close the viewer/browser in finally. Never print liveURL, CDP URL, API token or provider raw error.
- [x] During authorized implementation, run node --import tsx scripts/check-scamwin-live-view.ts with configured credentials once. Success means a real supported mint from this account, not a fixture response. If unsupported, report the exact sanitized capability issue and stop live activation; do not upgrade a plan or quietly substitute images.

**Deliverable:** A tested same-session adapter and an account capability result. Mint/close support is verified before dependent live UI work is considered production-ready.

## Task 2: Add encrypted ephemeral persistence with run fencing

**Files:** Create lib/scamwin/live-view-contracts.ts and lib/scamwin/live-view-crypto.ts; modify lib/scamwin/contracts.ts, lib/db/scamwin-schema.ts and lib/scamwin/store.ts; extend tests/scamwin-store.test.ts and tests/scamwin-postgres.test.mjs; create tests/scamwin-live-view-crypto.test.ts.

**Interfaces:** Define LiveViewScope={ownerId,checkId,runId,generation}. Define LiveViewRecord={sessionId,scope,status,encryptedLocator,createdAt,expiresAt,connectedAt?,endedAt?,reasonCode?}, where status is ready, connected, ended or unavailable. Export sealLiveViewLocator/openLiveViewLocator with the record scope, session ID and expiry as authenticated data. Extend ScamwinStore with putLiveView(scope,record):Promise<boolean>, getLiveView(ownerId,checkId,expectedRun:{runId:string,generation:number}):Promise<LiveViewRecord|null>, and updateLiveView(scope,sessionId,patch):Promise<boolean> for connected/end/unavailable transitions. The patch does not accept a replacement locator; end/unavailable transitions clear it internally.

- [x] Write tests for successful AES-GCM round trip and rejection of modified ciphertext, tag, owner, check, run, generation, session ID, expiry or encryption key. Accept SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY only as 64 hex characters; never reuse AUTH0_SECRET or the correlation HMAC key.
- [x] Add scamwin_live_views with a random session primary key, owner/check/run/generation, bounded status, nullable encrypted locator, created/expiry/connected/end times and bounded reason code. Add unique(checkId,runId,generation), owner/check and expiry indexes. No plaintext locator field or CheckRecord secret field.
- [x] Implement identical MemoryStore and PostgresStore semantics: saving/connecting requires the current nondeleted, unexpired collecting check and matching run/generation; a terminal session cannot be resurrected. Owner reads also enforce browser-stage activity, current run identity and expiry.
- [x] Cover cross-owner reads, stale save, cancel-versus-save, late connection after end and old-session-finally versus new run. Serialize atomic SQL eligibility with the check row so cancellation cannot race a new ready row into existence.
- [x] Wire ciphertext clearing/session retirement into cancellation, deletion, terminal updates, expireOverdue, admission's overdue sweep and purgeExpired. Preserve existing evidence/quota/publication behavior. A late cleanup must match its exact session ID.
- [x] Apply schema using npm run db:push only against the isolated clean development database. Run focused store/crypto tests and the existing isolated Postgres test harness; require passing ownership/race/cleanup assertions, not just type compatibility.

**Deliverable:** No plaintext locator in stored generic records, complete owner isolation and bounded cleanup across every run-ending path.

## Task 3: Expose the live viewer only to its current owner

**Files:** Create app/api/scamwin/checks/[id]/live-view/route.ts and lib/scamwin/live-view-server.ts; modify app/api/scamwin/checks/[id]/route.ts for sanitized viewer status only, lib/scamwin/readiness.ts and scamwin.env.example; create tests/scamwin-live-view-api.test.ts.

**Interfaces:** Export getOwnedLiveViewResponse({subject,checkId,expectedRunId,expectedGeneration,store,env}). Response is either {state:'ready'|'live',sessionId,runId,generation,viewerUrl,issuedAt,expiresAt} or {state:'starting'|'ended'|'unavailable'|'expired',runId,generation,reasonCode?}. The generic detail response may include sanitized state/sessionId/times only, never viewerUrl or encryptedLocator. Expected run identity is supplied in bounded request headers and compared with the server's owned record; it is not authorization.

- [x] Write API tests for unauthenticated 401, cross-owner/not-found 404, stale run, deleted/canceled/terminal/expired check, unavailable capability, valid owner and malformed headers. Assert private,no-store responses and that errors never echo a locator, ciphertext or API key.
- [x] Authenticate using requireScamwinUser, confirm the owned current check/run, obtain its row and decrypt only for a ready/connected unexpired current session. Validate the provider origin again before returning a URL.
- [x] Ensure this GET does not schedule an investigation, mint a URL or start a new browser. A viewer refresh only attaches to the existing live session.
- [x] With the feature flag false, skip new live-table reads in generic detail/bootstrap paths and do not require an encryption key. Roll out the new table before app code that references it; the flag is not a substitute for correct schema/deployment ordering.
- [x] Assert locator/key absence from check/history/list responses, observations, artifacts, follow-up inputs, public warnings and reviewer records. Add a separate readiness item for live viewing without changing basic configured gating.
- [x] Document the existing credential reuse and two proposed settings: SCAMWIN_LIVE_VIEW_ENABLED=true and a generated SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY. Keep both server-side, with the key a Vercel Production Secret. Do not generate or request its value during planning.
- [x] Run node --import tsx --test tests/scamwin-live-view-api.test.ts tests/scamwin-live-view-crypto.test.ts and npx tsc --noEmit. Require the stated authorization/serialization tests to pass.

**Deliverable:** One private capability-delivery endpoint; public/generic data paths remain incapable of exposing a viewer.

## Task 4: Publish truthful stages and attach the viewer to the actual collector

**Files:** Modify lib/scamwin/collector.ts, lib/scamwin/pipeline.ts, lib/scamwin/contracts.ts and lib/scamwin/store.ts; create lib/scamwin/progress.ts; extend tests/scamwin-pipeline.test.ts, tests/scamwin-providers.test.ts and tests/scamwin-browser-health.test.ts; create tests/scamwin-live-view-lifecycle.test.ts.

**Interfaces:** Extend CheckStage with optional startedAt, finishedAt and a bounded detailCode; statuses are pending, running, completed, unavailable, blocked, skipped and canceled. Six stable IDs: intake, browser, trust, registry, comparison, assessment. Export createProgressWriter(checkId,generation,store) with awaited beginStage, detailStage, finishStage and flush methods. Add awaited collector hooks onProgress({phase,status}), onLiveViewReady({locator,appliedTimeoutMs}) and onLiveViewEnded({reasonCode}); add a sanitized viewer-connected hook for the current locator ID. At termination finish the active stage honestly and mark unstarted stages skipped.

- [x] Write lifecycle tests demonstrating mint-before-navigation, listener setup before URL disclosure, same inspected page/context, real connection-event state and close on normal exit/error/cancel/deadline. Viewer mint/persistence failure must not turn an otherwise valid evidence collection into a fabricated successful viewer.
- [x] Use one serialized progress writer that reads the latest revision before each awaited store patch. Test callback collisions, cancellation and delayed events; no fire-and-forget progress write may regress a revision or abort a valid run as stale_run.
- [x] Initialize all six stages in newCheck, update their real server timestamps at the actual operations, and record browser connect/navigate/read/capture detail. Mark unavailable/blocked work accurately; keep existing overall states and assessment policy. Never report a stage completed before its awaited operation finishes.
- [x] Create a random app session ID, mint the watch-only URL from the page CDP, validate/encrypt/persist it and then navigate. Use documented Browserless.liveViewerConnected/liveComplete events for metadata; do not infer streaming success from iframe load or a fabricated parent message.
- [x] In finally, end the matching DB session, attempt Browserless.closeLiveURL with a short bounded cleanup deadline and close the browser regardless of earlier cleanup failure. Provider lifetime remains the crash backstop. A viewer error does not change an evidence-based risk label.
- [x] Keep locator lifetimes below the remaining 60-second collection budget and source-run deadline. Do not reconnect/extend the provider or wait for a viewer just to make the animation visible. Text-only/demo/out-of-scope checks never mint a live session.
- [x] Run the focused lifecycle/pipeline/provider tests and npm run test:scamwin. Require generation-fence, same-browser, no-secret and cancellation assertions to pass; recheck current partial/high-risk behavior.

**Deliverable:** Real collector activity drives stages, and the actual browser is privately watchable only for its real lifetime.

## Task 5: Build the auto-opening watch-only inspection panel

**Files:** Create components/scamwin/live-inspection.tsx, components/scamwin/investigation-progress.tsx and hooks/use-scamwin-live-view.ts; modify components/scamwin/result.tsx, app/scamwin.css and scoped Next headers in next.config.ts if required. Create tests/scamwin-live-view-state.test.ts and extend scripts/check-scamwin-controls-ui.mjs.

**Interfaces:** LiveInspection consumes {checkId,runId,generation,browserStage,liveStatus,capture,demo}. The hook consumes that identity and returns the discriminated live response, a safe error and an explicit reconnect callback. InvestigationProgress consumes the six saved stages and server timing. Keep these transport types browser-safe and separate from the server encryption module.

- [x] Write state tests: owned real active session auto-expands; manual collapse survives polls; a new run resets it; demo/text-only/unavailable states never open a viewer; rejected old revisions cannot replace data or stop polling. Use one-in-flight/sequence fencing in DetailLoader and the live hook.
- [x] Keep existing 2-second visible/10-second hidden detail polling. While the browser stage is active and no locator is ready, use a bounded 1-second owner-endpoint poll only in a visible tab; stop when ready, ended or unavailable. Abort pending reads on run change/unmount/session expiry. Reconnect reuses the same session and never starts another check.
- [x] Render one stable keyed iframe for the current session; do not reload it on every revision/timer tick. Use sandbox='allow-same-origin allow-scripts', referrerPolicy='no-referrer', a descriptive title and explicit denial of clipboard/camera/microphone/location. Grant no forms/popups or user control. Remote server interactable:false remains authoritative.
- [x] If a CSP exists, extend its frame-src only for the configured validated regional Browserless host; preserve other protections. The stream WebSocket runs inside the provider frame, so do not broadly relax the parent's connect-src. No postMessage completion handler is needed; the provider documents backend event relay.
- [x] Render preparing/connecting/live/interrupted/unavailable/ended states honestly. On collection end unmount the frame and render the owner artifact with Captured screenshot and observed time. Handle a session finishing before the first frame, capture expiry and missing image without hiding saved findings.
- [x] Implement the desktop two-column inspection/timeline and mobile stacked layout with current tokens. Keep focus/scroll stable, make collapse/reopen/cancel keyboard-accessible, respect reduced motion and do not announce the timer each second.
- [x] Run meaningful browser fixtures at 1440px, 375px and 320px: stable iframe identity, no overflow, automatic in-page opening, delayed response from another check ignored, frame teardown on cancel/delete/logout/navigation, timer reload behavior and accurately labelled fallback. Use a controlled fake viewer for deterministic UI checks, clearly separate from the real-provider acceptance in Task 7.

**Deliverable:** A responsive real-session viewer and timeline, automatically visible during inspection and resilient to polling and lifecycle changes.

## Task 6: Present the promise, selected intention and observed request clearly

**Files:** Create lib/scamwin/decision-comparison.ts, components/scamwin/decision-comparison.tsx and components/scamwin/finding-evidence.tsx; modify components/scamwin/result.tsx, components/scamwin/core.tsx and components/scamwin/intake.tsx only where labels need clarification, app/scamwin.css and lib/scamwin/demo.ts; create tests/scamwin-decision-comparison.test.ts.

**Interfaces:** Export deriveDecisionComparison(check,observations):DecisionComparison. Its three fields carry {text,provenance,evidenceIds}; provenance distinguishes user_stated, extracted, observed, inferred and unknown. Include a separately cited observedDestination. The helper is presentation-only and does not mutate Assessment or introduce a new risk classifier.

- [x] Write tests for the controlled refund, consistent offer, text-only input, missing destination, inferred-only request, expired capture and contradictory model/user intention. Assert the explicit input.intendedAction remains the user's intention and unknowns are not filled from guessed destinations.
- [x] Prefer the stated promise; label extraction if no stated promise exists. Derive request/destination only from eligible observations. For an AI semantic_mismatch, preserve inference and link its basedOnEvidenceId alongside the interpretation record.
- [x] Display the three comparison fields with a restrained connecting trace. Highlight a confirmed mismatch only when existing findings support it. Keep amount, direction and quote close to their evidence link; retain full observation details as expandable secondary content.
- [x] Put key findings/coverage first, show captures inline with accessible enlargement and keep follow-up/sharing controls intact. If factoring shared trace visuals from Journey, preserve its existing caller semantics and label intake selections Your intended action.
- [x] Keep registry lookup in the checking timeline and sharing separate after assessment. Review/consent/testnet publication must not start because the user views or enlarges evidence. Synthetic demo remains explicitly synthetic and never creates a viewer.
- [x] Run the comparison tests and the existing UI/controls checks. Verify evidence deep links, inference labels, form-preserved failures, follow-up retries and warning consent still work.

**Deliverable:** The USP is visible in the result without changing its meaning or inventing observed actions.

## Task 7: Verify the integrated feature and document release

**Files:** Update DESIGN.md, UX-CONTRACT.md, docs/scamwin-live-setup.md, docs/scamwin-setup-guide.md and any new test scripts' usage notes; create app/lab/live-view-checkpoint/route.ts and extend tests/scamwin-lab-fixtures.test.ts for a controlled read-only verification target. Do not rewrite unrelated deployment plans or migrate the publisher.

- [x] Update design/UX contracts with the approved panel, exact state/timing behavior, owner-only capability delivery, single-session lifecycle, scope and failure copy. Add the two app settings to setup guidance and secret-free configuration checks.
- [x] Add a clearly fictional approved-origin live-view training fixture with a harmless editable canary field, no submitting form, the existing disabled payment-shaped example and restrictive CSP. The bounded capability script can use it after staging deployment to compare the field before/after attempted viewer input through the real stream. Do not insert probe fields into ordinary inspected pages or pad the fixture to prolong a session.
- [x] Run npx tsc --noEmit, npm run test:scamwin, focused ESLint on changed source/test files and existing Scamwin UI/control checks. Run npm run build with the normal build environment. Do not run live mutations or DB push against production as a substitute for isolated tests.
- [ ] In an authorized staging/demo deployment, first review/apply the additive new table using db:push, stopping for any unrelated destructive proposal. Reuse the existing Browserless token; deploy the main app with the generated encryption secret and the enable flag false. Verify the bounded capability, then deliberately enable the flag for live acceptance. Keep the publisher project unchanged. The existing demo domain/Auth0 application can be used; a new external account is not required. If a separate staging domain is chosen, register its Auth0 callbacks and approved origin before testing rather than assuming Production secrets apply to Preview.
- [x] Perform a real provider check on an approved controlled page: observe actual streamed frames, verify attempted input cannot change a harmless controlled field, verify responsive scaling does not resize the remote viewport, then confirm close/capture/result transitions. Record sanitized capability, duration and pass/fail evidence without URLs/keys in screenshots or logs.
- [x] Verify second-account denial, refresh during inspection, manual collapse/reopen, network interruption, quick completion, cancel/delete, expired image and provider-unavailable behavior. Confirm old links stop when the browser closes or their applied timeout expires.
- [x] Verify the same refund assessment and cited findings, saved history and evidence-only follow-up, and an optional warning preview without publishing as part of UI verification.
- [ ] Give the user a concrete release summary and any values they must add. Commit/push/deploy only under the user's explicit release authorization. Keep SCAMWIN_LIVE_VIEW_ENABLED=false available as a rollback switch if the viewer fails; never relabel a still image as successful live streaming.

**Done means:** the selected actual stream works for the account and auto-opens for its authenticated owner, all stages/trace facts come from real saved data, and privacy/lifecycle/responsive tests pass. UI polish alone is not completion.

## Settings answer for the user

No new external API keys or accounts are planned. Existing keys already in Vercel can be reused. The only proposed additions are one Config enable flag and one generated Secret encryption key in the main Scamwin project. No key values are requested or generated by this planning task.

## Plan self-review

- The selected live/automatic behavior is owned by Tasks 1, 4 and 5; the other selected UI improvements are owned by Tasks 4 and 6.
- Every temporary credential has an owner/run/generation/expiry boundary and cleanup/test owner in Tasks 2 and 3.
- Same-session streaming, real progress, current deadlines and a truthful capture fallback are covered without introducing Trigger or another service.
- No production data migration, new risk engine, arbitrary-site expansion, recording, remote control or automatic warning publication is included.
- All task interfaces are named above; no application implementation has been performed by creating this plan.


## Implementation verification — 10 November 2026

The implementation is in the current checkout, uncommitted as required by AGENTS.md. Real Browserless account verification minted a bounded viewer; a separate 22-second synthetic-canary acceptance session verified streamed frames, backend connection, blocked typing/navigation, preserved remote viewport and acknowledged close. Application-shell browser tests used explicitly synthetic intercepted responses: 114 checks at 1440/375/320px. Existing UI and controls suites passed 36 and 15 checks. No application warning was published.

The schema was applied additively to the configured Neon database using `npm run db:push`, and the new table was confirmed by a read-only metadata query. Isolation/ownership/race assertions use PGlite with zero external requests; the schema push was not a substitute for those tests. This records a rollout-order adjustment from the plan's isolated-development-database wording. No unrelated destructive schema proposal was accepted.

The existing provider credentials are reused. A dedicated local encryption key and ignored two-setting Production import file were prepared without printing secret values. The main and isolated publisher builds passed. Final standalone type, unit and lint checks are recorded in `.trigger/live-ui`. Publishing the code and importing the two Vercel settings remain a release step requiring the owner's explicit git authorization. The publisher needs no new secret, but its packaged shared-store closure includes the pure progress and live-contract modules.
