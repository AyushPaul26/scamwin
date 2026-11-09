# OpenMods hero design

Approved in chat on 2026-10-21 with the instruction to implement. Preserve the supplied single-viewport composition and change the heading/product identity to OpenMods. Keep the existing Next.js 16 / React / TypeScript / Tailwind application and existing authentication routes.

## Appearance and behavior

- Exact supplied SVG mark, imagery and video URLs; Instrument Serif uppercase OPENMODS heading and Inter navigation. Helvetica Neue uses a locally installed font if available because no licensed font files were supplied.
- Fixed glass desktop navigation and reservation CTA. Below the desktop breakpoint, use the supplied hamburger and a fullscreen animated menu with keyboard dismissal, focus containment and restored focus.
- Stack the static 48px grid, background image, large heading, atmosphere overlay and bowl video. Per the user's revision, remove the cursor spotlight, white flare, cursor tracking and parallax entirely.
- Play the supplied video only while the pointer is inside the bowl's fixed outline. Clip the video directly to that outline with the same cover sizing at all viewports. Do not use the remote PNG as a CSS mask: its server does not allow cross-origin mask fetching, making the video invisible. Preload the video for prompt hover playback, including a cursor already over the jar during hydration. On leaving the bowl, pause and show the original still image. Reduced-motion and touch users retain the static composition; hidden or unfocused pages pause playback.
- Keep Cache Components and partial prefetching enabled. Disable the development indicator so its cache-bypass notice does not cover the landing view. Browser developer-tool cache bypass remains a browser setting, independent of the app configuration.
- No scrolling on the landing page; contain the page within the dynamic viewport. Keep authentication pages scrollable and retain their existing authentication navigation separately from the hero navigation.
- Preserve the reference navigation labels as presentational section selectors; they close the mobile menu and update the current selection. No unsupported product pages, product claims or reservation backend are added. Reserve Yours links to `/sign-up`.

## Verification

Run ESLint, TypeScript and a production build. Check the actual page at desktop and mobile widths, bowl hover playback and pointer-leave pause, absence of any canvas or spotlight flare, no page overflow, mobile open/close/Escape and focus restoration, reservation navigation, reduced-motion behavior and preserved sign-in/sign-up pages. Leave all changes uncommitted on the current branch.
