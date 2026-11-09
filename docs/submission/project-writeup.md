# Scamwin project write up

AI Powered Web Threat Detection and Digital Trust Intelligence

Live website: https://scamwin.vercel.app/

GitHub repository: https://github.com/AyushPaul26/scamwin

## Project overview

Scamwin helps people understand the risk behind an online offer before they send money or share information. It compares what the offer promises, what the person intends to do, and what the destination actually requests. We bring AI interpretation, technical security observations and reviewed Web3 warnings into one private investigation.

The central idea is simple. A person expecting a refund should be receiving money. If the observed payment checkpoint asks them to send money first, that contradiction is important even when the website uses valid HTTPS. Scamwin makes the connection visible and explains the evidence behind it.

## The problem we address

Phishing pages, fake job offers, refund messages and impersonated services can look convincing. People may focus on a familiar logo or an HTTPS padlock while missing what the page asks them to do. The challenge calls for an accessible platform that combines AI, cybersecurity and Web3 to explain suspicious indicators, assess web trust and share useful threat intelligence.

We focus on the decision a person is about to make. The user can submit a URL, message, email text or screenshot, describe the promised benefit, and choose an intended action such as receiving money, paying or sharing information. The result explains the risk in plain English and connects findings to saved evidence.

## What makes Scamwin distinctive

Our main innovation is adding the user's intent to the investigation. Scamwin connects the promise to the observed request and destination. In our controlled refund demonstration, the offer promises ₹2,499, the user selects Receive money, and the page contains a ₹499 outgoing-payment request. The deployed application produced a high-risk result with three cited findings.

The evidence trail is central to the product. Users can inspect observations, screenshots, timestamps and the basis for each finding. The interface separates direct observations from inferences and presents certificate validity separately from scam risk. Follow-up questions use the same saved evidence, keeping the explanation connected to the investigation.

We also separate private learning from public collaboration. Exact matches for selected hostnames, observed payment recipients and form endpoints help a user connect their own related cases. Owner-scoped cryptographic fingerprints protect these private relationships. Public sharing follows a different path: consent, redaction, review and publication through an isolated signing service.

## How the three required technologies are integrated

**Artificial Intelligence.** Cloudflare Workers AI interprets message and screenshot content, extracts the promise and requested actions, and compares observed page quotes with the offer. It turns technical observations into understandable explanations. Structured validation checks the model's output, while code-level evidence rules determine the final risk classification.

**Cybersecurity.** Scamwin normalizes URLs and inspects hostname and URL signals. Browser observations on authorized sites capture page text, structured payment links, form destinations, sensitive fields, security headers and mixed-content references. A separate DNS-pinned TLS handshake validates the selected hostname and records certificate information. Fresh browser contexts and read-only request controls support safe observation.

**Web3.** A user explicitly consents before selected evidence reaches a reviewer. After approval, a separate online publisher records an exact-hostname assertion on Base Sepolia. The registry tracks the publisher, revision, expiry and retraction state. An independent RPC reader verifies the on-chain record. This makes the origin and lifecycle of a shared warning transparent and verifiable, while evidence and review explain its meaning.

## User journey

The user signs in, submits the offer, and states the action they are considering. Scamwin saves a private check and shows investigation progress. The result brings together the promise, action, destination, findings and supporting sources. Users can ask questions, search their history, inspect related cases, recheck, cancel or delete a check.

If the user chooses to help others, they preview a redacted warning, select evidence and provide consent. A reviewer examines the submission and approves, rejects or requests more information. Approved warnings enter the isolated publishing service and become visible in the shared-warning workflow. Everyday users can use Scamwin without creating a crypto wallet.

## Working prototype and live verification

On 9 November 2026, we verified the hosted flow with Auth0 sign-in, private Neon storage, Cloudflare analysis, an actual Browserless capture and TLS validation. The clearly labelled fictional refund scenario produced 13 observations and three findings. This was a real online investigation of a controlled training page.

We then completed explicit sharing consent and operator review in the application. The isolated online publisher submitted a warning to Base Sepolia. An independent RPC reader confirmed an active assertion at epoch 1 and revision 1, with a seven-day expiry. The application verified the publication against the chain.

Published testnet transaction:
https://sepolia.basescan.org/tx/0xf37ee847ba82fcef4459bc9a6f12fcb224a7e5f5b5523e38501a30d035448890

Registry contract:
https://sepolia.basescan.org/address/0xb35fd72ae7a546ba4bae505019c437845532e3f0

During this verification, 130 Scamwin tests and 11 contract tests passed. TypeScript checks, the separate publisher build and an emitted JavaScript runtime check also passed. These checks cover implementation behavior and the tested flow.

## Architecture and implementation

The web application uses Next.js, React and TypeScript on Vercel. Auth0 verifies sign-in and ownership. Neon PostgreSQL stores private checks, observations, screenshots, jobs and review records. Vercel background execution coordinates the investigation, Cloudflare Workers AI interprets content, and Browserless provides remote page observation.

A second Vercel project handles publication. It authenticates server requests, reads a database-approved operation and applies the registry's publication checks. Its signing key stays separate from the main website and investigation environment. Solidity and viem connect the application to Base Sepolia. The demonstrated deployment uses free-tier services and free testnet funds, and runs online without an always-on laptop.

The hardest engineering problem was keeping interpretation, evidence and publication consistent across separate services. We addressed it with validated AI responses, evidence references, saved job state, generation and revision checks, consent records, reviewer approval and a separate publisher. This gives the explanation and the shared warning a traceable basis.

Scamwin builds on the OpenMods foundation. We added the dedicated investigation workflow, promise and action comparison, evidence handling, private case matching, reviewed sharing and testnet threat registry for this challenge.

## Review the project

Start with the live website and the controlled refund page at https://scamwin.vercel.app/lab/refund-checkpoint. The repository README explains the product, demonstration, architecture and setup. The public transaction and independent reader provide a separate way to inspect the Web3 result.
