---
version: alpha
name: Scamwin
description: A quiet evidence workspace for deciding what an online offer asks of you.
colors:
  background: "#080808"
  surface: "#141414"
  raised: "#1b1b1d"
  border: "#2c2c30"
  text: "#f2f1f4"
  muted: "#a6a5ad"
  primary: "#b8ccff"
  expressive: "#f5b4d3"
  danger: "#ffb4b4"
typography:
  sans:
    fontFamily: "Geist, Arial, sans-serif"
  mono:
    fontFamily: "Geist Mono, monospace"
  display:
    fontFamily: "Instrument Serif, Georgia, serif"
rounded:
  DEFAULT: "7px"
  card: "12px"
  badge: "5px"
spacing:
  page-max: "1240px"
  page-padding: "48px"
  section-gap: "28px"
components:
  button:
    minHeight: "44px"
  panel:
    borderRadius: "12px"
  input:
    minHeight: "44px"
---

# Scamwin design system

## Overview

Scamwin is a desk for examining an offer, like laying a message and its payment request side by side. Its signature is the meaningful trace **promise → requested action → destination**. This trace appears first as a synthetic example on the landing page, then as the editable decision restatement and saved evidence summary.

The audience is initially English-speaking people with India-relevant offers, often using a phone just before paying or sharing information. The product specification and zero-spend Vercel amendment in `docs/superpowers` define the audience and capability boundaries. The landing page uses a hybrid brand register; private, reviewer and admin routes use a quiet product register. There is no Japanese-market requirement.

Keep the existing OpenMods charcoal identity and Geist fonts. Use the existing Instrument Serif only for the landing page’s short emphasis. Do not resemble a terminal, gamified security score, agent roster or green matrix. Let the evidence trace carry expression; the form and result controls remain familiar.

Runtime ownership: `app/globals.css` owns the existing application foundations. The additive `app/scamwin.css` is the sole Scamwin adapter, declaring `--sw-*` tokens on `.sw` and mapping the existing primitive variables to them. This file documents those exact values; it does not generate a second token system. Every Scamwin route uses the shared Shell. Legacy OpenMods routes retain their existing theme.

## Colors

Background and surfaces retain the existing #080808 / #141414 identity. Soft evidence blue marks primary actions, evidence links and keyboard focus. Pink highlights a requested action that differs from a promise; it is expressive, not a safety verdict. Danger, caution and unavailable states always include text. No unavailable check is colored as completed.

Text and accents are used on charcoal surfaces. The primary button uses dark #111827 text. Gray utility text is intentionally quieter but readable. Scrollbars use #5c5b65 on #151518, with visible hover and active states. Forced-colors mode returns scrollbar colors to the system. The product currently supports its single charcoal theme.

## Typography

Geist owns product copy, forms and headings. Geist Mono is restrained to provenance labels, payload previews and timestamps. Instrument Serif adds only a few words of landing emphasis. Main product headings are 29–34px; marketing display is responsive 43–66px. Product body copy is 12–14px with generous line height. A system sans fallback supports mixed text in submitted offers.

## Layout

The shared document owns vertical scrolling. The max-width 1240px product container has 48px desktop padding, 30px intermediate padding and 16–22px mobile padding. Intake is a form plus a decision restatement; results put evidence before the secondary next-step rail. Both become single-column on narrow screens, preserving reading order. Lists paginate at 20 records. Private history search stays in memory and action bodies, never URLs.

## Elevation & Depth

Panels use a 1px border and subtle surface separation. The landing offer trace alone has a quiet shadow and small desktop rotation, representing the source message laid beside its evidence. Product panels do not float. Loading states keep readable labels and stable minimum space.

## Shapes

Panels use 12px corners, buttons and inputs 6–7px, status labels 5px. Circular outlines are reserved for the fingerprint brand, account initial and status symbols. Avoid large pill controls and repeated decorative shapes.

## Components

Shared owners are under `components/scamwin`: `core.tsx` owns Shell, Badge, Notice, Empty, Loading, Journey, SearchBox, Confirm, Readiness and access gates. Existing Base UI Button/Input/Dialog and Field primitives are reused. The form uses React Hook Form, Controller and the browser-safe shared Zod schema in `lib/scamwin/input.ts`.

Native details expose evidence and native checkboxes express reviewer selection and consent. The intended-action select uses the platform-native popup and explicit action values. No authored select or date input is needed. Native confirmation dialogs are prohibited. App-owned Base UI dialogs preserve focus and Escape behavior. Motion only communicates genuine loading; reduced-motion removes animation and transitions.

## Do's and Don'ts

- Lead with the action being considered and link findings to evidence.
- Keep risk separate from completeness and always show missing checks.
- Label synthetic examples before their first result; never portray a fixture as live collection.
- State source, observed time and inferred versus observed classification.
- Preserve original offer text after a failed submission. Never put private drafts in local storage.
- Never present a probability, guaranteed safety, fake chain transaction or fabricated live status.
- Use clear button verbs, visible labels and keyboard focus on every action.
