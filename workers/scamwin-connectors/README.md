# Scamwin connector scheduler

Tiny Cloudflare Workers Free Cron wakeup. It signs and awaits two Vercel calls;
Vercel owns provider access, parsing, connector storage and investigations. The
Worker has no mailbox credentials, database binding, AI binding or paid fallback.
No dependencies or Node compatibility shim are required by its source.

Deployment requires separate explicit authorization for this Worker. This source
has not been deployed or tested against live cloud services. Use the Workers Free
plan; the config creates no storage, queues, paid services or public HTTP route.
Wrangler is not added to the root project by this task.

## Configuration and cadence

| Input | Destination / meaning |
| --- | --- |
| `SCAMWIN_CONNECTOR_SCHEDULER_ENABLED` | Worker ordinary variable; only exact `true` enables requests. Checked-in value is `false`. |
| `SCAMWIN_CONNECTOR_APP_ORIGIN` | Worker ordinary variable; approved HTTPS application origin. Checked-in production default is `https://scamwin.vercel.app`. |
| `SCAMWIN_CONNECTOR_DISPATCH_SECRET` | Worker secret and matching Vercel server secret, at least 32 Unicode characters. Never put its value in Wrangler or a report. |

Do not copy provider credentials, publisher keys or either database URL into this
Worker. The separate Vercel connector feature/provider/automatic gates remain off
until their own runtime and acceptance checks are complete. Enabling this Worker
alone does not establish those capabilities.

Cron is `*/15 * * * *` in UTC (96 invocations/day, at most 192 HTTP calls/day).
An operator can change it to `*/30 * * * *` (48 invocations/day, at most 96 calls)
when measured free compute/transfer headroom requires the 30-minute fallback.
Future independent Cron events provide recovery; each event attempts each stage
only once, including on 429 or 503. There are no automatic retries or sleeps.
Disable the gate to stop new dispatches; in-flight server work remains governed
by Vercel's gates, leases and cancellation rules. This is periodic, bounded
processing with no instant-delivery or unlimited-scanning promise.

The configured origin must be an exact, canonical HTTPS DNS origin, optionally
ending in `/`. Paths, userinfo, query/hash (even empty delimiters), whitespace,
explicit ports, IP literals, single-label and local/reserved host suffixes are
rejected. Use an operator-reviewed public app hostname; this validation does not
perform DNS resolution or replace operator control of the configured destination.
Only the two paths below can be fetched, with `redirect: 'error'`.

## Vercel wire contract

For each stage, POST to the configured origin plus the fixed path:

| Order | Action | Path | Whole request + response deadline |
| --- | --- | --- | --- |
| 1 | `tick` | `/api/scamwin/connectors/tick` | 60,000 ms, allowing 5s transport padding beyond the 55s handler |
| 2 | `drain` | `/api/scamwin/connectors/drain` | 305,000 ms, allowing 5s padding beyond the 300s handler |

The timer includes signing, response headers and all streamed body reads. The
two stages together have at most 365s of timed transport work. Both responses are
awaited, including their bounded bodies; drain is attempted after any tick
failure. Each body is consumed and discarded up to 8,192 bytes (Content-Length
and actual streamed bytes are checked). Timeout/oversize aborts the request and
cancels the stream. A stalled cancellation handshake cannot extend the deadline.
The Worker never parses or logs response content.

Exact serialized JSON field order is:

```json
{"version":1,"action":"tick","deliveryId":"<fresh crypto.randomUUID()>"}
```

Drain uses `"action":"drain"` and a separate fresh UUID. Headers:
`Content-Type: application/json`, `Cache-Control: no-store`, and
`X-Scamwin-Dispatch-Signature: <timestamp>.<mac>`.

Derive the signing key as SHA-256 of the UTF-8 dispatch secret (32 raw bytes).
With WebCrypto HMAC-SHA256, sign the UTF-8 transcript consisting of decimal
13-digit timestamp milliseconds, one newline, then the **exact JSON body bytes**.
The MAC is lowercase 64-character hex. Sign each stage at its own call time,
rather than reusing the scheduled event timestamp. This interoperates with
`lib/scamwin/connectors/crypto.ts` `verifyDispatch` when Vercel derives the same
SHA-256-secret key. Do not base64-decode the secret or sign parsed/reserialized
request JSON on the server.

The Vercel consumer must verify the signature, five-minute age and 30-second
future-skew window, expected version/action, strict UUID delivery identity and
durably consume `deliveryId` for replay protection. The Worker has no replay
store. Tick must sync only bounded due work; drain must admit at most one
investigation after durable backlog and budgets permit it. Those handlers,
leases, durable idempotency, budget recovery and any after() nudge are Task6B.

The exported `runConnectorSchedule(env, overrides?)` supports injected
fetch/clock/random/timer boundaries for local tests. The default `scheduled`
handler awaits it directly. Results contain only `disabled`,
`invalid_configuration`, or `completed` with compact `tick`/`drain` status,
sanitized reason and optional HTTP status. `completed` means both dispatch
attempts finished, not that mail or an investigation succeeded. No response
body, secret, provider content or exception text is returned or logged.

## Local verification

From the repository root:

```powershell
node --import tsx --test tests/scamwin-connector-scheduler.test.ts
node node_modules/eslint/bin/eslint.js workers/scamwin-connectors/src/index.ts tests/scamwin-connector-scheduler.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM workers/scamwin-connectors/src/index.ts tests/scamwin-connector-scheduler.test.ts
```

Primary platform references (reviewed 2026-11-10):
[Cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/),
[Worker limits](https://developers.cloudflare.com/workers/platform/limits/).
Workers Free currently allows 10ms CPU per Cron and 15 minutes wall time; this
Worker spends CPU only on validation, signing and bounded transport. Network
waiting does not count as CPU time. Before enabling any
pilot, verify actual platform allowances and measured usage across Workers,
Vercel and the separate connector Neon project. No live pilot, laptop-off
operation, killed-worker recovery or provider acceptance is proven by local tests.
