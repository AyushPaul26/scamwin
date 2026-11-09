# OpenMods Hero Implementation Plan

> Execution: inline, as requested in chat. Preserve existing changes and leave all work uncommitted; project Git instructions override skill commit/worktree defaults.

**Goal:** Reproduce the supplied fullscreen hero with OpenMods branding.

**Architecture:** A server-rendered home page hosts a client hero with isolated cursor-animation and mobile-navigation components. Scoped CSS owns the visual layers; the existing auth navigation stays on the two auth pages.

**Tech Stack:** Next.js 16.4.2, React 19, TypeScript, Tailwind CSS 4 and a fixed CSS clip path.

## Tasks

- [x] Replace the starter home with `components/landing/openmods-hero.tsx`; put exact media URLs, labels and SVG mark in `components/landing/hero-content.tsx`.
- [x] Build `components/landing/bowl-video.tsx` with playback on bowl hover, a fixed clip path, pause on pointer leave, visibility and reduced-motion handling, video fallback and cleanup. This replaces the original spotlight per the user's revision.
- [x] Build `components/landing/hero-navigation.tsx` with the desktop glass pills and a native modal dialog for the animated mobile menu. Preserve labels, selection state and the `/sign-up` CTA.
- [x] Add scoped `components/landing/hero.css`; load Inter and Instrument Serif with Next fonts, set OpenMods metadata and keep auth navigation in the sign-in/sign-up pages.
- [x] Run `npm run lint`, `npx tsc --noEmit`, `npm run build`; inspect desktop/mobile page and interactions in the browser. Correct any observed failures, record actual verification limits and inspect the final diff.

## Acceptance

The opening composition matches the supplied layers and media; OPENMODS is visible without horizontal clipping at supported widths. Video plays within the bowl only while hovered, with no cursor glow or spotlight. Mobile menu traps focus, closes on Escape/selection and restores the trigger focus. Home has no document scrolling; auth routes remain usable. No branch, worktree, commit, dependency migration or deployment.

## Verification results

- Production build, TypeScript, scoped application ESLint and `git diff --check` passed.
- Original layout checks passed at 320x568, 390x844, 768x900 and 1440x900: fullscreen layout without document overflow; images and video loaded. Revised interaction checks confirmed no canvas/spotlight layer, playback inside the bowl, and paused hidden video when the pointer leaves the bowl.
- Mobile keyboard wrapping, Escape, selection dismissal, body overflow restoration and automatic closure at the desktop breakpoint passed. Reserve Yours reached sign-up; sign-in rendered with its existing provider links.
- Reduced-motion and coarse-pointer fallbacks were reviewed in code; OS-level media emulation was not available in the browser tooling.
- Full repository ESLint still reports two existing errors in `.agents/skills/auth0/assets/acul/react-templates/` and existing image warnings. No unrelated templates or lint configuration were changed.
- No verified Next.js framework issue remained for the agent-feedback reporting pass. The temporary preview server was retired; the development app remains at http://localhost:3000.

## Cache and visible playback correction

- The remote bowl PNG has no cross-origin permission for use as a CSS mask. The prior playback-state check did not prove visible motion: image comparison showed no changed jar pixels while the video was running. Removed that mask and retained the fixed bowl clip path.
- Compared two final rendered frames: jar pixels changed while the surrounding scene stayed unchanged. Pointer leave returned playback to paused with opacity zero. Video preloads, and pointer movement plus hydration-time hover detection handles a cursor already inside the jar.
- Disabled the Next.js development badge with `devIndicators: false`; Cache Components and partial prefetching remain enabled. A temporary production server returned `x-nextjs-cache: HIT` and `Cache-Control: s-maxage=31536000` for the home page. Browser-level Disable cache is controlled in the user's browser.
- The production build, TypeScript, scoped application/config ESLint and diff whitespace checks passed. No verified framework defect remained for feedback reporting.
