<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Git

- Never create branches, worktrees, or commits automatically. Only do so when the user explicitly asks for that specific action in the current request.
- Leave changes uncommitted in the working tree on the current branch and let the user decide when and how to commit.

## Authentication

- Use Auth0 (`@auth0/nextjs-auth0`) throughout OpenMods, including bot creation. Do not add Clerk or copy Clerk authentication from tutorial screenshots.
- Resolve bot ownership on the server from `auth0.getSession().user.sub`; never accept a browser-supplied user ID.

## Forms and creation dialogs

- Derive database insert validation from the Drizzle table with `createInsertSchema` from the installed, compatible `drizzle-zod` package. See `lib/db/bot-validation.ts`; do not upgrade Drizzle just to follow a tutorial's newer import path.
- Share field rules, limits, and messages between client and server. Keep browser-safe Zod schemas in modules such as `lib/bot-form-schema.ts`, separate from database clients and server credentials.
- Use React Hook Form with `zodResolver`. Connect controlled Base UI inputs through `Controller` or `useController`, and use `setValue` for preset changes so validation and dirty state stay consistent.
- Compose forms from the existing shadcn/Base UI `Dialog`, `FieldGroup`, `Field`, `FieldLabel`, `FieldError`, input, and button components. Use `ToggleGroup` for role presets and `render` for custom Base UI triggers.
- Validate again inside the server action, regardless of client validation. Authenticate with Auth0 before writing, allowlist editable fields, and assign ownership and generated fields on the server. Reject file values and duplicate scalar fields rather than silently selecting a value.
- Keep server mutations in server actions. Use `useActionState` for pending/results and `startTransition` when dispatching manually after React Hook Form validation. Prevent duplicate submissions and disable editing and presets while a save is pending.
- Show field errors inline with `aria-invalid` and `aria-describedby`, focus the first invalid field, and map server field errors back into the form. Show general save failures in an `Alert`; never expose raw database errors.
- Preserve entered values and the preview avatar seed through validation failures and retries. Close the dialog and refresh the dashboard only after a successful save. A late response from an earlier dialog must not close a newly opened dialog.
- The creation popup shows one small avatar matching the dashboard selection. Keep avatar selection on the dashboard; do not add a second carousel or shuffle control to the popup. Avatar greeting buttons must not submit the form.
- Keep normal desktop and small-phone layouts compact enough to show fields and action buttons without dialog scrolling. Retain overflow access for short viewports, keyboards, and validation messages; do not hide inaccessible content to remove a scrollbar. Preserve dialog focus trapping, Escape dismissal, and focus return.
- Use developer and GitLab workflow role presets from `lib/bot-presets.ts`. Presets fill editable jobs and starter instructions while preserving the name, avatar, and customized instructions. Do not present configured roles as connected or executing integrations.
- For changes to validation or submission behavior, verify invalid input, server rejection, retries, pending state, authenticated ownership, and saved values. For layout changes, inspect desktop/mobile fit and keyboard access. Reuse the existing focused tests and browser checks; distinguish synthetic local-session checks from real Auth0 OAuth testing.
- Form validation changes alone do not require database schema changes or `db:push`. Follow the Database rules below when a table actually changes.

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Routine debugging is not feedback. Verify changes before retaining them as feedback candidates. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Retain qualifying friction even if it is later fixed or worked around; record the final outcome during the reporting pass.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `npx --no-install next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->

## Database

This is a development project. There is no backward compatibility and the data is worthless. Prefer data loss. Never backfill, migrate, or preserve existing rows, and never spend effort on keeping old data working. Every schema change means a new, clean slate.

- Apply schema changes only with npm run db:push (drizzle-kit push).
- Never use migrations: do not run drizzle-kit generate or drizzle-kit migrate, and do not create migration files or a drizzle/ folder.

---

## DiceBear

Use DiceBear 10. Documentation: https://www.dicebear.com/llms.txt

There are seven native cores with identical output, not one library with
wrappers. Use the one matching this project's language. Do not reach for the
JavaScript core when the project is written in something else:

    JavaScript  @dicebear/core + @dicebear/styles
    PHP         dicebear/core + dicebear/styles
    Python      dicebear-core + dicebear-styles
    Rust        dicebear-core + dicebear-styles
    Go          github.com/dicebear/dicebear-go/v10 + github.com/dicebear/styles/v10
    Dart        dicebear_core + dicebear_styles
    C#          DiceBear.Core + DiceBear.Styles

Every style page carries a loading snippet for all seven, for example
https://www.dicebear.com/styles/lorelei/index.md

HTTP API: https://api.dicebear.com/10.x/<style>/svg?seed=<seed> The seed is a
query parameter, not a path segment. Options are query parameters too; array
values are separated by commas.

Options named after a component end in Variant: eyesVariant, not eyes. This
holds in all seven cores and in the HTTP API. Look up the options of a style at
https://api.dicebear.com/10.x/<style>/options.json

Write these forms, not the ones on the left. The left column is pre-10 and the
API does not reject it, so an outdated call runs and silently does the wrong
thing:

    avatars.dicebear.com/api/<style>/<seed>.svg  ->  api.dicebear.com/10.x/<style>/svg?seed=<seed>
    api.dicebear.com/9.x/<style>/svg             ->  api.dicebear.com/10.x/<style>/svg
    npm install @dicebear/collection             ->  npm install @dicebear/styles
    npm install @dicebear/lorelei                ->  npm install @dicebear/styles
    createAvatar(lorelei, { seed })              ->  new Avatar(new Style(definition), { seed })
    { eyes: ['variant01'] }                      ->  { eyesVariant: ['variant01'] }
    ?radius=50                                   ->  ?borderRadius=50

Only JavaScript and the HTTP API have a pre-10 form. The other six cores were
released in 2026 and never had one, so any older-looking PHP, Python, Rust, Go,
Dart or C# API attributed to DiceBear is invented rather than outdated.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->
