# Connected apps: setup and first live test

This guide is for the person hosting Scamwin. Ordinary users sign in, open **Account → Connected apps**, choose an app, and approve that provider's permission screen. They do not enter API keys or forward email.

The code, local fixtures and a provider's live approval are separate things. This build does not create developer accounts, apply cloud database changes, install apps into real accounts, or enable automatic processing for you. Follow the stages below, starting with one controlled account.

## 1. Keep the working prototype separate

Use the existing **scamwin** Vercel project and `https://scamwin.vercel.app`. The **scamwin-publisher** project does not need mailbox credentials or connector secrets. Keep the existing `DATABASE_URL`, Auth0, Workers AI, Browserless and publisher settings.

For these new settings, choose **Production only**. Configure Preview separately if you later want preview testing; production authorizations must not be copied to arbitrary preview URLs.

| Existing part | What to do |
| --- | --- |
| Auth0 sign-in | Keep the existing configuration. Connecting Google mail is a separate authorization. |
| Main Neon database | Keep `DATABASE_URL` unchanged. |
| Workers AI and Browserless | Keep the existing credentials. Connector imports use the existing investigation pipeline and limits. |
| Web3 publisher | Keep the separate publisher project. Private imported content is not automatically published. |
| Original prototype backup | Keep the restore point outside this repository. See `../SCAMWIN-RESTORE-POINT.md` from the workspace containing this repository. |

Start with the new global, provider, automatic and push flags set to `false`. A value of `true` enables a capability; it does not prove that the provider accepted an installation or that every item was checked.

## 2. Create the connector database

1. In [Neon Console](https://console.neon.tech), create a separate Free project called `scamwin-connectors`.
2. In that project, create a database whose **database name** is exactly `scamwin_connectors`. A project name alone does not rename its default database. See [Neon's database instructions](https://neon.com/docs/manage/databases).
3. Open **Connect**, select that database, keep TLS enabled and copy the full connection string privately.
4. In **Vercel → scamwin → Environment Variables**, add `SCAMWIN_CONNECTOR_DATABASE_URL` as **Secret / Production**. Its value is the new connection string. Do not replace `DATABASE_URL`.
5. If doing the local setup, put the same value in the ignored `.env.local`. Never paste connection strings into chat, screenshots or Git.
6. From the repository directory, verify the target before applying a schema:

```powershell
node --env-file-if-exists=.env.local scripts/check-scamwin-connector-database.mjs
```

The successful output names `scamwin_connectors`, confirms an isolated target, and says no DDL was applied. A failure must be resolved before continuing. The check rejects the main project's host and verifies the actual database name.

7. After separately approving the new database setup, apply **only** the connector schema:

```powershell
npm run db:push -- --config drizzle.connectors.config.ts
```

This command changes the selected database. Review its target and proposed tables before confirming. Do not run the default main-database push, generate migrations, reset the main database or copy production rows for this feature.

## 3. Add the shared settings

These settings go in the **main scamwin Vercel project**, with **Production** selected.

| Key | Type | Meaning |
| --- | --- | --- |
| `APP_BASE_URL` | Config | `https://scamwin.vercel.app`; exact origin, no path or query. Already used by the prototype. |
| `SCAMWIN_CONNECTOR_DATABASE_URL` | Secret | The isolated database connection string. |
| `SCAMWIN_CONNECTOR_ENCRYPTION_KEY` | Secret | A new random 32-byte value, encoded as 64 hexadecimal characters. Encrypts private grants and content. |
| `SCAMWIN_CONNECTOR_IDENTIFIER_KEY` | Secret | A different random 32-byte / 64-hex value. Creates stable private identifiers. |
| `SCAMWIN_CONNECTOR_DISPATCH_SECRET` | Secret | A separate random value of at least 32 characters, shared only with the scheduler Worker. |
| `SCAMWIN_CONNECTORS_ENABLED` | Config | Initially `false`; turns on connected-app capability after database/configuration checks. |
| `SCAMWIN_CONNECTOR_RUNTIME_ENABLED` | Config | Initially `false`; controls online runtime work. |
| `SCAMWIN_CONNECTOR_AUTOMATION_ENABLED` | Config | Initially `false`; automatic checks require both this gate and the user's consent. |

Use independent generated secrets, not existing Auth0, AI, publisher or Browserless credentials. Keep a private copy. Keep the identifier key stable when rotating the encryption key. Losing an encryption key means existing encrypted authorizations cannot be read and affected users must reconnect.

The local helper writes new independent secrets and disabled gates to a new ignored file; it refuses to overwrite an existing file and never prints keys:

```powershell
node scripts/generate-scamwin-connector-secrets.mjs .env.connectors.local
```

Copy the required settings privately into the intended environment, then run the offline checker against that environment:

```powershell
node --env-file-if-exists=.env.local scripts/check-scamwin-connectors.mjs
```

It reports setting names and configuration status without network requests, database writes, or secret values. A valid result verifies configuration shape only; provider approval, schema/connectivity and real coverage still require the later tests. `npm run check:scamwin` includes the same connector inspection alongside existing service presence checks.

Save settings before redeploying. Vercel environment edits take effect in a **new deployment**, not an already running one. [Vercel environment-variable instructions](https://vercel.com/docs/environment-variables/managing-environment-variables)

## 4. Choose the first provider

| App | What a user can connect | First test |
| --- | --- | --- |
| Gmail | Their authorized mailbox and selected label scope | Manually select one controlled email. |
| Outlook | Their authorized mailbox and selected folder scope | Manually select one controlled email. |
| Telegram | Their verified identity plus separately authorized Chat Automation/private-chat scope | Link the same account, then test a new authorized message. |
| Slack | Selected conversations that the installed bot can read | Select a conversation, then import one explicit message permalink. |
| Teams | Selected supported work/school chats | Select a chat, then import one explicit message permalink. |
| Discord | A message the user explicitly selects with a user-installed command | Use **Apps → Check with Scamwin** on one message. Automatic Gateway monitoring is not enabled. |
| Google Drive | Individual files opened with Scamwin and explicitly selected | Open one file with Scamwin, then choose to import it. |
| Browser extension | A page the user selects; optional permitted foreground sites | Pair the extension and explicitly check one controlled page. |

**All new items** means all eligible new items inside the user's authorized scope, after activation. It is not permission to read every account, old archive, inaccessible conversation or unsupported file. Automatic processing can queue behind quotas. The dashboard shows actual results, missing coverage and retry states.

## 5. Gmail

The mailbox OAuth app is separate from the Google connection used by Auth0 sign-in.

1. In [Google Cloud Console](https://console.cloud.google.com), create a project for the Gmail connector. Enable **Gmail API**.
2. Configure **Google Auth Platform** branding, audience and data access. For a private pilot, use Testing and explicitly add your test Google accounts.
3. Create a **Web application** OAuth client. Add this exact authorized redirect URI:

```text
https://scamwin.vercel.app/api/scamwin/connections/gmail/callback
```

4. Save `SCAMWIN_GOOGLE_CLIENT_ID` as **Config** and `SCAMWIN_GOOGLE_CLIENT_SECRET` as **Secret**, both Production. Set `SCAMWIN_GOOGLE_REDIRECT_URI` to the callback above, as Config.
5. Set `SCAMWIN_CONNECTOR_GMAIL_ENABLED=true` only after shared configuration is ready. Keep `SCAMWIN_GMAIL_PUBLIC_ELIGIBLE=false`. A private test-user pilot uses the separately configured test-user gate and owner allowlist.
6. Sign into Scamwin as the allowlisted owner. Open **Account → Connected apps → Gmail → Connect**, read the processing explanation, and approve Google readonly access.
7. Start in Manual, choose the intended label scope, select a harmless test email, import it, and follow its source and check result.
8. Enable automatic processing only after this succeeds. Choose Selective or All new items, confirm the activation boundary, and send a new test email after activation.

`gmail.readonly` is a restricted Google scope. Public distribution can require verification and a security assessment; a configured client or successful private fixture does not establish public eligibility. Testing refresh grants can expire after seven days. See [Google server authorization](https://developers.google.com/identity/protocols/oauth2/web-server) and [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## 6. Outlook

1. Open **[Microsoft Entra admin center](https://entra.microsoft.com) → App registrations → New registration**. Choose the account types you intend to support. See [Microsoft's registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
2. Add a **Web** redirect URI:

```text
https://scamwin.vercel.app/api/scamwin/connections/outlook/callback
```

3. Configure delegated `openid`, `profile`, `email`, `offline_access` and Microsoft Graph `Mail.Read`. Do not add send, write, delete or application-wide mailbox permissions.
4. Under **Certificates & secrets**, create a client secret. Copy its **Value**, not its secret ID, while it is visible.
5. Save `SCAMWIN_MICROSOFT_CLIENT_ID` as Config, `SCAMWIN_MICROSOFT_CLIENT_SECRET` as Secret, and `SCAMWIN_MICROSOFT_REDIRECT_URI` as Config with the callback above. Use main scamwin / Production.
6. Enable `SCAMWIN_CONNECTOR_OUTLOOK_ENABLED` after shared readiness checks. Connect through Account and begin with one controlled Inbox email in Manual.
7. Save the intended folder scope before opting into automatic checks. Test a new email, a move, a deletion and pause/resume. A move out of a selected folder is not proof of deletion from the whole mailbox.

Outlook authorization does not grant Teams chat access. Use the separate Teams registration below.

## 7. Telegram

Telegram has two connections: **verified Login identity** and **Chat Automation authorization**. Identity alone does not authorize reading the user's private messages.

1. Create the service bot through **@BotFather**. Save `SCAMWIN_TELEGRAM_BOT_TOKEN` as Secret and `SCAMWIN_TELEGRAM_BOT_USERNAME` as Config.
2. In BotFather's **Login Widget** settings, register `https://scamwin.vercel.app` and `https://scamwin.vercel.app/api/scamwin/connections/telegram/callback`. Save the separate Login client ID as `SCAMWIN_TELEGRAM_CLIENT_ID` (Config) and Login secret as `SCAMWIN_TELEGRAM_CLIENT_SECRET` (Secret). Keep the default supported RS256 signing configuration. See [Telegram Login](https://core.telegram.org/bots/telegram-login).
3. Enable **Secretary Mode** for the bot through BotFather. The user separately chooses which eligible private chats it may access. Do not grant reply, delete, profile, payment or mark-as-read powers for this checking feature. `can_read_messages` is mark-as-read authority, not the reason incoming content can be delivered. See [Telegram bot features](https://core.telegram.org/bots/features#business-bots).
4. Generate a separate webhook secret. Save `SCAMWIN_TELEGRAM_WEBHOOK_SECRET` as Secret. Register the shared service webhook only during an explicitly authorized bot-setup stage; do not remove it when one Scamwin user disconnects.
5. Enable `SCAMWIN_CONNECTOR_TELEGRAM_ENABLED` after readiness checks. Sign into Scamwin, verify the same Telegram identity, and complete its one-use account-linking step. A forwarded link must not bind a different account.
6. Return to Connected apps and inspect the actual Chat Automation connection before enabling automatic checks.
7. Test new text, an edit, deletion, supported image, unsupported media, pause/resume and disconnect/reconnect. Verify minimal rights and actual bot-to-bot eligibility on the real account. No old private-inbox archive is promised on resume.

Run the local readiness-only helper with `node --import tsx scripts/check-scamwin-telegram-pilot.ts`. It prints configured/accepted booleans and observations still needed; it does not configure the bot or run a live pilot.

## 8. Slack

1. Create a confidential Slack app at [Slack's app dashboard](https://api.slack.com/apps).
2. In **Basic Information**, obtain the app ID and signing secret. In **OAuth & Permissions**, obtain client ID/secret and register:

```text
https://scamwin.vercel.app/api/scamwin/connectors/expanded/slack/callback
```

3. Add only the supported bot read/history scope pairs. Default public-channel access uses `channels:read` and `channels:history`. Optional file access needs `files:read` and `SCAMWIN_SLACK_FILES_ENABLED=true`. Keep Slack's irreversible public-client setting off for this confidential app.
4. Save `SCAMWIN_SLACK_CLIENT_ID` and `SCAMWIN_SLACK_APP_ID` as Config; save `SCAMWIN_SLACK_CLIENT_SECRET` and `SCAMWIN_SLACK_SIGNING_SECRET` as Secret. Use main scamwin / Production.
5. Configure signed **Event Subscriptions** at `https://scamwin.vercel.app/api/scamwin/connectors/slack`, with the granted message classes and required installation lifecycle events.
6. Enable `SCAMWIN_CONNECTOR_SLACK_ENABLED` for a controlled installation. Connect through Scamwin, select only conversations the bot can actually read, and save the scope.
7. Import one explicit message permalink in Manual. Scamwin verifies its saved workspace/conversation and calls Slack's API; it does not browse the pasted URL or cache unsolicited recent message bodies.
8. Keep `SCAMWIN_SLACK_COVERAGE_PILOT_ACCEPTED=false` until the signed delivery, membership, edits/deletes, threads, rate limits and backlog pilot passes. Local disconnect does not uninstall a shared workspace app.

Follow [the detailed Slack setup and pilot](scamwin-slack-setup.md). [Slack's Events API](https://docs.slack.dev/apis/events-api/) explains permission-bound events; real installation rate limits and inaccessible thread replies must remain visible gaps.

## 9. Microsoft Teams

1. Create a separate Entra Web application for supported work/school accounts. Configure:

```text
https://scamwin.vercel.app/api/scamwin/connectors/expanded/teams/callback
```

2. Request delegated `openid`, `profile`, `offline_access` and Microsoft Graph `Chat.Read`. Complete any tenant admin consent required by your organization. Outlook permissions are not sufficient.
3. Save `SCAMWIN_TEAMS_CLIENT_ID` as Config and `SCAMWIN_TEAMS_CLIENT_SECRET` as Secret. Enable `SCAMWIN_CONNECTOR_TEAMS_ENABLED` only after shared readiness checks.
4. Connect through Scamwin, choose actual supported chat resources from the metadata selector, and save the scope. For Manual, select one explicit Teams message permalink.
5. Keep `SCAMWIN_TEAMS_AUTOMATION_PILOT_ACCEPTED=false` until real Graph subscription, renewal, expiry, lifecycle, recovery and tenant-scope tests pass. The app must display the provider's actual subscription expiry, not assume a requested lifetime was granted.

This implementation targets selected supported same-tenant work/school chats. It does not claim personal-account, federated, channel/RSC or hosted-file coverage. Missing or inaccessible parts remain explicit.

## 10. Discord

1. Create a Discord developer application. Enable **User Install** at the application level and configure the OAuth redirect:

```text
https://scamwin.vercel.app/api/scamwin/connectors/expanded/discord/callback
```

2. Save the application ID as `SCAMWIN_DISCORD_CLIENT_ID` (Config), OAuth secret as `SCAMWIN_DISCORD_CLIENT_SECRET` (Secret), and 64-hex application public key as `SCAMWIN_DISCORD_PUBLIC_KEY` (Config).
3. Configure Interactions Endpoint URL `https://scamwin.vercel.app/api/scamwin/connectors/discord` after the deployed endpoint and isolated schema are ready.
4. Register the single user-installed message command from `docs/scamwin-discord-command.example.json`, following [the Discord operator guide](scamwin-discord-setup.md). Registration uses separate operator authority; do not overwrite unrelated commands or put a registration token into the website.
5. Enable `SCAMWIN_CONNECTOR_DISCORD_ENABLED`. The user connects their verified identity, explicitly permits the supported message contexts, installs the command, then selects **Apps → Check with Scamwin** on one message.
6. Verify a signed PING, invalid signature rejection, selected-message persistence, duplicate handling and real cold/warm response time below Discord's three-second deadline.

Discord is Manual-only here. A user-installed message command does not grant all-DM or server-history monitoring. No automatic flag enables a Gateway host. The offline `node scripts/check-scamwin-discord.mjs` check validates the command template; it is not a live installation test.

## 11. Selected Google Drive files

1. Create a **separate Google Cloud project and OAuth client from Gmail**. Do not reuse the Gmail client: Google grant revocation in a shared project can affect other grants.
2. Enable **Drive API**, configure a Web OAuth client and register:

```text
https://scamwin.vercel.app/api/scamwin/connectors/expanded/drive/callback
```

3. Save `SCAMWIN_DRIVE_CLIENT_ID` as Config and `SCAMWIN_DRIVE_CLIENT_SECRET` as Secret.
4. In that project's Drive UI integration, configure the Open URL `https://scamwin.vercel.app/api/scamwin/connectors/drive/open`, its OAuth client, supported MIME types and supported Workspace export types. Do not advertise folder or shortcut handling.
5. The requested data scope is `drive.file`, with identity and `drive.install`. Google grants file-write authority with `drive.file`; the Scamwin adapter performs GET-only reads. No browser Picker key, service account or whole-Drive scope is used.
6. Keep `SCAMWIN_DRIVE_INSTALLATION_ACCEPTED=false` until installation/identity/Open-with checks pass. Then enable it and `SCAMWIN_CONNECTOR_DRIVE_ENABLED` for the controlled user.
7. In Drive, open a supported individual file with Scamwin. This registers verified file metadata only. In Scamwin, explicitly save the file selection and import one file.
8. Keep `SCAMWIN_DRIVE_AUTOMATION_PILOT_ACCEPTED=false` until the live version-change, removal, permissions, cursor and recovery pilot passes. Automatic mode then watches the selected files from its saved activation boundary.

Use [the detailed Drive pilot](scamwin-drive-pilot.md). Supported text exports can omit structure and embedded media. PDF, Office, folders and shortcuts remain explicit unsupported coverage. [Google's Drive UI guide](https://developers.google.com/workspace/drive/api/guides/integrate-open)

## 12. Browser extension

Use the bundled `extensions/scamwin` package for an unpacked controlled pilot. No paid Chrome Store publication or installation into a real user's browser is performed by the build.

1. Load the unpacked extension into a separate test browser profile through the browser's Extensions developer controls.
2. Open the extension, generate its pairing ticket, and use the signed-in Scamwin account's extension setup screen. Complete the one-use approval-code exchange in the same pairing flow.
3. Start in Manual and explicitly check a controlled page. Only the selected visible page content and bounded destinations may be captured; input/password/payment values are excluded.
4. Optional automatic mode needs the user's explicit choice and exact site permissions. It covers permitted active foreground pages while the browser is running. It is not a server-side archive or a promise to monitor closed browsers.
5. Revoke site access, pause, disconnect and attempt an old pairing/import. Confirm revoked authority cannot submit new content. Changing the app origin requires pairing again.

## 13. Run the online scheduler

The small Cloudflare Worker wakes Vercel. Provider credentials and private content stay in the app's connector database. This is separate from the existing Workers AI token.

1. Use the source/config in `workers/scamwin-connectors`. Its default Cron cadence is 15 minutes and its gate starts off.
2. Set `SCAMWIN_CONNECTOR_APP_ORIGIN=https://scamwin.vercel.app`. Store the same dedicated `SCAMWIN_CONNECTOR_DISPATCH_SECRET` as a **Worker secret**, not a plain variable.
3. Keep `SCAMWIN_CONNECTOR_SCHEDULER_ENABLED=false` until one controlled provider passes Manual then automatic processing and real free-resource usage has been checked.
4. Deploy only during the separately authorized setup stage, using the operator's Cloudflare login/deployment authority. Do not broaden or reuse the AI-only API token. No database URL, mailbox grant, AI token or publisher key belongs in the Worker.
5. Confirm scheduled runs reach the fixed Vercel tick/drain routes and resume durable work after an interrupted wakeup. Enable the scheduler gate only with measured allowance headroom. If necessary, use a 30-minute cadence and show the real delay.

The app stops or defers affected work at configured budgets; it does not silently purchase a paid replacement. Your laptop is not the server worker. See [Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and [Wrangler secret commands](https://developers.cloudflare.com/workers/wrangler/commands/#secret).

## 14. Optional device notifications

Dashboard alerts are the saved record. Device notifications are optional and need a supported browser, permission and a real delivery test.

1. Generate the VAPID configuration into a **new ignored local file** with `node scripts/generate-scamwin-vapid.mjs .env.push.local`. The command writes keys privately and must not print their values.
2. Add `SCAMWIN_WEB_PUSH_PUBLIC_KEY` as Config, `SCAMWIN_WEB_PUSH_PRIVATE_KEY` as Secret, and `SCAMWIN_WEB_PUSH_SUBJECT` as Config with a real `mailto:` operator contact. Use main scamwin / Production. Set `SCAMWIN_PRIVATE_PUSH_ENABLED=true` only after a supported-browser pilot.
3. In Scamwin, the user presses the device-notification button. Only that explicit gesture may request browser permission.
4. Test a controlled result with the tab closed. Verify the generic notification opens the authenticated account page. Email subjects, message content, provider links and credentials must not appear in the notification payload.
5. Deny permission and verify in-app alerts still work. Test device revoke, account-wide opt-out, expired subscriptions and connected-data erasure separately.

Reviewed official alternatives have their own default-off `SCAMWIN_ALTERNATIVES_ENABLED` gate. They use the existing reviewed official-source catalogue and evidence/freshness checks; enabling the projection does not verify a provider connection or create a new trusted source.

## 15. Verify before enabling broadly

- Existing sign-in, new manual check, saved checks, Browserless live view, official-source next step, reviewed warnings and publisher still work.
- Another owner cannot access a connection, source, alert, OAuth flow, file or device registration.
- One source with multiple links creates bounded separate target checks; a message is not marked fully checked when links or files were skipped.
- Manual mode imports only explicit choices. Selective mode follows saved rules. All mode does not silently filter bot messages or known senders.
- New automatic items respect activation time, selected scope, pauses, provider backoff and the daily/monthly limits. Queued is different from checked.
- Deletion, lost permissions, reconnect, expired media and late callbacks cannot restore erased source content. Retention is at most 30 days for imported text/context, 7 days for images, and 90 days for content-free activity metadata, with shorter provider-specific expiry where documented.
- Real independent-session PostgreSQL locking, provider authorizations/installation, closed-tab push, laptop-off scheduling and actual Free-plan headroom need recorded live evidence. Local fixtures do not establish these conditions.

## 16. Pause or restore

For an app-specific problem, pause/disconnect that app. For a runtime problem, turn off automatic processing and the scheduler while keeping saved-source/result access. Push has its own gate. Connected-data erasure is a separate explicit owner action; it does not delete the user's external Google/Microsoft/Auth0 account.

For a code rollback, use the existing workspace `SCAMWIN-RESTORE-POINT.md` and `backups/CURRENT-PROTOTYPE-RESTORE-POINT.json`. That backup covers the prototype files, Git history and encrypted local configuration. It does not rewind external databases, mailboxes, app installations or blockchain transactions.
