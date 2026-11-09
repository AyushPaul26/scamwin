# Historical README before the Scamwin submission

Preserved for project history and attribution. The root README describes the current Scamwin submission and deployment.

# Scamwin

Scamwin compares an offer’s promise, your intended action, and the observed destination or recipient. The application includes private checks, evidence-linked findings, follow-up questions, reviewed public warnings and a Base Sepolia registry. It reuses the OpenMods foundation described below.

Start the website with `npm ci` and `npm run dev`, then open `/demo` for explicitly synthetic, read-only examples. Real checks require configured Auth0, Neon and a deployed Trigger worker. Missing credentials never select mock data automatically.

- [Run, configure and deploy Scamwin](docs/scamwin-running.md)
- [Connect services one at a time: live setup walkthrough](docs/scamwin-live-setup.md)
- [Current free implementation plan, gaps and demo requirements](docs/scamwin-current-plan.md)
- [Step-by-step account and credential guide](docs/scamwin-setup-guide.md)
- [Free-only environment template](scamwin.env.example)
- [Build and verification ledger](docs/scamwin-build-progress.md)
- [Registry contract and independent reader](web3/README.md)

The website targets Vercel. Investigation work runs online in Trigger.dev using Workers AI and a remote Browserless browser. Live collection is limited to verified, operator-owned approved origins. There is no paid fallback or required laptop worker. Provider allowances and account capabilities still need live verification with your credentials.

## Original OpenMods foundation

**AI teammates with persistent computers, durable conversations, and tools to do real work.**

OpenMods lets you create AI teammates with their own roles, instructions, avatars,
and isolated Daytona Linux computers. Talk to a teammate directly or bring several
into a group, give them a task, and watch their desktop as they work. You can expand
the desktop, resize it beside the chat, and take control yourself.

The project is also a foundation for an authorized cybersecurity assessment agent.
Browser and security tools can be installed inside each teammate's computer; the
full VAPT approval, evidence-correlation, and reporting workflow is still in progress.

## Demo video

[Watch the demo video — placeholder](https://youtu.be/tGDxCR1USug)

This is the placeholder video link for the project walkthrough. Replace it with the
final recording when ready.

## What works today

| Feature | What it does |
| --- | --- |
| Authentication | Auth0 sign-in with server-side ownership checks |
| AI teammates | Create, edit, and delete bots with roles, instructions, and avatars |
| Durable chat | Trigger.dev stores transcripts and supports reconnect, stop, retry, and continuation |
| Agent computers | Persistent Daytona sandboxes with shell, files, memory, screenshots, and desktop tools |
| Live desktop | Watch-only viewing, takeover/release controls, expanded view, and a draggable chat/desktop divider |
| Group conversations | Ordered members, recipient selection, and sequential teammate handoffs |
| Cross-chat memory | Each bot's `MEMORY.md` follows it between its conversations |
| Webpage reading | Firecrawl extracts public page content for the agent to use and cite |
| Usage dashboard | Token totals, configured AI cost estimates, and estimated sandbox runtime |
| Optional monitoring | Sentry integration with privacy filtering |
| Optional security toolkit | Playwright/Chromium, Nmap, Nikto, and ZAP installed inside bot computers |

Usage tracking is informational: there are no payments, subscriptions, or usage
paywalls. Desktop expansion stays inside the application and retains the chat
composer and noVNC connection.

### Current boundaries

- A general shell tool is available. Scan scope and human approvals are **not yet
  enforced by a dedicated server-side assessment workflow**.
- Evidence correlation, validated vulnerability ranking, and a professional VAPT
  report generator remain to be built. Chromium's PDF support alone is not that report generator.
- Nessus, OpenVAS/Greenbone, Burp Suite, and Metasploit are not installed or integrated.
- Firecrawl does not inherit your browser login. Private challenge pages may need
  a separate login in the Daytona desktop, downloaded files, or lab VPN access.
- A successful build or GitHub push does not establish a working production deployment.

## Architecture

```text
Browser: Next.js UI, chat, and noVNC desktop
    |
    +-- Auth0: sign-in and server sessions
    +-- Next.js server actions: ownership checks and mutations
    |       +-- Neon Postgres / Drizzle: bots, groups, memberships, usage
    |       +-- Daytona: provisioning and authorized desktop access
    |
    +-- Trigger.dev: durable chat worker and transcript storage
            +-- OpenAI: reasoning and tool selection
            +-- Daytona: shell, files, memory, and desktop execution
            +-- Firecrawl: public webpage extraction
```

The web app and Trigger worker are separate processes. Both must be configured
and running for the full local workflow. Agent commands execute in Daytona, not
on your development computer.

## Prerequisites

- **Node.js 24** and npm; `package.json` requires Node `>=24 <25`.
- Git and accounts with access to **Auth0**, **Neon Postgres**, **Trigger.dev**,
  **Daytona**, and **OpenAI**.
- A **Firecrawl API key** for reliable webpage-reading access.
- Optional Sentry projects for monitoring.

External services have their own quotas and charges. This is not a fully offline
setup, even when the web app runs on localhost.

## Run locally

### 1. Clone and install

```bash
git clone https://github.com/ANAMASGARD/openmods.git
cd openmods
node --version
npm ci
```

Use the committed lockfile rather than upgrading packages during setup.

### 2. Configure Auth0

Create an Auth0 **Regular Web Application** and configure:

| Auth0 setting | Local value |
| --- | --- |
| Allowed Callback URLs | `http://localhost:3000/auth/callback` |
| Allowed Logout URLs | `http://localhost:3000` |
| Allowed Web Origins | `http://localhost:3000` |

Enable the database connection `Username-Password-Authentication` for email login.
Social login buttons use the connection names in `lib/auth-providers.ts`; enable
those connections for your application before using their buttons. Auth0 remains
the authentication provider regardless of where the Git repository is hosted.

Generate a cookie-encryption secret once:

```bash
openssl rand -hex 32
```

Keep that value stable between restarts. Changing it signs existing sessions out.
Use `localhost:3000` consistently rather than switching to `127.0.0.1`.

### 3. Create `.env.local`

Create this file in the repository root and replace every placeholder with your
own configuration. Do not overwrite an existing configured file.

```dotenv
# Web application and Auth0
APP_BASE_URL=http://localhost:3000
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
AUTH0_SECRET=replace-with-the-64-character-hex-secret

# Neon development database
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require

# Trigger.dev DEVELOPMENT environment key
TRIGGER_SECRET_KEY=replace-with-your-development-secret-key

# OpenAI worker configuration
OPENAI_API_KEY=replace-with-your-openai-api-key
OPENAI_CHAT_MODEL=gpt-6-luna

# Daytona: used by both web app and worker
DAYTONA_API_KEY=replace-with-your-daytona-api-key
DAYTONA_API_URL=https://app.daytona.io/api
OPENMODS_ENV=development

# Firecrawl: used by the worker
FIRECRAWL_API_KEY=replace-with-your-firecrawl-api-key

# Optional: install browser/security tools when creating new bots
OPENMODS_SECURITY_TOOLS=false
```

`OPENAI_CHAT_MODEL` must name a model your OpenAI account can use. The current
code defaults to `gpt-6-luna` if you omit it; set another supported model explicitly
if needed. Daytona credentials must allow sandbox creation, modification, and deletion.

`.env.local` is ignored by Git. Never prefix credentials with `NEXT_PUBLIC_`, paste
them into chat, or put them in bot instructions. On Linux/macOS, restrict file access:

```bash
chmod 600 .env.local
```

### 4. Link your Trigger.dev project

The checked-in `trigger.config.ts` points to the original project's identifier.
If you are using your own account, create a Trigger.dev project and replace the
`project` value with **your project reference**. Use a development secret key from
that same project in `.env.local`.

Authenticate the CLI:

```bash
npx trigger.dev@4.8.1 login
```

### 5. Initialize the development database

Create a Neon development database, set its connection URL above, then run:

```bash
npm run db:check
npm run db:push
```

The project treats development data as disposable. `db:push` applies the schema
directly and can require destructive changes. Use a development database, review
its prompts, and do not point this workflow at valuable data. Do not generate
migration files or run migration/backfill commands.

Optional database browser:

```bash
npm run db:studio
```

### 6. Start both processes

**Terminal 1 — web app:**

```bash
npm run dev
```

**Terminal 2 — agent worker:**

```bash
npm run dev:trigger
```

Wait for the worker's **Local worker ready** message. Both processes load
`.env.local`; restart them after changing credentials or environment settings.

Open **[http://localhost:3000](http://localhost:3000)**, sign in, and create a bot.

### 7. Check the first task

Try these in a direct chat:

- “Create a file called hello.txt containing Hello from OpenMods, then read it back.”
- “Read https://example.com and summarize what the page is for. Cite the URL.”
- “Remember that I prefer concise explanations.”

Click the computer icon to view the bot's desktop. Drag the divider to resize it,
expand the view, or select **Take over** to interact. Firecrawl extraction happens
remotely and does not navigate the visible desktop browser.

For groups, create at least two bots, create a group, and choose the recipient.
Group chats share the conversation while each bot keeps its own computer and memory.

## Optional security toolkit

Set `OPENMODS_SECURITY_TOOLS=true` in `.env.local` and restart the web app to enable
installation for **new bots**. First-time setup may take several minutes. Existing
bots can be updated explicitly:

```bash
node --env-file=.env.local --import tsx scripts/install-sandbox-security-tools.mts
```

This command updates bot computers referenced by the configured database and checks
their project/environment labels. It installs tools; it does not scan targets.
The agent can use `nmap`, `~/.local/bin/nikto`, `~/.local/bin/zaproxy`, and
`~/.local/bin/playwright`. See [Security toolkit setup](docs/security-toolkit.md)
for versions, paths, limits, and verification details.

For CTF work, provide the problem statement **and** the running lab URL/IP, plus any
required files. Only test targets explicitly authorized for that assessment. The
hackathon scope requires organizer-provided labs and human approval before active
exploitation. A pasted website link is not permission to scan it.

## Optional usage pricing and monitoring

Token usage is recorded without price configuration. To enable cost estimates,
set `MODEL_RATES_JSON` in the worker to a JSON object keyed by the exact model name,
with numeric `input`, `cachedInput`, and `output` prices in USD per million tokens.
Use the applicable provider rates; costs without configured rates remain unavailable.
Sandbox runtime is sampled and displayed as an estimate, not a billing statement.
The scheduled sampler runs through Trigger.dev's deployed schedule, not automatically
just because a local worker is open.

Monitoring is optional. Configure `SENTRY_DSN` for server/worker events and
`NEXT_PUBLIC_SENTRY_DSN` for browser events. Use a shared `SENTRY_RELEASE` for matching
web and worker releases; set `NEXT_PUBLIC_SENTRY_RELEASE` to the same value for
browser events and `NEXT_PUBLIC_OPENMODS_ENV` for their environment. Source-map
upload credentials belong only in build settings.
See [the deployment runbook](docs/render-deployment.md) for the complete environment matrix.

## Tests and verification

```bash
# Unit and integration-style test suite
npm test

# Focused chat, ownership, sandbox, usage, and privacy checks
npm run test:completion
node --import tsx --test tests/web-tools.test.ts

# Static checks and production build
npx tsc --noEmit
npm run lint
npm run build
```

These checks do not prove that your external credentials, OAuth configuration, or
production deployment work. Some browser checks create synthetic local Auth0
sessions; those are not real OAuth tests.

With the appropriate credentials and development processes running:

```bash
# Real worker + OpenAI + Firecrawl; isolated fixtures are cleaned up
node --env-file=.env.local --import tsx scripts/check-firecrawl-live.mjs

# Real Daytona desktop/layout checks; creates a temporary sandbox and DB fixtures
node --env-file=.env.local --import tsx scripts/check-desktop-design.mjs
```

Live checks consume service resources and may incur charges. Check each script's
requirements before running it. `npm run test:chat:browser` starts its own web
server; stop the normal development web server before using that check.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Sign-in fails or loops | Auth0 callback URL, enabled connection, stable `AUTH0_SECRET`, and matching `APP_BASE_URL` |
| Chat stays pending | Development worker is ready; project reference and development key match; OpenAI model is accessible |
| Database operations fail | Neon URL and TLS settings; run `db:check`, then ensure the schema is applied |
| Bot creation is slow | Optional toolkit installation downloads browsers and packages; check Daytona resource limits |
| Desktop will not connect | Daytona key, sandbox state, and network access; use the desktop reconnect button to renew access |
| Firecrawl returns an error | Worker has the key and was restarted; account has access/credits; page is publicly readable |
| Lab target cannot be reached | Actual target URL/IP, required VPN, and Daytona account network restrictions |
| New styling appears stale | Stop Next.js, move aside `.next/dev`, and restart; avoid deleting unrelated project files |

`/healthz` checks the web process only. It does not verify Auth0, Neon, OpenAI,
Firecrawl, Daytona, or the Trigger worker.

## Production deployment

The repository includes `render.yaml` for a Render Node web service connected to
GitHub. Deploy the compatible **Trigger.dev production worker separately before
releasing the web changes**. Configure production credentials in both services;
`.env.local` is not uploaded automatically. Use `OPENMODS_ENV=production`, production
Trigger credentials, and Auth0 callback URLs matching the actual public origin.

Follow [Deploy OpenMods on Render](docs/render-deployment.md) for the environment
matrix, schema step, deployment commands, smoke tests, and coordinated rollback.
The Blueprint selects a paid service; check provider pricing before deploying.
This README does not claim a verified public deployment.

## Project structure

```text
app/                       Next.js routes, server actions, and global styles
components/                Chat, desktop, bot/group forms, and shared UI
lib/daytona.ts             Sandbox lifecycle and authorized desktop connections
lib/sandbox-tools.ts       Shell, file, memory, desktop, and handoff tools
lib/web-tools.ts           Firecrawl webpage reader
lib/security-toolkit.ts    Optional sandbox tool installer
lib/db/                    Drizzle schema and database access
src/trigger/               Durable chat, healthcheck, and usage tasks
scripts/                   Setup helpers and browser/live-service checks
tests/                     Automated tests
docs/                      Deployment, research, and verification notes
trigger.config.ts          Trigger.dev project and worker build settings
render.yaml                Render web-service Blueprint
```

## Further reading

- [Project summary](PROJECT_SUMMARY.md)
- [Render deployment guide](docs/render-deployment.md)
- [Security toolkit setup and limitations](docs/security-toolkit.md)
- [Demo video placeholder](https://youtu.be/tGDxCR1USug)
