# Scamwin persistence integration review

Reviewed 8 November 2026 against the current `PostgresStore`, Drizzle Scamwin schema, publication relay, outbox dispatcher and independent contract artifact. This is a correctness/integration review, not a security audit or live Neon deployment test.

## Evidence and result

`node --import tsx --test tests/scamwin-postgres.test.mjs` passes **13 Node tests: twelve scenario groups plus their parent**, using PGlite **0.5.15**. The final run executed **487 actual PostgresStore SQL statements**, with **14 tables**, their primary/foreign keys, unique indexes and the partial active-owner index derived directly from the current Drizzle schema. Runtime was about **four seconds**, including startup/teardown. The external-request tripwire recorded **zero requests**; `finally` closes the in-memory database and restores the test hook.

Only the transport behind the store's TypeScript-private `sql` property is substituted. Tagged parameters, the store's SQL text, statement order, transaction boundaries, JSON operators, locking statements and database constraints execute in PostgreSQL. There is no production fallback to this adapter, and the test does not contact a localhost service or account database.

The scenario groups cover:

1. Deduplicated admissions, one check/run/outbox effect, owner filtering and active-check rejection.
2. Claim/revision fencing, immutable evidence, cross-owner denial, cancellation and terminal acknowledgment.
3. Artifact/message insert/read SQL, owner access and deletion.
4. Approval → publication lease → fee reservation → private signed-byte persistence → finality → reviewed chain retraction, including omission of raw bytes from public reads.
5. Deletion before the signing lease revokes publication; deletion after the lease preserves the signing boundary.
6. Filtered outbox leasing using native `text[]` parameters, attempt fencing, overdue-run cleanup and 30-day check expiration.
7. Never-published withdrawal becomes `local_only` and does not create a chain correction job.
8. Intake images remain separate from the check JSON; owner reads rehydrate allowed bytes; expired review evidence is hidden and purged, and expired unsigned publications leave reconciliation eligibility.
9. Deleted/canceled admissions remain counted against daily limits; server-side role grants and unauthorized grant rejection execute against SQL.
10. Exact fingerprint correlation joins only the same owner's live cases, preserves a 20-indicator cap atomically, deduplicates fingerprints, excludes deleted cases and stores no raw indicator value.
11. Operational pauses require admin authority; reviewer authority alone cannot change them. Paused admissions reject new work while preserving an exact idempotent retry. Paused publication blocks unsigned publish/retract leases, while already signed reconciliation and outcome updates remain available. State and content-free audit records update together.
12. A reviewer request for more information preserves the private packet and revision, creates no public warning/publication/outbox effect, and is withdrawn with its evidence when the owner deletes the original check.

## Confirmed findings corrected during review

| Finding | Evidence | Current resolution |
| --- | --- | --- |
| Publication leasing and fee reservation failed prepared parameter inference. | PostgreSQL returned `42P18: could not determine data type of parameter $1` for both `jsonb_build_object('leaseToken',$1)` and `jsonb_build_object('reservedFeeWei',$1)`. Explicit `::text` versions passed. | Both store statements now cast these values to `text`; the complete signing/fee scenario passes. |
| Retraction of an unsigned warning left obsolete queue rows and attempted correction of an assertion that never existed. | Static tracing connected `retractWarning`'s new public revision with the old publication/outbox and relay lookup of the current revision. | Obsolete unsigned publications/outbox entries are revoked; a never-published withdrawal is `local_only`, without a new chain operation. SQL scenario passes. |
| Expired unsigned reviews could occupy the oldest reconciliation slots indefinitely. | The old pending query selected nonterminal rows independently of current revision, consent expiry and original-check eligibility. | Pending reads now select eligible current revisions, preserve existing signed transactions for reconciliation and prioritize signed records. The expired-review SQL scenario passes. |
| Consent hash omitted schema version and publication TTL. | The old payload included only hostname, summary, category and evidence IDs, despite the specification requiring version and expiry binding. | Consent payload now binds `schemaVersion: 1` and `ttlSeconds: 604800`. Chain expiry remains an actual chain-time fact, distinct from local review eligibility/expiry. |

No SQL syntax, missing-column, foreign-key or prepared-value type failure remained in the exercised paths after those corrections. The active-owner partial index, retained run admissions, explicit `ReadCommitted` transaction options, advisory lock before the protected statement, consent revision checks, signing lease token and reserved fee checks are consistent with the intended boundaries in this inspected version.

Operational state uses the existing registry-sync table, so the schema remains at 14 tables. The admin setter acquires the admission lock followed by the review lock, then authorizes and atomically upserts the state/audit in a new statement snapshot. Admission and unsigned signing-lease checks occur inside the corresponding protected transactions; no reverse acquisition of those two locks was found. This local pause fences **new leases**: a lease already granted before the pause may finish. The local all-signatures pause is distinct from the contract's issuance-only pause, which keeps on-chain retractions available.

## ABI agreement

The application's exported ABI was parsed and compared byte-for-byte as JSON with `web3/artifacts/contracts/ThreatRegistryV1.sol/ThreatRegistryV1.json`: **exact match, 24 functions and seven events**. The relay's publish/retract calldata is also decoded in its tests; its parameter order and integer widths match the compiled contract. The independent Hardhat suite passes **11 tests**, and the app normalization/direct-read/relay suite passes **13 tests**.

## Limits of this verification

PGlite supplies one exclusive connection. This run verifies legal SQL execution, real constraints, statement effects and store behavior; it does **not** prove interleavings across separate Neon sessions, advisory-lock wait snapshots across processes, provider HTTP serialization, network loss, deployment schema application or real Auth0 ownership. The source was also checked against PostgreSQL's documented [Read Committed snapshot/recheck rules](https://www.postgresql.org/docs/current/transaction-iso.html) and [data-modifying CTE visibility](https://www.postgresql.org/docs/current/queries-with.html). Neon-specific transport/connection testing still requires an explicitly configured disposable database.

No account/schema deployment or chain transaction occurred. Publisher keys belong only in the separate publisher Trigger project, outside Vercel and the ordinary analysis project. A receipt continues to mean inclusion until independent safe/finalized observations establish stronger finality. Outstanding signed transactions require reconciliation; local review rows are never accepted as current trusted chain warnings.
