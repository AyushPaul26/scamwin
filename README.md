# Scamwin

**AI Powered Web Threat Detection and Digital Trust Intelligence**

Scamwin helps people understand the risk behind an online offer before they send money or share information. It connects **what the offer promises**, **what the person intends to do**, and **what the destination actually requests**. AI explains the offer, cybersecurity checks gather evidence, and reviewed Web3 warnings make shared intelligence independently verifiable.

[Live website](https://scamwin.vercel.app/) · [Project write-up](docs/submission/project-writeup.md) · [Sample walkthrough](https://scamwin.vercel.app/demo) · [Verified testnet transaction](https://sepolia.basescan.org/tx/0xf37ee847ba82fcef4459bc9a6f12fcb224a7e5f5b5523e38501a30d035448890)

## The problem we solve

A scam can look convincing, use HTTPS, and make a familiar promise. The danger often becomes clear when the website asks someone to do something that conflicts with that promise. People need an understandable explanation of the action, supported by technical observations and shared warning history.

Scamwin addresses the **AI-Powered Web Threat Detection & Digital Trust Intelligence** challenge by bringing AI analysis, website security checks, certificate validation and collaborative threat intelligence into one investigation.

## Our distinctive idea

**Assess the action in the context of the user's intent.** A refund should help someone receive money. If the observed payment checkpoint instead requests an outgoing payment, that conflict matters even when the page has valid HTTPS.

Our live demonstration makes this visible:

| What is promised | What the user intends | What the page requests | Observed result |
| --- | --- | --- | --- |
| A refund of ₹2,499 | Receive money | A ₹499 processing-fee payment | High risk with 3 cited findings |

This is a clearly labelled fictional training scenario. The investigation used the deployed application, real remote browser collection, an actual screenshot and TLS validation.

Three design choices make the product distinctive:

- **Connect the promise to the requested action.** AI interprets the offer and compares it with observed page content. Deterministic rules evaluate structured payment evidence against the user's stated intent.
- **Explain the evidence behind the decision.** Findings link to saved observations. The interface distinguishes an observation from an inference and shows which checks contributed to the assessment. Certificate validity and scam risk are presented separately.
- **Keep private investigation separate from accountable sharing.** Exact indicator matches connect a user's own cases. Sharing requires consent, redaction and reviewer approval before a dedicated publisher records an expiring assertion on Base Sepolia.

## How AI cybersecurity and Web3 work together

| Domain | What Scamwin does | Why it matters |
| --- | --- | --- |
| **Artificial Intelligence** | Cloudflare Workers AI interprets messages and screenshots, extracts the promise and requested actions, compares observed page quotes, and answers questions using saved evidence. | Explains the meaning of an offer in plain English. |
| **Cybersecurity** | URL and hostname checks, browser observations on authorized sites, structured payment-link parsing, form destinations, sensitive-field detection, security headers, mixed-content references and DNS-pinned TLS validation. | Provides technical observations to support the decision. |
| **Web3** | Consent and review lead to an exact-hostname assertion in a publicly readable Base Sepolia registry. Records identify the publisher, revision, expiry and retraction state; an independent RPC reader can verify them. | Makes the origin and lifecycle of shared warnings verifiable. |

AI interpretation, technical observations and publisher assertions remain distinct sources. The final risk classification follows code-level evidence rules. Blockchain records establish who issued an assertion and its status; the evidence and review explain the assertion itself.

## What users can do

1. Sign in and submit a message, email text, screenshot or one selected public URL.
2. Describe the promised benefit and the action they are considering.
3. Start a private saved investigation and follow its progress.
4. Read the assessment, source-linked findings, screenshots and recommended next steps.
5. Ask follow-up questions grounded in that check's saved evidence.
6. Search history, inspect related cases, recheck, cancel or delete a check.
7. Preview a redacted warning and explicitly consent to reviewer access and public sharing.
8. A reviewer examines the evidence and approves, rejects or requests more information. Approved warnings enter the separate online publishing service.

Ordinary users can use the application without setting up a crypto wallet.

## Private threat correlation

Scamwin links private cases using exact matches for selected hostnames, observed payment recipients and form endpoints. Owner-scoped HMAC fingerprints keep those relationships tied to the correct account. Each relationship explains the matching indicator, while public collaboration happens through the separate reviewed-warning workflow.

## Working live evidence

The following flow was verified on **9 November 2026**:

- Auth0 sign-in, an owner-controlled investigation and evidence saved in Neon.
- Cloudflare offer analysis, Browserless page collection, a real capture and TLS validation.
- The controlled refund check produced **13 observations and 3 findings**, with a high-risk result.
- The user consented to sharing a redacted warning and approved it through the reviewer workspace.
- The isolated online publisher submitted the warning to Base Sepolia. An independent RPC reader confirmed an active assertion at epoch 1, revision 1, with a seven-day expiry. The application verified the publication against the chain.

| Public proof | Link |
| --- | --- |
| Live application | [scamwin.vercel.app](https://scamwin.vercel.app/) |
| Controlled refund page | [Open the training fixture](https://scamwin.vercel.app/lab/refund-checkpoint) |
| Shared warnings | [Open the warning feed](https://scamwin.vercel.app/warnings) |
| Registry contract | [Base Sepolia contract](https://sepolia.basescan.org/address/0xb35fd72ae7a546ba4bae505019c437845532e3f0) |
| Published warning | [Successful testnet transaction](https://sepolia.basescan.org/tx/0xf37ee847ba82fcef4459bc9a6f12fcb224a7e5f5b5523e38501a30d035448890) |
| Independent verification | [RPC reader and contract documentation](web3/README.md) |

**130 Scamwin tests and 11 contract tests passed** during this verification. Main-site TypeScript, contract TypeScript, standalone publisher build and emitted JavaScript runtime checks also passed. Both Vercel applications were deployed successfully.

## Architecture and technology

```text
User input and intended action
          |
          v
Next.js website on Vercel + Auth0
          |
          +--> Neon private checks, evidence and job outbox
          |
          +--> Vercel background investigation
                 +--> Cloudflare Workers AI
                 +--> Browserless observations on authorized sites
                 +--> Public DNS and TLS validation
                 +--> Evidence rules and private indicator matching

Explicit consent --> Reviewer approval --> Separate Vercel publisher
                                                |
                                                v
                                      Base Sepolia registry
                                                |
                                                v
                                      Independent RPC reading
```

| Component | Technology |
| --- | --- |
| Web application | Next.js 16, React 19, TypeScript and Node.js 24 |
| Authentication | Auth0 with server-verified ownership and reviewer roles |
| Data and evidence | Neon PostgreSQL with Drizzle schema management |
| AI interpretation | Cloudflare Workers AI Scout model |
| Remote observation | Browserless with Playwright CDP and fresh browser contexts |
| Online investigations | Next.js `after()` on Vercel Fluid Compute |
| Publishing service | A separate native Node.js Vercel project |
| Registry | Solidity on Base Sepolia, with viem integration |

The demonstrated deployment uses Free or Hobby services and faucet-provided test ETH. Investigations and publishing run online, so a laptop does not need to stay on.

## Try the refund demonstration

Open [New check](https://scamwin.vercel.app/check), sign in, and enter:

| Field | Value |
| --- | --- |
| Offer link | `https://scamwin.vercel.app/lab/refund-checkpoint` |
| Message | `Your refund of ₹2,499 is ready. Receiving it is free.` |
| Promised benefit | `A refund of ₹2,499` |
| Intended action | `Receive money` |

Start the check, inspect the payment evidence and screenshot, and ask why the requested action is risky. The [read-only sample walkthrough](https://scamwin.vercel.app/demo) is available separately and labels its sample data.

## Run locally

Use Node.js 24 and npm:

```bash
git clone https://github.com/AyushPaul26/scamwin.git
cd scamwin
npm ci
```

Copy `scamwin.env.example` to an ignored `.env.local` file and follow the [service setup walkthrough](docs/scamwin-live-setup.md). Use a dedicated demo database, apply its schema with `npm run db:push`, then run:

```bash
npm run dev
```

The website opens at `http://localhost:3000`. Real service settings belong in private environment files and provider settings. The publisher has its own [package and deployment instructions](publisher/README.md); its signing key belongs only in that separate project.

Relevant checks:

```bash
npm run test:scamwin
npm --prefix web3 test
npm --prefix publisher ci
npm --prefix publisher run build
npm --prefix publisher run check:runtime
```

## Project structure

| Location | Purpose |
| --- | --- |
| `app/(scamwin)/` and `components/scamwin/` | Main investigation experience |
| `lib/scamwin/` | Intake, AI, collection, evidence rules, storage, correlation and publication logic |
| `app/lab/` | Clearly labelled controlled demonstration pages |
| `publisher/` | Isolated online publisher |
| `web3/` | Registry contract, tests, deployment helpers and independent reader |
| `tests/scamwin-*` | Application and integration checks |
| `docs/submission/` | Project write-up and short submission description |

## Foundation and documentation

Scamwin builds on the [OpenMods foundation](https://github.com/ANAMASGARD/openmods). Our submission adds the dedicated threat-analysis intake, intent comparison, saved evidence, private indicator matching, review workflow and testnet threat registry. The previous README is preserved in [the project archive](docs/archive/readme-before-submission-2026-11-09.md).

- [Project write-up](docs/submission/project-writeup.md)
- [Live setup and verification notes](docs/scamwin-live-setup.md)
- [Configuration guide](docs/scamwin-setup-guide.md)
- [Registry and independent reader](web3/README.md)
