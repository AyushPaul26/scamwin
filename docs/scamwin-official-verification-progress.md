# Execution ledger — official verification

Plan: `docs/superpowers/plans/2026-11-10-scamwin-official-verification.md`

Spec: `docs/superpowers/specs/2026-11-10-scamwin-official-verification-design.md`

Baseline: `c599bf38c49932ff05e2ea63a0c65eb21aeb660e`; existing Scamwin suite: 218/218 passing.

The user authorized implementation on 10 November 2026 and subsequently authorized committing and pushing the finished feature. Resume analysis and job matching remain deferred. Production environment activation remains an operator step; no database change is needed.

## Preflight

| Tasks | Shared interface/file | Finding |
| --- | --- | --- |
| 1 → 2/3/4/6 | Official types and read/navigation source policy | Separate API-read/public-navigation builders are mandatory; shared exports owned by Task 1. |
| 2/3 → 4 | Reader and adapter outcomes | Typed bounded outcomes, no model-selected URLs; cancellation must propagate. |
| 4 → 5/6 | Flat observations and projection | At most eight validated records, no schema change; current-run gates and actual timestamps. |
| 5 → 6 | Seventh progress stage, private detail response | Browser view ends before official HTTP work; old features stay in place. |
| 1/5 → 7 | Input/contracts/progress publisher closure | Pure contracts only; no reader/catalogue in publisher package. |
| 1/2/3/4/5/6/7 | Per-task tests versus implementation | Red/green scoped tests followed by regression suite and main/publisher builds. |

Execution decisions: the approved plan and AGENTS.md require using this checkout with changes left uncommitted. Windows-native tooling and this durable documentation ledger replace shell-only scratch-workspace scripts; no branch/worktree or automatic commits are created. The planning-only sentence in the original plan is superseded by the user's implementation request. Feature defaults remain disabled until explicitly configured; no production settings are changed.

## Tasks

- Task 1: complete — contracts/catalogue/policy and input validation; 11 scoped tests green. Initial production source set manually reviewed: Figma, TCS, Infosys, Cloudflare; only Figma has a reviewed exact-post Greenhouse adapter.
- Task 2: complete — DNS-pinned HTTPS transport; 41 native localhost HTTPS tests green, scoped lint green.
- Task 3: complete — deterministic claim derivation and static/Greenhouse adapters; 28 adapter tests green, scoped lint green.
- Task 4: complete — bounded orchestration, flat evidence and pure projection; 10 coordinator plus 16 view/navigation tests green.
- Task 5: complete — seven-stage integration, preserved risk priority, bounded evidence-only follow-up and cancellation tests green. The existing live-stage test was updated to expect an unstarted/skipped official stage when disabled, preserving all actual browser timing assertions.
- Task 6: complete — intake/result/navigation/history and shared evidence-link reuse verified; official UI 68 assertions, existing browser 36, controls 15 and live UI 114 passed at desktop/mobile widths using synthetic accounts.
- Task 7: implementation complete — source operations guide, presence readiness, feature flag in existing `scamwin.env.example`, and opt-in public-source CLI; seven CLI tests green. Deployment and real production-account acceptance remain separate release steps and were not performed.

## Implementation decisions and review

- The plan names `.env.example`, but this repository's maintained template is `scamwin.env.example`; extend that existing template instead of introducing a second one.
- `verifyOfficialOffer` also accepts optional `checkExpiresAt` so the production pipeline can clamp next-step expiry to the actual private check. The standalone CLI does not create private check evidence.
- A sole `gh_jid` parameter equal to a reviewed Greenhouse URL's numeric path ID is canonicalized away before lookup. It is never forwarded. Other/private queries and conflicting IDs are rejected; no model reference can trigger a lookup.
- Reference-only checks also use company/reference history labels and account-scoped search; new fields participate in the existing submission hash and existing whole-input erasure.
- Independent core review found two material integration defects. Both were reproduced red and fixed green: source deadlines are normalized to UTC (date-only through UTC day end), display title/location are bounded after comparison, and an API listing success cannot label an unread careers fallback as checked live.
- No schema, credentials, approved browser origins, public-warning eligibility, automatic sharing or Web3 signing behavior changed.

## Verification

- Baseline `npm run test:scamwin`: 218 passed, zero failed (before implementation).
- First combined regression: 333/334 passed; the only failure was the old hard-coded six-stage expectation, now corrected and its five-test live-pipeline suite passes.
- Publisher build: passed, 11 reviewed modules, no official network/catalogue modules or environment files packaged.
- Final `npm run test:scamwin`: **341/341 passed**, zero failed.
- TypeScript: `npx tsc --noEmit --incremental false --pretty false` passed.
- Lint of all **45 changed source/test files** passed. Repository-wide lint, after excluding generated Next/contract/publisher outputs, still reports 27 pre-existing errors and 13 warnings in unchanged legacy UI, vendored skill templates and existing tests. These files were not modified or suppressed.
- Main production `npm run build`: **passed** with the normal Turbopack configuration after preserving generated `.next` output under ignored `.trigger/official-validation/next-before-clean-build` and rebuilding cleanly. An explicit Node runtime export incompatible with Cache Components was removed first. No production bundler setting changed.
- Build detour: initial Turbopack retries failed to initialize child workers from generated output; a Webpack diagnostic attempt hit its default 4 GiB heap, then its CSS minimizer failed with a larger process-only heap. The normal clean Turbopack build resolved verification; Webpack was not adopted.
- Real unauthenticated Figma single-post acceptance: `matched_public_reference`, one GET, 8,925 bytes, 394 ms; no credentials, model, browser, database or application submission.
- Full in-memory-account pipeline using real public sources: completed as `partial` because no target website/browser was submitted; company recognized, exact public reference matched, source freshness fresh, two public documents, eligible official step resolved. No private database, AI or browser calls.
- Independent final whole-change review: no new material findings.
- Production-output official UI acceptance: **68 assertions passed** at 1440, 375 and 320 pixels. Synthetic sessions only; this does not claim a real Auth0 sign-in or private production-account test.

## Release state

Implementation and verification are complete. The owner authorized committing and pushing this release on 10 November 2026. Production activation and a real signed-in production-account acceptance check remain operator steps; no database push, actual private-account mutation or production environment change was made during implementation. The new feature defaults off. Set main-project Production Config `SCAMWIN_OFFICIAL_VERIFICATION_ENABLED=true` and deploy this release; keep existing keys and browser-origin controls. Follow the operations guide for current catalogue coverage and release acceptance.
