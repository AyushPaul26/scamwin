# OpenMods project summary

Last updated: 25 October 2026.

## Current state

OpenMods has an authenticated dashboard, bot management, a responsive chat interface,
and a working Trigger.dev chat agent with transcript persistence. Local mocked checks
and a real OpenAI/Trigger.dev streamed reply with reload persistence have passed.
Render deployment configuration and a [deployment runbook](./docs/render-deployment.md)
are prepared. Production deployment and hosted authentication verification remain
outstanding.

## Stack and architecture

- Next.js 16.4.2 App Router, React 19.3.0, TypeScript, Tailwind CSS 4, shadcn/Base UI.
- Auth0 for authentication and server-side ownership checks.
- Neon Postgres through Drizzle for bots, chats, and chat membership.
- AI SDK 7 and AI Elements for chat rendering and transport.
- Trigger.dev 4.8.1 for background tasks, chat execution, and transcript storage.
- OpenAI model: `gpt-6-luna`, configurable with `OPENAI_CHAT_MODEL` in `.env.local`.
- Motion for composer transitions; DiceBear 10 and creature assets for avatars.

The browser calls authenticated server actions to open a chat session or refresh its
scoped token. The Trigger.dev worker loads the bot's saved instructions from Neon,
streams the reply, and saves the transcript by chat ID. Reloading restores messages
and the stream cursor. The previous direct `/api/chat` route has been removed.

## Completed work

### Dashboard, authentication, and bots

- Landing page and Auth0 sign-in/sign-out with persistent encrypted sessions.
- Dashboard sidebar, account menu, chat search, and persisted collapse preference.
- Chat routes scoped to chat IDs, with server-side authorization.
- Bot creation, editing, and deletion; atomic bot/chat creation.
- Shared validation with Zod, Drizzle schemas, and React Hook Form.
- Developer and GitLab workflow role presets, editable instructions, and avatar previews.
- Bot ownership comes from the Auth0 server session, never a browser-supplied user ID.
- Role presets do not imply that external integrations or agent tools are connected.

### Chat composer and interaction

- Slim, charcoal, rounded composer: 56px single-line height and 768px maximum width.
- Centered empty state with “What are we working on?” and starter suggestions below.
- One continuously mounted composer docks after the first message, preserving focus.
- Approximately 220ms layout transition with reduced-motion support.
- Multiline expansion up to 160px, phone-friendly text, and short-viewport access.
- Compact white action button: waveform while idle, upward arrow when typing, stop while busy.
- Microphone control backed by browser speech recognition, with error handling.
- Balanced, Concise, and Detailed reply styles; starter menu, retry, and stop.
- Enter submits; Shift+Enter inserts a newline; latest-message scrolling is retained.
- Transcript retention notice now states that messages are saved to the chat.

### Trigger.dev and persistence

- Project reference: `proj_yyokorioekbldyziwkwb`.
- `trigger.config.ts` uses Node.js 24, `./src/trigger`, and a 60-second default maximum duration.
- Exported `openmods-healthcheck` task successfully ran in development.
- Exported `openmods-chat` agent uses default transcript storage, with a one-hour
  maximum active duration and a 60-second timeout waiting for the next message
  after suspension. This is not a per-reply execution timeout. A later message
  starts a continuation run using persisted history.
- Server actions authorize session creation, token refresh, and history loading.
- New-message validation rejects injected assistant/system history and unsupported content.
- The worker resolves bot instructions from the database and sanitizes client-facing errors.
- No new database schema was needed for transcripts. Default storage is not a promise
  of unlimited message retention; compaction may trim older history.
- No agent tools or file uploads were added.

## Important files

| File | Purpose |
| --- | --- |
| `components/chat-conversation.tsx` | Composer, transcript UI, and Trigger transport |
| `hooks/use-chat-dictation.ts` | Browser microphone/dictation behavior |
| `app/chats/actions.ts` | Authorized session, token, and history actions |
| `app/(dashboard)/chats/[chatId]/page.tsx` | Owned chat page and restored history |
| `src/trigger/chat.ts` | Chat agent, model selection, and persistence |
| `src/trigger/healthcheck.ts` | Development worker smoke test |
| `lib/chat-input.ts` | Message and reply-style validation |
| `lib/db/schema.ts` | Database tables |
| `scripts/check-chat-composer.mjs` | Responsive composer browser checks |
| `scripts/mock-trigger-chat.mjs` | Mock Trigger protocol for browser tests |

## Local development

Run these in separate terminals:

```bash
npm run dev
npm run dev:trigger
```

Keep credentials in ignored local environment files. The worker command explicitly
loads `.env.local`; restart it after changing model or credential settings.

```dotenv
OPENAI_CHAT_MODEL=gpt-6-luna
```

The worker also needs `OPENAI_API_KEY` and `DATABASE_URL`. The app needs its existing
Auth0 configuration, `DATABASE_URL`, and the development `TRIGGER_SECRET_KEY`.
Do not put secret values in documentation or commit local environment files.

## Verification completed during implementation

- Seven focused chat tests passed: authorization, input validation, persistence,
  regeneration, chat isolation, failure/retry, and stop behavior.
- TypeScript checking and focused linting passed; whitespace checks passed.
- Composer browser checks passed on desktop and mobile, including 390×844,
  320×568, and short 390×400 layouts, reduced motion, and reload persistence.
- Browser microphone behavior was checked with mocks, not a real microphone.
- Real Trigger.dev/OpenAI testing confirmed `gpt-6-luna`, conversation context,
  transcript writes, and persisted history reads.
- A real frontend streaming check produced “Migration verified.” and restored that
  reply once after reload. It used a synthetic local Auth0 session.
- Disposable verification chats and sessions were cleaned up afterward.

These are earlier chat-implementation results, not a claim that tests were rerun
for Render preparation. Real hosted OAuth, production deployment, and real
microphone permissions/devices still need verification.

## Git state

The persistent chat-agent migration is in commit `a47ed5d`,
`Migrate chat to Trigger.dev with persistent transcripts`. Render preparation is
left uncommitted on the current branch. Use `git status` and `git log -1` for the
live repository state; no branch, commit, or push is part of deployment preparation.

## Deployment recommendation and remaining work

Selected architecture: **one paid Render web service for Next.js, Trigger.dev Cloud
for tasks and transcripts, Neon for Postgres, and Auth0 for authentication**.
The `0.5c-512mb` instance avoids inactivity sleep with a base compute cost of about
$7/month. Hosting remains billable while idle. No cron, Render worker, database,
Redis instance, or persistent disk is added.

`render.yaml`, the production startup check, and `/healthz` prepare the app for
native Node hosting. Existing local commands and chat behavior remain intact.
The project requires server-side rendering and actions, so static export is not
appropriate.

Follow the [Render deployment runbook](./docs/render-deployment.md) when publishing.
Deploy the Trigger.dev production worker, configure Auth0 for the actual HTTPS
origin, then complete the hosted acceptance checklist. Render and Trigger deploy
separately; pushing to GitHub does not itself deploy the Trigger worker.
The repository configuration is not evidence of a live deployment.
