# Creature avatars implementation plan

## Milestone 1 — visual approval

- [x] Confirm the original six-character design and the one-model review checkpoint.
- [x] Add Three.js / React Three Fiber v9 and an explicitly limited review catalog.
- [x] Author and export the moss otter using a pinned, checksum-verified Blender runtime; retain script and .blend source.
- [x] Implement the client renderer, semantic rig controls, animation lifecycle, fallback portraits and keyboard/touch input.
- [x] Render all three portraits from the GLB in the same browser scene.
- [x] Show the authenticated preview at `/dashboard/avatar-preview`, including 240/200px showcase and 144px dialog sizes.
- [x] Verify model contracts, deterministic palettes, browser behavior, fallback, reduced motion, build and lint.
- [x] Receive user approval of the actual interactive model before expanding the cast.

## Milestone 2 — complete the cast after visual approval

- [x] Establish the approved otter surface/lighting/motion standard and expand to seven distinct species as requested.
- [x] Author the other six distinct meshes and rigs; export and inspect idle/greet clips for each.
- [x] Produce three matching portraits per species. Freeze the seven-species versioned catalog.
- [x] Replace ChatAvatar artwork using its existing public props; retain DiceBear 10 dependencies.
- [x] Integrate the welcome avatar and dialog preview at the approved sizes; pause the background scene while a dialog is open.
- [x] Generate one dialog seed per opening, validate it on submission, save it to bots.avatar, and preserve it on retry.
- [x] Verify saved-bot identity, form validation/security, every species/palette, static card behavior, accessible interactions and graphics lifecycle.
- [x] Run focused tests, type checks, lint, build, desktop/mobile browser review, and review whether Next feedback is warranted.
- [x] Record verification boundaries and leave all work uncommitted.

## Runtime regression checks

- [x] Reproduce the `_cacheIndex` exception from effect setup/cleanup replay and retain per-instance mixer bindings so memoized actions can restart safely.
- [x] Verify the fix in the development browser with Strict Mode, including repeated dialogs, greetings, and reduced-motion remounts.
- [x] Verify every published model/portrait is served successfully; catalog asset tests prevent selecting missing species assets.
- [x] Verify seeded creation and ownership isolation against the development database from both development and production browser sessions; remove synthetic test rows afterward.

## Final verification

- 32 focused tests passed: seven input-validation checks and 25 catalog/model/portrait checks.
- TypeScript, ESLint for the changed application/tests/tooling, and the production build passed.
- Development browser checks passed for all seven creatures and 21 palettes, including mouse/keyboard/touch greetings, repeated activation, dialog reopening/focus, reduced-motion remounts, loading failure, context loss, and suspension.
- Production-served assets returned HTTP 200 with valid GLB/WebP signatures for all 28 files. Creation, persistence, retries, ownership isolation and session rejection passed against both local development and production servers; synthetic rows were removed.
- Neutral, greeting and blink poses were visually reviewed. All greeting frames fit the browser camera bounds.
- Repository-wide lint still reports two pre-existing empty-interface errors in Auth0 skill templates, plus three existing image-element warnings. Those unrelated templates were not changed.
- Mobile testing uses Chromium device emulation; hidden-tab testing simulates the visibility event. Real OAuth and hosted deployment are outside this validation.
- The animation failure was caused by application cleanup invalidating memoized Three.js actions. No verified Next.js-specific feedback candidate remained after the reporting review.

## Follow-up — diagonal character selection

- [x] Adapt the supplied Vengeance UI spring-driven diagonal interaction for the welcome screen, creation dialog, and artwork review.
- [x] Keep only the center character interactive; use portrait neighbors, deliberate hover without cascading, direct choices, arrows, keyboard navigation and touch swipes.
- [x] Preserve chosen species/palette through a fresh dialog seed, keep typed fields when selecting, lock selection during submission, and persist the selected seed through validation and reload.
- [x] Verify all 37 focused tests, TypeScript, changed-code ESLint, production build, and selector/dashboard browser checks.
- [x] Inspect desktop and mobile layouts, including 320px controls, reduced motion, swipe suppression of greetings, and focus retention when the active avatar changes.
- [x] Resolve the temporary missing-module error by completing the carousel source before final verification. This was implementation ordering, not a Next.js-specific failure.

Browser checks used the local development server with synthetic Auth0 sessions;
database test rows were cleaned up. Work remains uncommitted on `main`.
