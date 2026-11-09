# Scamwin setup checklist: accounts, OAuth and credentials

> **Isolated publisher amendment, 9 November:** the optional publisher can now run in a second Vercel project rooted at `publisher/`. The signing key is permitted only in that dedicated project's Production secrets, never the main website, shared team variables, Preview or investigations. The main website receives an origin-only `SCAMWIN_PUBLISHER_BASE_URL`, shared dispatch secret and public registry settings. This supersedes the earlier platform-wide Vercel signing ban and Trigger-only publisher instructions. See [publisher setup](../publisher/README.md). The registry and publisher activation were deployed to Base Sepolia with explicit owner approval and free test ETH; actual warning publication still needs its hosted test.

> **9 November 2026 replacement:** the selected investigation backend is now `SCAMWIN_INVESTIGATION_BACKEND=vercel`, using Next.js `after()` and a 300-second Vercel Fluid invocation. Put investigation Cloudflare, Browserless, stable HMAC and approved-origin settings in **Vercel Production**. `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF` are optional legacy investigation settings, not requirements for this backend. Existing Trigger-only instructions below apply only when that backend is deliberately selected. Follow [the current live setup steps](scamwin-live-setup.md#step-6--run-investigations-on-vercel) for exact placement and limitations. Web3 publication still requires its separate isolated publisher; it is not enabled by this replacement.

For dashboard-by-dashboard instructions, credential explanations, placeholder templates, troubleshooting and a safe readiness form, use the [detailed step-by-step setup guide](scamwin-setup-guide.md). This file remains the shorter overview.

To connect services now, follow the [ordered live setup walkthrough](scamwin-live-setup.md), one checkpoint at a time. Begin with Auth0; you do not need every service account before starting. Use Neon PostgreSQL, not Neo4j.

Updated 8 November 2026 for the [current free implementation plan](scamwin-current-plan.md) and [accepted zero-spend amendment](superpowers/plans/2026-11-08-scamwin-zero-cost-vercel-amendment.md). The prototype is implemented locally; the current plan lists remaining feature gaps and live acceptance work. This checklist does not create accounts or deploy anything.

## Before starting

Use Free/Hobby plans only. No paid subscription, purchased credits, mainnet cryptocurrency, custom domain or laptop worker is required by the proposed prototype. Published free allowances and actual account/API eligibility still need verification. If a service requires an upgrade for the selected capability, pause that capability rather than buying access.

If an existing OpenMods account/project belongs to you and is usable, it may be reused after verification. Do not recreate projects or rotate working secrets just because the repository was cloned. The checked-in Trigger project reference is configuration, not proof that you control that project.

Keep secret values in your password manager, local ignored `.env.local` during development, or the relevant provider's environment/secret settings. Do not paste API keys, database URLs containing passwords, client secrets, wallet keys or recovery phrases into chat, screenshots, Git commits or Markdown documentation. Public IDs and project URLs can be discussed separately from secrets.

## 1. Required accounts and values

| Service | Prepare | Keep privately / note |
| --- | --- | --- |
| GitHub | An account with access to the repository we will deploy | Repository URL and who owns it; no personal access token required for the normal dashboard flow |
| Vercel | Hobby account, linked to the intended GitHub account | Project/dashboard access; actual production `https://...vercel.app` origin is assigned later |
| Auth0 | Free tenant; one **Regular Web Application** named Scamwin | Domain and Client ID; **Client Secret** privately; email/password database connection enabled |
| Neon | Free Postgres project, preferably dedicated disposable development/demo data | Full **DATABASE_URL** from Connect; includes database password, so treat the entire string as secret; preserve TLS parameters |
| Cloudflare | Free account with Workers AI access | Account ID and **Workers AI API token**, scoped to that account; use the Workers AI REST-token template |
| Trigger.dev | Free organization with separate investigation and publisher projects | Both project references and production API keys; development keys only for local development; CLI login access for deployment |
| Browserless | Free Cloud account | **API token** and correct shared-fleet regional endpoint from dashboard/docs; do not buy proxy/CAPTCHA add-ons |
| Testnet wallet | Dedicated test-only accounts for contract administration/publishing | Public addresses and free Base Sepolia test ETH; never share the recovery phrase or put real funds in these accounts |

Cloudflare's current REST setup says manually created tokens require `Workers AI - Read` and `Workers AI - Edit`; the built-in token template avoids guessing permissions. Actual model access will be smoke-tested before enabling it. Standard direct inference is used; content logging/caching is not enabled.

The administrator/reviewer sign-in identity is also needed. Choose which account you will use for the first admin login. After a real sign-in, role assignment uses the server-verified Auth0 identity; a browser-supplied role or email field cannot grant admin access.

## 2. OAuth: Auth0 to Scamwin

Start with email/password through Auth0. Google login is optional and does not need to block development. Only configured sign-in providers should appear in the finished UI.

In Auth0's application settings, keep the following exact entries ready. Replace `YOUR-PROJECT.vercel.app` only after Vercel assigns the actual production hostname; it is a placeholder, not a reserved domain.

| Auth0 setting | Development | Production |
| --- | --- | --- |
| Allowed Callback URLs | `http://localhost:3000/auth/callback` | `https://YOUR-PROJECT.vercel.app/auth/callback` |
| Allowed Logout URLs | `http://localhost:3000` | `https://YOUR-PROJECT.vercel.app` |
| Allowed Web Origins | `http://localhost:3000` | `https://YOUR-PROJECT.vercel.app` |
| Application base URL in our environment | `http://localhost:3000` | `https://YOUR-PROJECT.vercel.app` |

Use the canonical production hostname for the deployed demo. Arbitrary preview URLs do not automatically work with OAuth; do not add broad `*.vercel.app` callback access. If preview sign-in is needed, explicitly configure the specific preview origin with matching environment values. Separate dev/production Auth0 applications can be introduced later if isolation is needed.

Generate `AUTH0_SECRET` during secure configuration: a stable, cryptographically random 64-character hexadecimal cookie-encryption secret. It is different from the Auth0 Client Secret. Generate `SCAMWIN_INDICATOR_HMAC_SECRET` separately for private correlation. Do not repeatedly regenerate these between deployments; that invalidates sessions or old correlation fingerprints.

## 3. Optional Google sign-in: Google to Auth0

If you want a Continue with Google button, prepare a Google Cloud project and a Web application OAuth client. Keep its Google Client ID/Client Secret in the Auth0 Google social-connection configuration, and enable that connection for the Scamwin Auth0 application.

Google's authorized redirect URI points to **Auth0**, not to our Next.js callback:

```text
https://YOUR-AUTH0-DOMAIN/login/callback
```

Use the exact tenant domain shown in Auth0 (or a configured Auth0 custom domain, if one already exists). The app's own callback remains `/auth/callback` on the app origin. Complete whatever consent-screen/test-user steps Google requires for that project's publishing status. Do not rely on shared development OAuth keys for a hosted release.

GitHub/GitLab/Bitbucket sign-in is not required merely because OpenMods has provider buttons today. Each additional enabled social connection is a separate optional configuration.

## 4. Where values will be configured

The names below match the implemented free-only Scamwin adapters. The two root environment templates are authoritative about placement; never add a `NEXT_PUBLIC_` prefix to a secret.

| Setting | Vercel web environment | Investigation worker environment |
| --- | --- | --- |
| `APP_BASE_URL` | Required: actual app origin | Only if a feature explicitly needs it |
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | Required | Not required |
| `AUTH0_SECRET` | Required, generated once per environment | Not required |
| `DATABASE_URL` | Required | Required for the matching demo/development dataset |
| `TRIGGER_SECRET_KEY` | Named Production key for the online app and private setup; Dev only for a separate local worker | Injected automatically by Trigger; filtered from custom uploads |
| `SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY` | Separate publisher project's API key for reviewed dispatch | Never required by the investigation project |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Required for evidence-only follow-ups | Required for analysis inference |
| `SCAMWIN_AI_MODEL` | Fixed Scout model where inference executes | `@cf/meta/llama-4-scout-17b-16e-instruct`; verify actual account access first |
| `BROWSERLESS_TOKEN`, `BROWSERLESS_BASE_URL` | Not required for the ordinary UI | Required; endpoint stored separately from secret token |
| `SCAMWIN_INDICATOR_HMAC_SECRET` | Not required | Required for private exact-indicator correlation |
| Policy/quota/environment values | Server-controlled; generated from accepted plan | Matching server-controlled policy |

Keep Dev and Prod configuration separate. Do not make live preview deployments share a valuable database. Existing upstream Render/Daytona/OpenAI modules remain outside the dedicated Scamwin runtime; do not configure or deploy that generic bot flow for this demo.

Set `TRIGGER_PROJECT_REF` for `scamwin.trigger.config.ts` and `SCAMWIN_PUBLISHER_PROJECT_REF` for `scamwin.publisher.config.ts`; neither reference is interchangeable with an environment API key. Use `deploy:scamwin-worker` and `deploy:scamwin-publisher`, not the upstream generic worker configuration. The isolated publisher gets only its dedicated database/RPC/registry settings and test signing key from `scamwin.publisher.env.example`; the investigation project and Vercel never receive the wallet key. Worker deployment uses interactive Trigger CLI login. No Vercel/GitHub personal token is required for their normal dashboard connections.

## 5. Web3 values: prepare now versus generate later

Prepare now:

- A dedicated test-only deployer/admin public address and separate publisher account; a guardian address for suspension/correction controls.
- Access to those accounts through your wallet without sending recovery phrases to anyone.
- Base Sepolia selected; chain ID `84532`.
- A small amount of **free test ETH** from an official-listed faucet; availability/rate limits vary. Never buy mainnet ETH for this demo.
- A Base Sepolia RPC endpoint; a public endpoint can be tried initially, subject to limits. A provider API key is optional if a free dedicated RPC is later needed.

Generated during authorized implementation/deployment:

- Contract ABI, registry address, deployment block/transaction and versioned deployment manifest.
- Publisher permissions and guardian/owner configuration.
- The secure deployment configuration for transaction signing.

A server publisher needs access to a signing key, but that key must be configured through a protected deployment secret scope, not this chat or a committed file. Keep it separate from ordinary analysis/browser execution; use an isolated publisher deployment/project if the platform shares environment secrets across tasks. Normal Scamwin visitors do not need wallets.

## 6. What we generate for you

The build will provide a names-only/example environment template, validate missing variable names without printing values, generate application secrets during setup, wire provider adapters, update the correct Trigger project reference, and provide the exact hosted Auth0 callback entries after the Vercel origin exists. It will include a service-readiness screen/command and deployment order.

Do not prepare OpenAI, Daytona, Render, Firecrawl, R2/S3 or paid threat-feed credentials for this revised budget plan. No purchased custom domain or paid monitoring subscription is needed. There is no benefit to collecting unrelated API keys.

## 7. Smooth setup order

1. Verify access to GitHub and create/confirm the free Vercel account.
2. Create/confirm Auth0, Neon, Cloudflare, Trigger and Browserless Free accounts; save their values privately with clear service/environment labels.
3. Enable Auth0 email/password; decide whether optional Google login is needed immediately.
4. Prepare the test-only wallet public addresses/free test ETH, and choose the first admin/reviewer identity.
5. After build authorization, implement against mocks and then configure ignored local/provider secrets through protected inputs.
6. Run small real-service checks within free quotas: account/model access, database ownership, job dispatch, remote browser capability, authentication and testnet RPC.
7. Deploy the background jobs, deploy the Vercel web app, record its actual production origin, update Auth0 allowlists and redeploy any changed web environment configuration.
8. Deploy the registry and isolate publisher secrets, then verify a real reviewed testnet warning/retraction and independent reader.
9. Complete a real hosted sign-in → private check → saved result → optional review workflow, and verify quota/capability limits are visible.

UI and mocked development can proceed without all external keys. Live integration verification cannot be claimed until the required accounts/settings are available. Creating a provider account alone does not prove API/model/browser access.

## Official references

- [Auth0 Next.js v4 setup](https://auth0.com/docs/quickstart/webapp/nextjs), [Google connection](https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/google).
- [Neon connection details](https://neon.com/docs/connect/connect-from-any-app).
- [Cloudflare Workers AI REST token setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).
- [Browserless endpoints](https://docs.browserless.io/overview/connection-urls).
- [Trigger environment API keys](https://trigger.dev/docs/apikeys).
- [Vercel environment settings](https://vercel.com/docs/environment-variables).
- [Base network details](https://docs.base.org/get-started/connect-to-base), [free testnet funds](https://docs.base.org/get-started/get-funds).
