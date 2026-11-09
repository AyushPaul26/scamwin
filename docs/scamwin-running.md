# Run and deploy Scamwin

> **Isolated publisher amendment, 9 November:** the optional publisher can now run in a second Vercel project rooted at `publisher/`. The signing key is permitted only in that dedicated project's Production secrets, never the main website, shared team variables, Preview or investigations. The main website receives an origin-only `SCAMWIN_PUBLISHER_BASE_URL`, shared dispatch secret and public registry settings. This supersedes the earlier platform-wide Vercel signing ban and Trigger-only publisher instructions. See [publisher setup](../publisher/README.md). The registry and publisher activation were deployed to Base Sepolia with explicit owner approval and free test ETH; actual warning publication still needs its hosted test.

> **9 November 2026 replacement:** the selected investigation backend is now `SCAMWIN_INVESTIGATION_BACKEND=vercel`, using Next.js `after()` and a 300-second Vercel Fluid invocation. Put investigation Cloudflare, Browserless, stable HMAC and approved-origin settings in **Vercel Production**. `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF` are optional legacy investigation settings, not requirements for this backend. Existing Trigger-only instructions below apply only when that backend is deliberately selected. Follow [the current live setup steps](scamwin-live-setup.md#step-6--run-investigations-on-vercel) for exact placement and limitations. Web3 publication still requires its separate isolated publisher; it is not enabled by this replacement.

Provider and feature baseline: [current all-online free implementation plan](scamwin-current-plan.md). The active Scamwin workflow requires Vercel Hobby, Workers AI Free, Browserless Free, Trigger.dev Free, Neon Free, Auth0 Free and Base Sepolia test funds. Earlier paid-provider choices are superseded; the linked plan also records features still incomplete independently of credentials.

For the actual connection/deployment order, use the [live setup walkthrough with checkpoints](scamwin-live-setup.md). This file is the shorter command reference.

## Local website preview

Use Node 24. From the `openmods` directory:

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`. `/demo` is a separate, read-only synthetic demonstration. It performs no external investigation. Public pages and setup states work with no credentials. Missing configuration disables real checks rather than substituting demo results.

## Configure real online processing

1. Follow [the account setup guide](scamwin-setup-guide.md). Use `scamwin.env.example` as the authoritative variable-name template; save secrets only in ignored `.env.local` or provider settings.
2. Configure Auth0, Neon and Trigger.dev. Set `APP_BASE_URL` to the exact application origin and allow `/auth/callback` in Auth0. Hosted login offers the connections enabled in your Auth0 application; Google is optional.
3. With your intended dedicated Neon database configured, apply the clean schema with `npm run db:push`. The current owner's fresh demo schema was pushed and independently verified on 9 November; do not repeat schema setup against a different database without checking the target. Never run migrations; this repository uses Drizzle push.
4. Add the Cloudflare account ID/token to Trigger for investigation analysis, and to Vercel for bounded evidence-only follow-ups. The model is pinned to the allowed Workers AI Scout model. No OpenAI or paid model key is required.
5. Deploy the new worker with `npm run deploy:scamwin-worker -- --env prod --skip-update-check`, after setting your own `TRIGGER_PROJECT_REF` directly in the subprocess and authenticating via CLI login or a matching Production key in subprocess `TRIGGER_ACCESS_TOKEN`. This command uses `scamwin.trigger.config.ts` and `src/scamwin-trigger`. Upload hosted database/AI/HMAC variables separately; Trigger injects the worker's own `TRIGGER_SECRET_KEY`. The current build preflight passes, but this owner's cloud deployment was rejected with “Deployments are not available for this organization”; follow the live setup checkpoint before retrying.
6. The browser token, exact `SCAMWIN_APPROVED_ORIGINS` and capability gates belong in the worker environment. Start with the gates off. Verify remote context isolation, request blocking, deadlines and closure using a site you own before enabling the documented fixture boundary. Arbitrary hostile-site isolation is not established by application routing alone.
7. Sign in once, obtain your Auth0 `user.sub`, and place that exact subject in the server-only comma-separated `SCAMWIN_ADMIN_SUBJECTS`. Names and emails do not grant reviewer access. The initial admin can use `/review` and `/operations`.
8. Generate `SCAMWIN_INDICATOR_HMAC_SECRET` for the investigation worker with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Save its output privately in the worker settings. It scopes exact-match fingerprints to each owner; changing it disconnects old correlation fingerprints. It is separate from Auth0 and wallet secrets.
9. For Web3, follow [the separate registry instructions](../web3/README.md). Deploy only after explicit authorization, then configure the contract/publisher and Base Sepolia RPC in web and worker settings. Create a **separate publisher-only Trigger project** using `scamwin.publisher.env.example` and ignored `.env.publisher.local`, then deploy with `npm run deploy:scamwin-publisher`. Vercel gets that project’s API key as `SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY` to dispatch reviewed operations. Put `SCAMWIN_PUBLISHER_PRIVATE_KEY` only in the publisher project, never Vercel, the investigation project or any public variable. Users need no wallet.

`npm run check:scamwin` prints only whether variable names are present. It never prints values and does not establish live connectivity.

## Vercel

Import the repository’s `openmods` directory as a Next.js app, choose Node 24, install with `npm ci`, and build with `npm run build`. The project's `.npmrc` supplies the existing repository’s legacy peer resolution. Verify the current Scamwin source has reached that repository before importing it. Use a free Vercel project URL; no custom domain is required.

Add only the web configuration from the template. The browser, origin TLS probe and transaction signing are assigned to Trigger; Vercel serves the interface, Auth0, owner-authorized storage and provider API requests. Set the production `APP_BASE_URL`, update Auth0 URLs, and redeploy after configuration changes. Source and the Vercel website are published, Neon is configured, and local live AI tests pass. Trigger Production execution remains unavailable pending its organization-level deployment restriction; no blockchain transaction has been broadcast. The live setup guide records the current checkpoint.

## First-time user flow

Open the homepage → explore a synthetic sample or sign in → choose your intended action → submit the offer/link and optional prepared screenshots → open the saved check → read the promise/action/destination comparison, findings and missing evidence → inspect cited sources → ask a bounded follow-up or recheck. History is private and searchable. Cancellation requests stop further collection and wait for cleanup when a worker has started.

Sharing is optional. Preview a redacted exact-hostname summary, select observed evidence and explicitly consent to reviewer access. A reviewer approves or rejects it. Approved warnings appear locally with a separate transaction state; local approval is not a blockchain confirmation. The dedicated relay persists signed bytes before broadcast and reconciles inclusion, safe and finalized states independently. Reviewed corrections/retractions remain distinct operations. Public blockchain history cannot be erased by deleting private evidence.

## Availability and retention

Admission caps: 10 new checks/day globally, 50/month globally, three/day/account, one active/account. Follow-up caps: 20 attempts/day globally, five/day/account. Provider exhaustion pauses the module without a paid fallback. A dispatch failure ends that attempt with an explicit availability message; starting a new check after fixing the service uses a new admission. Overdue work is fenced at 300 seconds.

Checks expire after 30 days, raster artifacts after seven days and reviewer evidence snapshots after seven days. Reads enforce expiry before daily cleanup. Separate daily online tasks handle retention/outbox recovery and publication reconciliation; this prototype is not a continuous chain monitoring service. A valid HTTPS certificate is transport evidence, not proof of a legitimate offer. Related cases use owner-scoped HMAC fingerprints of exact selected hostnames, observed payment recipients and observed form endpoints. Shared CDN or certificate-issuer overlap is not linked.

Administrators can pause new check admissions or new warning signatures in `/operations`. Existing runs can finish, saved checks remain readable and already-signed transactions can still be reconciled. Reviewers can request more information with a reason; the owner sees the status on the private check and can submit a new packet with fresh consent.

Curated organization references are optional server configuration in `SCAMWIN_OFFICIAL_SOURCES_JSON`: an array of `{organization,hostname,referenceUrl,reviewedAt}` with an ISO timestamp. References older than 30 days are unavailable. The app never lets model output create a trusted official source.

## Verify

```powershell
npm run test:scamwin
node node_modules/typescript/bin/tsc --noEmit
npm run build
npm run test:scamwin:browser
npm run test:scamwin:controls
npm --prefix web3 ci
npm run test:web3
```

The browser check uses an installed Chrome and a local server. Its signed-in form fixture changes only the browser response; the actual server remains signed out and rejects real mutations. It does not test real OAuth. Unit tests use explicit fake providers/MemoryStore. Live PostgreSQL concurrency, OAuth, free-provider capabilities and a real Base Sepolia deployment still need separate acceptance with your configured accounts.
