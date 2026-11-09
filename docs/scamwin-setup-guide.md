# Scamwin: step-by-step account, API key, OAuth and deployment setup guide

> **Isolated publisher amendment, 9 November:** the optional publisher can now run in a second Vercel project rooted at `publisher/`. The signing key is permitted only in that dedicated project's Production secrets, never the main website, shared team variables, Preview or investigations. The main website receives an origin-only `SCAMWIN_PUBLISHER_BASE_URL`, shared dispatch secret and public registry settings. This supersedes the earlier platform-wide Vercel signing ban and Trigger-only publisher instructions. See [publisher setup](../publisher/README.md). The registry and publisher activation were deployed to Base Sepolia with explicit owner approval and free test ETH; actual warning publication still needs its hosted test.

> **9 November 2026 replacement:** the selected investigation backend is now `SCAMWIN_INVESTIGATION_BACKEND=vercel`, using Next.js `after()` and a 300-second Vercel Fluid invocation. Put investigation Cloudflare, Browserless, stable HMAC and approved-origin settings in **Vercel Production**. `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF` are optional legacy investigation settings, not requirements for this backend. Existing Trigger-only instructions below apply only when that backend is deliberately selected. Follow [the current live setup steps](scamwin-live-setup.md#step-6--run-investigations-on-vercel) for exact placement and limitations. Web3 publication still requires its separate isolated publisher; it is not enabled by this replacement.

Updated: 8 November 2026.

**Start here for the actual setup order:** [connect and test one service at a time](scamwin-live-setup.md). That walkthrough begins with Auth0, gets the current Scamwin revision onto Vercel, connects each remaining service with a checkpoint, and tests the current app before further feature work. This longer file is the service-by-service reference. The database is Neon PostgreSQL; no Neo4j account is required.

This is the preparation guide for our **fully online, zero-spend hackathon prototype**, with the website on **Vercel Hobby**. It follows the [current budget amendment](superpowers/plans/2026-11-08-scamwin-zero-cost-vercel-amendment.md).

The [current consolidated free implementation plan](scamwin-current-plan.md) records the actual stack, outstanding feature details and live-demo acceptance work. Only the Free/Hobby services listed there are required; the earlier paid-provider plan is superseded.

**The application has now been implemented locally. Accounts and credentials have not been created for you, and deployment still waits for your authorization.** Use [the running guide](scamwin-running.md) and [environment template](../scamwin.env.example) with these preparation steps. Dashboard labels can change; use the linked official guide when a menu looks different.

## 1. How to use this guide

Work through the service sections in order. Every section explains what the service does, how to obtain its settings, and what to keep ready. Items marked **Now** can be prepared before the build. Items marked **Later** depend on the finished app or first deployment.

Use the Free/Hobby plan for each required service. Do not activate a paid trial, purchase credits, buy a domain or enable automatic recharge for this plan. Actual account/API availability still needs a small live test; having an account alone does not establish that every feature is enabled. Free-quota exhaustion must pause the affected feature rather than incur a charge.

**Where to save your real values:** use your password manager or the provider's secret/environment settings. During development, an ignored `.env.local` is another supported location. Keep this Markdown file as a guide containing placeholders, not as a notebook of real passwords or API keys.

If you already control working OpenMods projects, keep their settings ready. We can verify and reuse them instead of creating duplicates. Do not reset working credentials or delete existing data just to follow the guide.

## 2. What the different values mean

| Term | Simple meaning | Secret? |
| --- | --- | --- |
| API key / API token | A credential that lets our server call a provider | Yes |
| Account ID / project reference | Identifies the account/project to use; does not normally authenticate by itself | Normally no |
| OAuth Client ID | Identifies the registered login application | Normally no |
| OAuth Client Secret | Authenticates our server-side login application | Yes |
| `AUTH0_SECRET` | Our own random key for protecting app-session cookies; different from Client Secret | Yes |
| `DATABASE_URL` | Database address plus login details, often including a password | Yes, the whole string |
| Callback / redirect URL | The exact destination a login provider returns to | No |
| Production URL | The stable address people open to use the deployed app | No |
| Blockchain wallet address | Public identifier for a testnet account | No |
| Wallet private key / recovery phrase | Material that can control a wallet | Yes; never paste in chat or this file |
| RPC URL | API endpoint for reading/sending blockchain transactions | Public unless it embeds a private provider key |
| Contract address / deployment block | Identifies the contract created during deployment | No; generated later |

Do not prefix any secret with `NEXT_PUBLIC_`. In Next.js that prefix is intended for values exposed to the browser.

## 3. Master preparation checklist

| Step | Prepare now | Required for |
| --- | --- | --- |
| GitHub | Account/repository access | Source hosting and Vercel connection |
| Vercel | Hobby account | Website deployment |
| Auth0 | Free tenant + Regular Web Application + saved client settings | Sign-in |
| Neon | Free Postgres project + connection string | Private cases/results/evidence |
| Cloudflare | Free account + Workers AI token + Account ID | AI |
| Trigger.dev | Separate Free investigation/publisher projects, both references and production keys | Online investigations and isolated reviewed warning publication |
| Browserless | Free Cloud account + API token + regional endpoint | Limited remote browser observations |
| Testnet wallet | Dedicated operator accounts + free Base Sepolia test ETH | Registry deployment and warning publication |
| Google OAuth | Optional Google Cloud OAuth client | Continue with Google button |
| Admin account | Decide which sign-in identity you will use | Reviewer/admin role after first real login |

The intended prototype needs no paid OpenAI, Daytona, Render, Firecrawl, R2/S3 or external threat-feed account. There is no required custom domain or paid monitoring service.

## 4. GitHub: source repository access

**What it does:** holds the application code and lets Vercel import approved revisions.

**Now**

1. Open [GitHub](https://github.com/) and sign in to the account that should own/control the project.
2. Confirm you can access `ANAMASGARD/openmods`, or the repository you intend to deploy instead.
3. Record the repository URL and account/organization owner.
4. If you do not control the source repository, note that fact. We will choose an authorized fork/repository during the build workflow; do not assume cloning gave you push rights.
5. Make sure you can complete the account's email/2FA prompts when connecting Vercel.

**Keep ready:** repository URL and owner. For the normal dashboard import, no GitHub personal access token is needed.

## 5. Vercel: prepare hosting now, import the app later

**What it does:** hosts the Next.js website, login routes, private reads and permitted provider API integrations. It is not the target browser/scanner.

**Now**

1. Open [Vercel](https://vercel.com/) and sign up/sign in, preferably through the intended GitHub account.
2. Select the **Hobby** plan for this personal, non-commercial hackathon prototype.
3. Confirm that the correct GitHub account can be linked. Grant repository access only to the intended repository when prompted.
4. Keep your dashboard access ready. Before importing a repository, confirm it contains the current Scamwin changes. The initial build was left uncommitted/unpushed; the owner has since authorized publication to `AyushPaul26/scamwin`. Importing the old upstream revision alone does not deploy the new application.

**Later, after the app is ready**

1. Choose **Add New → Project** and import the intended GitHub repository.
2. Use the Next.js framework detection. If the repository root is OpenMods itself, Root Directory is the repository root; if it contains an `openmods/` subdirectory, select that subdirectory.
3. Select Node **24.x**, matching the project, and add the web variables from section 14.
4. Deploy when authorized and copy the actual production address, such as `https://YOUR-PROJECT.vercel.app`. The example is a placeholder, not a reserved name.
5. Set `APP_BASE_URL` to that exact origin, update Auth0 allowlists from section 7, and redeploy any changed environment configuration.

**Keep ready:** account access now; actual production origin later. No Vercel personal token is needed for the ordinary dashboard workflow. Hobby has usage and non-commercial restrictions.

References: [getting started](https://vercel.com/docs/getting-started-with-vercel), [Hobby](https://vercel.com/docs/plans/hobby), [environment variables](https://vercel.com/docs/environment-variables).

## 6. Auth0: create the login application

**What it does:** manages accounts and sign-in. OAuth is the login redirect protocol; Auth0 is our selected login provider.

**Now**

1. Open the [Auth0 Dashboard](https://manage.auth0.com/) and sign up/sign in.
2. Create or select your Free tenant. Note its full domain.
3. Open **Applications → Applications → Create Application**.
4. Name it **Scamwin** and choose **Regular Web Applications**. Do not choose Single Page Application for this server-side Next.js setup.
5. Open the application's **Settings** and save:
   - **Domain** → `AUTH0_DOMAIN`.
   - **Client ID** → `AUTH0_CLIENT_ID`.
   - **Client Secret** → `AUTH0_CLIENT_SECRET`, stored privately.
6. Open **Authentication → Database** and confirm an email/password connection exists, commonly `Username-Password-Authentication`.
7. In that connection's application settings, enable it for the Scamwin application and save.
8. Configure the development callback entries in section 7 and save all application changes.

**Ready when:** the correct application type is selected, the three client values are saved, and email/password is enabled. We verify an actual login after the deployed website's origin and Auth0 settings are connected; `/account` can be used before investigation services are ready.

Reference: [official Next.js v4 setup](https://auth0.com/docs/quickstart/webapp/nextjs).

## 7. Auth0: exact callback and origin settings

Enter the following in the Scamwin application's Settings. Localhost entries can be added now; hosted entries must use the actual production URL later.

| Auth0 field | Development value | Production value |
| --- | --- | --- |
| Allowed Callback URLs | `http://localhost:3000/auth/callback` | `https://YOUR-PROJECT.vercel.app/auth/callback` |
| Allowed Logout URLs | `http://localhost:3000` | `https://YOUR-PROJECT.vercel.app` |
| Allowed Web Origins | `http://localhost:3000` | `https://YOUR-PROJECT.vercel.app` |

If one field contains multiple entries, follow Auth0's input format and add both exact values. Save changes. Avoid broad wildcard access to other Vercel projects. Preview deployment URLs need their own explicit matching configuration if preview login is required.

`APP_BASE_URL` is our application environment value, not a secret. Use `http://localhost:3000` locally and the exact HTTPS production origin when hosted. Keep `localhost` consistent; `127.0.0.1` is a different origin/cookie store.

### Client Secret versus AUTH0_SECRET

`AUTH0_CLIENT_SECRET` comes from Auth0. `AUTH0_SECRET` is generated by us and protects session cookies.

**Later:** we can generate it during setup. If you choose to generate it yourself with Node installed, run this on your own machine:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Store the generated value privately as `AUTH0_SECRET`. It should be 64 hexadecimal characters. Generate separate stable secrets for separate environments; do not rotate it at every deployment or users will lose their sessions.

Reference: [Auth0 Next.js configuration](https://auth0.com/docs/quickstart/webapp/nextjs).

## 8. Neon: obtain the database connection string

**What it does:** stores private checks, progress, results, small evidence artifacts and review data.

**Now**

1. Open the [Neon Console](https://console.neon.tech/) and sign up/sign in.
2. Create a **Free** project named `scamwin`, or select an existing project you control.
3. Prefer a dedicated disposable development/demo database. Do not point our development schema-reset workflow at valuable existing data.
4. Open the project and choose **Connect**.
5. Select the intended branch, database and role. Keep a note of those names.
6. Copy the complete connection string. Pooled connection details are normally available; keep the provider-supplied TLS parameters intact.
7. Save the whole string privately as `DATABASE_URL`. It contains the database password.

**Ready when:** you have a complete connection string for a known project/branch/database. We run a read-only connection test later; you do not need to create tables manually.

Use a separate development dataset from the deployed demo when available. Each runtime must use the intended environment's database. Do not manually strip `sslmode` or other required connection parameters.

Reference: [Neon Connect dialog and connection strings](https://neon.com/docs/connect/connect-from-any-app).

## 9. Cloudflare Workers AI: obtain the AI token

**What it does:** supplies our free-allowance text/image inference. A separate Cloudflare-hosted website or purchased domain is not needed for REST inference.

**Now**

1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com/) and create/sign in to your Free account.
2. Open **Workers AI**. If navigation labels differ, search the dashboard for that product.
3. Select **Use REST API**.
4. Choose **Create a Workers AI API Token** and review its account scope.
5. Create the token and save the full value privately as `CLOUDFLARE_API_TOKEN`.
6. On the same setup page, copy **Account ID** as `CLOUDFLARE_ACCOUNT_ID`.
7. Keep the account on Workers Free. Do not enable paid billing or AI Gateway prepaid credits to follow this guide.

If you manually create a token rather than using the template, the current guide specifies `Workers AI - Read` and `Workers AI - Edit`, restricted to the intended account. Do not substitute a broadly privileged Global API Key.

The candidate model is `@cf/meta/llama-4-scout-17b-16e-instruct`, configured as `SCAMWIN_AI_MODEL`. We will verify actual account/model access and image quality. If access fails, the app must explain the unavailable capability instead of activating a paid fallback. Keep content logging/caching disabled.

References: [REST token setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [free allowance](https://developers.cloudflare.com/workers-ai/platform/pricing/), [model capabilities](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/).

## 10. Trigger.dev: obtain project reference and environment keys

**What it does:** runs finite background investigations online, so your laptop can be off.

**Now**

1. Open [Trigger.dev Cloud](https://cloud.trigger.dev/) and create/sign in to a Free account/organization.
2. Create or select the intended project, such as `scamwin`.
3. Open **Project settings** and record the **project reference**. This is not an API key.
4. For the fully online prototype, select **Production → API keys** and create a named key such as `Scamwin investigation`.
5. Use **No restrictions**, the current Free-plan preset. Save the complete key privately; it is shown only once.
6. Save the Production value as `TRIGGER_SECRET_KEY` in Vercel Production and the ignored local file used for setup/deployment.
7. A Development key is optional for a separately running local development worker; it is not required for the fully online production setup. Production and Development keys are not interchangeable.
8. CLI deployment can authenticate with this Production key supplied as subprocess `TRIGGER_ACCESS_TOKEN`, or with a separately authorized CLI login. Also supply `TRIGGER_PROJECT_REF` directly before config evaluation. Use the dedicated Scamwin deployment config and `--skip-update-check`.

The repository already contains a project reference in `trigger.config.ts`. We must confirm whether it belongs to you before reusing it. The project reference, API key, deployed task ID and run ID are different things.

**Later:** in the correct Trigger project's environment-variable settings, enter worker secrets from section 15. Vercel variables do not automatically appear in Trigger. CLI deployment uses interactive login or a suitable `TRIGGER_ACCESS_TOKEN`; setting `TRIGGER_SECRET_KEY` alone is not the CLI deployment login.

References: [project quickstart](https://trigger.dev/docs/quick-start), [API keys](https://trigger.dev/docs/apikeys), [worker environment settings](https://trigger.dev/docs/deploy-environment-variables).

## 11. Browserless: obtain a remote-browser token and endpoint

**What it does:** provides limited online browser sessions for permitted, controlled observations. This is not an unrestricted malware sandbox entitlement.

**Now**

1. Open [Browserless](https://www.browserless.io/) and sign up for the **Free Cloud** plan.
2. Open your account dashboard and find **API Token / API Keys**.
3. Reveal/copy the appropriate token or create a named token if the dashboard provides that option.
4. Save it privately as `BROWSERLESS_TOKEN`.
5. Note the supported shared-fleet regional host. Store the plain HTTPS host separately as `BROWSERLESS_BASE_URL`; do not include the token in a value you intend to share publicly.
6. Check the dashboard's free allowance, reset date and session limit. Do not buy a proxy add-on or enable CAPTCHA-solving for this workflow.

The current shared-fleet documentation lists:

```text
https://production-sfo.browserless.io
https://production-lon.browserless.io
https://production-ams.browserless.io
```

Use the endpoint supported by your account. The application adapter constructs the appropriate authenticated Playwright/WebSocket connection; you do not need to assemble a token-bearing URL manually. Connection URLs containing a token are themselves secret.

**Ready when:** token, region/host and Free status are saved. Browser capability and policy tests happen later. Arbitrary hostile-site execution remains disabled until provider permission and containment are verified.

References: [API token management](https://docs.browserless.io/overview/api-keys), [dashboard](https://docs.browserless.io/overview/dashboard), [regional endpoints](https://docs.browserless.io/overview/connection-urls).

## 12. Optional: Google login through Auth0

Email/password is enough to start. Follow these steps only if you want **Continue with Google** immediately.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select/create a project for Scamwin login.
2. Open **Google Auth Platform** and configure the app branding/consent information.
3. Configure the intended audience; for a testing setup, add the Google accounts you will use as test users when required.
4. Use only the basic identity scopes needed for login; do not add Gmail/Drive access.
5. Open **Clients → Create client** and choose **Web application**.
6. Set the authorized origin/redirect based on your actual Auth0 domain:

```text
Origin:   https://YOUR-AUTH0-DOMAIN
Redirect: https://YOUR-AUTH0-DOMAIN/login/callback
```

7. Save Google's Client ID/Client Secret privately.
8. In Auth0, open **Authentication → Social → Google**, enter those Google credentials and enable the connection for the Scamwin application.

Google returns to Auth0's `/login/callback`; Auth0 returns to Scamwin's `/auth/callback`. The Google secret belongs in Auth0, not automatically in our Next.js environment. Complete Google's current testing/publishing requirements for the intended audience.

Reference: [Auth0's Google setup](https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/google).

## 13. Web3: prepare dedicated testnet operator accounts

**What it does:** allows the operator to deploy/administer the warning registry and lets the restricted publisher send approved warnings. Normal Scamwin users do not connect a wallet.

**Now**

1. Create a dedicated test-only wallet using an official wallet distribution, such as the official [MetaMask website](https://metamask.io/), or use an existing test-only wallet you control.
2. Follow the wallet's backup instructions privately. Do not send the recovery phrase to anyone or put it in this guide.
3. Create/label accounts for `Scamwin owner/deployer`, `Scamwin publisher`, and `Scamwin guardian`. In current MetaMask Extension, open the account selector, choose **Add account or hardware wallet → + Ethereum account**, enter a name and choose **Add account**. Repeat as needed; the first account can be the owner/deployer. Keep all three public addresses distinct.
4. Record each **public account address** and its role. An address generally starts with `0x`; it is not the private key.
5. Open the wallet's network selector and enable **Show test networks** if needed. Select Base Sepolia if available; otherwise choose the custom-network/add-network option and use the official parameters below. Confirm the chain ID before requesting funds.
6. Open a faucet linked by the official Base funding guide and request free Base Sepolia test ETH for the relevant addresses. Some faucets require a free account or impose a cooldown. If one is unavailable, do not buy test/mainnet ETH; note the limitation.
7. Confirm the wallet is displaying Base Sepolia, not Base mainnet or Ethereum Sepolia.

| Network field | Value |
| --- | --- |
| Name | Base Sepolia |
| Chain ID | `84532` |
| Public RPC | `https://sepolia.base.org` |
| Currency | ETH, testnet only |
| Explorer | `https://sepolia.basescan.org` |

The public RPC is rate-limited and has no promised production SLA. A free dedicated RPC provider is optional later; a URL containing that provider's API key must be handled as secret.

**Do not collect these yet:** contract address, ABI, deployment block/transaction, publisher grants or verification result. They are created by compilation/deployment.

The automated publisher will eventually need its test account's signing key in an isolated protected deployment secret scope. Configure that yourself through the approved secure setup when the publisher is ready. Do not export/paste a real personal wallet key for this preparation task. Keep publisher secrets outside ordinary analysis/browser deployments, using a separate project where environment secrets otherwise apply to every task.

References: [Base network details](https://docs.base.org/get-started/connect-to-base), [official-listed free faucets](https://docs.base.org/get-started/get-funds), [wallet account instructions](https://support.metamask.io/configure/accounts/how-to-add-accounts-in-your-wallet/).

## 14. Later: fill the Vercel web environment

After the build, open the Vercel project and its **Environment Variables** settings. Add values under the intended environment; normally **Production** for the deployed demo. Do not copy production credentials indiscriminately to preview deployments.

Use this as a names-only template. Replace placeholders in protected settings, not in this Markdown file:

```dotenv
APP_BASE_URL=https://YOUR-PROJECT.vercel.app
AUTH0_DOMAIN=YOUR_AUTH0_TENANT_DOMAIN
AUTH0_CLIENT_ID=YOUR_AUTH0_CLIENT_ID
AUTH0_CLIENT_SECRET=ENTER_PRIVATELY
AUTH0_SECRET=GENERATE_A_STABLE_64_HEX_CHARACTER_SECRET
DATABASE_URL=ENTER_THE_MATCHING_DATABASE_CONNECTION_STRING_PRIVATELY
TRIGGER_SECRET_KEY=ENTER_THE_PRODUCTION_TRIGGER_KEY_PRIVATELY
SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY=ENTER_THE_SEPARATE_PUBLISHER_PROJECT_API_KEY_PRIVATELY
```

If the implemented follow-up route performs AI inference directly from the web server, that route also receives the scoped Cloudflare account/token/model settings. Otherwise keep them worker-only. The implementation's final environment template is authoritative about that placement.

Save the settings and **redeploy**. Editing Vercel environment variables does not update an already-running deployment. Set local development equivalents in ignored `.env.local`, using local base URL, Dev Trigger key and the development database.

Reference: [Vercel environment settings and redeployment](https://vercel.com/docs/environment-variables).

## 15. Later: fill the Trigger investigation-worker environment

In the intended Trigger project, select the correct environment, open **Environment Variables**, and add these settings. Mark sensitive values Secret where the dashboard supports it.

```dotenv
DATABASE_URL=ENTER_THE_MATCHING_DATABASE_CONNECTION_STRING_PRIVATELY
CLOUDFLARE_ACCOUNT_ID=YOUR_CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=ENTER_PRIVATELY
SCAMWIN_AI_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct
BROWSERLESS_BASE_URL=https://production-sfo.browserless.io
BROWSERLESS_TOKEN=ENTER_PRIVATELY
SCAMWIN_INDICATOR_HMAC_SECRET=GENERATE_A_SEPARATE_64_HEX_CHARACTER_SECRET
```

The Browserless host is an example from the documented shared fleet; select the account's actual supported host. Application policy, environment and quota settings will be supplied by the build. Trigger injects its own `TRIGGER_SECRET_KEY` into deployed tasks for internal SDK dispatch; this reserved name is filtered from custom uploads. External application/deploy clients still need their saved named Production key.

Development and Production settings are separate. A local `.env.local` file is not uploaded automatically. Worker variable edits may require a new deployment/run as specified by Trigger; we will verify the active version. Do not run an old worker with a new web release and assume compatible task IDs.

### Isolated publisher settings, later

The publisher deployment will receive only the required RPC/database/contract settings and its dedicated test signing secret. A proposed names-only set is:

```dotenv
SCAMWIN_PUBLISHER_PROJECT_REF=YOUR_SEPARATE_PUBLISHER_TRIGGER_PROJECT
SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY=ENTER_THAT_PROJECT_API_KEY_PRIVATELY
DATABASE_URL=ENTER_PRIVATELY
SCAMWIN_REGISTRY_CHAIN_ID=84532
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
SCAMWIN_REGISTRY_ADDRESS=GENERATED_BY_CONTRACT_DEPLOYMENT
SCAMWIN_REGISTRY_PUBLISHER=YOUR_PUBLIC_TEST_PUBLISHER_ADDRESS
SCAMWIN_REGISTRY_DEPLOYMENT_BLOCK=GENERATED_BY_CONTRACT_DEPLOYMENT
SCAMWIN_PUBLISHER_PRIVATE_KEY=ENTER_ONLY_IN_THE_PROTECTED_PUBLISHER_ENVIRONMENT
```

Use `scamwin.publisher.env.example` in a separate publisher-only Trigger project. Deploy it with `npm run deploy:scamwin-publisher`, using ignored `.env.publisher.local` for local CLI configuration. Do not add the wallet signing key to Vercel, the ordinary analysis project, Browserless, source, screenshots or this Markdown file. The publisher project API key used by Vercel is a different credential from the wallet private key.

Reference: [Trigger worker environment variables](https://trigger.dev/docs/deploy-environment-variables).

## 16. Build outputs and later deployment values

| Generated item | When it becomes available |
| --- | --- |
| Application environment templates and startup/readiness checks | Implemented: `scamwin.env.example`, `scamwin.publisher.env.example`, `npm run check:scamwin` |
| `AUTH0_SECRET` and private indicator HMAC secret | Generate separately during secure configuration; no real secrets were generated in source |
| Actual Vercel production origin | First authorized deployment |
| Final Auth0 hosted allowlist values | After the origin is known |
| Trigger task IDs/deployed versions | Source tasks implemented in the separate investigation/publisher directories; hosted versions come from deployment |
| Database tables/indexes | 14 Scamwin tables defined and locally exercised; remote `db:push` still pending |
| Contract ABI/bytecode | Contract compiled/tested; application ABI exported |
| Registry address/deployment block/transaction | Authorized testnet deployment |
| Publisher permissions | After the registry exists |
| Admin/reviewer role mapping | After the intended account signs in and its Auth0 identity is verified |

We can build interfaces and mocked tests without all external values. We cannot claim real-service integration is verified until the necessary values/access are configured.

## 17. What you can safely report back

Copy this status form when ready. Fill public identifiers and readiness statuses only. Enter actual secret values through the appropriate protected environment fields when configuration is requested.

```text
GitHub repository URL:
Repository owner / do I have deployment access?:
Vercel Hobby account ready: yes / no
Vercel production URL: not created yet / actual public URL

Auth0 domain:
Auth0 Client ID:
Auth0 Client Secret saved privately: yes / no
Email/password enabled for Scamwin: yes / no
Google login desired: yes / no
Google connection configured, if desired: yes / no

Neon project/branch/database names:
DATABASE_URL saved privately: yes / no
Dataset confirmed disposable for development: yes / no

Cloudflare Account ID:
Workers AI token saved privately: yes / no
Workers Free selected: yes / no

Trigger project reference:
Trigger Dev key saved privately: yes / no
Trigger Prod key saved privately: yes / no

Browserless Free ready: yes / no
Browserless regional host:
Browserless token saved privately: yes / no

Test-only owner/deployer PUBLIC address:
Test-only publisher PUBLIC address:
Test-only guardian PUBLIC address:
Base Sepolia test ETH available: yes / no

First admin/reviewer sign-in account chosen: yes / no
Any blocked setup step or provider requiring payment:
```

This form is a readiness checklist, not an invitation to paste the saved secrets. No personal access token, seed phrase, password or database connection string belongs in a normal chat reply.

## 18. Common problems and fixes

| Problem | Check first |
| --- | --- |
| Auth0 callback mismatch | Exact protocol, production hostname and `/auth/callback`; save application settings |
| Google redirect URI mismatch | Google's callback is Auth0's `/login/callback`, not the app's callback |
| Login button for an unavailable provider | Enable its Auth0 connection or hide that optional button |
| Login repeatedly fails after changing app secret | Old cookies may use the prior `AUTH0_SECRET`; avoid unnecessary rotation |
| Database authentication/connection failure | Correct branch/database/role/password and original TLS parameters |
| Cloudflare 401/403 | Correct account ID, Workers AI token permissions and actual account access |
| AI unavailable/quota reached | Free allowance/model access; pause or return a labeled partial result, never auto-upgrade |
| Browserless 401 | Correct token and shared/private fleet endpoint; account and host must match |
| Browserless quota/session limit | Close sessions promptly; no paid retry/proxy/CAPTCHA fallback |
| Trigger tasks do not run | Correct project reference, matching environment key, deployed task/version and Free allowance |
| Vercel works but worker has missing keys | Worker variables must also be configured in Trigger's matching environment |
| Changed Vercel variable has no effect | Redeploy; old deployments retain their prior values |
| Blockchain publication is pending/unavailable | Correct chain/RPC, publisher test ETH/permission and actual receipt status |
| Faucet requests fail | Official-listed alternative/cooldown/free eligibility; do not buy funds for this demo |
| Live website facts are not checked | The provider/scope capability gate may be closed; do not invent evidence |

## 19. After build approval: final setup sequence

1. Implement the app and tests using the accepted budget plan.
2. Configure development credentials privately and run small real-service checks within free limits.
3. Confirm the intended disposable database before applying the development schema.
4. Deploy compatible investigation jobs to Trigger's intended environment.
5. Configure Vercel Production settings and deploy the adapted application.
6. Record the actual production origin; update Auth0 callbacks/logout/origins and `APP_BASE_URL`; redeploy changed web settings.
7. Configure optional Google connection if requested.
8. Build/deploy the warning registry on Base Sepolia, record its generated manifest and configure isolated publisher access.
9. Verify actual hosted sign-in, private-check ownership, job progress/cancel, evidence/result/history, quota failures and review/publication/retraction.
10. Share the app only with its demonstrated capabilities and visible limits. The deployed web app and workers run online; your laptop does not need to remain on.

## 20. Final readiness checklist

- [ ] Required Free/Hobby accounts are accessible.
- [ ] Real secrets are stored privately, not in this document or Git.
- [ ] Auth0 application is Regular Web Application; email/password is enabled.
- [ ] Correct development Auth0 allowlists are saved; hosted entries wait for the actual URL.
- [ ] Neon connection string and dataset identity are known.
- [ ] Cloudflare Account ID/Workers AI token are ready.
- [ ] Trigger project reference and separately labeled Dev/Prod keys are ready.
- [ ] Browserless token/host and free allowance are ready.
- [ ] Test-only public wallet addresses and faucet access are ready.
- [ ] Optional Google login is either configured or explicitly deferred.
- [ ] The first admin/reviewer identity is chosen.
- [ ] Provider access problems are noted without buying an upgrade.
- [ ] Contract/deployment-generated values are left for later.
- [ ] Main app implementation still waits for the user's approval.
