import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { MemoryStore, PostgresStore, ScamwinStoreError } from "../lib/scamwin/store";
import type { CheckInput, Observation } from "../lib/scamwin/contracts";

const input: CheckInput = { url: "https://example.org/", message: "An offer", promisedBenefit: "Refund", intendedAction: "Receive money", images: [] };
const makeStore = () => new MemoryStore({ now: () => new Date("2026-11-08T12:00:00.000Z"), initialRoles: [{ ownerId: "reviewer", role: "reviewer" }] });

const testAllowance = { schemaVersion: 1 as const, ownerId: 'alice', dailyLimit: 5 as const, utcDay: '2026-11-08', expiresAt: '2026-11-09T00:00:00.000Z' };
test('temporary owner allowance permits five durable admissions while other accounts retain three', async () => {
  const store = new MemoryStore({ now: () => new Date('2026-11-08T12:00:00.000Z'), dailyCheckAllowances: [testAllowance] });
  for (let i = 0; i < 5; i++) { const check = await store.createCheck('alice', input, `allowance-${i}`); await store.deleteCheck('alice', check.id); }
  assert.equal((await store.listChecks('alice', {})).total, 0);
  await assert.rejects(store.createCheck('alice', input, 'sixth'), /owner_daily_quota/);
  for (let i = 0; i < 3; i++) { const check = await store.createCheck('bob', input, `normal-${i}`); await store.deleteCheck('bob', check.id); }
  await assert.rejects(store.createCheck('bob', input, 'fourth'), /owner_daily_quota/);
});
test('temporary allowances expire at UTC rollover and malformed records never raise the default', async () => {
  for (const record of [
    { ...testAllowance, dailyLimit: 6 }, { ...testAllowance, schemaVersion: 2 },
    { ...testAllowance, expiresAt: '2026-11-10T00:00:00.000Z' }, { ...testAllowance, utcDay: '2026-11-07' },
    { ...testAllowance, extra: true },
  ]) {
    const store = new MemoryStore({ now: () => new Date('2026-11-08T12:00:00.000Z'), dailyCheckAllowances: [record as never] });
    for (let i = 0; i < 3; i++) { const check = await store.createCheck('alice', input, `${i}`); await store.deleteCheck('alice', check.id); }
    await assert.rejects(store.createCheck('alice', input, 'fourth'), /owner_daily_quota/);
  }
  let now = new Date('2026-11-08T23:59:58.000Z');
  const store = new MemoryStore({ now: () => now, dailyCheckAllowances: [testAllowance] });
  for (let i = 0; i < 5; i++) { const check = await store.createCheck('alice', input, `before-${i}`); await store.deleteCheck('alice', check.id); }
  now = new Date('2026-11-09T00:00:00.000Z');
  for (let i = 0; i < 3; i++) { const check = await store.createCheck('alice', input, `after-${i}`); await store.deleteCheck('alice', check.id); }
  await assert.rejects(store.createCheck('alice', input, 'expired-fourth'), /owner_daily_quota/);
});
test('a test allowance never expands the global daily admission budget', async () => {
  const store = new MemoryStore({ now: () => new Date('2026-11-08T12:00:00.000Z'), dailyCheckAllowances: [testAllowance] });
  for (let i = 0; i < 5; i++) { const check = await store.createCheck('alice', input, `alice-${i}`); await store.deleteCheck('alice', check.id); }
  for (let i = 0; i < 5; i++) { const owner = `other-${i}`, check = await store.createCheck(owner, input, 'first'); await store.deleteCheck(owner, check.id); }
  await assert.rejects(store.createCheck('another-owner', input, 'eleventh'), /global_daily_quota/);
});

test("terminal storage paths finish interrupted stages without inventing completed work",async()=>{
  for(const action of ["queued_cancel","cancel","deadline_read","deadline_admission","deadline_purge","delete","terminal_failed","terminal_canceled","expiry"] as const){
    let now=new Date("2026-11-08T12:00:00.000Z");const store=new MemoryStore({now:()=>now}),c=await store.createCheck("alice",input,action);
    const oldFinish="2026-11-08T11:59:59.000Z";
    let current=c;
    if(action!=="queued_cancel") current=(await store.updateRun(c.id,1,c.revision,{state:"collecting",stages:[
      {id:"intake",label:"Intake",status:"completed",finishedAt:oldFinish},
      {id:"browser",label:"Browser",status:"running",startedAt:c.createdAt},
      {id:"trust",label:"Trust",status:"pending"},
    ]}))!;
    now=new Date("2026-11-08T12:00:03.000Z");
    if(action==="queued_cancel"||action==="cancel") await store.requestCancel("alice",c.id);
    if(action.startsWith("deadline")) now=new Date("2026-11-08T12:05:01.000Z");
    if(action==="deadline_read")await store.getInternalCheck(c.id);
    if(action==="deadline_admission")await store.createCheck("bob",input,"next");
    if(action==="deadline_purge")await store.purgeExpired();
    if(action==="delete")await store.deleteCheck("alice",c.id);
    if(action==="terminal_failed"||action==="terminal_canceled")await store.updateRun(c.id,1,current.revision,{state:action==="terminal_failed"?"failed":"canceled"});
    if(action==="expiry"){now=new Date("2026-12-09T12:00:00.000Z");await store.purgeExpired();}
    const saved=(store as unknown as {checks:Map<string,typeof c>}).checks.get(c.id)!;
    assert.ok(saved.stages.every(s=>!["pending","running"].includes(s.status)),action);
    if(action==="queued_cancel"){assert.ok(saved.stages.every(s=>s.status==="skipped"&&!s.startedAt&&!s.finishedAt));continue;}
    assert.equal(saved.stages[0].status,"completed",action);assert.equal(saved.stages[0].finishedAt,oldFinish,action);
    assert.equal(saved.stages[1].status,action.startsWith("deadline")||action==="terminal_failed"?"unavailable":"canceled",action);
    assert.equal(saved.stages[1].finishedAt,now.toISOString(),action);assert.equal(saved.stages[2].status,"skipped",action);assert.equal(saved.stages[2].finishedAt,undefined,action);
  }
});

test("live sessions enforce owner, run, browser activity, session identity and irreversible end", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "live");
  const scope = { ownerId: "alice", checkId: c.id, runId: c.runId, generation: c.generation };
  const record = { sessionId: "session", scope, status: "ready" as const, encryptedLocator: "sealed", createdAt: c.createdAt, expiresAt: "2026-11-08T12:00:30.000Z" };
  assert.equal(await store.putLiveView(scope, record), false);
  const collecting = await store.updateRun(c.id, 1, c.revision, { state: "collecting", stages: [{ id: "browser", label: "Browser", status: "running" }] });
  assert.ok(collecting);
  assert.equal(await store.putLiveView({ ...scope, runId: "stale" }, { ...record, scope: { ...scope, runId: "stale" } }), false);
  assert.equal(await store.putLiveView(scope, record), true);
  assert.equal(await store.putLiveView(scope, { ...record, sessionId: "replacement" }), false);
  assert.equal(await store.getLiveView("bob", c.id, scope), null);
  assert.equal(await store.getLiveView("alice", c.id, { ...scope, generation: 2 }), null);
  assert.equal((await store.getLiveView("alice", c.id, scope))?.encryptedLocator, "sealed");
  assert.equal(await store.updateLiveView(scope, "old-session", { status: "ended" }), false);
  assert.equal(await store.updateLiveView(scope, "session", { status: "connected" }), true);
  assert.equal(await store.updateLiveView(scope, "session", { status: "ended", reasonCode: "collection_ended" }), true);
  const ended = await store.getLiveView("alice", c.id, scope);
  assert.equal(ended?.status, "ended"); assert.equal(ended?.encryptedLocator, null);
  assert.equal(await store.updateLiveView(scope, "session", { status: "connected" }), false);
  assert.equal(await store.putLiveView(scope, record), false);
  assert.equal(JSON.stringify(await store.getCheck("alice", c.id)).includes("sealed"), false);
});

test("initial unavailable live sessions are bounded, secret-free and fenced like ready sessions", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "unavailable");
  const scope = { ownerId: "alice", checkId: c.id, runId: c.runId, generation: 1 };
  const record = { sessionId: "unavailable", scope, status: "unavailable" as const, encryptedLocator: null, reasonCode: "provider_unavailable", createdAt: c.createdAt, expiresAt: "2026-11-08T12:00:30.000Z", endedAt: c.createdAt };
  assert.equal(await store.putLiveView(scope, record), false, "queued checks cannot save unavailable viewer sessions");
  const current = (await store.updateRun(c.id, 1, 0, { state: "collecting", stages: [{ id: "browser", label: "Browser", status: "completed" }] }))!;
  assert.equal(await store.putLiveView(scope, record), false, "finished browser cannot save a late unavailable session");
  assert.ok(await store.updateRun(c.id, 1, current.revision, { stages: [{ id: "browser", label: "Browser", status: "running" }] }));
  assert.equal(await store.putLiveView({ ...scope, generation: 2 }, { ...record, scope: { ...scope, generation: 2 } }), false);
  assert.equal(await store.putLiveView({ ...scope, ownerId: "bob" }, { ...record, scope: { ...scope, ownerId: "bob" } }), false);
  for (const changed of [
    { ...record, encryptedLocator: "forbidden-ciphertext" }, { ...record, connectedAt: c.createdAt },
    { ...record, reasonCode: undefined }, { ...record, endedAt: "2026-11-08T11:59:59.000Z" },
    { ...record, endedAt: "2026-11-08T12:00:01.000Z" }, { ...record, expiresAt: "2026-11-08T12:01:01.000Z" },
    { ...record, status: "ended" as const }, { ...record, status: "connected" as const },
  ]) assert.equal(await store.putLiveView(scope, changed), false);
  await assert.rejects(store.putLiveView(scope, { ...record, reasonCode: "https://private.example/secret" }));
  assert.equal(await store.putLiveView(scope, record), true);
  assert.deepEqual(await store.getLiveView("alice", c.id, scope), record);
  assert.equal(await store.getLiveView("bob", c.id, scope), null);
  assert.equal(await store.putLiveView(scope, { ...record, sessionId: "second" }), false);
  assert.equal(await store.updateLiveView(scope, record.sessionId, { status: "connected" }), false);
});

test("expired live reads return bounded owner metadata without retaining a capability", async () => {
  let now = new Date("2026-11-08T12:00:00.000Z");
  const store = new MemoryStore({ now: () => now }), c = await store.createCheck("alice", input, "expiry-metadata");
  const scope = { ownerId: "alice", checkId: c.id, runId: c.runId, generation: 1 };
  await store.updateRun(c.id, 1, 0, { state: "collecting", stages: [{ id: "browser", label: "Browser", status: "running" }] });
  const record = { sessionId: "expired", scope, status: "ready" as const, encryptedLocator: "private-ciphertext", createdAt: c.createdAt, expiresAt: "2026-11-08T12:00:30.000Z" };
  assert.equal(await store.putLiveView(scope, record), true);
  now = new Date("2026-11-08T12:00:31.000Z");
  const expired = await store.getLiveView("alice", c.id, scope);
  assert.ok(expired);
  assert.equal(expired.encryptedLocator, null);
  assert.equal(expired.status, "ended");
  assert.equal(expired.reasonCode, "expired");
  assert.equal(expired.expiresAt, record.expiresAt);
  assert.equal(await store.getLiveView("bob", c.id, scope), null);
  assert.equal(await store.getLiveView("alice", c.id, { ...scope, generation: 2 }), null);
});

test("cancel, terminal, deletion, overdue reads and purge retire live ciphertext", async () => {
  for (const action of ["cancel", "terminal", "delete", "overdue", "admission", "purge", "expiry"] as const) {
    let now = new Date("2026-11-08T12:00:00.000Z");
    const store = new MemoryStore({ now: () => now }), c = await store.createCheck("alice", input, action);
    const scope = { ownerId: "alice", checkId: c.id, runId: c.runId, generation: 1 };
    const collecting = await store.updateRun(c.id, 1, 0, { state: "collecting", stages: [{ id: "browser", label: "Browser", status: "running" }] });
    const record = { sessionId: action, scope, status: "ready" as const, encryptedLocator: "sealed", createdAt: c.createdAt, expiresAt: "2026-11-08T12:00:30.000Z" };
    assert.equal(await store.putLiveView(scope, record), true);
    if (action === "cancel") await store.requestCancel("alice", c.id);
    if (action === "terminal") await store.updateRun(c.id, 1, collecting!.revision, { state: "analyzing" });
    if (action === "delete") await store.deleteCheck("alice", c.id);
    if (["overdue", "admission", "purge"].includes(action)) now = new Date("2026-11-08T12:05:01.000Z");
    if (action === "overdue") await store.getCheck("alice", c.id);
    if (action === "admission") await store.createCheck("bob", input, "next");
    if (action === "purge") await store.purgeExpired();
    if (action === "expiry") { now = new Date("2026-11-08T12:00:31.000Z"); await store.purgeExpired(); }
    const result = await store.getLiveView("alice", c.id, scope);
    if (action === "expiry") { assert.ok(result); assert.equal(result.encryptedLocator, null); assert.equal(result.reasonCode, "expired"); }
    else assert.equal(result, null, action);
    assert.equal(await store.putLiveView(scope, record), false, action);
    const rows = [...(store as unknown as { liveViews: Map<string, { encryptedLocator: string | null }> }).liveViews.values()];
    assert.ok(rows.every(row => row.encryptedLocator === null), action);
  }
});

test("old-session finally cannot clear a new generation, and browser activity gates delivery", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "fencing");
  const scope = { ownerId: "alice", checkId: c.id, runId: c.runId, generation: 1 };
  await store.updateRun(c.id, 1, 0, { state: "collecting", stages: [{ id: "browser", label: "Browser", status: "running", startedAt: c.createdAt, detailCode: "navigate" }] });
  const record = { sessionId: "old", scope, status: "ready" as const, encryptedLocator: "old-cipher", createdAt: c.createdAt, expiresAt: "2026-11-08T12:00:30.000Z" };
  assert.equal(await store.putLiveView(scope, record), true);
  // Simulate a new durable run identity; the public API starts new checks.
  const saved = (store as unknown as { checks: Map<string, typeof c> }).checks.get(c.id)!;
  saved.generation = 2; saved.runId = "new-run";
  const nextScope = { ...scope, generation: 2, runId: "new-run" };
  assert.equal(await store.putLiveView(nextScope, { ...record, scope: nextScope, sessionId: "new", encryptedLocator: "new-cipher" }), true);
  assert.equal(await store.updateLiveView(scope, "new", { status: "ended" }), false);
  assert.equal(await store.updateLiveView(scope, "old", { status: "ended" }), true);
  assert.equal((await store.getLiveView("alice", c.id, nextScope))?.encryptedLocator, "new-cipher");
  saved.stages[0].status = "completed";
  assert.equal(await store.getLiveView("alice", c.id, nextScope), null);
  assert.equal(await store.updateLiveView(nextScope, "new", { status: "connected" }), false);
});

test("live writes reject replacement locators, invalid times and unbounded reason codes", async () => {
  const store = makeStore(), c = await store.createCheck("alice", input, "validation");
  const scope = { ownerId: "alice", checkId: c.id, runId: c.runId, generation: 1 };
  await store.updateRun(c.id, 1, 0, { state: "collecting", stages: [{ id: "browser", label: "Browser", status: "running" }] });
  const record = { sessionId: "session", scope, status: "ready" as const, encryptedLocator: "sealed", createdAt: c.createdAt, expiresAt: "2026-11-08T12:01:01.000Z" };
  assert.equal(await store.putLiveView(scope, record), false);
  assert.equal(await store.putLiveView(scope, { ...record, expiresAt: "2026-11-08T12:00:30.000Z" }), true);
  await assert.rejects(store.updateLiveView(scope, "session", { status: "ended", encryptedLocator: "replacement" } as never));
  await assert.rejects(store.updateLiveView(scope, "session", { status: "ended", reasonCode: "https://secret" }));
  const check = await store.getCheck("alice", c.id);
  assert.ok(await store.updateRun(c.id, 1, check!.revision, { stages: [{ id: "browser", label: "Browser", status: "canceled", finishedAt: c.createdAt }, { id: "trust", label: "Trust", status: "skipped" }] }));
});
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

