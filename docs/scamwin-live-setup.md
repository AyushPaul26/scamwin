# Scamwin: connect services, deploy, test, then finish the missing features

Updated 9 November 2026. **The core fully online demo is verified.** Website: `https://scamwin.vercel.app`; isolated publisher: `https://scamwin-publisher.vercel.app`. Application revision `de79df5` passed both hosted production builds. No always-on laptop or paid provider is required.

Observed live: Auth0 sign-in and private Neon storage, Cloudflare offer analysis, an actual Browserless capture, public-DNS-pinned TLS validation, three cited high-risk findings for the fictional refund checkpoint, explicit sharing consent, operator review, and publication through the isolated online publisher. The hosted browser initially lacked Playwright's dynamically loaded manifest; explicit output-file tracing fixed it. The native publisher initially had extensionless ESM imports; NodeNext-compatible emitted imports fixed that startup error.

The controlled warning was published in transaction `0xf37ee847ba82fcef4459bc9a6f12fcb224a7e5f5b5523e38501a30d035448890`. The independent RPC reader confirmed **active**, publisher enabled, epoch 1, assertion revision 1, seven-day expiry and **included** finality on Base Sepolia. Contract: `0xb35fd72ae7a546ba4bae505019c437845532e3f0`. The online publisher subsequently reconciled the same transaction to **safe**. Safe does not mean finalized; a live retraction/finality cycle has not yet been rehearsed.

Verification: **130 Scamwin tests and 11 contract tests pass**; main and contract TypeScript checks pass; the standalone publisher build and its emitted-JavaScript runtime check pass. Other inherited OpenMods tests have unrelated baseline failures, so this is not a claim that the entire upstream test suite is green. Manual authenticated production cleanup was not run because automatic approval review rejected its potential irreversible deletion; unauthenticated rejection, read-only deployment checks and local cleanup tests passed. Secret values remain in ignored local files and the appropriate provider settings, never this guide.

Neon setup was independently verified on 9 November: the intended new database was empty before `npm run db:push`; the push completed successfully; a subsequent metadata/read check confirmed all 18 expected tables (14 `scamwin_*` tables and four inherited OpenMods tables), 18 primary keys, 10 foreign keys, and a readable empty `scamwin_checks` table. The private local connection string is in ignored `.env.local`. Vercel has been redeployed after its database variable was added. The public readiness endpoint reports configuration presence, rather than a database connection test from Vercel; database connectivity and schema checks above ran separately from the local setup environment. Database verification does not establish working AI, background investigations, browser collection or Web3 publication; those services remain the next setup steps.

Cloudflare checks on 9 November confirmed an active local token and real Scout model access. The live service returned `result.response` as an already parsed JSON object, exposing a parser assumption in the previously published code. The fix accepts that object through the same strict schema and response-size checks while retaining JSON-string support and bounded retries. Two subsequent live tests through `extractOfferIntent` passed: fictional text and an independently generated 30 KiB screenshot, with the expected organization, benefit and requested one-time code extracted from each. Each test used one request with repairs disabled; no real offer data or browser visit was used. The focused provider suite passed 10/10, the full Scamwin suite passed 87/87, TypeScript checking completed successfully, and independent review found no blockers. The owner authorized committing and pushing this fix, its tests and the setup notes on 9 November. Verify that Vercel deploys the resulting revision with the three AI variables; a redeploy of the old source alone will not include the parser fix.

Scamwin uses **Neon PostgreSQL**. No Neo4j account, Neo4j API key or separate graph database is needed. Exact related-case relationships are stored in Neon.

## The order we will follow

| Step | What we connect | What must work before moving on |
| --- | --- | --- |
| 1 | Prepare Auth0 | Login application exists; its settings are saved privately |
| 2 | Current Scamwin code → your GitHub → Vercel | A deployed page actually says Scamwin; stable production address exists |
| 3 | Auth0 → the Vercel website | Real sign-in, refresh and logout work on `/account` |
| 4 | Neon → website | Database connection and clean Scamwin schema verified |
| 5 | Cloudflare Workers AI → investigation and follow-up | The chosen model accepts a small test; no paid fallback |
| 6 | Vercel background execution → database/AI | A real message-only check produces saved evidence and a result |
| 7 | Browserless → investigation worker | An owned controlled site yields real browser/TLS observations |
| 8 | Isolated publisher + Base Sepolia | Reviewed warning appears on chain and in an independent reader |
| 9 | End-to-end rehearsal | Owned/private data, history, sharing, roles and failures tested live |
| 10 | Remaining product work | Build the listed missing features and repeat the affected tests |

All deployed processing runs online. A laptop may be used briefly for setup/deployment commands; it does not need to stay on afterward. Use Free/Hobby accounts, the included Vercel address, and testnet funds. Do not enable paid usage, buy credits or buy ETH for this demo.

## Before entering any keys

- Public URLs, project references, Client IDs and public wallet addresses can be discussed in chat. Do not paste client secrets, database URLs/passwords, API tokens, wallet private keys or recovery phrases.
- Real values go in provider secret settings or ignored environment files. Markdown documents contain names/placeholders only.
- The local project directory is `C:\Users\Ayush Paul\Desktop\hackmatrix\openmods`.
- `scamwin.env.example` lists web/investigation settings. `scamwin.publisher.env.example` is for the separate publisher. Do not overwrite an existing `.env.local` containing saved values; merge the needed names.
- Environment variables are the connections: for example, the website receives Neon's `DATABASE_URL`; it does not need your Neon dashboard password or a Neon management API key.

## Step 1 — prepare Auth0 sign-in first

### What you do now

1. Open the [Auth0 Dashboard](https://manage.auth0.com/) and create/sign in to your account.
2. Create/select a tenant and retain the Free plan. If onboarding shows a temporary feature trial, do not enable paid/trial-only capabilities or billing. Auth0 says its default trial returns to Free; verify the actual account state before the demo.
3. Open **Applications → Applications → Create Application**.
4. Enter **Scamwin** as its name.
5. Choose **Regular Web Application**, then create it. This Next.js app already contains Auth0 integration; do not create a second app using a tutorial or replace it with a Single Page Application.
6. On the new application's **Settings**, find and save these values privately:

| Auth0 field | App environment name | Where it eventually goes |
| --- | --- | --- |
| Domain | `AUTH0_DOMAIN` | Vercel Production |
| Client ID | `AUTH0_CLIENT_ID` | Vercel Production |
| Client Secret | `AUTH0_CLIENT_SECRET` | Vercel Production; secret |

7. Open **Authentication → Database**. Select the email/password connection, commonly named `Username-Password-Authentication`. In its application settings, enable it for Scamwin and save. Check that sign-ups are allowed for the demo.
8. Stop here for the first checkpoint. Report only **“Auth0 app created”** and, if useful, the public Domain/Client ID. Keep the Client Secret private.

Email/password through Auth0 is the first user sign-in method. Google login is optional and can be added later; it is not necessary to prepare Google Cloud OAuth keys now. Your GitHub/Vercel account login is separate from the login used by Scamwin's users.

### What we configure after the website address exists

We also need `APP_BASE_URL` and a stable random `AUTH0_SECRET`. The latter is our own cookie-protection secret, not the Client Secret from Auth0. Generate it during secure setup and store it privately. Do not regenerate it at every deployment.

No production callback URL is required just to create the Auth0 application. We will enter the real Vercel origin in Step 3. Do not paste the example hostname below into your real settings.

Sources: [Auth0 Next.js setup](https://auth0.com/docs/quickstart/webapp/nextjs), [database connections](https://auth0.com/docs/authenticate/database-connections), [tenants](https://auth0.com/docs/get-started/auth0-overview/create-tenants), [trial-to-Free behavior](https://auth0.com/pricing).

## Step 2 — create a deployment for the actual current Scamwin code

1. Create a GitHub repository you control when we reach this step; `scamwin` is a suitable name. Share its public repository URL or repository identifier, not a token.
2. We put the current local Scamwin source in that repository. **Important:** the initial build was left uncommitted/unpushed; on 9 November the owner authorized publication to `AyushPaul26/scamwin`. Verify that repository contains the current Scamwin commit before importing it. Importing the old upstream OpenMods repository alone may deploy its old application. Creating an empty repository does not upload this code.
3. Repository instructions require explicit authorization for commits. We handle the actual commit/push step only after the target repository is known and that action is authorized. No secret environment files go into Git.
4. In Vercel, choose **Add New → Project**, import the repository containing the current Scamwin revision and use the Next.js framework.
5. Choose Root Directory according to the repository: use its root if `package.json` is at the root, or `openmods` if that directory contains the app.
6. Use Node **24.x**, install command `npm ci`, and build command `npm run build`. The project has the required peer-resolution `.npmrc`.
7. An initial keyless deployment can show the homepage and the read-only `/demo`; real checks remain unavailable. Record the assigned production origin, such as `https://your-actual-project.vercel.app`.
8. Verify that it displays **Scamwin**, not the old bot dashboard. Share only the actual public URL for the next checkpoint.

No purchased domain or Vercel personal API token is needed for this dashboard workflow. Source: [Vercel deployment](https://vercel.com/docs/deployments).

## Step 3 — connect Auth0 to that deployed website

Suppose the **actual assigned** origin is `https://your-actual-project.vercel.app`. Use your real address consistently in these fields:

| Auth0 application setting | Value pattern |
| --- | --- |
| Allowed Callback URLs | `https://your-actual-project.vercel.app/auth/callback` |
| Allowed Logout URLs | `https://your-actual-project.vercel.app` |
| Allowed Web Origins | `https://your-actual-project.vercel.app` |

Save the Auth0 settings. In **Vercel → Project → Settings → Environment Variables**, add these to **Production**:

```dotenv
APP_BASE_URL=YOUR_ACTUAL_HTTPS_VERCEL_ORIGIN
AUTH0_DOMAIN=YOUR_AUTH0_DOMAIN
AUTH0_CLIENT_ID=YOUR_CLIENT_ID
AUTH0_CLIENT_SECRET=ENTER_PRIVATELY
AUTH0_SECRET=GENERATED_STABLE_64_HEX_CHARACTERS
```

Redeploy after changing Vercel variables. Test **Sign in → create an email/password test user → return to the app → `/account` → refresh → sign out**.

The current `/check` screen stays gated until database and investigation-worker settings are also present. Use `/account` to test login on its own; do not add fake database/worker values just to unlock the form.

After sign-in, find your test user's Auth0 **User ID** under **User Management → Users**. Put that exact subject, such as `auth0|...`, in Vercel's `SCAMWIN_ADMIN_SUBJECTS` when we enable the reviewer/admin workspace. Email text does not grant a role.

Checkpoint: a genuine Auth0 session survives refresh and logout clears it. Sources: [Auth0 callback setup](https://auth0.com/docs/quickstart/webapp/nextjs), [Vercel environment variables and redeployments](https://vercel.com/docs/environment-variables).

## Step 4 — connect Neon PostgreSQL

1. Open the [Neon Console](https://console.neon.tech/), create a Free project named `scamwin`, and choose a convenient region.
2. Use a dedicated disposable demo database. Our repository uses a clean-schema workflow; do not supply a valuable existing database.
3. Open **Connect**, choose the intended branch/database/role and copy its complete PostgreSQL connection string. Preserve its TLS parameters.
4. Save it privately as `DATABASE_URL` in Vercel Production and in the local ignored `.env.local` used for one-time schema setup. No separate Neon API key is needed.
5. From the project directory, run the read-only connection check:

```powershell
npm run db:check
```

6. Once the dedicated target is verified, apply the schema:

```powershell
npm run db:push
```

7. Confirm the Scamwin tables exist, including `scamwin_checks`, `scamwin_observations` and `scamwin_job_outbox`. Do not create tables manually or run migrations.
8. Redeploy Vercel with the new setting. Later, the two Trigger projects will receive this same demo `DATABASE_URL` separately.

Checkpoint: read-only connection succeeds and the intended schema exists. Source: [Neon connection dialog](https://neon.com/docs/connect/connect-from-any-app).

## Step 5 — obtain Cloudflare Workers AI values

1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com/), select your account and stay on Workers Free.
2. Open **Workers AI → Use REST API → Create a Workers AI API Token**.
3. Use the account-scoped token template. Save the API token and copy the Account ID from that setup page.
4. Add these to Vercel Production for follow-up answers; add the same relevant values to the investigation project's Production settings in Step 6:

```dotenv
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=ENTER_PRIVATELY
SCAMWIN_AI_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct
```

5. We test a small synthetic prompt and then a prepared synthetic screenshot against the selected model. Invalid/refused output or an exhausted quota must remain visible; we do not replace it with a paid model.

You do not need to deploy another website on Cloudflare. Checkpoint: account/model access is verified. Source: [Workers AI REST setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).

## Step 6 — run investigations on Vercel

The selected replacement uses Next.js `after()` in the existing Vercel project. No extra hosting account or continuously running laptop is needed. Set these in **Vercel Production**:

| Name | Type | Value/source |
| --- | --- | --- |
| `SCAMWIN_INVESTIGATION_BACKEND` | Config | `vercel` |
| `SCAMWIN_INDICATOR_HMAC_SECRET` | Secret | Existing stable generated value in private `.env.local` |
| `CRON_SECRET` | Secret | Generated private value for daily physical cleanup |
| `DATABASE_URL` | Secret | Existing Neon connection |
| `CLOUDFLARE_ACCOUNT_ID`, `SCAMWIN_AI_MODEL` | Config | Existing verified AI settings |
| `CLOUDFLARE_API_TOKEN` | Secret | Existing rolled and verified token |

1. The private ignored `.env.vercel-worker.local` file contains the additional generated settings. In Vercel's environment variable dialog use **Import .env** to select this file, select **Production**, and save. Keep existing Auth0/database/AI variables. Never upload this file to Git or chat.
2. Deploy the replacement source after the repository-required commit/push authorization. `vercel.json` enables Fluid Compute. Action pages and result polling have `maxDuration=300`; the pipeline retains a 240-second deadline. No paid upgrade or fallback is enabled.
3. Sign in on the exact production origin. Submit one fictional message-only check, open its result, refresh and verify saved observations. Browser and registry checks can correctly remain unavailable.
4. The callback leases only investigation jobs. At most two checks may be active globally, one per account, with existing daily/monthly admission caps. Owner-authenticated result polling can nudge an undelivered pending job.
5. Daily authenticated Vercel cron physically purges expired private data. Access checks already hide expired data immediately; physical removal can occur later at the daily cleanup invocation.

This is bounded background execution, **not a durable workflow service**. The original request and its background work share Vercel's five-minute limit. If the invocation is terminated, Neon preserves completed writes; the check expires as failed/incomplete instead of claiming success. Automatic retry after every possible process failure is not guaranteed.

Legacy Trigger code remains optional under `SCAMWIN_INVESTIGATION_BACKEND=trigger`. It requires an actually deployable project and matching key. Its key/reference are not required for Vercel investigations, and setting them does not select a paid fallback.

Sources: [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after), [Vercel duration](https://vercel.com/docs/functions/configuring-functions/duration), [Fluid Compute](https://vercel.com/docs/fluid-compute), [Hobby limits](https://vercel.com/docs/plans/hobby).

## Step 7 — add Browserless and controlled technical evidence

1. Open [Browserless Free signup](https://www.browserless.io/signup/email?plan=free), sign in with GitHub/Google or email, and retain Free. Copy the API token privately from the account home.
2. Add `BROWSERLESS_TOKEN` as **Secret** in **Vercel Production** and private `.env.local`. No token needs to be shared in chat.
3. Set these **Config** values in Vercel Production:

```dotenv
BROWSERLESS_BASE_URL=https://production-sfo.browserless.io
SCAMWIN_APPROVED_ORIGINS=https://scamwin.vercel.app
SCAMWIN_BROWSER_CAPABILITY_VERIFIED=false
SCAMWIN_ORIGIN_PROBE_ENABLED=false
SCAMWIN_OFFICIAL_SOURCES_JSON=[]
```

4. Deploy the replacement source containing clearly fictional owned fixtures at `/lab/refund-offer`, `/lab/refund-checkpoint` and `/lab/official-refund-policy`. The existing `/demo` remains saved synthetic data, rather than proof of a live visit.
5. We test actual remote sessions, approved/denied requests, read-only policy, raster capture, timeouts and closure. Only after the relevant checks pass set the browser capability flag true. Separate TLS probing stays false until tested separately.
6. Test the checkpoint URL with the fictional message: “Your refund of ₹2,499 is ready. Receiving it is free; I want to receive my refund.” The page's synthetic outgoing payment checkpoint supplies observable contradictory evidence; no real payment or credential submission occurs.

Free sessions have provider quotas. The app uses a 60-second session cap and provider closure; exhausted or unavailable browsing stays explicit. Arbitrary malicious or unapproved sites remain outside the enabled demo.

Sources: [Browserless keys](https://docs.browserless.io/overview/api-keys), [connection URLs](https://docs.browserless.io/overview/connection-urls), [Free quota behavior](https://docs.browserless.io/overview/unit-consumption).

## Step 8 — connect the isolated Vercel publisher and Base Sepolia

The owner approved registry deployment and publisher authorization on 9 November, using only free Base Sepolia test ETH. Contract: `0xb35fd72ae7a546ba4bae505019c437845532e3f0`; publisher: `0xea54c5Ba331a5B48D58aECF1126fba3e3957BeD9`. Public deployment metadata is in `web3/deployments/`; signing keys remain in ignored local files.

1. In Vercel create a **second project**, named `scamwin-publisher`, importing the same GitHub repository.
2. Choose **Root Directory `publisher`**, **Framework Other**, **Node 24.x**. Enable **Include source files outside of the Root Directory in the Build Step**. The package's `vercel.json` supplies install `npm ci`, build `npm run build`, output `public`, Fluid Compute and the daily cron.
3. Import the private `.env.publisher-host.local` file into **this publisher project only**, Production. Mark `DATABASE_URL`, `SCAMWIN_PUBLISHER_PRIVATE_KEY`, `SCAMWIN_PUBLISHER_DISPATCH_SECRET` and `CRON_SECRET` as **Secret**. Public chain/registry/publisher/RPC settings can be Config. Never put these signing settings in the main website.
4. Deploy it and record its public origin, such as `https://scamwin-publisher.vercel.app`. The API path is `/api/relay`; unauthenticated requests must be rejected before a database or signer is loaded.
5. In the **main Scamwin website** configure `SCAMWIN_PUBLICATION_BACKEND=vercel`, `SCAMWIN_PUBLISHER_BASE_URL` as the publisher **origin only**, shared `SCAMWIN_PUBLISHER_DISPATCH_SECRET` as Secret, and public registry/chain/publisher/RPC settings. The main build rejects a publisher signing key.
6. Configure `SCAMWIN_ADMIN_SUBJECTS` using the exact verified Auth0 subject of the operator, then redeploy the main website.
7. Complete a real controlled browser check, choose a redacted warning and explicitly consent. Sign in as the operator, review it and approve. The website schedules a server-authenticated call to the separate publisher; no browser submits calldata or a signing key.
8. Check stored transaction status and read the actual on-chain assertion independently. Reviewer reads and daily cron can reconcile one operation. Inclusion, safe and finalized remain different states; pending signed operations prevent new nonces. Do not promise immediate retraction before that operation is reconciled.

The package build and request tests run independently. Legacy Trigger publication requires an explicit `SCAMWIN_PUBLICATION_BACKEND=trigger` and a working separate publisher project; it is not an automatic fallback. See [the isolated package](../publisher/README.md) and [registry protocol](../web3/README.md).

## Exact settings placement

“Public registry settings” below means chain ID, contract address, trusted publisher address and RPC URL; it never means a wallet private key.

| Values | Vercel Production (selected investigation backend) | Legacy Investigation Trigger Production | Publisher Trigger Production |
| --- | --- | --- | --- |
| `APP_BASE_URL` | Required actual web origin | No | No |
| Auth0 domain, Client ID, Client Secret, `AUTH0_SECRET` | Required | No | No |
| `SCAMWIN_ADMIN_SUBJECTS` | Verified admin subject(s) | No | No |
| `DATABASE_URL` | Demo DB | Same demo DB | Same demo DB |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `SCAMWIN_AI_MODEL` | Investigation and follow-up inference | Investigation inference if selected | No |
| `TRIGGER_SECRET_KEY` | Optional legacy backend only | Built in and injected by Trigger; do not upload | Built in for the publisher environment |
| `SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY` | Publisher project's Prod key | No | Own key for outbox recovery |
| `SCAMWIN_INDICATOR_HMAC_SECRET` | Required stable secret for private correlation | Required only if selected | No |
| Browserless token/host, approved origins, browser/TLS gates | Required for enabled live collection | Required only if selected | No |
| `SCAMWIN_OFFICIAL_SOURCES_JSON` | Optional curated demo references | Optional if selected | No |
| Public registry settings | Yes when Web3 enabled | Yes for warning lookups | Required |
| `SCAMWIN_PUBLISHER_PRIVATE_KEY` | **Never** | **Never** | Dedicated test signing key only |
| Deployer/owner private keys or recovery phrases | **Never** | **Never** | **Never** |

`TRIGGER_PROJECT_REF` and `SCAMWIN_PUBLISHER_PROJECT_REF` select the deployment configuration; they are not dispatch API keys. Keep the separate local deployment environment files private. Production and Development keys are not interchangeable.

## Step 9 — what we test on the live deployment

Record pass/fail and observed limitations for each item. Local tests and configuration presence do not replace these tests.

- Auth0 signup/login/refresh/logout and a second account.
- Private check creation, actual Vercel background execution, reload/reopen and owner isolation.
- Message and screenshot analysis, exact payment-direction evidence, readable explanations and missing checks.
- Remote captures/TLS only within approved scope; unavailable/blocked/provider-quota states.
- Follow-up answers, history/search, recheck, cancellation and deletion.
- Same-owner related indicators and no cross-owner disclosure.
- Reviewer approval/rejection/request-information, fresh owner consent and admin pause controls.
- Actual testnet publication, independent reading, retraction and explicit finality/freshness.
- Mobile layout, keyboard access and session-expiry recovery.

Plan the rehearsal within admission caps: three new checks/account/day, ten globally/day, fifty globally/month. Deleted/canceled checks still count. Repeatedly clicking recheck consumes another admission; hitting a limit is an expected state, not a reason to buy a plan.

## Step 10 — finish what is missing after we test the current app

The feature backlog remains: automatic multiple-link picker, elapsed timer, security impact/fix presentation, cleanup status tracking, live operations health, verified official-reference entries and a dedicated correction editor. Setup also requires live verification of the controlled fixtures and the publisher activation step described above. Trigger-independent Web3 publishing remains unfinished while its cloud deployment is restricted; do not present a local-only review as an on-chain transaction. Track any additional live-test defects instead of treating every problem as a missing API key.

The live image-only AI smoke also returned correct visible facts while labeling candidate hints `user_text`. Candidate-source labels remain model output, rather than verified provenance; add source-label validation in the follow-up product work before relying on those hints as source evidence. These candidate hints are currently not consumed by the evidence/risk pipeline.

We will build these against observed requirements, then repeat the affected local and live tests. None of these UI gaps requires adding a paid provider. See [current plan and feature status](scamwin-current-plan.md), [full credential reference](scamwin-setup-guide.md) and [running commands](scamwin-running.md).

## Safe checkpoint replies

For Step 1, reply with only:

```text
Auth0 application created: yes / no
Application type: Regular Web Application
Email/password connection enabled: yes / no
Domain: public value, optional
Client ID: public value, optional
Client Secret saved privately: yes / no
```

We then continue to the next unfinished checkpoint. Do not collect every service's secret first or post a complete `.env` file in chat.
