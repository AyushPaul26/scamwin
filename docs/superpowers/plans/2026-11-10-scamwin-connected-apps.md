# Scamwin Connected Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect authorized apps to Scamwin with Manual, Selective automatic and All new items modes, complete per-item coverage accounting, private account alerts/history and reviewed official alternatives while preserving current features.

**Architecture:** Provider adapters persist authorized source revisions in a separate connector database. A bounded Cloudflare scheduled wakeup and authenticated Vercel dispatcher admit child checks into the existing investigation engine only when execution capacity and quotas are available. Account pages project source coverage, existing saved checks and private alerts; explicit public-warning review and the isolated Web3 publisher remain unchanged.

**Tech Stack:** Existing Next.js 16.4/React/TypeScript, Auth0, Zod/RHF/Base UI, Neon/Postgres/Drizzle, Cloudflare Workers AI, Browserless, Vercel Fluid Compute, existing Base Sepolia publisher; add a tiny Cloudflare Worker scheduler, provider OAuth/Bot API adapters and optional standards-based Web Push. Exact new dependency versions are verified at execution, not installed while planning.

**Spec:** [Connected-apps design](../specs/2026-11-10-scamwin-connected-apps-design.md). Read it before executing any task.

**Status:** Implemented locally and resumed for integration fixes and final verification on 2026-11-10. Provider/runtime/account code and offline operator tools are present in the uncommitted working tree. Real provider grants, installations, isolated cloud database setup and schema push, scheduler deployment and live acceptance remain pending. The checkboxes below retain the original acceptance checklist; unchecked live steps must not be read as completed by local fixtures. See [the setup guide](../../scamwin-connected-apps-setup.md) and [recovery verification](../../scamwin-connected-apps-recovery.md).

## Global constraints

- Manual, Selective automatic, or All new items is chosen per connection. All new items must not silently apply suspicion filtering, sender whitelists or bot-based exclusions.
- Existing manual checks remain available. Email forwarding is excluded.
- Historical import is off by default. Initial coverage starts at the recorded activation boundary.
- Preserve /check, /checks, existing /checks/[checkId], /warnings, /account and current consent/reviewer/publisher boundaries.
- Existing private checks: 30 days; images: seven days. Connector body/context: at most 30 days; bounded metadata/activity/alerts: 90 days.
- Use a separate empty Neon Free project named scamwin-connectors with a database named scamwin_connectors. Existing DATABASE_URL and check tables remain unchanged. Never run connector DDL against the main database.
- No migration files, main-db reset, backfill or historical record rewrite. Only an explicitly authorized npm run db:push with the connector config may apply connector schema changes.
- Existing global limits of 10 investigations/day and 50/month remain. Automatic sublimits: eight/day and 40/month globally, one/day per owner by default with a selectable maximum of two, and one concurrent automatic run globally.
- Current 240-second investigation and approximately 300-second admitted-check lifetime remain. Connector backlog is stored before main check admission.
- Parser limits: 256 KiB decoded text, 200 distinct URLs and 20 attachment metadata records per revision; existing four prepared raster images per child and 12,000-character child input limits remain. Limits produce partial/not-checked coverage, never fabricated completion.
- Tick maxDuration 55 seconds; drain maxDuration 300 seconds; Cloudflare scheduler every 15 minutes, adjustable to 30 minutes to preserve free allowance. No always-running laptop or paid fallback.
- Root AGENTS.md, DESIGN.md and UX-CONTRACT.md apply. Do not add a runtime='nodejs' export incompatible with this Cache Components setup; keep the default Node runtime.
- Keep publisher keys isolated. No connector content or credential is automatically published. No Gmail/Outlook send/delete permission or Telegram reply/delete permission is required for this checking product.
- Follow the current checkout. Commits/pushes/worktrees require the user's explicit authorization in the current execution request; task completion is a review checkpoint, not an automatic commit instruction.

## Review focus

1. A message containing many links, only text or unsupported attachments must have honest per-target coverage; owned by Tasks 1 and 3.
2. An OAuth account mismatch, Telegram link replay or disconnect during processing must not expose another user's data or revive access; owned by Tasks 4 and 8.
3. A crash between the two database commits or after outbox acknowledgement must not duplicate checks, lose pending work or claim completion; owned by Task 3.
4. Provider history expiry, out-of-order edits and a saturated inbox must not advance cursors past unsaved work or silently skip All-mode items; owned by Tasks 5-8.
5. Permission-denied/unsupported device notifications, stale UI responses and public-warning lookalikes must preserve a usable, private dashboard; owned by Tasks 2 and 9.

## File and interface map

### Shared connector foundation

- Create lib/scamwin/connectors/contracts.ts: bounded Zod contracts, source/revision/target/job/alert/connection states and provider capabilities.
- Create lib/scamwin/connectors/policy.ts: mode selection, consent epoch, scope and lifecycle policy.
- Create lib/scamwin/connectors/crypto.ts: versioned credential encryption, context binding, HMAC identifiers and dispatch verification.
- Create lib/db/scamwin-connector-schema.ts, drizzle.connectors.config.ts, scripts/check-scamwin-connector-database.mjs: isolated schema/target guard.
- Create lib/scamwin/connectors/store.ts and repository.ts: owner/epoch-bound persistence, cursors, deduplication, leases and retention.
- Create normalization.ts, targets.ts, sync.ts, admission.ts, runner.ts, reconcile.ts, limits.ts under lib/scamwin/connectors: bounded import and scheduling responsibilities.

Core interfaces, defined and tested before adapters:

    type ProviderId = 'gmail' | 'outlook' | 'telegram' | 'slack' | 'teams' | 'discord' | 'drive' | 'extension';
    type ConnectionMode = 'manual' | 'selective' | 'all_new';
    type ConnectionRef = { id: string; ownerId: string; epoch: number; provider: ProviderId };
    type SyncBudget = { deadlineAtMs: number; maxItemIds: 50; maxBodies: 10; maxBodyBytes: 262144 };
    interface ProviderAdapter {
      capabilities: ProviderCapabilities;
      pullChanges(connection: SavedConnection, cursor: SyncCursor | null, budget: SyncBudget, signal: AbortSignal): Promise<ProviderPage>;
      readItem(connection: SavedConnection, reference: ProviderItemRef, signal: AbortSignal): Promise<ProviderItem>;
      revoke(connection: SavedConnection, signal: AbortSignal): Promise<RevocationResult>;
    }

All named SavedConnection, ProviderCapabilities, SyncCursor, ProviderPage, ProviderItemRef, ProviderItem and RevocationResult types live in contracts.ts. ProviderPage contains immutable item references, resumable page state, final cursor only when the range is complete, and explicit gap/unavailable information. Telegram push delivery uses the same ProviderItem normalization contract; unsupported pull/history capability is declared, never simulated.

### Account and API surface

- Modify components/scamwin/core.tsx: existing Shell navigation, Ayush menu, bell, configurable Confirm labels and unique SearchBox IDs.
- Extend components/scamwin/account.tsx for Overview without losing existing identity/privacy/service status.
- Create components/scamwin/account-nav.tsx, connections.tsx, private-alerts.tsx and activity.tsx; reuse core primitives and existing history actions.
- Create app/(scamwin)/account/layout.tsx and account/{connections,alerts,activity,privacy}/page.tsx; preserve account/page.tsx and /checks.
- Create app/scamwin/connection-actions.ts and notification-actions.ts; mutations use server actions with Auth0-derived ownership.
- Create app/api/scamwin/connections/[provider]/callback/route.ts; authorized start is a server action returning a fixed provider URL, not a prefetched mutating GET.
- Create app/api/scamwin/connectors/{tick,drain,telegram,slack,teams,discord}/route.ts as the relevant adapter lands. Public callbacks/webhooks have provider-specific validation; internal tick/drain require dispatch authentication.
- Create app/api/scamwin/{alerts,activity,connections}/route.ts for bounded private reads, each private/no-store.
- Create public/scamwin-sw.js, lib/scamwin/notifications/{contracts,store,push}.ts and authenticated push subscription actions only in Task 9; verify no existing service-worker scope conflict first.
- Create workers/scamwin-connectors/{src/index.ts,wrangler.jsonc,README.md}; mail tokens stay in Vercel/the encrypted connector store, never this Worker.

### Provider/alternative modules

- Create lib/scamwin/connectors/providers/{gmail,outlook,telegram,slack,teams,discord,drive}.ts and oauth.ts, consent.ts under connectors.
- Create lib/scamwin/alternatives/{contracts,catalog,projection}.ts; extend existing official next-step components/gate only through explicitly versioned saved evidence contracts.
- Modify scamwin.env.example for variable names/default-off gates only; extend scripts/check-scamwin-config.mjs and lib/scamwin/readiness.ts for truthful presence/capability status.

## Wave 1: foundation and account experience

### Task 1: Define modes, coverage and isolated storage

**Files:** shared contracts/policy/crypto/store/repository, isolated schema/config/target-guard files above; tests/scamwin-connector-contracts.test.ts, scamwin-connector-store.test.ts, scamwin-connector-database.test.mjs.

**Interfaces:** produces SourceItem, SourceRevision, TargetManifest, SavedConnection, ConnectorJob and Alert; persistProviderPage(ref, lease, page), saveRevision(ref, item), leaseDueJob(), finishJob(lease, outcome), revokeConnection(subject, id, expectedEpoch). No adapter may bypass owner/epoch checks.

- [ ] Write failing cases: all_new selects a routine text-only item; manual selects no background items; selective records nonmatch without a safety verdict; edits have a new revision; 201 URLs produce explicit overflow coverage; another owner/old epoch cannot read or mutate an item.
- [ ] Add target-guard tests proving both a copied main DATABASE_URL and a current_database() value other than scamwin_connectors fail before DDL. Run node --import tsx --test tests/scamwin-connector-contracts.test.ts tests/scamwin-connector-store.test.ts tests/scamwin-connector-database.test.mjs and observe expected RED.
- [ ] Implement strict contracts, parameterized SQL/unique keys, encryption/context binding, privacy-safe read projections, lease fencing and independent lifecycle retention. Credentials are never returned by read projections.
- [ ] Verify GREEN with the same tests and an isolated fake/integration connector database. In an authorized execution only, run the target guard before npm run db:push -- --config drizzle.connectors.config.ts. Never change main drizzle.config.ts/DATABASE_URL.
- [ ] Record the database target/retention acceptance without credentials. Review checkpoint.

### Task 2: Add Account navigation, Connections, Private alerts and Activity

**Files:** Account/API/UI files in the map; app/scamwin.css, DESIGN.md, UX-CONTRACT.md; tests/scamwin-account-navigation.test.ts and scripts/check-scamwin-connections-ui.mjs.

**Interfaces:** private read models ConnectionCard, AlertPage, ActivityPage use 20-record pagination and revision/epoch fields; existing /checks remains the canonical check dataset. beginConnectionAction/saving mode return structured success/error states, with provider execution supplied in Task 4.

- [ ] Write failing navigation/state tests: Ayush menu, bell and account tabs reach canonical routes; /checks/detail/back/delete continue unchanged; signed-out, service-disabled, partial grant, queued, quota_paused, unsupported and stale-response states remain distinct.
- [ ] Add UI cases for a 21-record page, private search not entering URLs/storage, correct disconnect dialog labels, multiple unique input IDs, keyboard access and no horizontal overflow at 320/375/1440. Run the new script against clearly labelled synthetic responses and capture RED before implementation.
- [ ] Implement shared route navigation, account overview, genuine provider readiness cards, filtering, read/unread and Activity projections. Keep current header routes; Connected apps links to /account/connections. Do not show production Connect success using fixtures.
- [ ] Run focused tests/UI acceptance and relevant existing controls/history/official UI checks. Treat fixture UI results separately from real OAuth.
- [ ] Update the canonical UI map and lifecycle ledger in the same reviewed change. Review checkpoint.

### Task 3: Build normalization, multi-target coverage and durable admission

**Files:** normalization.ts, targets.ts, admission.ts, runner.ts, reconcile.ts, limits.ts; modify lib/scamwin/contracts.ts and store.ts only for a backward-compatible optional aggregate ID filter on leaseOutbox; tests/scamwin-connector-targets.test.ts, scamwin-connector-admission.test.ts, scamwin-connector-recovery.test.ts.

**Interfaces:** planItemTargets(revision): TargetManifest; admitConnectorTarget(lease, mainStore, connectorStore): AdmissionOutcome; runConnectorTarget(lease, deps): JobOutcome; reconcileConnectorJobs(now, deps): RecoverySummary. Existing createCheck/main pipeline remain authoritative for check validation and quotas.

- [ ] Write failing tests for multiple distinct links, text-only items, bounded text chunks/attachments, malicious attachment URLs, edited bodies, quota pause, manual capacity, body expiry and incomplete parent states. A partial child can never make the whole parent fully checked.
- [ ] Reproduce crash boundaries: main create succeeds before connector checkId save; exact outbox ACK succeeds before worker starts; process dies mid-run; a retry arrives after disconnect; two deliveries race. Assert the same stable admission key recovers the same check and no stale worker overwrites a newer epoch/revision. Deleting a child check/submission_expired must create a suppression tombstone, never an automatic new attempt after an ambiguous null read.
- [ ] Implement target manifests and separate waiting jobs. Enforce the spec's parser and automatic sublimits. Admit a main check only with capacity to run it now; acknowledge the exact matching outbox job and call the existing runInvestigation. Reconcile expired admitted checks before any separately budgeted retry.
- [ ] Run node --import tsx --test tests/scamwin-connector-targets.test.ts tests/scamwin-connector-admission.test.ts tests/scamwin-connector-recovery.test.ts plus the existing pipeline/vercel-worker/store suites. Require RED then GREEN and payment-risk precedence throughout.
- [ ] Review stable idempotency input, private provenance and honest parent coverage. No broad Browserless permission change.

### Task 4: Implement authorization, credential lifecycle and read-only connection actions

**Files:** oauth.ts, consent.ts, provider grant modules, connection-actions.ts, callback routes, readiness/template updates; tests/scamwin-connector-oauth.test.ts and scamwin-connector-lifecycle.test.ts.

**Interfaces:** beginConnection(subject, provider, mode, scope): ConsentRequest; completeConnection(savedFlow, providerGrant): GrantResult; changeConnectionMode(subject, id, expectedEpoch, settings): ConnectionCard; pauseConnection and disconnectConnection with the same owner/epoch envelope.

- [ ] Write failing tests for state/PKCE mismatch, callback replay, denied consent, wrong provider account on reconnect, missing read scope, token expiry/refresh races, connection ownership conflicts, encrypted-token context swaps and disconnect during work.
- [ ] Implement one-time owner-bound flows and fixed provider callbacks. A new connection may use a mailbox different from the Auth0 login email; reconnect must not silently replace an existing provider account. Never request mail send/delete rights.
- [ ] Make refresh tokens server-only and encrypted; mode expansion requires the owner's explicit scope confirmation. Disconnect invalidates the epoch before token revocation, and remains locally disconnected even if provider revocation is temporarily unavailable.
- [ ] Run focused tests RED/GREEN, verify environment presence checks never imply a working connection, and verify no credential/raw body appears in logs, read APIs, job payloads or public pages.
- [ ] Record proposed setup values by name only. Real grants happen only with the authorized account holder in the later pilot.

## Wave 1: provider connections and automatic operation

### Task 5: Gmail selected-item and all-new-item adapter

**Files:** providers/gmail.ts, sync.ts, gmail-specific grant UI/callback handling; tests/scamwin-gmail-sync.test.ts, scamwin-gmail-coverage.test.ts; scripts/check-scamwin-gmail-pilot.ts.

**Interfaces:** ProviderAdapter with Manual listing/selection and bounded history polling; syncConnection(ref, budget): SyncOutcome persists each page before cursor advancement. Default pilot does not depend on Pub/Sub billing.

- [ ] Add RED fixtures for new text-only email, multi-link body, MIME alternative/HTML text, attachment metadata, duplicates, out-of-order pages, expired history cursor, provider-deleted item, 429/503 and a full local inbox queue. Verify All mode has no suspicion-based skip.
- [ ] Implement gmail.readonly authorized fixed-endpoint requests, messagesAdded processing, immutable page checkpoints, resumable gap reconciliation and explicit unavailable/unsupported targets. Sanitize HTML without rendering or loading embedded resources. Avoid treating a provider's sender field as authenticated sender proof.
- [ ] Verify cursor advancement only after durable item/job writes, no fetch before activation without a separate history action, and no automatic body import in Manual mode. On token expiry mark Reconnect required.
- [ ] Run focused tests and an opt-in test-user pilot with real OAuth, two controlled new emails, one multi-link item and an edited/retried delivery. Record actual provider coverage/latency separately from fixtures; do not print private message contents or tokens.
- [ ] Before public release, verify Google restricted-scope eligibility/assessment requirements and costs. Keep public Gmail unavailable until that gate is met within the approved budget. This gate never blocks existing manual Scamwin checks.

### Task 6: Online scheduler, bounded worker and budget recovery

**Files:** workers/scamwin-connectors files; tick/drain routes, sync.ts/runner.ts/reconcile.ts/limits.ts; tests/scamwin-connector-worker.test.ts, scamwin-connector-budget.test.ts; scripts/check-scamwin-connector-runtime.ts.

**Interfaces:** connectorTick(authenticatedTick, deps): TickSummary with one due connection/page and recovery; connectorDrain(authenticatedDelivery, deps): terminal/deferred JobOutcome for at most one admitted investigation. Responses contain IDs/status/counts only.

- [ ] Write RED tests for invalid/replayed dispatch signatures, bounded 55/300-second handlers, two racing ticks, fair scheduling, stale leases, lost after() nudges, manual priority, quota reset and cursor recovery after an offline interval. Work waiting 15 minutes must not become an expired main check because it was admitted early.
- [ ] Implement the tiny 15-minute Cloudflare Cron that signs and awaits bounded tick/drain calls. Vercel owns all provider/AI/database work. New events may nudge processing, but independent scheduling supplies recovery. No provider account token or main DATABASE_URL goes into the Worker.
- [ ] Apply conservative compute/transfer counters, provider 429 pauses, daily/monthly automatic sublimits, queue saturation notices and the 30-minute low-headroom cadence. No paid fallback, infinite retry or quota bypass.
- [ ] Run focused tests, a killed-worker recovery drill and a multi-day bounded pilot. Inspect actual Neon/Vercel/Workers usage before enabling automatic mode for additional users. Record measured polling delay and backlog; no instant-delivery claim.
- [ ] Verify laptop-off operation and feature-gate rollback. Optional Free Queues require a separate acceptance proving 24-hour delivery expiry never deletes the durable database job; they are not required for this task.

### Task 7: Outlook direct connection and delta synchronization

**Files:** providers/outlook.ts, Microsoft consent/callback UI, sync registry; tests/scamwin-outlook-sync.test.ts and scripts/check-scamwin-outlook-pilot.ts.

**Interfaces:** same ProviderAdapter, SyncBudget and coverage/admission contracts; delegated personal/work account support is an explicit capability.

- [ ] Write RED fixtures for folder delta pagination, immutable message identities, moved/edited/deleted messages, expired delta links, access denial and body/attachment omissions under insufficient scope.
- [ ] Implement delegated Mail.Read and refresh authorization against fixed Graph endpoints. Add no Mail.Send/ReadWrite. Do not follow an arbitrary delta URL outside the approved Graph origin/path scope.
- [ ] Use the existing polling/recovery scheduler first. Native Graph subscriptions are an optional optimization after renewal/clientState/provider verification tests; manual/all modes cannot depend on an unrenewed subscription.
- [ ] Run focused tests, owner-isolation/revoke cases and controlled personal/work-account pilots where available. Tenant approval failures remain a clear connection state, not an app-wide sign-in failure.
- [ ] Verify provider outage leaves Gmail/manual/history working. Review checkpoint.

### Task 8: Telegram account Chat Automation, with explicit scoped coverage

**Files:** providers/telegram.ts, Telegram webhook route and connection actions/UI; tests/scamwin-telegram-connection.test.ts, scamwin-telegram-events.test.ts; scripts/check-scamwin-telegram-pilot.ts.

**Interfaces:** beginTelegramLink(subject): { deepLink, expiresAt }; verifyTelegramUser(update, nonce): LinkResult; persistTelegramEvent(verifiedUpdate): IngestOutcome. Store bot connection ID, verified Telegram user ID, owner and epoch; no phone/session/API-hash credentials.

- [ ] Write RED tests for one-time linking nonce replay, wrong Telegram account, connection-before-link ordering, forged webhook secret, new/edit/delete events, reconnect epochs, selected-chat exclusions and unsupported event types. Manual/paused delivery must not store a body; if provider recovery is unavailable, resume displays a content-free gap marker rather than claiming those messages were checked.
- [ ] Enable the service bot's current Secretary/Chat Automation capability only in the authorized setup stage. User links the bot from Scamwin and selects it in Telegram's Chat Automation settings. Accept only verified business_connection events mapped to that owner's one-time link.
- [ ] Persist new events before webhook acknowledgement. Treat account-authorized private chats separately from group/channel bot installation. Keep reply/delete/profile/payment rights disabled. The can_read_messages right must not be misrepresented as permission to receive content; verify minimal rights in the real pilot.
- [ ] Verify current opt-in bot-to-bot behavior with a controlled other bot before claiming that coverage. If unavailable, show that exact limitation. Do not repeat the outdated blanket claim that current Telegram always excludes other bots.
- [ ] Run focused tests and two controlled private-chat account pilots for Manual and All modes, including disconnect/reconnect. Verify no personal inbox history or unauthorized groups are claimed as checked.

## Wave 1: notifications and official alternatives

### Task 9: Private alerts, optional device push and unified activity

**Files:** notification modules/service worker/actions, private alerts/activity APIs and UI, core header bell; tests/scamwin-private-alerts.test.ts, scamwin-push.test.ts; scripts/check-scamwin-notifications-ui.mjs.

**Interfaces:** publishPrivateOutcome(itemRevision, coverage): AlertProjection; markAlertRead(subject, id, expectedRevision); registerPushSubscription(subject, validatedSubscription); listActivity(subject, filters, cursor): ActivityPage. These never publish shared warnings.

- [ ] Write RED tests for one alert per revision/outcome, read/unread retries, distinct failed/delayed/partial/risk notices, owner isolation, deleted evidence links, generic device payloads, unsupported/denied push permission and push provider 404/410 cleanup.
- [ ] Add a browser-support/permission flow triggered by an explicit user action. Generate VAPID configuration; keep private key server-side. Validate allowed push-service origins and public endpoints so subscription input cannot create SSRF.
- [ ] Implement a service worker that handles notifications without caching private pages/APIs/callbacks. Notification click opens the authenticated account route, not a private provider link. Dashboard alerts work independently of push permission or delivery success.
- [ ] Implement private read models and 20-record activity pagination across connector events and existing manual-check references without duplicating the /checks dataset. Preserve old UI results across read failures and reject stale responses.
- [ ] Run unit/UI acceptance at 320/375/1440 and an authorized supported-browser push pilot with the tab closed. Report device delivery separately from in-app alert persistence; do not promise delivery on unsupported/offline devices.

### Task 10: Reviewed official alternatives for the user's purpose

**Files:** alternatives modules, components/scamwin/official-verification.tsx and existing official-next-step contracts/view/gate if required; tests/scamwin-alternatives.test.ts and existing navigation/risk tests.

**Interfaces:** projectReviewedAlternatives(goal, evidence, catalog, now): AlternativeProjection[] with purpose, authority evidence IDs, relationship, review/fetch times, expiry and saved gated step ID. URLs originate only from reviewed sources.

- [ ] Add RED cases for a risky job message with a genuine copied listing, unknown company, unrelated source, expired review, revoked authority and a model-invented URL. No alternative may clear the observed payment risk or claim personal offer authenticity.
- [ ] Extend the existing Official next step card rather than add a competing trust badge. First use current reviewed careers/support sources; expand categories only after first-party source review. Missing coverage displays No reviewed alternative available.
- [ ] Reuse explicit same-tab, no-prefetch owner/current-run/expiry-checked navigation. If extending the saved evidence schema, version it and retain historical read behavior without rewriting old checks.
- [ ] Run focused tests, existing official-offer/navigation/payment-precedence tests and the official UI script. No personal resume/job matching, affiliate ranking or automatic application.
- [ ] Review source catalogue additions and their dated evidence independently from ranking/UI. Review checkpoint.

## Wave 2 and 3: additional connections, using the same contracts

### Task 11: Slack and Teams authorized-conversation adapters

**Files:** providers/slack.ts and teams.ts, their grant/installation/webhook UI and routes; tests/scamwin-slack.test.ts and scamwin-teams.test.ts; provider setup sections in docs/scamwin-connected-apps-setup.md.

**Interfaces:** the same persisted connection, epoch, ProviderItem and target contracts. Capabilities state installed channels/chats vs personal mailbox coverage precisely.

- [ ] Write RED fixtures for Slack event signature/retry challenges, membership/scope changes and rate-limited catch-up; Teams notification validation, saved subscription/clientState, lifecycle renewal and RSC resource scope. Mentions-only access must not display all-message coverage.
- [ ] Implement the least-privilege selected-channel Slack installation and eligible work/school Teams/Graph or RSC installation. Bound provider recovery; respect current app distribution/tenant policies. No tenant-wide permission is silently requested.
- [ ] Run Manual/Selective/All cases with controlled permitted conversations, excluded chats and revoked access. Require real installation coverage acceptance before enabling each automatic capability.
- [ ] Verify these adapters cannot affect Gmail/Outlook/Telegram ownership, worker quotas or public warning eligibility. Review checkpoint per adapter.

### Task 12: Discord, selected Drive files and browser extension

**Files:** providers/discord.ts and drive.ts; extensions/scamwin/{manifest.json,src/*}; corresponding connection/webhook UI; tests/scamwin-discord.test.ts, scamwin-drive.test.ts and scripts/check-scamwin-extension.mjs.

**Interfaces:** same ProviderItem/coverage contract; browser input is a user-owned signed session submission, never a provider-authorized mailbox. Each capability is separately enabled.

- [ ] Start with Discord HTTP message interactions, verified application signatures and manual selection. Qualify a persistent Gateway host and current message-content approval separately; enable automatic selected-server channels only after a documented free-runtime/recovery pilot. Otherwise the capability remains Manual only, not a fake successful connection.
- [ ] Implement Drive selected-file authorization with drive.file and revision/change handling. Whole-Drive monitoring is excluded until separate restricted-scope approval. Unsupported document formats remain visible gaps; add a bounded parser in its own reviewed task before claiming PDF/office-file coverage.
- [ ] Implement activeTab manual extension checks and separate explicit host permissions for optional visible-page automation. Preserve ordinary server manual intake validation, quotas and owner authorization. No claim of background inbox access when the browser is closed.
- [ ] Run RED/GREEN coverage for provider signatures, unsupported intent/scope, file revocation, changed revisions, malicious page scripts, private-origin URLs and user-triggered vs automatic submissions. Use an unpacked or no-fee Edge pilot under the ₹0 constraint; Chrome Store fees require a separate decision.
- [ ] Enable only independently accepted capabilities on Connections; keep other provider routes honest and disabled.

## Task 13: Operations, release gates and regression evidence

**Files:** docs/scamwin-connected-apps-setup.md, scamwin.env.example, Worker README, readiness/operations projections and scripts/check-scamwin-connector-config.mjs; tests/scamwin-connector-config.test.ts.

- [ ] Document setup without values: Gmail project/API/client ID/client secret/approved callback/consent/test users; Outlook app/client ID/credentials/account types/callback; Telegram bot username/token/webhook secret/Secretary capability/account link; other providers' installation IDs/secrets/scopes as their task lands.
- [ ] Define the exact proposed variable inventory below in the example/config checker. VAPID public/private keys are separate; existing publisher/live-view secrets are never reused. Worker receives only fixed allowed Vercel target, dispatch secret and enabled/cadence controls. Its free scheduled Worker permission is separate from the existing AI-only token; do not broaden the AI token merely for deployment.
- [ ] Add readiness distinctions for configured, provider-approved, connected, last successful sync and actual per-item coverage. Credentials present must never mean every message was checked.
- [ ] Verify new core/adapter suites, npm run test:scamwin, npx tsc --noEmit --incremental false --pretty false, changed-file ESLint, normal npm run build, publisher build and relevant browser scripts. Compare npm test with the existing legacy 19 failures/one cancellation; report new differences explicitly.
- [ ] Run real authorized OAuth/account/push acceptance separately from synthetic tests. Include quota exhaustion, paused connection, disconnected grant, history gap, killed worker, multiple links, unsupported attachment, stale official alternative, private/public warning separation and laptop-off scheduled recovery.
- [ ] Release with all gates off, enable one provider/test account, then optional All mode. Record live commit/config/coverage evidence before widening the pilot. Rollback disables connectors/automation/push/alternatives independently while preserving existing manual and public-review behavior.
- [ ] Commit/push/deploy only when explicitly authorized in the execution request. No billing or public restricted-scope release without its own resolved approval/eligibility gate.

## Definition of done

- The user can connect accepted providers under Ayush → Connected apps, choose Manual/Selective/All new items, inspect actual scope and stop access.
- Every accessible new All-mode item has a durable revision/target coverage record; no routine message is silently skipped, no pending item is presented as safe, and provider gaps are visible.
- Private alerts and Activity & history explain what arrived, what was checked and what remains unavailable; old /checks links and all current investigation/sharing features still work.
- Optional device push is separately permissioned and tested; a failed push cannot erase the durable dashboard alert.
- Reviewed official alternatives preserve authority, freshness and risk boundaries.
- Free limits, timing and public provider eligibility are documented truthfully; full-item selection is not advertised as unlimited free computation.
- No main-database data reset, leaked token, automatic public accusation, paid fallback, forwarded-mail requirement or permanently running laptop has been introduced.

## Proposed credential/configuration inventory

These names are planned, not settings to add before implementation. Main-app values use Vercel Production only for the pilot; Preview uses isolated test accounts/store and distinct credentials if enabled. Provider application registration is separate from Auth0 login. Every connected user grants access through the built flow rather than supplying a password/API key.

| Name | Type / destination | Purpose |
| --- | --- | --- |
| SCAMWIN_CONNECTORS_ENABLED | Config, main | Default false; account connection feature |
| SCAMWIN_CONNECTOR_AUTOMATION_ENABLED | Config, main | Default false; automatic processing |
| SCAMWIN_CONNECTOR_GMAIL_ENABLED | Config, main | Gmail flag, default false |
| SCAMWIN_CONNECTOR_OUTLOOK_ENABLED | Config, main | Outlook flag, default false |
| SCAMWIN_CONNECTOR_TELEGRAM_ENABLED | Config, main | Telegram flag, default false; expanded providers follow the same full prefix |
| SCAMWIN_CONNECTOR_DATABASE_URL | Secret, main | Empty scamwin_connectors database in separate Free project scamwin-connectors, never main DATABASE_URL |
| SCAMWIN_CONNECTOR_ENCRYPTION_KEY | Secret, main | Dedicated 32 bytes represented by 64 hex characters |
| SCAMWIN_CONNECTOR_DISPATCH_SECRET | Secret, main + scheduler Worker | Dedicated >=32-character server-to-server request signing secret |
| SCAMWIN_CONNECTOR_APP_ORIGIN | Config, scheduler Worker | Exact allowed origin https://scamwin.vercel.app; no user-provided fetch destination |
| SCAMWIN_CONNECTOR_SCHEDULER_ENABLED | Config, scheduler Worker | Default false until a measured authorized pilot |
| SCAMWIN_GOOGLE_CLIENT_ID / SCAMWIN_GOOGLE_CLIENT_SECRET | Config / Secret, main | Gmail-specific Google OAuth web application |
| SCAMWIN_GOOGLE_REDIRECT_URI | Config, main | https://scamwin.vercel.app/api/scamwin/connections/gmail/callback |
| SCAMWIN_MICROSOFT_CLIENT_ID / SCAMWIN_MICROSOFT_CLIENT_SECRET | Config / Secret, main | Outlook app registration with selected supported account types |
| SCAMWIN_MICROSOFT_REDIRECT_URI | Config, main | https://scamwin.vercel.app/api/scamwin/connections/outlook/callback |
| SCAMWIN_TELEGRAM_BOT_USERNAME | Config, main | Configured service bot used for linking and Chat Automation |
| SCAMWIN_TELEGRAM_BOT_TOKEN / SCAMWIN_TELEGRAM_WEBHOOK_SECRET | Secret, main | Hosted Bot API access and incoming webhook authentication |
| SCAMWIN_PRIVATE_PUSH_ENABLED | Config, main | Default false; optional device notifications |
| SCAMWIN_WEB_PUSH_PUBLIC_KEY / SCAMWIN_WEB_PUSH_PRIVATE_KEY | Config / Secret, main | Generated VAPID key pair; only public key is exposed by the app's permission endpoint |
| SCAMWIN_WEB_PUSH_SUBJECT | Config, main | Operator-supplied valid contact URI for Web Push |
| SCAMWIN_ALTERNATIVES_ENABLED | Config, main | Default false; reviewed alternatives projection |

Do not add these names to the isolated publisher project. Expanded Slack/Teams/Discord/Drive/extension credential inventories are documented with their Wave 2/3 tasks before those capabilities are enabled.

## Self-review and execution handoff

Before implementation, review this plan with its design: verify each scope/mode/UI/lifecycle requirement maps to a task; check exact interface/type consistency; ensure each Review focus item has its owning regression; compare the provider capability matrix with current official docs. The design's defaults (retention, budgets, idle cadence, wave order and privacy behavior) are explicit planner proposals for review.

The user has requested the implementation plan, not product implementation. Finish planning and present the source/app matrix, account flow and connection requirements. After design/plan approval, execute tasks in dependency order with independent reviews. Do not start building from this document merely because it exists.
