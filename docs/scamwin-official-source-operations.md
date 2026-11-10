# Official company and public offer sources

The Scamwin repository maintainers own the reviewed catalogue in `lib/scamwin/official-source-catalog.ts`. It authorizes specific public sources for company and exact-listing facts. A published listing does not authenticate its sender, prove a private offer or clear payment, credential or other observed action risks. This feature does not add resume analysis, job search, job matching or automatic applications.

## Configuration and release

Use the existing `scamwin.env.example` as the variable-name template. The implementation plan's `.env.example` reference means this existing template; no second template is needed.

`SCAMWIN_OFFICIAL_VERIFICATION_ENABLED` is a main-app Config value. Only the literal value `true` enables the new collection and official navigation; absent, `false` and all other values disable them. The checked-in default is `false`. After local verification and source review, enable `SCAMWIN_OFFICIAL_VERIFICATION_ENABLED=true` in main Vercel **Production only** as part of a separately authorized push/deployment and configuration change. Keep Preview tests on fictional injected fixtures unless separately configured. The isolated publisher does not receive this variable or the catalogue/reader modules.

No new API key, service account, model call or paid fallback is required. Existing Auth0, Neon, Cloudflare and Browserless settings stay in their current projects. The native public HTTPS reader uses public GET resources; it does not use the Greenhouse application POST API. The existing Browserless capability flags and `SCAMWIN_APPROVED_ORIGINS` stay unchanged. Reviewed public sources use a separate catalogue scope; adding a company never grants the browser permission to visit it.

`npm run check:scamwin` and the operations readiness display check configuration and current catalogue coverage only. They make no official-source fetch and do not establish successful source access, an exact listing match or sender authenticity. Enabling the flag with no current catalogue entries leaves official coverage limited/unavailable; the existing investigation workflow remains available.

## Reviewed catalogue, version 2026-11-10.1

The entries below were manually reviewed at **2026-11-09 20:20 UTC**, which is **10 November 2026 in Asia/Calcutta**. Their review window ends at **2026-12-09 20:20 UTC** unless renewed or revoked sooner. These are authority-review dates, separate from a check's actual fetch time. They do not promise that a particular page or posting will remain accessible.

| Company ID | Source IDs | Dated first-party authority and allowed route |
| --- | --- | --- |
| `figma` | `figma-careers`, `figma-greenhouse` | [Figma careers](https://www.figma.com/careers/) is the reviewed first-party entry and delegation evidence. It directly linked public `boards.greenhouse.io/figma/jobs/…` posts, which redirected to the same `figma` board on `job-boards.greenhouse.io`. The reviewed public listing pattern is `https://job-boards.greenhouse.io/figma/jobs/{postId}`; the only listing read pattern is the code-owned `https://boards-api.greenhouse.io/v1/boards/figma/jobs/{postId}`. |
| `tcs` | `tcs-careers` | [Tata Consultancy Services careers](https://www.tcs.com/careers), first-party entry only. `TCS` is a reviewed alias. No delegated board or exact-listing adapter is authorized. |
| `infosys` | `infosys-careers`, `infosys-recruitment-help` | [Infosys careers](https://www.infosys.com/careers/) and the first-party [recruitment fraud help page](https://www.infosys.com/careers/apply/recruitment-fraud-alert.html). These are entry/help routes, with no delegated board or exact-listing adapter. |
| `cloudflare` | `cloudflare-careers` | [Cloudflare careers jobs](https://www.cloudflare.com/careers/jobs/), first-party entry only. No delegated board or exact-listing adapter is authorized. |

A known ATS hostname does not establish a company's relationship with a tenant. Figma's review authorizes the exact `figma` tenant, not every Greenhouse board. Entry-only companies can provide a reviewed route for manual verification; their presence does not imply support for exact public post checks.

## Review, renew or revoke a source

1. A maintainer opens an independently established first-party company page and confirms the precise company name, aliases and literal hostnames. Record its public evidence URL and the actual UTC review time. Do not establish authority from a submitted offer, model suggestion, search snippet or the ATS hostname alone.
2. For delegated hiring, follow a link from that first-party page and verify the exact ATS tenant and canonical public listing pattern. Record the first-party delegation URL, board token, entry URL and listing template. For static JobPosting support, review the first-party relationship evidence, exact listing origin and segment-bounded path prefix. Unsupported/dynamic sources remain entry-only or unavailable; do not add a browser/search fallback.
3. Check source definitions against the catalogue schema and separate read/navigation URL policy. Reject credentials, arbitrary queries, fragments, escaped separators, guessed subdomains and cross-company tenants. Public IDs must be actual published post IDs, not internal requisition or application IDs.
4. Add or renew the entry in code, update the catalogue version, and document the evidence/date and access limitations here. Run the focused catalogue, reader, offer, verification, view, navigation and acceptance tests. The new entry is not permission to change production configuration or deploy.
5. Re-review before **30 days** from `reviewedAt`. A future-dated review is invalid; at 30 days authority expires. Remove or correct revoked relationships immediately and increment the catalogue version. Saved next-step candidates are checked against the current version, source definition and review age on click, so old permissions are not retained after a catalogue change.

Sources must allow unauthenticated public HTTPS access. Honor access restrictions; blocked, encoded, dynamic-only, partial, malformed, oversized or inaccessible pages yield unavailable coverage. Do not bypass login/CAPTCHA, accept cookies, run scripts or send user content to a source. An unknown/ambiguous company gets manual verification instructions with no guessed official link. Multiple reviewed boards plus a numeric post ID require the exact public listing link in the application rather than speculative reads.

## Limits, freshness and expected source use

The worker shares one official budget per check: at most **2 documents**, **4 HTTP requests including redirects**, **1 redirect per document**, **20 seconds** for the stage, **8 seconds per request including DNS/body**, **256 KiB per body** and **512 KiB per stage**. There are no retries, pagination or shared cache. The existing 240-second pipeline must have at least 55 seconds left before collection starts, preserving at least 35 seconds for final comparison and assessment. HTTPS requests retain normal TLS verification, reject non-public/mixed DNS answers, pin the public address, and revalidate every redirect against the exact catalogue scope. Identity encoding is requested; compressed responses are unavailable in this release.

| Input and current coverage | Expected official reads per check |
| --- | --- |
| Figma recruitment plus a scoped exact public post | One single-post API document and one reviewed careers entry, within the shared budget. |
| Reviewed recruitment company without a usable exact public reference | At most one reviewed careers entry; no title search or guessed match. |
| TCS, Infosys or Cloudflare recruitment with only a numeric ID | At most one reviewed careers entry; no supported exact-post lookup. |
| Unknown, ambiguous or expired company | Zero official reads; manual verification or expired-review coverage. |
| Insufficient pipeline time or cancelled investigation | Collection is skipped or stopped; no new confirmation is inferred. |

Listing facts are current for **6 hours from the actual fetch time**, additionally bounded by any explicit listing deadline, catalogue review expiry and private check expiry. Older observations remain historical with their original timestamps. A reviewed entry can be offered without a successful live fetch and is labeled accordingly. Refreshing a saved result or using follow-up chat does not fetch sources again. Public-source observations remain private, owner/run-bound and bounded; raw source bodies are not persisted. Existing private-check and image retention continue unchanged, with no schema or database push.

Official next steps are explicit same-tab links through an authenticated server gate. The gate checks ownership, completed/partial current run, feature flag, saved reference, current catalogue version, exact reconstructed destination and expiry without refetching. It returns a validated 303 with `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`; private input and session data are not forwarded. An invalid saved step returns to the owned check with an unavailable notice, with no substituted destination.

## Opt-in public-source acceptance CLI

From the repository root with Node 24, explicitly run:

```powershell
node --import tsx scripts/check-scamwin-official-sources.ts --company figma --post 6222861004
```

`6222861004` was a public post linked during the authority review; it is an example, not a guarantee that the listing remains open or accessible. Obtain a current public post ID directly from the reviewed Figma careers route when needed. The CLI accepts one catalogue company ID and one numeric public post ID. It refuses unknown/expired companies, malformed/private references, arbitrary URLs, missing boards and multiple eligible boards **before a reader call**. Entry-only companies are refused by this exact-post CLI even though the application can show their reviewed careers route.

The CLI makes at most **one source check**, using the same native HTTPS reader and normal shared budget. It reads no environment file or credentials, starts no model/browser, connects to no database and makes no application POST. It is independent of the production feature flag. Importing the module does not execute it; tests inject a fictional catalogue, reader and clock.

Output is one JSON report containing only controlled status categories, trusted public company/source IDs and catalogue version, check/fetch timestamps, offer status and document/request/byte/time budget usage. It does not print the submitted reference, response body, raw exceptions, environment values or private inputs. `status: "ok"` describes a complete source read; `offerStatus` describes the exact public-reference interpretation. Exit 0 requires an exact public-reference match; refusal, absent/closed/malformed postings, blocked access and unavailable checks exit 1. A 404 means only `not_found_in_checked_source`, and an unavailable result establishes neither a match nor fraud.

Record actual CLI timestamps, status and usage in the release handoff. This check does not write application evidence, so application evidence IDs must come from the separately authorized owned-account acceptance check.

## Release acceptance and rollback

Before an authorized release, record the main/publisher build results, lint, Scamwin regression tests, official UI desktop/mobile/keyboard checks, catalogue version/review dates, expected sources and opt-in CLI result. Tests use clearly fictional catalogues and clocks; do not present fixtures as public-source observations. No database migration or push is required. Commit, push, deployment and production variable changes require their own user authorization.

After an authorized deployment, check an owned account with an exact public listing, an unknown organization, an unavailable source and a controlled suspicious offer. Verify separate company/destination/offer coverage, original fetch times and evidence IDs, retained action risk for copied listings with fees, explicit gated navigation, and zero extra browser/model requests or private data in outgoing URLs/logs. This is still required even when configuration and a standalone public GET succeed. Official-source evidence alone cannot authorize a public warning, and no automatic sharing, Web3 review approval or transaction is introduced; the existing warning review workflow remains in place.

For rollout failures, set main Production `SCAMWIN_OFFICIAL_VERIFICATION_ENABLED=false` through the authorized configuration process. This restores the existing hostname-reference investigation path and disables new official collection/navigation. Saved official observations remain historical. Revoke an incorrect catalogue relationship and increment its version before a later authorized release; do not broaden scopes, add paid fallbacks or weaken browser restrictions to make acceptance pass.
