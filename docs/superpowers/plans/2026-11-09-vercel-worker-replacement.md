# Vercel Investigation Replacement Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the approved replacement task by task. Leave changes uncommitted until explicitly authorized under AGENTS.md.

**Goal:** Restore fully online, zero-spend investigations on the existing Vercel project.

**Architecture:** Next.js `after()` schedules one bounded Neon outbox delivery and the existing pipeline. Auth0 and database fencing remain unchanged. Browserless supplies remote Chromium; Web3 publication stays isolated.

**Tech Stack:** Next.js 16.4.2, Node 24, Neon Postgres, Cloudflare Workers AI, Playwright CDP, Browserless Free.

**Spec:** ../specs/2026-11-09-vercel-worker-replacement-design.md

## Global Constraints

- Invocation limit 300 seconds; pipeline limit 240 seconds; at most two active checks globally.
- Explicit backend selection, no paid fallback, no publisher signing key in Vercel.
- User ownership from verified Auth0 session; keep approved-origin and browser capability gates.
- Preserve existing uncommitted work; no branches, worktrees or commits without an explicit user request.

## Review Focus

- Duplicate polling must not execute the same run twice.
- Expired outbox leases must not start work after a failed acknowledgement.
- Canceled, deleted and old-generation checks must not write results.
- Review actions must never lease investigation jobs.
- Interrupted callbacks must remain visibly incomplete and expire, rather than claim success.

### Task 1: Bounded runner and admission

Files: lib/scamwin/investigation-backend.ts, lib/scamwin/vercel-worker.ts, lib/scamwin/store.ts, tests/scamwin-vercel-worker.test.ts and existing store tests.

- [x] Write and run failing tests for explicit selection, one-job lease/ack ordering, stale acknowledgement, no publication execution and runner failure.
- [x] Implement `investigationBackend(env)` and `runVercelInvestigation(store, dependencies?)`; lease only investigations, acknowledge before executing, fence failure writes.
- [x] Add global active admission limit 2 in memory and Postgres under the existing admission transaction; verify concurrent admission and released capacity.
- [x] Run focused runner/store tests.

### Task 2: Next scheduling and configuration

Files: app/scamwin/actions.ts, result API route, check/checks pages, lib/scamwin/readiness.ts, lib/scamwin/server.ts, scripts/check-scamwin-config.mjs, vercel.json, maintenance route and tests.

- [x] Route create/recheck and owner polling through a Next-only `after()` wrapper; keep Trigger dispatch investigation-scoped and review dispatch publication-scoped.
- [x] Export maxDuration=300 on action pages and polling route; use default Node runtime with cacheComponents.
- [x] Configure Fluid Compute and authenticated daily physical purge; update presence-only readiness and config checks for explicit backend.
- [x] Verify configuration tests and TypeScript.

### Task 3: Controlled browser demonstration and rollout

Files: public fictional lab routes, docs/scamwin-live-setup.md, docs/scamwin-running.md, docs/scamwin-setup-guide.md, docs/scamwin-setup-checklist.md.

- [x] Add self-contained fictional offer and destination pages for the existing collector, with no real payment or credential submission.
- [x] Prepare a private ignored environment import file using existing stable HMAC plus backend/browser settings; never print secrets.
- [ ] Run all Scamwin tests, TypeScript, production build and independent review. Request the repository-required commit/push authorization only once the changes are concrete.
- [ ] Guide Vercel environment import/redeploy; verify public readiness and real signed-in check. Test Browserless before enabling collection. Report remaining unavailable Web3 features accurately.

## Execution record

Ruling: both backends require explicit selection; an absent selector fails closed even when an old Trigger key exists. This prevents dispatch to the restricted service from stale configuration.

Verification: 106/106 Scamwin tests passed, TypeScript passed, independent review found no correctness blockers, and known secret values were absent from all 32 changed/new source documents. Real Browserless and pinned TLS setup smokes passed on the owned production origin. Local Turbopack fails in the Windows loader evaluator; Webpack cannot substitute for the configured Tailwind Turbopack integration. No unrelated framework/dependency change is included. The owner explicitly authorized committing and pushing this replacement; the actual Vercel build and signed-in check remain the production gate.
