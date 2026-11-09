# Scamwin UX contract

Visual intent and runtime-token mapping are maintained in [DESIGN.md](DESIGN.md). Product policy comes from [the accepted product design](docs/superpowers/specs/2026-11-08-scamwin-web-app-design.md), with provider, quota, artifact and polling decisions superseded by [the zero-spend amendment](docs/superpowers/plans/2026-11-08-scamwin-zero-cost-vercel-amendment.md). Server ownership and validated domain contracts remain authoritative.

## Business sources and UI consequences

| Concern | Authoritative source | UI consequence |
| --- | --- | --- |
| Permission model | Product design §§6, 12; Auth0 session; bootstrap role | Authenticated private checks, reviewer queue, admin operations; no client-supplied owner |
| Data lifecycle | Amendment §6; product design §10 | 30-day private checks, 7-day images, explicit private-check delete dialog; public warnings remain separate |
| Spend | Amendment §§1–6 | No wallet or paid fallback; explicit quota/unavailable states |
| Privacy and publication | Product design §§7, 10–11; amendment §4 | Private drafts, external processing explanation, selected reviewer evidence and redacted public payload with explicit consent |
| Result integrity | Product design §§7–9 | Risk separate from coverage, evidence source/time, no probability or safety guarantee |
| Registry status | Amendment §7 | Test network label, last freshness observation, distinguish queued/submitted/included/safe/finalized |

## Canonical UI map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | RHF + Controller, existing Field/Input/Textarea, `lib/scamwin/input.ts` | Shared schema and server validation | Intake, follow-up, review, redacted sharing | Invalid input, preservation, duplicate prevention |
| Dialog | Existing `components/ui/dialog.tsx`, shared Confirm | Domain privacy/deletion rules | Delete, unsaved draft, warning consent, retraction | Focus, Escape, narrow viewport |
| Search | Shared SearchBox, history stale-result sequencing | Private history policy | Local public filter; 300ms private server search | Clear, IME, stale result |
| Scrollbar | `app/scamwin.css` | DESIGN.md token mapping | Document and dialog overflow | Computed styles and narrow overflow |
| Feedback / Toast | Shared Notice, persistent inline FieldError, explicit saved sharing state | Domain action result | Information, error, unavailable | Live role and actionable text; no transient critical feedback |
| CRUD | `app/scamwin/actions.ts`, history/detail components | Server action contracts | Create, recheck, delete, cancel, submit/review/retract warning | Confirmed destination, failure recovery |
| Select/Listbox | Native intended-action select in intake; platform-owned popup geometry is accepted | Explicit action token contract | Native select, filter buttons and native checkbox groups | Keyboard |
| Date | Not applicable: read-only Intl formatting | Server UTC timestamps, viewer locale | en-IN date and local timezone name | Valid date output |
| Table Selection | Not applicable: no bulk list selection | Explicit individual evidence consent | Native evidence checkboxes | Label, checked state |

## Flow ledger

| Operation | Pending / success destination | Failure / recovery | Source |
| --- | --- | --- | --- |
| Create private check | Disable edits; saved check detail | Inline failure, values retained, stable idempotency key for retry | Product §6; immutable inputs §7 |
| Cancel check | Cancellation requested, stay on detail; poll authoritative state | Keep evidence; retry action | Product lifecycle §7 |
| Recheck | New saved check detail; preserve original | Existing check remains readable | Product §§6, 14 |
| Delete private check | App-owned confirmation; return to private list | Keep dialog open; show sanitized failure | Product §10 |
| Follow-up | Stay on check; append server-confirmed message | Preserve question, retry same operation key | Product §7 |
| Submit warning | Explicit selected-evidence consent + exact redacted payload; sent-for-review state | Preserve fields and consent; retry | Product §11 |
| Review / retract | Require reason; refresh queue or warning after success | Preserve reason; explain stale revision/reload | Product §11 |

## State and dataset contracts

Private check reads poll every 2 seconds while active and 10 seconds when hidden/reconnecting. Polling stops at terminal states. Lower revisions cannot replace newer data. Failed reads retain the last received result with an interrupted-updates notice; retries are bounded and a reconnect button remains. Quota pause is a separate availability notice, never an indefinite ordinary queue.

Private history is newest first with server pagination of 20 records. Search is transient sensitive state kept in component memory and authenticated action bodies. Filters reset page; deletion clamps out-of-range pages. Public warning search is local over the bounded server projection and paginates 20 records. Warning state filters are explicit buttons.

All lists distinguish loading, empty, no-results and read errors. Access gates distinguish missing configuration, signed out, forbidden role and failed bootstrap; they do not manufacture a signed-in user or substitute fixtures for production records. `/demo` alone presents synthetic, read-only fixtures and never invokes mutations.

## Input, async and recovery

All product forms use `noValidate`, text errors, explicit label associations, first-invalid focus when RHF validates and disabled duplicate submissions. Source images use the existing bounded image preparation, at most four 10MB source images into still JPEGs of at most 160KiB each. No original file is uploaded. Textareas have adequate natural height and no user resize.

Sensitive intake drafts remain in memory. An in-app navigation dialog guards unsaved loss; the browser unload lifecycle guards tab closure. Session-expiry action errors preserve values and provide reauthentication in another tab. Private queries are never persisted to browser storage, URL parameters or analytics.

## Accessibility and content

Use semantic links for navigation, buttons for actions, real label associations, a skip link, non-color states and visible blue focus. Base UI owns modal behavior. Product routes use document scrolling down to 320px, respect reduced motion and keep all actions reachable. Dates use `Intl.DateTimeFormat('en-IN')` including timezone. English is the current UI locale; private offer content is not translated or normalized by the frontend. No safety verdict derives only from HTTPS or absence of a warning.

The intended-action select records an explicit user choice (`receive_money`, `pay_money`, `share_information`, `read_information`, or `other`). This choice is distinct from model-inferred requested actions. The browser owns popup geometry; a native select preserves its platform keyboard and touch behavior.

## Operational controls and review clarification

The live viewer is an authenticated, run-bound capability supplied by a separate no-store endpoint. It never starts an investigation. Preparation polls every second only while visible; a connected viewer refreshes status every 2 seconds, or 10 seconds when hidden. Requests do not overlap and stale runs cannot replace the current frame. Collapse retains the iframe; cancellation, expiry, session end and navigation remove it. Opening the panel never moves keyboard focus. The remote view is watch only, with provider input disabled and a restricted iframe. Captures open in the existing app-owned image dialog. Six-stage progress uses server-recorded start/end times and actual collection details. Risk rules, private history, follow-up and optional warning consent/review retain their existing contracts.

Admin pause controls read authoritative state from the admin-only operations endpoint. They separately pause new investigation starts and new warning signatures. Ongoing runs can finish; already signed transactions still reconcile; saved results and registry reads remain available. Buttons are reversible and need no extra confirmation. Both controls disable during a save. Success displays the returned state; failure preserves the last state and requires reload before another change.

Reviewers can request more information with a reason, without an approval checkbox. This creates a needs-information review state, not a publication. Owners see only their own submission status and reviewer reason under sharing. They can prepare a new packet through the existing preview flow, with fresh evidence selection and consent; prior packets stay immutable. Submission or approval status never establishes a published chain assertion.

The saved journey destination requires observed evidence: a selected payment recipient takes priority, followed by the final URL of an observed live page. A submitted URL alone is never presented as an observed destination. Limited coverage says “Destination not observed.”
