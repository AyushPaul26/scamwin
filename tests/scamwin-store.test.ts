import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { MemoryStore, PostgresStore, ScamwinStoreError } from "../lib/scamwin/store";
import type { CheckInput, Observation } from "../lib/scamwin/contracts";

const input: CheckInput = { url: "https://example.org/", message: "An offer", promisedBenefit: "Refund", intendedAction: "Receive money", images: [] };
const makeStore = () => new MemoryStore({ now: () => new Date("2026-11-08T12:00:00.000Z"), initialRoles: [{ ownerId: "reviewer", role: "reviewer" }] });
async function addReviewEvidence(store: MemoryStore, c: { id: string; runId: string }) {
  await store.saveObservation("alice", { id: "review-evidence", checkId: c.id, runId: c.runId, kind: "page", status: "observed", sourceKind: "live_page", sourceRef: "https://example.org/", observedAt: "2026-11-08T12:00:00.000Z", data: { hostname: "example.org", text: "Request a payment" }, collectorVersion: "1", policyVersion: "1" });
}
test("admission is deduplicated atomically, enforces one active run and isolates owners", async () => {
  const store = makeStore();
  const [a, b] = await Promise.all([store.createCheck("alice", input, "same"), store.createCheck("alice", input, "same")]);
  assert.equal(a.id, b.id);
  assert.equal(await store.getCheck("bob", a.id), null);
  assert.equal((await store.listChecks("bob", {})).total, 0);
  await assert.rejects(store.createCheck("alice", input, "other"), (e) => e instanceof ScamwinStoreError && e.code === "active_check");
  input.message = "Mutated caller value";
  assert.equal((await store.getCheck("alice", a.id))?.input.message, "An offer");
  input.message = "An offer";
});
test("a submission key cannot silently bind a different message or image payload", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "same");
  await assert.rejects(store.createCheck("alice", { ...input, message: "A different offer" }, "same"), (e) => e instanceof ScamwinStoreError && e.code === "submission_conflict");
  await assert.rejects(store.createCheck("alice", { ...input, images: [{ name: "proof.png", mediaType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" }] }, "same"), (e) => e instanceof ScamwinStoreError && e.code === "submission_conflict");
  assert.equal((await store.createCheck("alice", input, "same")).id, c.id);
});
test("CAS allows one claim and rejects stale writes after cancellation or deletion", async () => {
  const store = makeStore();
  const c = await store.createCheck("alice", input, "first");
  const results = await Promise.all([store.claimRun(c.id, 1), store.claimRun(c.id, 1)]);
  assert.equal(results.filter(Boolean).length, 1);
  const claimed = results.find(Boolean)!;
  assert.equal(await store.updateRun(c.id, 1, 0, { state: "completed" }), null);
  const canceled = await store.requestCancel("alice", c.id);
  assert.equal(canceled?.state, "cancel_requested");
  assert.equal(await store.updateRun(c.id, 1, claimed.revision, { state: "completed" }), null);
  assert.equal(await store.deleteCheck("bob", c.id), false);
  assert.equal(await store.deleteCheck("alice", c.id), true);
  assert.equal(await store.getInternalCheck(c.id), null);
});
test("canceling an unclaimed queued check is final and cannot subsequently be claimed", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first");
  assert.equal((await store.requestCancel("alice", c.id))?.state, "canceled");
  assert.equal(await store.claimRun(c.id, 1), null);
});
test("daily quotas retain reservations even when a check is deleted", async () => {
  const store = makeStore();
  for (let i = 0; i < 3; i++) { const c = await store.createCheck("alice", input, String(i)); await store.deleteCheck("alice", c.id); }
  await assert.rejects(store.createCheck("alice", input, "fourth"), (e) => e instanceof ScamwinStoreError && e.code === "owner_daily_quota");
  for (let i = 0; i < 7; i++) {
    const c = await store.createCheck("person" + i, input, "unique");
    await store.updateRun(c.id, c.generation, c.revision, { state: "completed" });
  }
  await assert.rejects(store.createCheck("last", input, "unique"), (e) => e instanceof ScamwinStoreError && e.code === "global_daily_quota");
});
test("evidence and private artifacts reject cross-owner access and expire", async () => {
  let now = new Date("2026-11-08T12:00:00Z");
  const store = new MemoryStore({ now: () => now });
  const c = await store.createCheck("alice", input, "first");
  const observation: Observation = { id: "e1", checkId: c.id, runId: c.runId, kind: "message", status: "observed", sourceKind: "user_text", sourceRef: "message", observedAt: now.toISOString(), data: { text: "An offer" }, collectorVersion: "1", policyVersion: "1" };
  await store.saveObservation("alice", observation);
  assert.equal(await store.getObservation("bob", "e1"), null);
  await assert.rejects(store.saveObservation("bob", { ...observation, id: "e2" }));
  const artifact = await store.saveArtifact("alice", { checkId: c.id, name: "proof.png", kind: "input", mediaType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" });
  assert.equal(await store.getArtifact("bob", artifact.id), null);
  now = new Date("2026-11-16T12:00:00Z");
  assert.equal(await store.getArtifact("alice", artifact.id), null);
});
test("review requires consent, evidence ownership, reviewer role and revision fencing", async () => {
  const store = makeStore(); const c = await store.createCheck("alice", input, "first");
  await assert.rejects(store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: [], consent: false as true }));
  await addReviewEvidence(store, c); const w = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await assert.rejects(store.reviewWarning("alice", w.id, { decision: "approve", reason: "Reviewed", expectedRevision: 1 }));
  assert.equal((await store.getPublicWarnings()).length, 0);
  await store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Reviewed", expectedRevision: 1 });
  const publicWarnings = await store.getPublicWarnings();
  assert.equal(publicWarnings.length, 1); assert.equal(publicWarnings[0].hostname, "example.org");
  assert.equal("ownerId" in publicWarnings[0], false); assert.equal("evidence" in publicWarnings[0], false);
  await assert.rejects(store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Again", expectedRevision: 1 }));
});
test("deletion withdraws pending consent and hides all private evidence", async () => {
  const store = makeStore(); const c = await store.createCheck("alice", input, "first");
  await addReviewEvidence(store, c); const w = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await store.deleteCheck("alice", c.id);
  assert.equal((await store.listWarnings("alice"))[0].status, "withdrawn");
  await assert.rejects(store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Too late", expectedRevision: 1 }));
});
test("intake image bytes use expiring artifacts while saved offer text remains readable", async () => {
  let now = new Date("2026-11-08T12:00:00Z"); const store = new MemoryStore({ now: () => now });
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const c = await store.createCheck("alice", { ...input, images: [{ name: "offer.png", mediaType: "image/png", dataUrl }] }, "image");
  assert.equal(c.input.images[0].dataUrl, dataUrl);
  assert.equal(c.inputArtifactIds?.length, 1);
  assert.equal((await store.getArtifact("alice", c.inputArtifactIds![0]))?.dataUrl, dataUrl);
  now = new Date("2026-11-16T12:00:00Z");
  const retained = await store.getCheck("alice", c.id);
  assert.equal(retained?.input.message, "An offer");
  assert.equal(retained?.input.images[0].dataUrl, "");
});
test("new check quota resets by UTC day but the monthly cap still applies", async () => {
  let now = new Date("2026-11-01T12:00:00Z"); const store = new MemoryStore({ now: () => now });
  for (let day = 1; day <= 5; day++) {
    now = new Date(`2026-11-0${day}T12:00:00Z`);
    for (let owner = 0; owner < 10; owner++) { const c = await store.createCheck(String(owner), input, `${day}`); await store.deleteCheck(String(owner), c.id); }
  }
  now = new Date("2026-11-06T12:00:00Z");
  await assert.rejects(store.createCheck("new", input, "month"), (e) => e instanceof ScamwinStoreError && e.code === "global_monthly_quota");
});
test("assessment evidence IDs and related cases cannot reference another owner", async () => {
  const store = makeStore(); const a = await store.createCheck("alice", input, "first"), b = await store.createCheck("bob", input, "first");
  const c = (await store.claimRun(a.id, 1))!;
  await assert.rejects(store.updateRun(c.id, 1, c.revision, { assessment: { schemaVersion: 1, risk: "high_risk", summary: "Unsupported claim", findings: [{ id: "finding", statement: "Claim", classification: "observation", evidenceIds: ["foreign"] }], missingChecks: [], nextSteps: [] } }));
  await assert.rejects(store.updateRun(c.id, 1, c.revision, { relatedCases: [{ checkId: b.id, reason: "Match", evidenceIds: [] }] }));
});
test("deletion revokes a queued publication before a relay can lease it", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first");
  await addReviewEvidence(store, c); const warning = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await store.reviewWarning("reviewer", warning.id, { decision: "approve", reason: "Reviewed", expectedRevision: 1 });
  await store.deleteCheck("alice", c.id);
  assert.equal((await store.listWarnings("alice"))[0].status, "withdrawn");
  assert.equal((await store.getWarning(warning.id))?.status, "retracted");
  assert.equal((await store.getWarning(warning.id))?.publication?.status, "failed");
});
test("production storage requires explicit database configuration", () => {
  assert.throws(() => new PostgresStore(""), (e) => e instanceof ScamwinStoreError && e.code === "database_unavailable");
});
test("private review snapshots expire and canceled runs cannot append evidence", async () => {
  let now = new Date("2026-11-08T12:00:00Z"); const store = new MemoryStore({ now: () => now });
  const c = await store.createCheck("alice", input, "first");
  const o: Observation = { id: "e1", checkId: c.id, runId: c.runId, kind: "page", status: "observed", sourceKind: "live_page", sourceRef: "https://example.org/", observedAt: now.toISOString(), data: { text: "An offer" }, collectorVersion: "1", policyVersion: "1" };
  await store.saveObservation("alice", o);
  await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: [o.id], consent: true });
  await store.requestCancel("alice", c.id);
  await assert.rejects(store.saveObservation("alice", { ...o, id: "e2" }));
  now = new Date("2026-11-16T12:00:00Z");
  assert.deepEqual((await store.listWarnings("alice"))[0].evidence, []);
});
test("outbox leases are exclusive, stale attempts are fenced, and deletion revokes dispatch", async () => {
  let now = new Date("2026-11-08T12:00:00Z"); const store = new MemoryStore({ now: () => now });
  const c = await store.createCheck("alice", input, "first");
  const [a, b] = await Promise.all([store.leaseOutbox(), store.leaseOutbox()]);
  assert.equal(a.length + b.length, 1); const job = [...a, ...b][0];
  assert.equal(job.aggregateId, c.id);
  now = new Date("2026-11-08T12:02:00Z");
  const retry = (await store.leaseOutbox())[0];
  assert.equal(await store.finishOutbox(job.id, job.attempts, "dispatched"), false);
  assert.equal(await store.finishOutbox(retry.id, retry.attempts, "failed"), true);
  await store.deleteCheck("alice", c.id);
  assert.equal((await store.leaseOutbox()).length, 0);
});
test("retention fails overdue work and removes expired private contents", async () => {
  let now = new Date("2026-11-08T12:00:00Z"); const store = new MemoryStore({ now: () => now });
  const c = await store.createCheck("alice", input, "first");
  now = new Date("2026-11-08T12:06:00Z");
  assert.equal((await store.purgeExpired()).runs, 1);
  assert.equal((await store.getCheck("alice", c.id))?.state, "failed");
  assert.equal(await store.claimRun(c.id, 1), null);
  now = new Date("2026-12-09T12:00:00Z");
  assert.equal((await store.purgeExpired()).checks, 1);
  assert.equal(await store.getCheck("alice", c.id), null);
});
test("reading a queued check past its deadline fences the run and permits a new check", async () => {
  let now = new Date("2026-11-08T12:00:00Z"); const store = new MemoryStore({ now: () => now });
  const c = await store.createCheck("alice", input, "first");
  now = new Date("2026-11-08T12:06:00Z");
  const expired = await store.getCheck("alice", c.id);
  assert.equal(expired?.state, "failed"); assert.equal(expired?.errorCode, "deadline_exceeded"); assert.equal(expired?.generation, 2);
  assert.equal(await store.claimRun(c.id, 1), null);
  assert.notEqual((await store.createCheck("alice", input, "second")).id, c.id);
});
test("admission itself expires an overdue owner run before a separate status read", async () => {
  let now = new Date("2026-11-08T12:00:00Z"); const store = new MemoryStore({ now: () => now });
  const c = await store.createCheck("alice", input, "first");
  now = new Date("2026-11-08T12:06:00Z");
  const next = await store.createCheck("alice", input, "second");
  assert.notEqual(next.id, c.id);
  assert.equal((await store.getInternalCheck(c.id))?.state, "failed");
});
test("global admission atomically permits two active owners and holds cancellation capacity until settled", async () => {
  const store = makeStore();
  const admitted = await Promise.allSettled(['alice', 'bob', 'carol'].map(owner => store.createCheck(owner, input, 'first')));
  assert.equal(admitted.filter(result => result.status === 'fulfilled').length, 2);
  const rejected = admitted.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'global_active_quota');
  const first = (admitted[0] as PromiseFulfilledResult<Awaited<ReturnType<MemoryStore['createCheck']>>>).value;
  const claimed = (await store.claimRun(first.id, 1))!;
  const canceled = (await store.requestCancel('alice', first.id))!;
  assert.equal(canceled.state, 'cancel_requested');
  await assert.rejects(store.createCheck('carol', input, 'second'), (e) => e instanceof ScamwinStoreError && e.code === 'global_active_quota');
  assert.equal(await store.updateRun(first.id, 1, claimed.revision, { state: 'completed' }), null);
  await store.updateRun(first.id, 1, canceled.revision, { state: 'canceled' });
  assert.ok(await store.createCheck('carol', input, 'second'));
});
test("global admission expires overdue checks across all owners before counting capacity", async () => {
  let now = new Date('2026-11-09T11:00:00Z'); const store = new MemoryStore({ now: () => now });
  const first = await store.createCheck('alice', input, 'first'), second = await store.createCheck('bob', input, 'second');
  now = new Date(now.getTime() + 300_000);
  assert.ok(await store.createCheck('carol', input, 'third'));
  assert.equal((await store.getInternalCheck(first.id))?.state, 'failed');
  assert.equal((await store.getInternalCheck(second.id))?.state, 'failed');
});
test("reviewed retraction creates a distinct durable operation without claiming chain finality", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first");
  await addReviewEvidence(store, c); const w = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Reviewed", expectedRevision: 1 });
  const approved = (await store.getWarning(w.id))!;
  assert.equal((await store.updatePublication(w.id, approved.revision, { status: "submitted", transactionHash: "0x" + "1".repeat(64) }))?.publication?.status, "submitted");
  await assert.rejects(store.retractWarning("alice", w.id, { expectedRevision: approved.revision, reason: "No authority" }));
  const retracted = await store.retractWarning("reviewer", w.id, { expectedRevision: approved.revision, reason: "Correction" });
  assert.equal(retracted.status, "retracted"); assert.equal(retracted.publication?.status, "queued");
  assert.notEqual(retracted.publication?.operationId, approved.publication?.operationId);
  assert.equal(await store.updatePublication(w.id, approved.revision, { status: "finalized" }), null);
});
test("signing needs a live fenced lease and fee reservation, and unresolved bytes block new nonces", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first"); await addReviewEvidence(store, c);
  const w = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Reviewed", expectedRevision: 1 });
  const lease = (await store.leasePublication(w.id, 2))!;
  const signed = { status: "signed" as const, nonce: 1, transactionHash: "0x" + "1".repeat(64), signedRawTransaction: "0x1234", leaseToken: lease.leaseToken };
  await assert.rejects(store.updatePublication(w.id, 2, signed));
  assert.equal(await store.reservePublicationFee(w.id, 2, "1000000000000001", lease.leaseToken), false);
  assert.equal(await store.reservePublicationFee(w.id, 2, "1000", "stale"), false);
  assert.equal(await store.reservePublicationFee(w.id, 2, "1000", lease.leaseToken), true);
  await store.updatePublication(w.id, 2, signed);
  assert.equal((await store.getPublication(w.id, 2))?.signedRawTransaction, "0x1234");
  await assert.rejects(store.updatePublication(w.id, 2, { ...signed, signedRawTransaction: "0x5678" }));
  await assert.rejects(store.retractWarning("reviewer", w.id, { expectedRevision: 2, reason: "Wait for uncertain chain write" }));
  await store.deleteCheck("alice", c.id);
  assert.equal((await store.getPublication(w.id, 2))?.signedRawTransaction, "0x1234");
  assert.deepEqual(await store.listPendingPublications(), [{ warningId: w.id, kind: "publish_warning" }]);
});
test("message-only or mismatched-host evidence cannot become public allegations", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first");
  await store.saveObservation("alice", { id: "text", checkId: c.id, runId: c.runId, kind: "message", status: "observed", sourceKind: "user_text", sourceRef: "message", observedAt: "2026-11-08T12:00:00Z", data: { text: "Allegation" }, collectorVersion: "1", policyVersion: "1" });
  await assert.rejects(store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["text"], consent: true }));
  await addReviewEvidence(store, c);
  await assert.rejects(store.submitWarning("alice", { checkId: c.id, hostname: "other.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true }));
});
test("retracting an unsigned local warning revokes obsolete jobs without a chain transaction", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first"); await addReviewEvidence(store, c);
  const w = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Reviewed", expectedRevision: 1 });
  const retracted = await store.retractWarning("reviewer", w.id, { reason: "Withdraw before chain signing", expectedRevision: 2 });
  assert.equal(retracted.publication?.status, "local_only");
  assert.equal((await store.getPublication(w.id, 2))?.status, "failed");
  assert.deepEqual(await store.listPendingPublications(), []);
  assert.equal((await store.leaseOutbox()).filter(j => j.kind !== "investigate").length, 0);
});
test("expired unsigned review packets do not occupy the pending publication queue", async () => {
  let now = new Date("2026-11-08T12:00:00Z"); const store = new MemoryStore({ now: () => now, initialRoles: [{ ownerId: "reviewer", role: "reviewer" }] });
  const c = await store.createCheck("alice", input, "first"); await addReviewEvidence(store, c);
  const w = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Reviewed", expectedRevision: 1 });
  now = new Date("2026-11-16T12:00:00Z");
  assert.deepEqual(await store.listPendingPublications(), []);
});
test("consent hash binds the exact redacted warning, schema version and publication TTL", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first"); await addReviewEvidence(store, c);
  const w = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", category: "payment", evidenceIds: ["review-evidence"], consent: true });
  const consent = { schemaVersion: 1, ttlSeconds: 604800, hostname: "example.org", summary: "Public warning", category: "payment", evidenceIds: ["review-evidence"] };
  assert.equal(w.payloadHash, createHash("sha256").update(JSON.stringify(consent)).digest("hex"));
});
test("owner-scoped recipient indicators connect unrelated hosts and hide foreign or deleted cases", async () => {
  const store = makeStore(), recipient = { kind: "recipient" as const, fingerprint: "a".repeat(64) };
  const first = await store.createCheck("alice", { ...input, url: "https://one.example.org/" }, "first");
  await store.saveIndicators("alice", first.id, [recipient]);
  const claimed = (await store.claimRun(first.id, 1))!; await store.updateRun(first.id, 1, claimed.revision, { state: "completed" });
  const second = await store.createCheck("alice", { ...input, url: "https://two.example.org/" }, "second");
  await store.saveIndicators("alice", second.id, [recipient]);
  const foreign = await store.createCheck("bob", input, "foreign"); await store.saveIndicators("bob", foreign.id, [recipient]);
  assert.deepEqual(await store.findRelatedCases("alice", second.id, [recipient]), [{ checkId: first.id, kind: "recipient" }]);
  assert.deepEqual(await store.findRelatedCases("bob", foreign.id, [recipient]), []);
  await store.deleteCheck("alice", first.id);
  assert.deepEqual(await store.findRelatedCases("alice", second.id, [recipient]), []);
});
test("indicator writes reject foreign ownership, non-evidence infrastructure kinds and oversized sets", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first");
  await assert.rejects(store.saveIndicators("bob", c.id, [{ kind: "hostname", fingerprint: "a".repeat(64) }]));
  await assert.rejects(store.saveIndicators("alice", c.id, [{ kind: "issuer" as "hostname", fingerprint: "a".repeat(64) }]));
  await assert.rejects(store.saveIndicators("alice", c.id, Array.from({ length: 21 }, (_, n) => ({ kind: "endpoint" as const, fingerprint: n.toString(16).padStart(64, "0") }))));
  await store.requestCancel("alice", c.id);
  await assert.rejects(store.saveIndicators("alice", c.id, [{ kind: "hostname", fingerprint: "a".repeat(64) }]));
});
test("outbox kind filters isolate analysis from publisher dispatch without leasing other jobs", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first"); await addReviewEvidence(store, c);
  const warning = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await store.reviewWarning("reviewer", warning.id, { decision: "approve", reason: "Reviewed", expectedRevision: 1 });
  assert.deepEqual(await store.leaseOutbox(10, []), []);
  const publication = await store.leaseOutbox(10, ["publish_warning", "retract_warning"]);
  assert.equal(publication.length, 1); assert.equal(publication[0].kind, "publish_warning");
  const analysis = await store.leaseOutbox(10, ["investigate"]);
  assert.equal(analysis.length, 1); assert.equal(analysis[0].kind, "investigate");
  await assert.rejects(store.leaseOutbox(10, ["other" as "investigate"]));
});
test("only admins can pause new investigations while owner reads and identical retries remain available", async () => {
  const store = new MemoryStore({ initialRoles: [{ ownerId: "admin", role: "admin" }, { ownerId: "reviewer", role: "reviewer" }] });
  const c = await store.createCheck("alice", input, "first");
  await assert.rejects(store.setOperationalPause("reviewer", "investigation", true));
  await store.setOperationalPause("admin", "investigation", true);
  assert.equal((await store.getOperationalState()).investigationPaused, true);
  assert.equal((await store.getCheck("alice", c.id))?.id, c.id);
  assert.equal((await store.createCheck("alice", input, "first")).id, c.id);
  await assert.rejects(store.createCheck("bob", input, "new"), (e) => e instanceof ScamwinStoreError && e.code === "investigation_paused");
  await store.setOperationalPause("admin", "investigation", false);
  assert.ok((await store.createCheck("bob", input, "new")).id);
});
test("publication pause blocks new signatures while stored signed transactions can reconcile", async () => {
  let now = new Date("2026-11-08T12:00:00Z");
  const store = new MemoryStore({ now: () => now, initialRoles: [{ ownerId: "admin", role: "admin" }] });
  const c = await store.createCheck("alice", input, "first"); await addReviewEvidence(store, c);
  const w = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await store.reviewWarning("admin", w.id, { decision: "approve", reason: "Reviewed", expectedRevision: 1 });
  await store.setOperationalPause("admin", "publication", true);
  assert.equal(await store.leasePublication(w.id, 2), null);
  await store.setOperationalPause("admin", "publication", false);
  const lease = (await store.leasePublication(w.id, 2))!;
  await store.reservePublicationFee(w.id, 2, "1000", lease.leaseToken);
  await store.updatePublication(w.id, 2, { status: "signed", nonce: 1, transactionHash: "0x" + "1".repeat(64), signedRawTransaction: "0x1234", leaseToken: lease.leaseToken });
  await store.setOperationalPause("admin", "publication", true);
  now = new Date("2026-11-08T12:03:00Z");
  assert.equal((await store.leasePublication(w.id, 2))?.signedRawTransaction, "0x1234");
  assert.equal((await store.updatePublication(w.id, 2, { status: "submitted" }))?.publication?.status, "submitted");
  assert.equal((await store.getOperationalState()).publicationPaused, true);
});
test("requesting more information is role-enforced, revision-fenced and never publishes", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "first"); await addReviewEvidence(store, c);
  const w = await store.submitWarning("alice", { checkId: c.id, hostname: "example.org", summary: "Public warning", evidenceIds: ["review-evidence"], consent: true });
  await assert.rejects(store.reviewWarning("alice", w.id, { decision: "request_information", reason: "More evidence", expectedRevision: 1 }));
  const review = await store.reviewWarning("reviewer", w.id, { decision: "request_information", reason: "Please provide independent official instructions.", expectedRevision: 1 });
  assert.equal(review.status, "needs_information"); assert.equal(review.revision, 2); assert.equal(review.reviewerId, "reviewer");
  assert.equal(review.reviewReason, "Please provide independent official instructions.");
  assert.deepEqual(await store.getPublicWarnings(), []);
  assert.deepEqual(await store.leaseOutbox(10, ["publish_warning", "retract_warning"]), []);
  await assert.rejects(store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Stale packet", expectedRevision: 1 }));
  await assert.rejects(store.reviewWarning("reviewer", w.id, { decision: "approve", reason: "Fresh consent required", expectedRevision: 2 }));
});

