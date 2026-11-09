# Scamwin: current free implementation plan and demo requirements

> **Isolated publisher amendment, 9 November:** the optional publisher can now run in a second Vercel project rooted at `publisher/`. The signing key is permitted only in that dedicated project's Production secrets, never the main website, shared team variables, Preview or investigations. The main website receives an origin-only `SCAMWIN_PUBLISHER_BASE_URL`, shared dispatch secret and public registry settings. This supersedes the earlier platform-wide Vercel signing ban and Trigger-only publisher instructions. See [publisher setup](../publisher/README.md). The registry and publisher activation were deployed to Base Sepolia with explicit owner approval and free test ETH; actual warning publication still needs its hosted test.

> **9 November 2026 replacement:** the selected investigation backend is now `SCAMWIN_INVESTIGATION_BACKEND=vercel`, using Next.js `after()` and a 300-second Vercel Fluid invocation. Put investigation Cloudflare, Browserless, stable HMAC and approved-origin settings in **Vercel Production**. `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF` are optional legacy investigation settings, not requirements for this backend. Existing Trigger-only instructions below apply only when that backend is deliberately selected. Follow [the current live setup steps](scamwin-live-setup.md#step-6--run-investigations-on-vercel) for exact placement and limitations. Web3 publication still requires its separate isolated publisher; it is not enabled by this replacement.

Updated 8 November 2026. This is the current provider, scope and status summary. Use it with the [16-task engineering plan](superpowers/plans/2026-11-08-scamwin-web-app.md), [design](superpowers/specs/2026-11-08-scamwin-web-app-design.md) and [accepted zero-cost amendment](superpowers/plans/2026-11-08-scamwin-zero-cost-vercel-amendment.md). Older paid-provider instructions are superseded.

## 1. Required runtime stack

| Part | Current choice | How it is used |
| --- | --- | --- |
| Website | Vercel Hobby | Next.js/React/TypeScript app, Auth0 routes, private reads and provider API calls |
| AI | Cloudflare Workers AI Free | Fixed Scout model for bounded offer/screenshot interpretation, comparisons and evidence-only follow-ups |
| Remote browser | Browserless Free | Fresh Playwright context for approved operator-owned HTTPS origins; no user cookies, payment submission or arbitrary computer tools |
| Background investigation | Trigger.dev Free | Investigation and daily cleanup tasks; no laptop worker |
| Warning publisher | A separate Trigger.dev Free project | Reviewed Base Sepolia signing/reconciliation, isolated from the analysis project's environment |
| Database | Neon Free with Drizzle | Private checks, observations, jobs, review records and owner-scoped correlation fingerprints |
| Screenshots | Private expiring Neon artifacts | At most four prepared input images and three captures; 160 KiB per stored image, seven-day expiry |
| Login | Auth0 Free | Hosted sign-in and server-verified account ownership |
| Web3 | Base Sepolia | Dedicated test-only wallets, limited public RPC and free faucet test ETH |
| Monitoring | Sanitized app/provider logs | No required paid monitoring or session replay |

Scamwin does not require OpenAI API billing, Daytona, Render, R2/S3, Firecrawl, a paid threat feed, a purchased domain or mainnet funds. Existing upstream OpenMods modules/dependencies for some of these services remain in the source checkout; the dedicated Scamwin workflow does not invoke that generic runtime. Do not deploy its original Trigger configuration as the Scamwin worker.

Free tiers must actually be selected in the owner-controlled accounts. The app has admission limits and handles quota rejection without a paid fallback; it cannot turn an already-paid provider account into a free account. No automatic upgrade, purchased credit balance or recharge is part of this plan. Free allowance exhaustion can make a check partial or unavailable. A full public production service and unlimited usage are not promised at zero cost.

Published boundaries checked 8 November 2026: Workers AI offers 10,000 Neurons/day on Free; Browserless Free lists 1,000 units/month and a two-minute maximum session; Trigger Free includes $5/month of usage. Vercel Hobby is for personal, non-commercial use. The application uses a tighter 60-second browser cap. These are service allowances, not confirmed balances or guarantees of account/capability access.

Sources: [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Browserless pricing](https://www.browserless.io/pricing), [Browserless quota behavior](https://docs.browserless.io/overview/unit-consumption), [Trigger.dev pricing](https://trigger.dev/pricing), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Neon pricing](https://neon.com/pricing), [Auth0 pricing](https://auth0.com/pricing), [Base testnet funds](https://docs.base.org/get-started/get-funds).

## 2. Current feature status

The code implements the core workflow: submit an offer and intended action, run a private saved investigation, inspect risk and missing evidence, ask a follow-up, manage history and optionally submit a redacted warning for review. Responsive pages, input images, editable field-based preview, stage progress, cancellation, four outcomes, evidence links, certificate probe adapter, exact related-case matches, history/search/recheck/delete, reviewer decisions, information requests, retractions and admin pause controls are present.

This is not exact feature parity with the original expected-outcome text. The following work is still outstanding and does not require buying a paid service:

| Gap | Current behavior | Remaining implementation |
| --- | --- | --- |
| Multiple-link destination selection | User manually enters one URL | Extract candidate links and present an explicit picker |
| Elapsed investigation timer | Stages and saved/updated timestamps | Add running elapsed-time display |
| Security findings with impact/fix | Header/mixed-content facts and limitations | Add evidence-grounded, readable impact and remediation text |
| Deletion/cleanup tracking | Immediate owner-read hiding and expiry cleanup | Add user-visible cleanup progress/status |
| Live operations health | Configuration-presence readiness, static quotas and actual pause flags | Add live queue/resource/provider-health telemetry within the free budget |
| Official reference directory | Configuration-driven curated lookup, empty by default | Populate and verify references for the chosen demonstration organizations |
| Dedicated correction editor | Retraction followed by a fresh reviewed submission | Add a dedicated versioned correction workflow if retaining that original UX requirement |

Screenshots can be opened through an authenticated image endpoint. QR payloads are not machine-decoded; model-guessed QR values are not treated as verified recipients. Arbitrary hostile-site browsing, continuous chain monitoring, richer graphs, many independent publishers and additional languages remain outside this prototype. The original expected outcome already limited the hackathon browser demonstration to controlled approved sites.

## 3. What the owner needs ready

| Service / input | Required values or access |
| --- | --- |
| GitHub + Vercel Hobby | A repository the owner can deploy, Vercel dashboard access and the generated production origin; normal dashboard connection needs no personal API token |
| Auth0 Free | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`; exact app callback/logout/web origins |
| Neon Free | `DATABASE_URL` for a dedicated disposable demo database |
| Cloudflare Workers AI Free | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`; verify access to `@cf/meta/llama-4-scout-17b-16e-instruct` |
| Trigger.dev Free: investigation project | `TRIGGER_PROJECT_REF` and production `TRIGGER_SECRET_KEY`; CLI/dashboard deployment access |
| Trigger.dev Free: separate publisher project | `SCAMWIN_PUBLISHER_PROJECT_REF` and `SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY`; wallet signing key only in this isolated project |
| Browserless Free | `BROWSERLESS_TOKEN`, supported `BROWSERLESS_BASE_URL` |
| Testnet administration/publisher | Dedicated wallet public addresses, secure test-only signing access and free Base Sepolia test ETH; contract address is generated during deployment |
| Controlled demonstration sites | Exact approved HTTPS origins the operator owns; create/host fixtures if none exist |
| Administrator/reviewer identity | Verified Auth0 subject after first sign-in, placed in `SCAMWIN_ADMIN_SUBJECTS` |

Generate `AUTH0_SECRET` and `SCAMWIN_INDICATOR_HMAC_SECRET` as separate random secrets during configuration; they require no paid service. Use a public Base Sepolia RPC initially; a paid RPC subscription is not required. Curated references require verified source content, not an extra AI/search subscription.

Use [scamwin.env.example](../scamwin.env.example) for web/investigation placement and [scamwin.publisher.env.example](../scamwin.publisher.env.example) only for the isolated publisher. Save real values in provider secret settings or ignored environment files. Never paste live secrets, recovery phrases or wallet private keys into chat, this document or Git.

## 4. Full live-demo acceptance work

1. Follow the [ordered live setup walkthrough](scamwin-live-setup.md), beginning with Auth0. Deploy/test the current prototype before further feature work, as requested by the owner; an early deployment does not establish exact expected-outcome parity.
2. Configure the Free/Hobby accounts without enabling paid usage.
3. Apply the clean Drizzle schema only to the dedicated demo database.
4. Deploy the investigation worker, the isolated publisher worker and the Vercel site; configure the real Auth0 origin and role mapping.
5. Prepare controlled, explicitly synthetic demonstration pages and current official reference entries.
6. Verify Browserless isolation/request restrictions, deadlines, close/cancel behavior and origin probing against those owned sites. Keep browser/TLS capability gates off until these checks pass.
7. Deploy/configure the Base Sepolia registry, authorize the publisher and verify its free test balance. No real funds or consumer wallet are needed.
8. Rehearse real sign-in, saved investigation, images, findings, follow-up, private history, information request/approval, publication, independent reading and retraction. Test quota/provider failures and a second account's access denial.
9. Record the actual live behavior, fix setup/integration defects, then finish the outstanding product details listed above and repeat the affected checks.

The current `/demo` is read-only synthetic data and requires no credentials. It is not evidence that live AI, browser collection or blockchain publication has happened. Local tests/build/browser verification are recorded in the [build ledger](scamwin-build-progress.md); real provider/account/deployment acceptance remains pending. API keys enable existing integrations but do not implement missing features.

Step-by-step account instructions: [setup guide](scamwin-setup-guide.md). Commands and environment placement: [running guide](scamwin-running.md).
