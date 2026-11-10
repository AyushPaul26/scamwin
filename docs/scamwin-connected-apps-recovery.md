# Connected-app recovery and verification — 2026-11-10

The interrupted build already contained most connected-app code. This recovery compared the supplied transcripts, accepted design/plan, current source and later implementation reports, then completed missing local integration work. Existing changes remain uncommitted in the current checkout. No provider account was connected, no cloud schema was applied, and no deployment or billing change was performed.

## Completed fixes

- Slack: authenticated uninstall/token-revocation/rate-limit handling; durable event dedupe and pending-capacity accounting; active installation/selected-resource retention; pagination through empty discovery pages; atomic OAuth installation routing before first discovery.
- Telegram: expired bot links now fence the connection, cancel waiting work and record a relink-required coverage gap. The same transition runs before generic physical cleanup, including bounded batches larger than 100 links.
- Teams: production Account disconnect captures subscription cleanup before local revocation and sends DELETE afterward, including feature-off operation. Expired selections no longer report successful empty coverage; daily-limit-only saves preserve recovery boundaries; processed/duplicate references no longer exhaust the pending queue.
- Discord: the actual identity-only OAuth grant is accepted independently of message-command installation. The installation link remains available until explicit refresh after saving context consent.
- Browser extension: documented `SCAMWIN_` flags now enable the actual integration. Old unprefixed flags do not enable it.
- Retention: authenticated daily maintenance attempts independent cleanup of both stores, including when provider/import/dispatch gates are disabled. It needs no provider/encryption credentials for physical deletion, verifies the isolated database target, and does not create checks or fetch provider content.
- Account/history: deterministic timestamp/ID ordering across equal-time pages in both storage adapters; accessible focus/error association for mailbox resource choices; repaired invalid UTF-8 loading/error text; a loading boundary for dynamic source-inbox routes required by Cache Components production rendering.
- Operator tooling: offline sanitized configuration inspection, private non-overwriting secret generators, canonical VAPID names, integrated service-readiness reporting, and reconciled setup documentation.

## Verification

Final local release receipts are recorded below. Raw logs live in the ignored `.superpowers/sdd/2026-11-10-scamwin-connected-apps/` directory.

| Check | Observed result |
| --- | --- |
| Complete Scamwin suite | 769 tests passed, zero failed/canceled/skipped. Ran the repository's full Scamwin test selection with bounded concurrency and test-runner forced exit. |
| Full repository baseline comparison | 842 tests: 822 passed, 19 failed, one canceled. Every failing/canceled test location matches the existing root `baseline-tests.log`; no new failure location. This run preceded the final focused retention/routing deltas. |
| Full TypeScript | Passed, exit 0. |
| Main production build | Passed, exit 0, including the final frozen-source release build after repairing source encoding and adding the source-route loading boundary. |
| Isolated publisher build | Module preparation and typecheck each passed, explicit child exit 0; 11 modules prepared, no environment files copied. |
| Changed-file ESLint | 248 files, zero errors/warnings, exit 0. |
| Example configuration | Offline checker accepted `scamwin.env.example` as valid disabled configuration, exit 0. |
| Source encoding / whitespace | Strict UTF-8 validation passed for all 176 Scamwin source files inspected; `git diff --check` passed. |
| Account browser matrix | 187 assertions passed at 320/375/1440 px, including pagination, transient private search, stale reads, consent, focus/Escape, and actual signed-out mutation/read rejection. |
| Source/private-alert/device UI | 40 assertions passed at 320/375/1440 px; synthetic delivery/permission states, real signed-out action rejection. |
| Telegram setup UI | 20 assertions passed at 320/1440 px, including consecutive saves and accepted epochs. |
| Existing Scamwin pages | 36 assertions passed at 320/375/1440 px. |
| Existing review/admin/owner controls | 15 assertions passed. |
| Official-source/reviewed-alternative UI | 89 assertions passed with synthetic sessions/evidence and intercepted destinations. |
| Final routing/cleanup regressions | Five final OAuth-before-discovery, routing rollback and credential-free/batched cleanup cases passed, exit 0, in addition to the complete Scamwin suite. |
| Strict static UI audit | Same two legacy actionless-button findings in `app/(dashboard)/chats/[chatId]/page.tsx:32` and `app/(dashboard)/dashboard/page.tsx:35`; zero new finding. This audit exits 1 and is not reported as passing. |

The browser fixtures are explicitly synthetic; they do not establish real OAuth, account installation, provider delivery, physical browser site permissions, or closed-tab push acceptance.

The existing SQL rollback fixtures intentionally emit two `22012` division-by-zero diagnostics while proving admission rollback. Those assertions pass; the diagnostics are test injection, not a production database incident. Static audit findings remain confined to the two legacy OpenMods pages listed above.

## Existing repository failures

The full-repository result retains the saved legacy baseline. The failures are outside Scamwin connected-app implementation:

- `bot-lifecycle.test.mts`: module-level test file fails during import.
- `chat-actions.test.mts`: recipient validation reuses the owned chat without reading it twice.
- `chat-actions.test.mts`: authorized actions pin task inputs, scope tokens and transcript cursors to the owned chat.
- `chat-actions.test.mts`: session endpoints reject foreign origins, malformed bodies and unowned chats.
- `chat-actions.test.mts`: history recovery authenticates ownership and returns only the transcript.
- `chat-agent.test.mts`: image bytes reach the model and survive storage, continuation and retry.
- `chat-agent.test.mts`: agent streams, persists, resumes context and regenerates without duplicating questions.
- `chat-agent.test.mts`: fresh chat is isolated and failure can be retried with a sanitized UI error.
- `chat-agent.test.mts`: stopping aborts the provider and keeps the user message (the existing cancellation).
- `daytona.test.mts`: provisioning persists sandbox and cleans up failed memory initialization.
- `daytona.test.mts`: access restarts stopped sandbox and refuses foreign environment.
- `daytona.test.mts`: desktop preserves signed URL and returns expiration.
- `daytona.test.mts`: deletion is idempotent for a missing sandbox.
- `daytona.test.mts`: opt-in toolkit installs before returning a bot and failed installation cleans up.
- `desktop-access.test.mts`: desktop checks authentication, input, direct-chat ownership and bot ownership.
- `desktop-access.test.mts`: connection endpoint rejects cross-origin calls, scopes returned data and sanitizes failures.
- `sandbox-tools.test.mts`: shell uses the server-selected sandbox with bounded execution and respects stop.
- `security-toolkit.test.mts`: toolkit failure retains allowlisted installation stages before cleanup.
- `usage-sampler.test.mts`: samples only owned environment labels and deduplicates the interval.
- `usage-sampler.test.mts`: failed polling writes no partial observations and never wakes a machine.

## Decisions and material limits

- Existing accepted modules were repaired in place; repeated implementations, branches, commits and backup replacement were unnecessary. The current repository instructions require explicit requests for Git mutations.
- Current Slack installation/selected-scope identifiers are authorization configuration retained with a live grant. Historical events and unused discovery metadata still expire. Telegram instead requires renewed authorization/linking when its saved link expires.
- Slack lifecycle event timestamps have one-second precision. An ambiguous same-second revocation/reinstall event conservatively stops access and may require reconnecting. Older events and replayed lifecycle IDs are fenced; strict subsecond ordering is not claimed.
- Teams retained references remain available to already queued body reads after cursor acknowledgement, while pending capacity is released only against durable progress. Separate provider metadata staging cannot bypass Core's owner-wide 1,000 pending-revision bound.
- No source fixtures or synthetic identities were added to production authentication paths. Deployment gates remain default-off in the example configuration.

## Remaining operator acceptance

Follow [the setup guide](scamwin-connected-apps-setup.md) for the separate `scamwin-connectors` Neon project and exact `scamwin_connectors` database, explicit guarded connector schema push, developer registrations/credentials, and one controlled provider/account pilot. Keep the main `DATABASE_URL` and isolated publisher authority separate.

Live acceptance still needs real provider grants/installation and revocation, Gmail public-eligibility review if applicable, Telegram bot/account rights, Teams subscription/tenant behavior, Discord command latency, Drive Open with, genuine extension gestures/site permissions, closed-tab push, independent-session PostgreSQL locking, scheduler deployment/laptop-off recovery and measured free-tier headroom. Local fixtures do not prove those conditions.
