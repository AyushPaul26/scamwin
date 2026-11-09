# Isolated Vercel Publisher Implementation Plan

> **For agentic workers:** Implement independent tasks with focused failing tests first. No transactions until explicitly approved, and no commits without the repository-required authorization.

**Goal:** Replace unavailable Trigger publication with a separate free, fully online publisher.

**Architecture:** Native authenticated Node API in a second Vercel project, reusing the existing pure relay/store modules. Main Next app dispatches after a verified review or retraction; signer receives only approved database operations.

**Tech Stack:** Vercel Hobby Node 24, viem, Neon, Zod, existing testnet registry.

**Spec:** ../specs/2026-11-09-isolated-vercel-publisher.md

## Global Constraints

- Dedicated project-scoped Production signing key; never main website/shared/Preview.
- Explicit backend; one operation; 300-second invocation; existing chain 84532 and spending caps.
- No transactions on import or without execution approval; zero real-money purchases.

## Review Focus

- Missing/wrong auth must not access any database or signer.
- Request payload must not choose unsigned transactions or destinations.
- Duplicate reconciliation must retain existing nonce/fee/consent fences.
- Main website must never import signer implementation or key.
- Activation must reject wrong chain, owner, or excess estimated fee.

### Task 1 — Standalone publisher

- [x] Add publisher-only native API, packaging/build metadata and focused auth/one-operation/sanitization tests.
- [x] Build its isolated dependency closure and verify generated output excludes secrets.

### Task 2 — Main website dispatch

- [x] Add explicit publication backend selector and HTTPS dispatch, with missing-config/no-redirect/error tests.
- [x] Schedule Vercel dispatch after verified review/retraction and verified reviewer reads; keep explicit Trigger adapter available.

### Task 3 — Activation and rollout

- [x] Add deliberate chain/owner/fee-guarded activation helper and tests.
- [x] Prepare private wallets/settings, obtain free test funds, estimate deployment and request transaction approval.
- [x] Verify full suite/type checking, independent review and actual hosted build before claiming publication is live.

## Verified execution

The owner approved testnet deployment and activation; both completed with free faucet ETH. The owner then explicitly consented in the application, submitted the controlled demo warning and approved it as the configured operator. The isolated online publisher broadcast the warning. Independent RPC reading confirmed active revision 1 in epoch 1, with included finality. 130 application tests, 11 contract tests, TypeScript and the native Node package/runtime checks passed. Actual hosted builds passed after explicit Playwright manifest inclusion and native ESM import fixes. No private key entered the main website.
