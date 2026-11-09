# Enable the embedded website inspection

This feature uses the existing Browserless account, API token, regional endpoint, Auth0 login, Neon database and Vercel worker. It does not need another provider account, another browser session, Trigger.dev or a paid upgrade.

## What the user sees

Start a private check as usual. Once the website inspection begins, a watch-only browser panel opens inside the saved check page. The timeline shows understanding the offer, observing the website, checking the connection, checking shared warnings, comparing promise and request, and preparing the result. Each stage records its own real timestamps.

The user can collapse the view, reopen it, or cancel the investigation. Collapsing does not restart the browser. When the browser finishes, the panel displays a saved screenshot when one exists. A fast investigation can finish before a viewer connects; its saved evidence still appears normally. A captured image is always labelled as a capture.

## Add the database table before deploying either project

From the repository root, with the existing `DATABASE_URL` configured, run:

```powershell
npm run db:push
```

The added table is `scamwin_live_views`. It stores owner/run/session identity, expiry, sanitized status and an encrypted locator. The locator is never part of a check record, screenshot, AI prompt or public warning. Inspect the Drizzle proposal before accepting it. This feature requires the new table; do not deploy the updated main app or publisher before the schema is ready. No migration files are used.

## Add two settings to the MAIN `scamwin` Vercel project

Use **Production** for both:

| Key | Type | Value |
| --- | --- | --- |
| `SCAMWIN_LIVE_VIEW_ENABLED` | Config | `true` |
| `SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY` | Secret | A dedicated random 32-byte key encoded as 64 hexadecimal characters |

Keep the existing `BROWSERLESS_TOKEN` as a Secret. Reuse `BROWSERLESS_BASE_URL`, approved origins and the already verified browser capability flag. Do not add these new settings to `scamwin-publisher`, and never use a `NEXT_PUBLIC_` name.

The implementation prepares an ignored local import file at `.trigger/live-ui/vercel-live-view.env`, when a local key has been generated. Import that file through Vercel's **Add Environment Variable → Import .env** and restrict both entries to Production. Mark the encryption key as Secret. The file contains a secret: keep it on your computer and out of Git, screenshots and chat.

Alternatively, generate a new key directly into your local environment using Node's `randomBytes(32).toString('hex')`, then paste its value privately into Vercel. Use the same key for every instance of the main deployment. Rotating it makes already-issued short-lived viewer locators unreadable; a new investigation uses the new key.

After saving the settings and applying the schema, deploy the code. Environment changes require a new deployment. Repository rules leave this implementation uncommitted until the owner explicitly approves the commit and push.

## Verification commands

```powershell
npm run test:scamwin
npm run check:scamwin:live-view
npm run check:scamwin:live-embed
```

The first command uses deterministic private-store and UI contract tests. The two capability commands use the existing remote browser allowance and print only sanitized results. They write no application checks or warnings. The embedded acceptance command uses a synthetic canary to verify that streaming works while typing, navigation and remote resizing remain blocked. It closes the provider session in `finally`.

For localhost UI verification, run the app on port 3100, then:

```powershell
npm run test:scamwin:live-ui -- http://localhost:3100
```

This browser test intercepts synthetic check, session and image responses. It tests the actual screen at desktop and mobile widths without starting a real check, invoking a mutation or contacting the remote viewer. It complements the real provider acceptance check.

## Privacy and lifecycle

The worker mints a locator from the same page CDP session it already uses for evidence collection. Watch-only options disable interaction, browser controls and remote resizing. The app authenticates the owner before decrypting a locator, verifies the expected run and generation, and refuses expired or inactive collection sessions. A dedicated AES-GCM key binds each ciphertext to its owner, check, run, generation, session and expiry.

The browser retains its existing 60-second budget. The viewer never pads an investigation or extends that budget. Browser closure retires the locator. Cancellation, deletion, terminal runs and cleanup remove or retire stored capabilities. Viewer failures do not replace collected evidence or stop the later assessment. Warning sharing remains optional and requires selected evidence, explicit consent and reviewer approval.
