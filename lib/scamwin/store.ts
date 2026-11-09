import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { z } from "zod";
import { assessmentSchema, checkStates, observationSchema, offerIntentSchema } from "./contracts";
import type { Artifact, ArtifactInput, CheckInput, CheckMessage, CheckPage, CheckRecord, IndicatorFingerprint, IndicatorKind, MessageInput, Observation, OperationalState, OutboxJob, PublicationPatch, PublicationRecord, PublicWarning, PurgeResult, ReviewInput, RunPatch, ScamwinRole, ScamwinStore, WarningDraftInput, WarningSubmission } from "./contracts";
import { checkInputSchema, isPublicInputUrl, validatePreparedImage } from "./input";
import type { LiveViewScope, LiveViewRecord, LiveViewPatch } from "./live-view-contracts";
import { createInitialStages, finishInterruptedStages } from "./progress";
import { dailyCheckAllowanceKey, effectiveDailyCheckLimit, type DailyCheckAllowance } from "./daily-check-allowance";

const DAY = 86400000, ARTIFACT_CAP = 200 * 1024 * 1024;
const active = new Set(["queued", "validating", "collecting", "analyzing", "cancel_requested"]);
const clone = <T>(value: T): T => structuredClone(value);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const future = (now: Date, days: number) => new Date(now.getTime() + DAY * days).toISOString();
export class ScamwinStoreError extends Error {
  constructor(public readonly code: string, message: string = code) { super(message); this.name = "ScamwinStoreError"; }
}
function fail(code: string, message?: string): never { throw new ScamwinStoreError(code, message); }
const stageSchema = z.object({ id: z.string().max(100), label: z.string().max(200), status: z.enum(["pending", "running", "completed", "unavailable", "blocked", "skipped", "canceled"]), startedAt: z.string().datetime().optional(), finishedAt: z.string().datetime().optional(), detailCode: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).optional() }).strict();
const liveScopeSchema = z.object({ ownerId: z.string().min(1).max(300), checkId: z.string().min(1).max(120), runId: z.string().min(1).max(120), generation: z.number().int().positive() }).strict();
const liveReasonSchema = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const liveRecordSchema = z.object({ sessionId: z.string().min(1).max(120), scope: liveScopeSchema, status: z.enum(["ready", "connected", "ended", "unavailable"]), encryptedLocator: z.string().min(1).max(24000).nullable(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(), connectedAt: z.string().datetime().optional(), endedAt: z.string().datetime().optional(), reasonCode: liveReasonSchema.optional() }).strict();
const livePatchSchema = z.discriminatedUnion("status", [z.object({ status: z.literal("connected"), connectedAt: z.string().datetime().optional() }).strict(), z.object({ status: z.enum(["ended", "unavailable"]), endedAt: z.string().datetime().optional(), reasonCode: liveReasonSchema.optional() }).strict()]);
function sameLiveScope(a: LiveViewScope, b: LiveViewScope) { return a.ownerId === b.ownerId && a.checkId === b.checkId && a.runId === b.runId && a.generation === b.generation; }
function liveEligible(c: CheckRecord | null, scope: LiveViewScope, now: Date) {
  return c && c.ownerId === scope.ownerId && c.id === scope.checkId && c.runId === scope.runId && c.generation === scope.generation && c.state === "collecting" && !c.cancelRequestedAt && c.expiresAt > now.toISOString() && Date.parse(c.createdAt) + 300000 > now.getTime() && c.stages.some(s => s.id === "browser" && s.status === "running");
}
function validLiveRecord(scope: LiveViewScope, record: LiveViewRecord, now: Date) {
  const initialReady = record.status === "ready" && Boolean(record.encryptedLocator) && !record.endedAt;
  const initialUnavailable = record.status === "unavailable" && record.encryptedLocator === null && Boolean(record.reasonCode)
    && (!record.endedAt || Date.parse(record.endedAt) >= Date.parse(record.createdAt) && Date.parse(record.endedAt) <= now.getTime());
  return sameLiveScope(scope, record.scope) && (initialReady || initialUnavailable) && !record.connectedAt
    && record.createdAt <= now.toISOString() && Date.parse(record.expiresAt) > now.getTime() && Date.parse(record.expiresAt) <= Date.parse(record.createdAt) + 60000;
}
const runPatchSchema = z.object({ state: z.enum(checkStates).optional(), intent: offerIntentSchema.optional(), assessment: assessmentSchema.optional(), stages: z.array(stageSchema).max(20).optional(), errorCode: z.string().max(100).optional(), availability: z.string().max(500).optional(), relatedCases: z.array(z.object({ checkId: z.string().max(120), reason: z.string().max(1000), evidenceIds: z.array(z.string().max(120)).max(30) }).strict()).max(20).optional() }).strict();
const messageSchema = z.object({ checkId: z.string().min(1).max(120), role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(12000), evidenceIds: z.array(z.string().max(120)).max(50).optional() }).strict();
const warningSchema = z.object({ checkId: z.string().min(1).max(120), hostname: z.string().trim().toLowerCase().max(253).refine((v) => !v.includes("/") && !v.includes(":") && isPublicInputUrl(`https://${v}/`), "Use an exact public hostname."), summary: z.string().trim().min(10).max(1500), category: z.string().trim().min(1).max(80).optional(), evidenceIds: z.array(z.string().min(1).max(120)).max(20), consent: z.literal(true) }).strict();
const reviewSchema = z.object({ decision: z.enum(["approve", "reject", "request_information"]), reason: z.string().trim().min(1).max(1000), expectedRevision: z.number().int().positive() }).strict();
const indicatorsSchema = z.array(z.object({ kind: z.enum(["hostname", "recipient", "endpoint"]), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(20);
const outboxKindsSchema = z.array(z.enum(["investigate", "publish_warning", "retract_warning"])).max(3);
const operationalStateSchema = z.object({ investigationPaused: z.boolean(), publicationPaused: z.boolean(), updatedAt: z.string().datetime().optional() }).strict();
const operationalPauseSchema = z.object({ scope: z.enum(["investigation", "publication"]), paused: z.boolean() }).strict();
const publicationPatchSchema = z.object({ status: z.enum(["queued", "signed", "submitted", "included", "safe", "finalized", "failed", "unavailable"]), transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(), signedRawTransaction: z.string().regex(/^0x[0-9a-fA-F]+$/).max(40000).optional(), nonce: z.number().int().nonnegative().optional(), contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), publisherAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), leaseToken: z.string().max(100).optional(), leaseUntil: z.string().datetime().optional(), reservedFeeWei: z.string().regex(/^\d+$/).optional(), epoch: z.string().regex(/^\d+$/).optional(), assertionRevision: z.number().int().nonnegative().optional() }).strict();
function validateWarningEvidence(check: CheckRecord, hostname: string, evidence: Observation[]) {
  if (!check.input.url || new URL(check.input.url).hostname.toLowerCase().replace(/\.$/, "") !== hostname.replace(/\.$/, "") || !evidence.some((e) => e.status === "observed" && ["live_page", "origin_probe", "registry"].includes(e.sourceKind))) fail("warning_evidence_required");
}
function identity(ownerId: string) { if (!ownerId || ownerId.length > 300) fail("invalid_owner"); }
function newCheck(ownerId: string, input: CheckInput, submissionKey: string, now: Date): CheckRecord {
  identity(ownerId);
  if (!submissionKey || submissionKey.length > 200) fail("invalid_submission_key");
  const parsed = checkInputSchema.parse(input);
  return { id: nanoid(), ownerId, submissionKey, submissionHash: hash(JSON.stringify(parsed)), input: clone(parsed), runId: nanoid(), state: "queued", generation: 1, revision: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: future(now, 30), stages: createInitialStages() };
}
function artifactRecord(input: ArtifactInput, now: Date): Artifact {
  const image = validatePreparedImage({ name: input.name, mediaType: input.mediaType, dataUrl: input.dataUrl });
  if (!["input", "capture"].includes(input.kind)) fail("invalid_artifact_kind");
  return { ...input, id: nanoid(), byteLength: image.byteLength, sha256: createHash("sha256").update(Buffer.from(input.dataUrl.split(",")[1], "base64")).digest("hex"), createdAt: now.toISOString(), expiresAt: future(now, 7) };
}
function separateImages(check: CheckRecord, now: Date): Artifact[] {
  const artifacts = check.input.images.map((image) => artifactRecord({ ...image, checkId: check.id, kind: "input" }, now));
  check.inputArtifactIds = artifacts.map((a) => a.id);
  check.input.images = check.input.images.map((image) => ({ ...image, dataUrl: "" }));
  return artifacts;
}
function warningRecord(ownerId: string, input: WarningDraftInput, evidence: Observation[], now: Date): WarningSubmission {
  const parsed = warningSchema.parse(input);
  const payload = { schemaVersion: 1 as const, ttlSeconds: 604800 as const, hostname: parsed.hostname, summary: parsed.summary, category: parsed.category ?? "offer", evidenceIds: [...new Set(parsed.evidenceIds)].sort() };
  return { ...payload, id: nanoid(), ownerId, checkId: parsed.checkId, evidence: clone(evidence), consentAt: now.toISOString(), payloadHash: hash(JSON.stringify(payload)), revision: 1, status: "pending", createdAt: now.toISOString(), expiresAt: future(now, 7) };
}
function publicRecord(warning: WarningSubmission, now: Date): PublicWarning {
  return { id: warning.id, hostname: warning.hostname, summary: warning.summary, category: warning.category, publisher: "Scamwin reviewed warnings", createdAt: now.toISOString(), expiresAt: future(now, 7), status: "active", revision: warning.revision + 1, publication: { status: "queued", chainId: 84532, operationId: `scamwin:warning:${warning.id}:${warning.revision + 1}` } };
}
function checkPatch(current: CheckRecord, value: RunPatch): RunPatch {
  const patch = runPatchSchema.parse(value);
  if (patch.state === "queued" || patch.state === "cancel_requested") fail("invalid_transition");
  if (patch.relatedCases?.some((c) => c.checkId === current.id)) fail("invalid_related_case");
  return patch;
}

/** Explicitly injected test adapter. Never selected from missing production configuration. */
export class MemoryStore implements ScamwinStore {
  private liveViews = new Map<string, LiveViewRecord>();
  private checks = new Map<string, CheckRecord>();
  private deleted = new Set<string>();
  private admissions: { ownerId: string; createdAt: string }[] = [];
  private dailyCheckAllowances = new Map<string, DailyCheckAllowance>();
  private observations = new Map<string, Observation>();
  private artifacts = new Map<string, Artifact>();
  private messages = new Map<string, CheckMessage>();
  private warnings = new Map<string, WarningSubmission>();
  private publicWarnings = new Map<string, PublicWarning>();
  private roles = new Set<string>();
  private outbox = new Map<string, OutboxJob>();
  private publications = new Map<string, PublicationRecord>();
  private feeReservations: { key: string; day: string; fee: bigint }[] = [];
  private indicators = new Map<string, IndicatorFingerprint & { ownerId: string; checkId: string }>();
  private operations: OperationalState = { investigationPaused: false, publicationPaused: false };
  private operationalAudit: { action: string; code: string; at: string }[] = [];
  private now: () => Date;
  constructor(options: { now?: () => Date; initialRoles?: { ownerId: string; role: ScamwinRole }[]; dailyCheckAllowances?: DailyCheckAllowance[] } = {}) {
    this.now = options.now ?? (() => new Date());
    options.initialRoles?.forEach(({ ownerId, role }) => this.roles.add(`${ownerId}:${role}`));
    options.dailyCheckAllowances?.forEach(record => this.dailyCheckAllowances.set(record.ownerId, clone(record)));
  }
  private read(id: string, ownerId?: string): CheckRecord | null {
    const c = this.checks.get(id);
    if (c && (!ownerId || c.ownerId === ownerId) && !this.deleted.has(id)) this.expireOverdue(c);
    return c && !this.deleted.has(id) && c.expiresAt > this.now().toISOString() && (!ownerId || c.ownerId === ownerId) ? c : null;
  }
  private expireOverdue(c: CheckRecord): boolean {
    const now = this.now();
    if (!active.has(c.state) || new Date(c.createdAt).getTime() + 300000 > now.getTime()) return false;
    c.state = c.state === "cancel_requested" ? "canceled" : "failed"; c.errorCode = "deadline_exceeded"; c.updatedAt = now.toISOString(); c.revision++; c.generation++;
    c.stages = finishInterruptedStages(c.stages, c.state === "canceled" ? "canceled" : "unavailable", now.toISOString());
    this.retireLiveViews(c.id, "deadline_exceeded");
    for (const job of this.outbox.values()) if (job.aggregateId === c.id && job.kind === "investigate" && job.state !== "dispatched") job.state = "revoked";
    return true;
  }
  private owned(ownerId: string, id: string): CheckRecord { identity(ownerId); return this.read(id, ownerId) ?? fail("not_found"); }
  private retireLiveViews(checkId: string, reasonCode: string) {
    for (const row of this.liveViews.values()) if (row.scope.checkId === checkId && ["ready", "connected"].includes(row.status)) Object.assign(row, { status: "ended", encryptedLocator: null, endedAt: this.now().toISOString(), reasonCode });
  }
  async putLiveView(value: LiveViewScope, recordValue: LiveViewRecord) {
    const scope = liveScopeSchema.parse(value), record = liveRecordSchema.parse(recordValue), now = this.now(), c = this.read(scope.checkId, scope.ownerId);
    if (!liveEligible(c, scope, now) || !validLiveRecord(scope, record, now) || Date.parse(record.expiresAt) > Date.parse(c!.createdAt) + 300000 || this.liveViews.has(record.sessionId) || [...this.liveViews.values()].some(row => sameLiveScope(row.scope, scope))) return false;
    this.liveViews.set(record.sessionId, clone(record)); return true;
  }
  async getLiveView(ownerId: string, checkId: string, expectedRun: { runId: string; generation: number }) {
    const scope = { ownerId, checkId, runId: expectedRun.runId, generation: expectedRun.generation }, now = this.now(), c = this.read(checkId, ownerId);
    if (!liveEligible(c, scope, now)) return null;
    const row = [...this.liveViews.values()].find(row => sameLiveScope(row.scope, scope));
    if (!row) return null;
    if (row.expiresAt <= now.toISOString()) Object.assign(row, { status: "ended", encryptedLocator: null, endedAt: row.endedAt ?? row.expiresAt, reasonCode: "expired" });
    return clone(row);
  }
  async updateLiveView(value: LiveViewScope, sessionId: string, patchValue: LiveViewPatch) {
    const scope = liveScopeSchema.parse(value), patch = livePatchSchema.parse(patchValue), row = this.liveViews.get(sessionId), now = this.now();
    if (!row || !sameLiveScope(row.scope, scope) || !["ready", "connected"].includes(row.status)) return false;
    if (patch.status === "connected") {
      if (!liveEligible(this.read(scope.checkId, scope.ownerId), scope, now) || row.expiresAt <= now.toISOString()) return false;
      row.status = "connected"; row.connectedAt ??= patch.connectedAt ?? now.toISOString();
    } else Object.assign(row, patch, { encryptedLocator: null, endedAt: patch.endedAt ?? now.toISOString() });
    return true;
  }
  private view(c: CheckRecord | null): CheckRecord | null {
    if (!c) return null; const result = clone(c);
    result.input.images = result.input.images.map((image, i) => {
      const a = this.artifacts.get(result.inputArtifactIds?.[i] ?? "");
      return { ...image, dataUrl: a && a.expiresAt > this.now().toISOString() ? a.dataUrl : "" };
    }); return result;
  }
  private evidence(ownerId: string, checkId: string, ids: string[]) {
    this.owned(ownerId, checkId);
    return ids.map((id) => { const o = this.observations.get(id); return o?.checkId === checkId ? o : fail("invalid_evidence"); });
  }
  async createCheck(ownerId: string, input: CheckInput, submissionKey: string): Promise<CheckRecord> {
    const now = this.now(), c = newCheck(ownerId, input, submissionKey, now);
    const existing = [...this.checks.values()].find((v) => v.ownerId === ownerId && v.submissionKey === submissionKey);
    if (existing) { if (existing.submissionHash !== c.submissionHash) fail("submission_conflict"); return this.view(this.read(existing.id, ownerId) ?? fail("submission_expired"))!; }
    if (this.operations.investigationPaused) fail("investigation_paused");
    const day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
    if (this.admissions.filter((a) => a.createdAt.startsWith(day)).length >= 10) fail("global_daily_quota");
    if (this.admissions.filter((a) => a.createdAt.startsWith(month)).length >= 50) fail("global_monthly_quota");
    if (this.admissions.filter((a) => a.ownerId === ownerId && a.createdAt.startsWith(day)).length >= effectiveDailyCheckLimit(ownerId, this.dailyCheckAllowances.get(ownerId), now)) fail("owner_daily_quota");
    const activeChecks = [...this.checks.values()].filter((v) => this.read(v.id) && active.has(v.state));
    if (activeChecks.some((v) => v.ownerId === ownerId)) fail("active_check");
    if (activeChecks.length >= 2) fail("global_active_quota");
    const images = separateImages(c, now);
    const currentBytes = [...this.artifacts.values()].filter((a) => a.expiresAt > now.toISOString()).reduce((sum, a) => sum + a.byteLength, 0);
    if (currentBytes + images.reduce((sum, a) => sum + a.byteLength, 0) > ARTIFACT_CAP) fail("artifact_storage_cap");
    this.checks.set(c.id, c); images.forEach((a) => this.artifacts.set(a.id, a)); this.admissions.push({ ownerId, createdAt: c.createdAt });
    this.enqueue("investigate", c.id, 1, `scamwin:${c.id}:1`); return this.view(c)!;
  }
  async getCheck(ownerId: string, id: string) { identity(ownerId); return this.view(this.read(id, ownerId)); }
  async getInternalCheck(id: string) { return this.view(this.read(id)); }
  async listChecks(ownerId: string, options: { page?: number; query?: string }): Promise<CheckPage> {
    identity(ownerId); const page = Math.max(1, Math.floor(options.page ?? 1)), pageSize = 20, query = (options.query ?? "").slice(0, 200).toLowerCase();
    const checks = [...this.checks.values()].filter((c) => this.read(c.id, ownerId) && JSON.stringify([c.input.url, c.input.message, c.input.promisedBenefit, c.input.intendedAction]).toLowerCase().includes(query)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { checks: checks.slice((page - 1) * pageSize, page * pageSize).map((c) => this.view(c)!), total: checks.length, page, pageSize };
  }
  async claimRun(id: string, generation: number) {
    const c = this.read(id); if (!c || c.generation !== generation || c.state !== "queued" || new Date(c.createdAt).getTime() + 300000 <= this.now().getTime()) return null;
    c.state = "validating"; c.revision++; c.updatedAt = this.now().toISOString(); return this.view(c);
  }
  async updateRun(id: string, generation: number, expectedRevision: number, value: RunPatch) {
    const c = this.read(id); if (!c || c.generation !== generation || c.revision !== expectedRevision || !active.has(c.state)) return null;
    const patch = checkPatch(c, value); if (c.state === "cancel_requested" && patch.state !== "canceled") return null;
    if (patch.assessment) this.evidence(c.ownerId, c.id, patch.assessment.findings.flatMap((f) => f.evidenceIds));
    for (const related of patch.relatedCases ?? []) this.owned(c.ownerId, related.checkId);
    Object.assign(c, clone(patch), { revision: c.revision + 1, updatedAt: this.now().toISOString() });
    if (!active.has(c.state)) c.stages = finishInterruptedStages(c.stages, c.state === "canceled" ? "canceled" : "unavailable", c.updatedAt);
    if (!liveEligible(c, { ownerId: c.ownerId, checkId: c.id, runId: c.runId, generation: c.generation }, this.now())) this.retireLiveViews(c.id, "collection_ended");
    return this.view(c);
  }
  async requestCancel(ownerId: string, id: string) {
    const c = this.read(id, ownerId); if (!c) return null;
    if (active.has(c.state) && c.state !== "cancel_requested") Object.assign(c, { state: c.state === "queued" ? "canceled" : "cancel_requested", cancelRequestedAt: this.now().toISOString(), updatedAt: this.now().toISOString(), revision: c.revision + 1 });
    if (c.state === "canceled" || c.state === "cancel_requested") c.stages = finishInterruptedStages(c.stages, "canceled", c.updatedAt);
    this.retireLiveViews(c.id, "canceled");
    return this.view(c);
  }
  async deleteCheck(ownerId: string, id: string) {
    const c = this.read(id, ownerId); if (!c) return false;
    this.deleted.add(id); c.generation++; c.revision++;
    c.state = "canceled"; c.stages = finishInterruptedStages(c.stages, "canceled", this.now().toISOString());
    this.retireLiveViews(id, "deleted");
    for (const w of this.warnings.values()) if (w.checkId === id) {
      const pub = this.publicWarnings.get(w.id);
      const publication = pub ? this.publications.get(`${w.id}:${pub.revision}`) : null;
      if (["pending", "needs_information"].includes(w.status) || (w.status === "approved" && pub?.publication?.status === "queued" && (!publication?.leaseUntil || publication.leaseUntil <= this.now().toISOString()))) {
        w.status = "withdrawn"; w.revision++; w.evidence = [];
        if (pub?.publication) { pub.status = "retracted"; pub.publication.status = "failed"; if (publication) publication.status = "failed"; pub.revision++; }
      }
    }
    for (const [key, a] of this.artifacts) if (a.checkId === id) this.artifacts.delete(key);
    for (const [key, m] of this.messages) if (m.checkId === id) this.messages.delete(key);
    for (const [key, o] of this.observations) if (o.checkId === id) this.observations.delete(key);
    for (const [key, indicator] of this.indicators) if (indicator.checkId === id) this.indicators.delete(key);
    c.input = { url: "", message: "", promisedBenefit: "", intendedAction: "", images: [] }; delete c.intent; delete c.assessment;
    for (const job of this.outbox.values()) if (job.aggregateId === id || this.warnings.get(job.aggregateId)?.status === "withdrawn") if (job.state !== "dispatched") job.state = "revoked";
    return true;
  }
  async saveObservation(ownerId: string, value: Observation) {
    const o = observationSchema.parse(value), c = this.owned(ownerId, o.checkId);
    if (c.runId !== o.runId || !active.has(c.state) || c.state === "cancel_requested") fail("stale_run");
    if (o.artifactId && this.artifacts.get(o.artifactId)?.checkId !== c.id) fail("invalid_artifact");
    if (this.observations.has(o.id)) fail("immutable_observation");
    this.observations.set(o.id, clone(o)); return clone(o);
  }
  async getObservation(ownerId: string, id: string) { const o = this.observations.get(id); return clone(o && this.read(o.checkId, ownerId) ? o : null); }
  async listObservations(ownerId: string, checkId: string) { if (!this.read(checkId, ownerId)) return []; return clone([...this.observations.values()].filter((o) => o.checkId === checkId)); }
  async saveArtifact(ownerId: string, input: ArtifactInput) {
    const c = this.owned(ownerId, input.checkId), a = artifactRecord(input, this.now());
    if (input.runId && (input.runId !== c.runId || c.state === "cancel_requested" || !active.has(c.state))) fail("stale_run");
    const current = [...this.artifacts.values()].filter((x) => x.expiresAt > this.now().toISOString());
    if (current.filter((x) => x.checkId === c.id && x.kind === a.kind).length >= (a.kind === "input" ? 4 : 3)) fail("artifact_case_cap");
    if (current.reduce((sum, x) => sum + x.byteLength, 0) + a.byteLength > ARTIFACT_CAP) fail("artifact_storage_cap");
    this.artifacts.set(a.id, a); return clone(a);
  }
  async getArtifact(ownerId: string, id: string) { const a = this.artifacts.get(id); return clone(a && a.expiresAt > this.now().toISOString() && this.read(a.checkId, ownerId) ? a : null); }
  async listArtifacts(ownerId: string, checkId: string) { if (!this.read(checkId, ownerId)) return []; return clone([...this.artifacts.values()].filter((a) => a.checkId === checkId && a.expiresAt > this.now().toISOString())); }
  async appendMessage(ownerId: string, value: MessageInput) {
    const input = messageSchema.parse(value); this.evidence(ownerId, input.checkId, input.evidenceIds ?? []);
    if ([...this.messages.values()].filter((m) => m.checkId === input.checkId).length >= 100) fail("message_cap");
    const m: CheckMessage = { ...input, id: nanoid(), evidenceIds: input.evidenceIds ?? [], createdAt: this.now().toISOString() }; this.messages.set(m.id, m); return clone(m);
  }
  async listMessages(ownerId: string, checkId: string) { if (!this.read(checkId, ownerId)) return []; return clone([...this.messages.values()].filter((m) => m.checkId === checkId)); }
  async submitWarning(ownerId: string, value: WarningDraftInput) {
    const input = warningSchema.parse(value), now = this.now(), evidence = this.evidence(ownerId, input.checkId, input.evidenceIds);
    validateWarningEvidence(this.owned(ownerId, input.checkId), input.hostname, evidence);
    if ([...this.warnings.values()].filter((w) => w.ownerId === ownerId && w.createdAt.startsWith(now.toISOString().slice(0, 10))).length >= 3) fail("warning_daily_quota");
    const w = warningRecord(ownerId, input, evidence, now); this.warnings.set(w.id, w); return clone(w);
  }
  async listWarnings(ownerId: string) { identity(ownerId); return clone([...this.warnings.values()].filter((w) => w.ownerId === ownerId).map((w) => w.expiresAt <= this.now().toISOString() ? { ...w, evidence: [] } : w)); }
  async getPublicWarnings(query = "") { return clone([...this.publicWarnings.values()].filter((w) => w.hostname.includes(query.toLowerCase().slice(0, 253))).map((w) => ({ ...w, status: w.status === "active" && w.expiresAt <= this.now().toISOString() ? "expired" as const : w.status }))); }
  async getWarning(id: string) { return (await this.getPublicWarnings()).find((w) => w.id === id) ?? null; }
  async getReviewQueue(reviewerId: string) { if (!await this.hasRole(reviewerId, "reviewer")) fail("forbidden"); return clone([...this.warnings.values()].filter((w) => w.status === "pending" && w.expiresAt > this.now().toISOString())); }
  async reviewWarning(reviewerId: string, id: string, value: ReviewInput) {
    const input = reviewSchema.parse(value); if (!await this.hasRole(reviewerId, "reviewer")) fail("forbidden");
    const w = this.warnings.get(id), now = this.now();
    if (!w || w.status !== "pending" || w.revision !== input.expectedRevision || w.expiresAt <= now.toISOString() || !this.read(w.checkId)) fail("review_conflict");
    if (input.decision === "approve") {
      const pub = publicRecord(w, now); this.publicWarnings.set(w.id, pub);
      this.publications.set(`${w.id}:${pub.revision}`, { warningId: w.id, revision: pub.revision, kind: "publish", ...pub.publication! });
      this.enqueue("publish_warning", w.id, pub.revision, pub.publication!.operationId);
    }
    w.status = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "needs_information"; w.revision++; w.reviewerId = reviewerId; w.reviewReason = input.reason; w.reviewedAt = now.toISOString(); return clone(w);
  }
  async hasRole(ownerId: string, role: ScamwinRole) { return this.roles.has(`${ownerId}:${role}`) || this.roles.has(`${ownerId}:admin`); }
  async grantRole(actorId: string, ownerId: string, role: ScamwinRole) { if (!await this.hasRole(actorId, "admin")) fail("forbidden"); identity(ownerId); if (!["reviewer", "admin"].includes(role)) fail("invalid_role"); this.roles.add(`${ownerId}:${role}`); }
  private enqueue(kind: OutboxJob["kind"], aggregateId: string, generation: number, idempotencyKey: string) {
    const id = nanoid(); this.outbox.set(id, { id, kind, aggregateId, generation, idempotencyKey, state: "pending", attempts: 0 });
  }
  async leaseOutbox(limit = 10, kinds: OutboxJob["kind"][] = ["investigate", "publish_warning", "retract_warning"]) {
    const allowedKinds = outboxKindsSchema.parse(kinds);
    const now = this.now(), jobs = [...this.outbox.values()].filter((j) => allowedKinds.includes(j.kind) && j.attempts < 3 && (j.state === "pending" || j.state === "failed" || (j.state === "leased" && (j.leaseUntil ?? "") <= now.toISOString()))).filter((j) => j.kind === "investigate" ? this.read(j.aggregateId)?.generation === j.generation && ["queued", "validating", "collecting", "analyzing"].includes(this.read(j.aggregateId)!.state) : this.publicWarnings.get(j.aggregateId)?.revision === j.generation && (j.kind === "retract_warning" || this.warnings.get(j.aggregateId)?.status === "approved")).slice(0, Math.min(20, Math.max(1, limit)));
    for (const j of jobs) { j.state = "leased"; j.attempts++; j.leaseUntil = new Date(now.getTime() + 60000).toISOString(); }
    return clone(jobs);
  }
  async finishOutbox(id: string, expectedAttempt: number, status: "dispatched" | "failed") {
    const j = this.outbox.get(id); if (!j || j.state !== "leased" || j.attempts !== expectedAttempt || (j.leaseUntil ?? "") <= this.now().toISOString()) return false;
    j.state = status; delete j.leaseUntil; return true;
  }
  async purgeExpired(): Promise<PurgeResult> {
    const now = this.now(), result = { artifacts: 0, checks: 0, reviews: 0, runs: 0 };
    for (const row of this.liveViews.values()) if (row.expiresAt <= now.toISOString()) this.retireLiveViews(row.scope.checkId, "expired");
    for (const [id, a] of this.artifacts) if (a.expiresAt <= now.toISOString()) { this.artifacts.delete(id); result.artifacts++; }
    for (const w of this.warnings.values()) if (w.expiresAt <= now.toISOString() && (w.evidence.length || w.status === "pending")) { w.evidence = []; if (w.status === "pending") { w.status = "withdrawn"; w.revision++; } result.reviews++; }
    for (const c of this.checks.values()) {
      if (!this.deleted.has(c.id) && c.expiresAt <= now.toISOString()) {
        c.state = "canceled"; c.stages = finishInterruptedStages(c.stages, "canceled", now.toISOString());
        this.retireLiveViews(c.id, "expired");
        this.deleted.add(c.id); c.input = { url: "", message: "", promisedBenefit: "", intendedAction: "", images: [] }; delete c.intent; delete c.assessment; delete c.relatedCases;
        for (const [id, o] of this.observations) if (o.checkId === c.id) this.observations.delete(id);
        for (const [id, m] of this.messages) if (m.checkId === c.id) this.messages.delete(id);
        for (const [id, a] of this.artifacts) if (a.checkId === c.id) { this.artifacts.delete(id); result.artifacts++; }
        for (const [id, indicator] of this.indicators) if (indicator.checkId === c.id) this.indicators.delete(id);
        for (const w of this.warnings.values()) if (w.checkId === c.id && w.status === "pending") { w.evidence = []; w.status = "withdrawn"; w.revision++; }
        result.checks++;
      }
      else if (!this.deleted.has(c.id) && this.expireOverdue(c)) result.runs++;
    }
    for (const job of this.outbox.values()) if (job.kind === "investigate" && this.read(job.aggregateId)?.generation !== job.generation && job.state !== "dispatched") job.state = "revoked";
    return result;
  }
  async retractWarning(reviewerId: string, id: string, input: { reason: string; expectedRevision: number }) {
    if (!await this.hasRole(reviewerId, "reviewer")) fail("forbidden"); reviewSchema.parse({ ...input, decision: "reject" });
    const w = this.publicWarnings.get(id); if (!w || w.revision !== input.expectedRevision || [...this.publications.values()].some((p) => p.warningId === id && p.signedRawTransaction && !["finalized", "failed"].includes(p.status))) fail("review_conflict");
    const prior = [...this.publications.values()].filter((p) => p.warningId === id), onChain = prior.some((p) => p.kind === "publish" && (p.signedRawTransaction || ["submitted", "included", "safe", "finalized"].includes(p.status)));
    for (const p of prior) if (!p.signedRawTransaction && ["queued", "unavailable", "failed"].includes(p.status)) {
      p.status = "failed"; for (const job of this.outbox.values()) if (job.idempotencyKey === p.operationId) job.state = "revoked";
    }
    w.status = "retracted"; w.revision++; w.publication = { status: onChain ? "queued" : "local_only", chainId: 84532, operationId: `scamwin:retract:${id}:${w.revision}` };
    if (onChain) { this.publications.set(`${id}:${w.revision}`, { warningId: id, revision: w.revision, kind: "retract", ...w.publication }); this.enqueue("retract_warning", id, w.revision, w.publication.operationId); }
    return clone(w);
  }
  async getPublication(id: string, revision: number) { return clone(this.publications.get(`${id}:${revision}`) ?? null); }
  async leasePublication(id: string, expectedRevision: number, kind: "publish" | "retract" = "publish") {
    const p = this.publications.get(`${id}:${expectedRevision}`), now = this.now();
    if (this.operations.publicationPaused && !p?.signedRawTransaction) return null;
    if (!p || p.kind !== kind || this.publicWarnings.get(id)?.revision !== expectedRevision || [...this.publications.values()].some((other) => (other.leaseUntil ?? "") > now.toISOString() || (other !== p && Boolean(other.signedRawTransaction) && !["finalized", "failed"].includes(other.status)))) return null;
    if (!p.signedRawTransaction && p.kind === "publish" && (this.warnings.get(id)?.status !== "approved" || this.warnings.get(id)!.expiresAt <= now.toISOString() || !this.read(this.warnings.get(id)!.checkId))) return null;
    p.leaseUntil = new Date(now.getTime() + 120000).toISOString(); p.leaseToken = nanoid(); return clone(p);
  }
  async reservePublicationFee(id: string, revision: number, estimatedFeeWei: string, leaseToken?: string) {
    if (!/^\d+$/.test(estimatedFeeWei)) return false; const fee = BigInt(estimatedFeeWei), p = this.publications.get(`${id}:${revision}`), day = this.now().toISOString().slice(0, 10);
    if (!p || p.leaseToken !== leaseToken || (p.leaseUntil ?? "") <= this.now().toISOString() || fee > BigInt("1000000000000000")) return false;
    if (this.feeReservations.some((r) => r.key === p.operationId)) return p.reservedFeeWei === estimatedFeeWei;
    const today = this.feeReservations.filter((r) => r.day === day); if (today.length >= 25 || today.reduce((sum, r) => sum + r.fee, BigInt(0)) + fee > BigInt("5000000000000000")) return false;
    this.feeReservations.push({ key: p.operationId, day, fee }); p.reservedFeeWei = estimatedFeeWei; return true;
  }
  async updatePublication(id: string, expectedRevision: number, patch: PublicationPatch) {
    patch = publicationPatchSchema.parse(patch);
    const w = this.publicWarnings.get(id), p = this.publications.get(`${id}:${expectedRevision}`); if (!w || !p || w.revision !== expectedRevision) return null;
    if (p.signedRawTransaction && patch.signedRawTransaction && p.signedRawTransaction !== patch.signedRawTransaction) fail("signed_transaction_immutable");
    if (p.signedRawTransaction && ((patch.transactionHash && patch.transactionHash !== p.transactionHash) || (patch.nonce !== undefined && patch.nonce !== p.nonce))) fail("signed_transaction_immutable");
    if (patch.status === "signed" && (!patch.signedRawTransaction || !patch.transactionHash || patch.nonce === undefined)) fail("signed_transaction_required");
    if (patch.signedRawTransaction && (!p.leaseToken || patch.leaseToken !== p.leaseToken || (p.leaseUntil ?? "") <= this.now().toISOString() || !p.reservedFeeWei)) fail("publication_lease_required");
    Object.assign(p, clone(patch)); w.publication = { status: p.status, chainId: p.chainId, operationId: p.operationId, ...(p.transactionHash ? { transactionHash: p.transactionHash } : {}) }; return clone(w);
  }
  async listPendingPublications(limit = 20) {
    return [...this.publications.values()].filter((p) => !["finalized", "failed", "local_only"].includes(p.status)).filter((p) => {
      if (p.signedRawTransaction) return true;
      if (this.publicWarnings.get(p.warningId)?.revision !== p.revision) return false;
      const consent = this.warnings.get(p.warningId);
      return p.kind === "retract" || Boolean(consent?.status === "approved" && consent.expiresAt > this.now().toISOString() && this.read(consent.checkId));
    }).sort((a, b) => Number(Boolean(b.signedRawTransaction)) - Number(Boolean(a.signedRawTransaction))).slice(0, Math.max(1, Math.min(50, limit))).map((p) => ({ warningId: p.warningId, kind: p.kind === "retract" ? "retract_warning" as const : "publish_warning" as const }));
  }
  async saveIndicators(ownerId: string, checkId: string, value: IndicatorFingerprint[]) {
    const parsed = indicatorsSchema.parse(value), c = this.owned(ownerId, checkId);
    if (!["queued", "validating", "collecting", "analyzing"].includes(c.state)) fail("stale_run");
    const entries = parsed.map((p) => ({ id: hash(JSON.stringify([ownerId, checkId, p.kind, p.fingerprint])), ...p, ownerId, checkId }));
    const unique = new Set([...this.indicators.entries()].filter(([, i]) => i.checkId === checkId).map(([id]) => id)); entries.forEach((e) => unique.add(e.id));
    if (unique.size > 20) fail("indicator_case_cap");
    for (const { id, ...indicator } of entries) if (!this.indicators.has(id)) this.indicators.set(id, indicator);
  }
  async findRelatedCases(ownerId: string, checkId: string, value: IndicatorFingerprint[]) {
    this.owned(ownerId, checkId); const parsed = indicatorsSchema.parse(value), found = new Map<string, { checkId: string; kind: IndicatorKind }>();
    for (const indicator of this.indicators.values()) if (indicator.ownerId === ownerId && indicator.checkId !== checkId && this.read(indicator.checkId, ownerId) && parsed.some((p) => p.kind === indicator.kind && p.fingerprint === indicator.fingerprint)) found.set(`${indicator.checkId}:${indicator.kind}`, { checkId: indicator.checkId, kind: indicator.kind });
    return [...found.values()].slice(0, 100);
  }
  async getOperationalState() { return clone(this.operations); }
  async setOperationalPause(adminId: string, scope: "investigation" | "publication", paused: boolean) {
    operationalPauseSchema.parse({ scope, paused }); if (!await this.hasRole(adminId, "admin")) fail("forbidden");
    const updatedAt = this.now().toISOString(); this.operations[scope === "investigation" ? "investigationPaused" : "publicationPaused"] = paused; this.operations.updatedAt = updatedAt;
    this.operationalAudit.push({ action: `pause_${scope}`, code: paused ? "paused" : "resumed", at: updatedAt });
  }
}

/** Neon HTTP transactions use a first-statement advisory lock, then a fresh
 * READ COMMITTED statement snapshot. Counts and admission writes are therefore
 * serialized across app instances. Never rely on an in-memory production lock. */
export class PostgresStore implements ScamwinStore {
  private sql: NeonQueryFunction<false, false>;
  private trustedAdmins: Set<string>;
  constructor(databaseUrl: string, options: { trustedAdminSubjects?: string[] } = {}) { if (!databaseUrl) fail("database_unavailable", "DATABASE_URL is required for Scamwin storage."); this.sql = neon(databaseUrl); this.trustedAdmins = new Set(options.trustedAdminSubjects ?? []); }
  async putLiveView(value: LiveViewScope, recordValue: LiveViewRecord) {
    const scope = liveScopeSchema.parse(value), record = liveRecordSchema.parse(recordValue);
    if (!validLiveRecord(scope, record, new Date())) return false;
    const sql = this.sql, results = await sql.transaction([
      // Separate statements are intentional: after waiting on cancellation's row
      // lock, READ COMMITTED must take a fresh snapshot before eligibility.
      sql`SELECT id FROM scamwin_checks WHERE id=${scope.checkId} FOR UPDATE`,
      sql`INSERT INTO scamwin_live_views(session_id,owner_id,check_id,run_id,generation,status,encrypted_locator,created_at,expires_at,ended_at,reason_code)
        SELECT ${record.sessionId},${scope.ownerId},c.id,${scope.runId},${scope.generation},${record.status},${record.encryptedLocator},${record.createdAt}::timestamptz,${record.expiresAt}::timestamptz,${record.endedAt ?? null}::timestamptz,${record.reasonCode ?? null}
        FROM scamwin_checks c JOIN scamwin_runs r ON r.id=${scope.runId} AND r.check_id=c.id AND r.generation=${scope.generation}
        WHERE c.id=${scope.checkId} AND c.owner_id=${scope.ownerId} AND c.generation=${scope.generation} AND c.record->>'runId'=${scope.runId}
          AND c.state='collecting' AND c.deleted_at IS NULL AND c.expires_at>now() AND c.record->>'cancelRequestedAt' IS NULL
          AND c.created_at>now()-interval '300 seconds' AND r.deadline>now() AND ${record.expiresAt}::timestamptz<=r.deadline AND ${record.expiresAt}::timestamptz<=c.created_at+interval '300 seconds' AND ${record.expiresAt}::timestamptz>now()
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.record->'stages') s WHERE s->>'id'='browser' AND s->>'status'='running')
        ON CONFLICT DO NOTHING RETURNING session_id`,
    ], { isolationLevel: "ReadCommitted" });
    return results[1].length > 0;
  }
  async getLiveView(ownerId: string, checkId: string, expectedRun: { runId: string; generation: number }): Promise<LiveViewRecord | null> {
    identity(ownerId);
    await this.expireOverdue(ownerId, checkId);
    const rows = await this.sql`SELECT v.session_id,v.owner_id,v.check_id,v.run_id,v.generation,v.created_at,v.expires_at,v.connected_at,
      CASE WHEN v.expires_at<=now() THEN 'ended' ELSE v.status END AS status,
      CASE WHEN v.expires_at<=now() THEN NULL ELSE v.encrypted_locator END AS encrypted_locator,
      CASE WHEN v.expires_at<=now() THEN COALESCE(v.ended_at,v.expires_at) ELSE v.ended_at END AS ended_at,
      CASE WHEN v.expires_at<=now() THEN 'expired' ELSE v.reason_code END AS reason_code
      FROM scamwin_live_views v JOIN scamwin_checks c ON c.id=v.check_id JOIN scamwin_runs r ON r.id=v.run_id AND r.check_id=c.id AND r.generation=v.generation
      WHERE c.id=${checkId} AND c.owner_id=${ownerId} AND v.owner_id=${ownerId} AND v.run_id=${expectedRun.runId} AND v.generation=${expectedRun.generation}
        AND c.generation=v.generation AND c.record->>'runId'=v.run_id AND c.state='collecting' AND c.record->>'cancelRequestedAt' IS NULL
        AND c.deleted_at IS NULL AND c.expires_at>now() AND c.created_at>now()-interval '300 seconds' AND r.deadline>now()
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.record->'stages') s WHERE s->>'id'='browser' AND s->>'status'='running')`;
    const row = rows[0];
    return row ? { sessionId: row.session_id, scope: { ownerId: row.owner_id, checkId: row.check_id, runId: row.run_id, generation: row.generation }, status: row.status, encryptedLocator: row.encrypted_locator, createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), ...(row.connected_at ? { connectedAt: new Date(row.connected_at).toISOString() } : {}), ...(row.ended_at ? { endedAt: new Date(row.ended_at).toISOString() } : {}), ...(row.reason_code ? { reasonCode: row.reason_code } : {}) } : null;
  }
  async updateLiveView(value: LiveViewScope, sessionId: string, patchValue: LiveViewPatch) {
    const scope = liveScopeSchema.parse(value), patch = livePatchSchema.parse(patchValue), sql = this.sql, results = await sql.transaction([
      sql`SELECT id FROM scamwin_checks WHERE id=${scope.checkId} FOR UPDATE`,
      sql`UPDATE scamwin_live_views v SET status=${patch.status},
        encrypted_locator=CASE WHEN ${patch.status}='connected' THEN v.encrypted_locator ELSE NULL END,
        connected_at=CASE WHEN ${patch.status}='connected' THEN COALESCE(v.connected_at,${patch.status === "connected" ? patch.connectedAt ?? null : null}::timestamptz,now()) ELSE v.connected_at END,
        ended_at=CASE WHEN ${patch.status}='connected' THEN v.ended_at ELSE COALESCE(${patch.status !== "connected" ? patch.endedAt ?? null : null}::timestamptz,now()) END,
        reason_code=CASE WHEN ${patch.status}='connected' THEN v.reason_code ELSE ${patch.status !== "connected" ? patch.reasonCode ?? null : null} END
        WHERE v.session_id=${sessionId} AND v.owner_id=${scope.ownerId} AND v.check_id=${scope.checkId} AND v.run_id=${scope.runId} AND v.generation=${scope.generation} AND v.status IN('ready','connected')
        AND (${patch.status} IN('ended','unavailable') OR (v.expires_at>now() AND EXISTS(SELECT 1 FROM scamwin_checks c JOIN scamwin_runs r ON r.id=v.run_id AND r.check_id=c.id AND r.generation=v.generation
          WHERE c.id=v.check_id AND c.owner_id=v.owner_id AND c.generation=v.generation AND c.record->>'runId'=v.run_id AND c.state='collecting'
            AND c.deleted_at IS NULL AND c.record->>'cancelRequestedAt' IS NULL AND c.expires_at>now() AND c.created_at>now()-interval '300 seconds' AND r.deadline>now()
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.record->'stages') s WHERE s->>'id'='browser' AND s->>'status'='running')))) RETURNING v.session_id`,
    ], { isolationLevel: "ReadCommitted" });
    return results[1].length > 0;
  }
  private async view(c: CheckRecord | null): Promise<CheckRecord | null> {
    if (!c) return null;
    const rows = await this.sql`SELECT id,record FROM scamwin_artifacts WHERE check_id=${c.id} AND owner_id=${c.ownerId} AND kind='input' AND expires_at>now()`;
    c.input.images = c.input.images.map((image, i) => ({ ...image, dataUrl: (rows.find((a) => a.id === c.inputArtifactIds?.[i])?.record as Artifact | undefined)?.dataUrl ?? "" }));
    return c;
  }
  private async expireOverdue(ownerId?: string, id?: string) {
    const sql = this.sql;
    await sql.transaction([
      sql`SELECT id FROM scamwin_checks WHERE deleted_at IS NULL AND created_at<=now()-interval '300 seconds' AND state IN('queued','validating','collecting','analyzing','cancel_requested') AND (${ownerId ?? null}::text IS NULL OR owner_id=${ownerId ?? null}) AND (${id ?? null}::text IS NULL OR id=${id ?? null}) ORDER BY id FOR UPDATE`,
      sql`WITH overdue AS (UPDATE scamwin_checks SET state=CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'failed' END,generation=generation+1,revision=revision+1,updated_at=now(),record=record||jsonb_build_object('state',CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'failed' END,'generation',generation+1,'revision',revision+1,'errorCode','deadline_exceeded','updatedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'stages',(SELECT COALESCE(jsonb_agg(CASE WHEN stage->>'status'='running' THEN stage||jsonb_build_object('status',CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'unavailable' END,'finishedAt',COALESCE(stage->>'finishedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHEN stage->>'status'='pending' THEN stage||jsonb_build_object('status','skipped') ELSE stage END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(record->'stages') WITH ORDINALITY AS terminal_stages(stage,ordinal))) WHERE deleted_at IS NULL AND created_at<=now()-interval '300 seconds' AND state IN('queued','validating','collecting','analyzing','cancel_requested') AND (${ownerId ?? null}::text IS NULL OR owner_id=${ownerId ?? null}) AND (${id ?? null}::text IS NULL OR id=${id ?? null}) RETURNING id),
      live_views AS (UPDATE scamwin_live_views SET status='ended',encrypted_locator=NULL,ended_at=now(),reason_code='deadline_exceeded' WHERE check_id IN(SELECT id FROM overdue) AND status IN('ready','connected')),
      runs AS (UPDATE scamwin_runs SET state='failed',cleanup_state='pending' WHERE check_id IN(SELECT id FROM overdue)),
      outbox AS (UPDATE scamwin_job_outbox SET state='revoked' WHERE kind='investigate' AND aggregate_id IN(SELECT id FROM overdue) AND state<>'dispatched') SELECT id FROM overdue`,
    ], { isolationLevel: "ReadCommitted" });
  }
  private async owned(ownerId: string, id: string) { return await this.getCheck(ownerId, id) ?? fail("not_found"); }
  private async evidence(ownerId: string, checkId: string, ids: string[]) {
    await this.owned(ownerId, checkId); const all = await this.listObservations(ownerId, checkId);
    return ids.map((id) => all.find((o) => o.id === id) ?? fail("invalid_evidence"));
  }
  async createCheck(ownerId: string, input: CheckInput, submissionKey: string) {
    const now = new Date(), c = newCheck(ownerId, input, submissionKey, now), images = separateImages(c, now), sql = this.sql;
    const allowanceKey = dailyCheckAllowanceKey(ownerId);
    const result = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-admission'))`,
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-artifacts'))`,
      sql`SELECT id FROM scamwin_checks WHERE deleted_at IS NULL AND (created_at<=now()-interval '300 seconds' OR expires_at<=now()) AND state IN('queued','validating','collecting','analyzing','cancel_requested') ORDER BY id FOR UPDATE`,
      sql`WITH overdue AS (UPDATE scamwin_checks SET state=CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'failed' END,generation=generation+1,revision=revision+1,updated_at=now(),record=record||jsonb_build_object('state',CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'failed' END,'generation',generation+1,'revision',revision+1,'errorCode','deadline_exceeded','updatedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'stages',(SELECT COALESCE(jsonb_agg(CASE WHEN stage->>'status'='running' THEN stage||jsonb_build_object('status',CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'unavailable' END,'finishedAt',COALESCE(stage->>'finishedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHEN stage->>'status'='pending' THEN stage||jsonb_build_object('status','skipped') ELSE stage END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(record->'stages') WITH ORDINALITY AS terminal_stages(stage,ordinal))) WHERE deleted_at IS NULL AND created_at<=now()-interval '300 seconds' AND state IN('queued','validating','collecting','analyzing','cancel_requested') RETURNING id), live_views AS (UPDATE scamwin_live_views SET status='ended',encrypted_locator=NULL,ended_at=now(),reason_code='deadline_exceeded' WHERE check_id IN(SELECT id FROM overdue) AND status IN('ready','connected')), runs AS (UPDATE scamwin_runs SET state='failed',cleanup_state='pending' WHERE check_id IN(SELECT id FROM overdue)), outbox AS (UPDATE scamwin_job_outbox SET state='revoked' WHERE kind='investigate' AND aggregate_id IN(SELECT id FROM overdue) AND state<>'dispatched') SELECT id FROM overdue`,
      sql`WITH expired AS (UPDATE scamwin_checks SET state='canceled',generation=generation+1,revision=revision+1,record=record||jsonb_build_object('state','canceled','generation',generation+1,'revision',revision+1,'stages',(SELECT COALESCE(jsonb_agg(CASE WHEN stage->>'status'='running' THEN stage||jsonb_build_object('status','canceled','finishedAt',COALESCE(stage->>'finishedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHEN stage->>'status'='pending' THEN stage||jsonb_build_object('status','skipped') ELSE stage END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(record->'stages') WITH ORDINALITY AS terminal_stages(stage,ordinal))) WHERE expires_at<=now() AND state IN('queued','validating','collecting','analyzing','cancel_requested') RETURNING id)
        UPDATE scamwin_live_views SET status='ended',encrypted_locator=NULL,ended_at=now(),reason_code='expired' WHERE check_id IN(SELECT id FROM expired) AND status IN('ready','connected')`,
      sql`WITH existing AS (SELECT record, deleted_at, expires_at FROM scamwin_checks WHERE owner_id=${ownerId} AND submission_key=${submissionKey}),
        limits AS (SELECT CASE
          WHEN EXISTS (SELECT 1 FROM scamwin_registry_sync WHERE id='scamwin-operations' AND record->>'investigationPaused'='true') THEN 'investigation_paused'
          WHEN (SELECT count(*) FROM scamwin_runs WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') >= 10 THEN 'global_daily_quota'
          WHEN (SELECT count(*) FROM scamwin_runs WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') >= 50 THEN 'global_monthly_quota'
          WHEN (SELECT count(*) FROM scamwin_runs WHERE owner_id=${ownerId} AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') >= CASE WHEN EXISTS (
            SELECT 1 FROM scamwin_registry_sync WHERE id=${allowanceKey} AND deployment=${allowanceKey}
              AND record=jsonb_build_object('schemaVersion',1,'ownerId',${ownerId}::text,'dailyLimit',5,'utcDay',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),'expiresAt',to_char(date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          ) THEN 5 ELSE 3 END THEN 'owner_daily_quota'
          WHEN EXISTS (SELECT 1 FROM scamwin_checks WHERE owner_id=${ownerId} AND deleted_at IS NULL AND expires_at>now() AND state IN ('queued','validating','collecting','analyzing','cancel_requested')) THEN 'active_check'
          WHEN (SELECT count(*) FROM scamwin_checks WHERE deleted_at IS NULL AND expires_at>now() AND state IN ('queued','validating','collecting','analyzing','cancel_requested')) >= 2 THEN 'global_active_quota'
          WHEN (SELECT COALESCE(sum(bytes),0) FROM scamwin_artifacts WHERE expires_at>now())+${images.reduce((sum, a) => sum + a.byteLength, 0)} > ${ARTIFACT_CAP} THEN 'artifact_storage_cap' ELSE NULL END AS error),
        inserted AS (INSERT INTO scamwin_checks(id,owner_id,submission_key,state,generation,revision,record,expires_at)
          SELECT ${c.id},${ownerId},${submissionKey},'queued',1,0,${JSON.stringify(c)}::jsonb,${c.expiresAt}::timestamptz
          WHERE NOT EXISTS(SELECT 1 FROM existing) AND (SELECT error FROM limits) IS NULL RETURNING record),
        run AS (INSERT INTO scamwin_runs(id,check_id,generation,state,deadline,owner_id)
          SELECT ${c.runId},${c.id},1,'queued',now()+interval '300 seconds',${ownerId} FROM inserted RETURNING id),
        images AS (INSERT INTO scamwin_artifacts(id,check_id,owner_id,run_id,kind,bytes,sha256,record,expires_at)
          SELECT a->>'id',${c.id},${ownerId},NULL,'input',(a->>'byteLength')::integer,a->>'sha256',a,(a->>'expiresAt')::timestamptz
          FROM jsonb_array_elements(${JSON.stringify(images)}::jsonb) a WHERE EXISTS(SELECT 1 FROM inserted)),
        outbox AS (INSERT INTO scamwin_job_outbox(id,kind,aggregate_id,generation,idempotency_key)
          SELECT ${nanoid()},'investigate',${c.id},1,${`scamwin:${c.id}:1`} FROM run RETURNING id)
        SELECT record,NULL::text AS error FROM existing WHERE deleted_at IS NULL AND expires_at>now() AND record->>'submissionHash'=${c.submissionHash!}
        UNION ALL SELECT record,NULL FROM inserted
        UNION ALL SELECT NULL::jsonb,CASE WHEN EXISTS(SELECT 1 FROM existing WHERE record->>'submissionHash'<>${c.submissionHash!}) THEN 'submission_conflict' WHEN EXISTS(SELECT 1 FROM existing) THEN 'submission_expired' ELSE (SELECT error FROM limits) END
          WHERE NOT EXISTS(SELECT 1 FROM inserted) AND NOT EXISTS(SELECT 1 FROM existing WHERE deleted_at IS NULL AND expires_at>now() AND record->>'submissionHash'=${c.submissionHash!})`,
    ], { isolationLevel: "ReadCommitted" });
    const row = result[result.length - 1][0]; if (!row?.record) fail(String(row?.error ?? "admission_failed")); return (await this.view(row.record as CheckRecord))!;
  }
  async getCheck(ownerId: string, id: string) { identity(ownerId); await this.expireOverdue(ownerId, id); const rows = await this.sql`SELECT record FROM scamwin_checks WHERE id=${id} AND owner_id=${ownerId} AND deleted_at IS NULL AND expires_at>now()`; return this.view((rows[0]?.record as CheckRecord) ?? null); }
  async getInternalCheck(id: string) { await this.expireOverdue(undefined, id); const rows = await this.sql`SELECT record FROM scamwin_checks WHERE id=${id} AND deleted_at IS NULL AND expires_at>now()`; return this.view((rows[0]?.record as CheckRecord) ?? null); }
  async listChecks(ownerId: string, options: { page?: number; query?: string }): Promise<CheckPage> {
    identity(ownerId); await this.expireOverdue(ownerId); const page = Math.max(1, Math.floor(options.page ?? 1)), query = (options.query ?? "").slice(0, 200).toLowerCase();
    const result = await this.sql`WITH matches AS (SELECT record,created_at FROM scamwin_checks WHERE owner_id=${ownerId} AND deleted_at IS NULL AND expires_at>now() AND position(${query} in lower(concat_ws(' ',record->'input'->>'url',record->'input'->>'message',record->'input'->>'promisedBenefit',record->'input'->>'intendedAction')))>0)
      SELECT (SELECT count(*) FROM matches)::int AS total, COALESCE((SELECT jsonb_agg(record) FROM (SELECT record FROM matches ORDER BY created_at DESC LIMIT 20 OFFSET ${(page - 1) * 20}) p),'[]'::jsonb) AS checks`;
    return { checks: await Promise.all((result[0].checks as CheckRecord[]).map(async (c) => (await this.view(c))!)), total: Number(result[0].total), page, pageSize: 20 };
  }
  async claimRun(id: string, generation: number) {
    const rows = await this.sql`WITH claimed AS (UPDATE scamwin_checks SET state='validating',revision=revision+1,updated_at=now(),record=record||jsonb_build_object('state','validating','revision',revision+1,'updatedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHERE id=${id} AND generation=${generation} AND state='queued' AND deleted_at IS NULL AND expires_at>now() AND created_at>now()-interval '300 seconds' RETURNING record),
      run AS (UPDATE scamwin_runs SET state='validating',heartbeat=now() WHERE check_id=${id} AND generation=${generation} AND EXISTS(SELECT 1 FROM claimed)) SELECT record FROM claimed`;
    return this.view((rows[0]?.record as CheckRecord) ?? null);
  }
  async updateRun(id: string, generation: number, expectedRevision: number, value: RunPatch) {
    const current = await this.getInternalCheck(id); if (!current) return null; const patch = checkPatch(current, value);
    if (patch.assessment) await this.evidence(current.ownerId, id, patch.assessment.findings.flatMap((f) => f.evidenceIds));
    for (const related of patch.relatedCases ?? []) await this.owned(current.ownerId, related.checkId);
    const sql = this.sql, results = await sql.transaction([
      sql`SELECT id FROM scamwin_checks WHERE id=${id} FOR UPDATE`,
      sql`WITH updated AS (UPDATE scamwin_checks SET state=COALESCE(${patch.state ?? null},state),revision=revision+1,updated_at=now(),record=record||${JSON.stringify(patch)}::jsonb||jsonb_build_object('revision',revision+1,'updatedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))||CASE WHEN COALESCE(${patch.state ?? null},state) NOT IN('queued','validating','collecting','analyzing','cancel_requested') THEN jsonb_build_object('stages',(SELECT COALESCE(jsonb_agg(CASE WHEN stage->>'status'='running' THEN stage||jsonb_build_object('status',CASE WHEN ${patch.state ?? null}='canceled' THEN 'canceled' ELSE 'unavailable' END,'finishedAt',COALESCE(stage->>'finishedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHEN stage->>'status'='pending' THEN stage||jsonb_build_object('status','skipped') ELSE stage END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements((record||${JSON.stringify(patch)}::jsonb)->'stages') WITH ORDINALITY AS terminal_stages(stage,ordinal))) ELSE '{}'::jsonb END WHERE id=${id} AND generation=${generation} AND revision=${expectedRevision} AND deleted_at IS NULL AND expires_at>now() AND (state IN ('queued','validating','collecting','analyzing') OR (state='cancel_requested' AND ${patch.state ?? ""}='canceled')) RETURNING record),
      live_views AS (UPDATE scamwin_live_views SET status='ended',encrypted_locator=NULL,ended_at=now(),reason_code='collection_ended' WHERE check_id=${id} AND run_id=${current.runId} AND generation=${generation} AND status IN('ready','connected') AND EXISTS(SELECT 1 FROM updated WHERE record->>'state'<>'collecting' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(record->'stages') s WHERE s->>'id'='browser' AND s->>'status'='running'))),
      run AS (UPDATE scamwin_runs SET state=COALESCE(${patch.state ?? null},state),heartbeat=now() WHERE check_id=${id} AND generation=${generation} AND EXISTS(SELECT 1 FROM updated)),
      assessment AS (INSERT INTO scamwin_assessments(id,check_id,run_id,record,policy_version) SELECT ${nanoid()},${id},${current.runId},${JSON.stringify(patch.assessment ?? null)}::jsonb,'1' WHERE ${Boolean(patch.assessment)} AND EXISTS(SELECT 1 FROM updated) ON CONFLICT (run_id) DO NOTHING) SELECT record FROM updated`,
    ], { isolationLevel: "ReadCommitted" });
    return this.view((results[1][0]?.record as CheckRecord) ?? null);
  }
  async requestCancel(ownerId: string, id: string) {
    const sql = this.sql, results = await sql.transaction([
      sql`SELECT id FROM scamwin_checks WHERE id=${id} FOR UPDATE`,
      sql`WITH canceled AS (UPDATE scamwin_checks SET state=CASE WHEN state='queued' THEN 'canceled' ELSE 'cancel_requested' END,revision=revision+1,updated_at=now(),record=record||jsonb_build_object('state',CASE WHEN state='queued' THEN 'canceled' ELSE 'cancel_requested' END,'revision',revision+1,'cancelRequestedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'stages',(SELECT COALESCE(jsonb_agg(CASE WHEN stage->>'status'='running' THEN stage||jsonb_build_object('status','canceled','finishedAt',COALESCE(stage->>'finishedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHEN stage->>'status'='pending' THEN stage||jsonb_build_object('status','skipped') ELSE stage END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(record->'stages') WITH ORDINALITY AS terminal_stages(stage,ordinal))) WHERE id=${id} AND owner_id=${ownerId} AND deleted_at IS NULL AND expires_at>now() AND state IN ('queued','validating','collecting','analyzing') RETURNING id,record),
      live_views AS (UPDATE scamwin_live_views SET status='ended',encrypted_locator=NULL,ended_at=now(),reason_code='canceled' WHERE check_id IN(SELECT id FROM canceled) AND status IN('ready','connected')),
      run AS (UPDATE scamwin_runs SET state='canceled' WHERE check_id IN(SELECT id FROM canceled WHERE record->>'state'='canceled')) SELECT record FROM canceled`,
    ], { isolationLevel: "ReadCommitted" });
    const rows = results[1];
    return rows[0]?.record ? this.view(rows[0].record as CheckRecord) : this.getCheck(ownerId, id);
  }
  async deleteCheck(ownerId: string, id: string) {
    const sql = this.sql, results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`SELECT id FROM scamwin_checks WHERE id=${id} FOR UPDATE`,
      sql`WITH removed AS (UPDATE scamwin_checks SET deleted_at=now(),state='canceled',generation=generation+1,revision=revision+1,record=(record-'intent'-'assessment'-'relatedCases')||jsonb_build_object('state','canceled','stages',(SELECT COALESCE(jsonb_agg(CASE WHEN stage->>'status'='running' THEN stage||jsonb_build_object('status','canceled','finishedAt',COALESCE(stage->>'finishedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHEN stage->>'status'='pending' THEN stage||jsonb_build_object('status','skipped') ELSE stage END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(record->'stages') WITH ORDINALITY AS terminal_stages(stage,ordinal)),'input',jsonb_build_object('url','','message','','promisedBenefit','','intendedAction','','images','[]'::jsonb)) WHERE id=${id} AND owner_id=${ownerId} AND deleted_at IS NULL RETURNING id),
      revocable AS (SELECT w.id FROM scamwin_warning_submissions w JOIN scamwin_publications p ON p.warning_id=w.id JOIN scamwin_job_outbox o ON o.idempotency_key=p.operation_id WHERE w.check_id IN(SELECT id FROM removed) AND p.status='queued' AND o.state IN('pending','failed') AND (o.lease_until IS NULL OR o.lease_until<=now()) AND (p.record->>'leaseUntil' IS NULL OR (p.record->>'leaseUntil')::timestamptz<=now())),
      warnings AS (UPDATE scamwin_warning_submissions SET status='withdrawn',revision=revision+1,record=record||jsonb_build_object('status','withdrawn','revision',revision+1,'evidence','[]'::jsonb) WHERE check_id IN(SELECT id FROM removed) AND (status IN('pending','needs_information') OR id IN(SELECT id FROM revocable))),
      public AS (UPDATE scamwin_public_warnings SET status='retracted',revision=revision+1,record=record||jsonb_build_object('status','retracted','revision',revision+1,'publication',(record->'publication')||jsonb_build_object('status','failed')) WHERE id IN(SELECT id FROM revocable)),
      publications AS (UPDATE scamwin_publications SET status='failed',record=record||jsonb_build_object('status','failed') WHERE warning_id IN(SELECT id FROM revocable)),
      outbox AS (UPDATE scamwin_job_outbox SET state='revoked' WHERE (aggregate_id IN(SELECT id FROM removed) OR aggregate_id IN(SELECT id FROM revocable)) AND state IN('pending','failed')),
      assessments AS (DELETE FROM scamwin_assessments WHERE check_id IN(SELECT id FROM removed)), indicators AS (DELETE FROM scamwin_indicators WHERE check_id IN(SELECT id FROM removed)),
      live_views AS (UPDATE scamwin_live_views SET status='ended',encrypted_locator=NULL,ended_at=now(),reason_code='deleted' WHERE check_id IN(SELECT id FROM removed) AND status IN('ready','connected')),
      runs AS (UPDATE scamwin_runs SET state='canceled',cleanup_state='pending' WHERE check_id IN(SELECT id FROM removed)),
      artifacts AS (DELETE FROM scamwin_artifacts WHERE check_id IN(SELECT id FROM removed)), observations AS (DELETE FROM scamwin_observations WHERE check_id IN(SELECT id FROM removed)), messages AS (DELETE FROM scamwin_messages WHERE check_id IN(SELECT id FROM removed)) SELECT id FROM removed`,
    ], { isolationLevel: "ReadCommitted" }); return results[2].length > 0;
  }
  async saveObservation(ownerId: string, value: Observation) {
    const o = observationSchema.parse(value);
    const rows = await this.sql`INSERT INTO scamwin_observations(id,check_id,run_id,owner_id,kind,record,observed_at)
      SELECT ${o.id},${o.checkId},${o.runId},${ownerId},${o.kind},${JSON.stringify(o)}::jsonb,${o.observedAt}::timestamptz FROM scamwin_checks c
      WHERE c.id=${o.checkId} AND c.owner_id=${ownerId} AND c.record->>'runId'=${o.runId} AND c.deleted_at IS NULL AND c.expires_at>now() AND c.state IN('queued','validating','collecting','analyzing')
      AND (${o.artifactId ?? null}::text IS NULL OR EXISTS(SELECT 1 FROM scamwin_artifacts a WHERE a.id=${o.artifactId ?? null} AND a.check_id=c.id AND a.expires_at>now())) FOR UPDATE OF c
      ON CONFLICT (id) DO NOTHING RETURNING record`;
    return (rows[0]?.record as Observation) ?? fail("stale_or_immutable_observation");
  }
  async getObservation(ownerId: string, id: string) { const rows = await this.sql`SELECT o.record FROM scamwin_observations o JOIN scamwin_checks c ON c.id=o.check_id WHERE o.id=${id} AND c.owner_id=${ownerId} AND c.deleted_at IS NULL AND c.expires_at>now()`; return (rows[0]?.record as Observation) ?? null; }
  async listObservations(ownerId: string, checkId: string) { const rows = await this.sql`SELECT o.record FROM scamwin_observations o JOIN scamwin_checks c ON c.id=o.check_id WHERE c.id=${checkId} AND c.owner_id=${ownerId} AND c.deleted_at IS NULL AND c.expires_at>now() ORDER BY o.observed_at`; return rows.map((r) => r.record as Observation); }
  async saveArtifact(ownerId: string, input: ArtifactInput) {
    const a = artifactRecord(input, new Date()), sql = this.sql;
    const results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-artifacts'))`,
      sql`INSERT INTO scamwin_artifacts(id,check_id,owner_id,run_id,kind,bytes,sha256,record,expires_at)
        SELECT ${a.id},${a.checkId},${ownerId},${a.runId ?? null},${a.kind},${a.byteLength},${a.sha256},${JSON.stringify(a)}::jsonb,${a.expiresAt}::timestamptz FROM scamwin_checks c
        WHERE c.id=${a.checkId} AND c.owner_id=${ownerId} AND c.deleted_at IS NULL AND c.expires_at>now()
        AND (${a.runId ?? null}::text IS NULL OR (c.record->>'runId'=${a.runId ?? null} AND c.state IN('queued','validating','collecting','analyzing')))
        AND (SELECT count(*) FROM scamwin_artifacts WHERE check_id=c.id AND kind=${a.kind} AND expires_at>now()) < ${a.kind === "input" ? 4 : 3}
        AND (SELECT COALESCE(sum(bytes),0) FROM scamwin_artifacts WHERE expires_at>now())+${a.byteLength} <= ${ARTIFACT_CAP} FOR UPDATE OF c RETURNING record`,
    ], { isolationLevel: "ReadCommitted" }); return (results[1][0]?.record as Artifact) ?? fail("artifact_unavailable_or_cap");
  }
  async getArtifact(ownerId: string, id: string) { const rows = await this.sql`SELECT a.record FROM scamwin_artifacts a JOIN scamwin_checks c ON c.id=a.check_id WHERE a.id=${id} AND c.owner_id=${ownerId} AND c.deleted_at IS NULL AND c.expires_at>now() AND a.expires_at>now()`; return (rows[0]?.record as Artifact) ?? null; }
  async listArtifacts(ownerId: string, checkId: string) { const rows = await this.sql`SELECT a.record FROM scamwin_artifacts a JOIN scamwin_checks c ON c.id=a.check_id WHERE c.id=${checkId} AND c.owner_id=${ownerId} AND c.deleted_at IS NULL AND c.expires_at>now() AND a.expires_at>now() ORDER BY a.created_at`; return rows.map((r) => r.record as Artifact); }
  async appendMessage(ownerId: string, value: MessageInput) {
    const input = messageSchema.parse(value); await this.evidence(ownerId, input.checkId, input.evidenceIds ?? []);
    const m: CheckMessage = { ...input, id: nanoid(), evidenceIds: input.evidenceIds ?? [], createdAt: new Date().toISOString() };
    const sql = this.sql, results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext(${`scamwin-message:${m.checkId}`}))`,
      sql`INSERT INTO scamwin_messages(id,check_id,owner_id,record) SELECT ${m.id},${m.checkId},${ownerId},${JSON.stringify(m)}::jsonb FROM scamwin_checks c WHERE c.id=${m.checkId} AND c.owner_id=${ownerId} AND c.deleted_at IS NULL AND c.expires_at>now() AND (SELECT count(*) FROM scamwin_messages WHERE check_id=c.id)<100 FOR UPDATE OF c RETURNING record`,
    ], { isolationLevel: "ReadCommitted" }); return (results[1][0]?.record as CheckMessage) ?? fail("message_unavailable_or_cap");
  }
  async listMessages(ownerId: string, checkId: string) { const rows = await this.sql`SELECT m.record FROM scamwin_messages m JOIN scamwin_checks c ON c.id=m.check_id WHERE c.id=${checkId} AND c.owner_id=${ownerId} AND c.deleted_at IS NULL AND c.expires_at>now() ORDER BY m.created_at`; return rows.map((r) => r.record as CheckMessage); }
  async submitWarning(ownerId: string, value: WarningDraftInput) {
    const input = warningSchema.parse(value), evidence = await this.evidence(ownerId, input.checkId, input.evidenceIds), w = warningRecord(ownerId, input, evidence, new Date()), sql = this.sql;
    validateWarningEvidence(await this.owned(ownerId, input.checkId), input.hostname, evidence);
    const results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`INSERT INTO scamwin_warning_submissions(id,owner_id,check_id,status,revision,payload_hash,record,expires_at)
        SELECT ${w.id},${ownerId},${w.checkId},'pending',1,${w.payloadHash},${JSON.stringify(w)}::jsonb,${w.expiresAt}::timestamptz FROM scamwin_checks c WHERE c.id=${w.checkId} AND c.owner_id=${ownerId} AND c.deleted_at IS NULL AND c.expires_at>now()
        AND (SELECT count(*) FROM scamwin_warning_submissions WHERE owner_id=${ownerId} AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')<3 RETURNING record`,
    ], { isolationLevel: "ReadCommitted" }); return (results[1][0]?.record as WarningSubmission) ?? fail("warning_unavailable_or_quota");
  }
  async listWarnings(ownerId: string) { const rows = await this.sql`SELECT record FROM scamwin_warning_submissions WHERE owner_id=${ownerId} ORDER BY created_at DESC`; return rows.map((r) => { const w = r.record as WarningSubmission; if (w.expiresAt <= new Date().toISOString()) w.evidence = []; return w; }); }
  async getPublicWarnings(query = "") { const rows = await this.sql`SELECT record FROM scamwin_public_warnings WHERE position(${query.toLowerCase().slice(0, 253)} in hostname)>0 ORDER BY created_at DESC LIMIT 100`; return rows.map((r) => { const w = r.record as PublicWarning; if (w.status === "active" && w.expiresAt <= new Date().toISOString()) w.status = "expired"; return w; }); }
  async getWarning(id: string) { const rows = await this.sql`SELECT record FROM scamwin_public_warnings WHERE id=${id}`; const w = rows[0]?.record as PublicWarning | undefined; if (w?.status === "active" && w.expiresAt <= new Date().toISOString()) w.status = "expired"; return w ?? null; }
  async getReviewQueue(reviewerId: string) { if (!await this.hasRole(reviewerId, "reviewer")) fail("forbidden"); const rows = await this.sql`SELECT w.record FROM scamwin_warning_submissions w JOIN scamwin_checks c ON c.id=w.check_id WHERE w.status='pending' AND w.expires_at>now() AND c.deleted_at IS NULL AND c.expires_at>now() ORDER BY w.created_at LIMIT 100`; return rows.map((r) => r.record as WarningSubmission); }
  async reviewWarning(reviewerId: string, id: string, value: ReviewInput) {
    const input = reviewSchema.parse(value); if (!await this.hasRole(reviewerId, "reviewer")) fail("forbidden");
    const found = await this.sql`SELECT record FROM scamwin_warning_submissions WHERE id=${id}`, current = found[0]?.record as WarningSubmission | undefined;
    if (!current) fail("review_conflict"); const now = new Date(), pub = publicRecord(current, now), sql = this.sql;
    const results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`WITH reviewed AS (UPDATE scamwin_warning_submissions w SET status=${input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "needs_information"},revision=w.revision+1,record=w.record||${JSON.stringify({ status: input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "needs_information", revision: input.expectedRevision + 1, reviewerId, reviewReason: input.reason, reviewedAt: now.toISOString() })}::jsonb
        WHERE w.id=${id} AND w.status='pending' AND w.revision=${input.expectedRevision} AND w.payload_hash=${current.payloadHash} AND w.expires_at>now()
        AND EXISTS(SELECT 1 FROM scamwin_checks c WHERE c.id=w.check_id AND c.deleted_at IS NULL AND c.expires_at>now())
        AND (${this.trustedAdmins.has(reviewerId)} OR EXISTS(SELECT 1 FROM scamwin_roles WHERE owner_id=${reviewerId} AND role IN('reviewer','admin'))) RETURNING w.record),
      public AS (INSERT INTO scamwin_public_warnings(id,hostname,status,revision,record,expires_at) SELECT ${pub.id},${pub.hostname},'active',${pub.revision},${JSON.stringify(pub)}::jsonb,${pub.expiresAt}::timestamptz FROM reviewed WHERE ${input.decision === "approve"} RETURNING id),
      publication AS (INSERT INTO scamwin_publications(id,warning_id,revision,operation_id,status,record) SELECT ${nanoid()},${pub.id},${pub.revision},${pub.publication!.operationId},'queued',${JSON.stringify({ warningId: pub.id, revision: pub.revision, kind: "publish", ...pub.publication })}::jsonb FROM public RETURNING id),
      outbox AS (INSERT INTO scamwin_job_outbox(id,kind,aggregate_id,generation,idempotency_key) SELECT ${nanoid()},'publish_warning',${pub.id},${pub.revision},${pub.publication!.operationId} FROM publication),
      audit AS (INSERT INTO scamwin_audit_events(id,actor_class,action,object_id,code) SELECT ${nanoid()},'reviewer','review',${id},${input.decision} FROM reviewed) SELECT record FROM reviewed`,
    ], { isolationLevel: "ReadCommitted" }); return (results[1][0]?.record as WarningSubmission) ?? fail("review_conflict");
  }
  async hasRole(ownerId: string, role: ScamwinRole) { if (this.trustedAdmins.has(ownerId)) return true; const rows = await this.sql`SELECT 1 FROM scamwin_roles WHERE owner_id=${ownerId} AND role IN(${role},'admin') LIMIT 1`; return rows.length > 0; }
  async grantRole(actorId: string, ownerId: string, role: ScamwinRole) {
    identity(ownerId); if (!["reviewer", "admin"].includes(role)) fail("invalid_role");
    const rows = await this.sql`INSERT INTO scamwin_roles(id,owner_id,role) SELECT ${nanoid()},${ownerId},${role} WHERE ${this.trustedAdmins.has(actorId)} OR EXISTS(SELECT 1 FROM scamwin_roles WHERE owner_id=${actorId} AND role='admin') ON CONFLICT(owner_id,role) DO UPDATE SET role=EXCLUDED.role RETURNING id`;
    if (!rows.length) fail("forbidden");
  }
  async leaseOutbox(limit = 10, kinds: OutboxJob["kind"][] = ["investigate", "publish_warning", "retract_warning"]): Promise<OutboxJob[]> {
    const allowedKinds = outboxKindsSchema.parse(kinds), sql = this.sql, results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`WITH selected AS (SELECT o.id FROM scamwin_job_outbox o WHERE o.kind=ANY(${allowedKinds}::text[]) AND o.attempts<3 AND (o.state IN('pending','failed') OR (o.state='leased' AND o.lease_until<=now()))
        AND ((o.kind='investigate' AND EXISTS(SELECT 1 FROM scamwin_checks c WHERE c.id=o.aggregate_id AND c.generation=o.generation AND c.deleted_at IS NULL AND c.expires_at>now() AND c.state IN('queued','validating','collecting','analyzing')))
        OR (o.kind IN('publish_warning','retract_warning') AND EXISTS(SELECT 1 FROM scamwin_public_warnings w WHERE w.id=o.aggregate_id AND w.revision=o.generation AND (o.kind='retract_warning' OR EXISTS(SELECT 1 FROM scamwin_warning_submissions s WHERE s.id=w.id AND s.status='approved'))))) ORDER BY o.created_at LIMIT ${Math.min(20, Math.max(1, Math.floor(limit)))} FOR UPDATE OF o SKIP LOCKED)
      UPDATE scamwin_job_outbox SET state='leased',attempts=attempts+1,lease_until=now()+interval '60 seconds' WHERE id IN(SELECT id FROM selected) RETURNING *`,
    ], { isolationLevel: "ReadCommitted" }); return results[1].map((r) => ({ id: r.id, kind: r.kind, aggregateId: r.aggregate_id, generation: r.generation, idempotencyKey: r.idempotency_key, state: r.state, attempts: r.attempts, leaseUntil: new Date(r.lease_until).toISOString() }));
  }
  async finishOutbox(id: string, expectedAttempt: number, status: "dispatched" | "failed") {
    if (!["dispatched", "failed"].includes(status)) fail("invalid_outbox_state");
    const rows = await this.sql`UPDATE scamwin_job_outbox SET state=${status},lease_until=NULL WHERE id=${id} AND attempts=${expectedAttempt} AND state='leased' AND lease_until>now() RETURNING id`; return rows.length>0;
  }
  async purgeExpired(): Promise<PurgeResult> {
    const sql = this.sql, results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`SELECT id FROM scamwin_checks WHERE deleted_at IS NULL AND (expires_at<=now() OR (created_at<=now()-interval '300 seconds' AND state IN('queued','validating','collecting','analyzing','cancel_requested'))) ORDER BY id FOR UPDATE`,
      sql`WITH overdue AS (UPDATE scamwin_checks SET state=CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'failed' END,generation=generation+1,revision=revision+1,updated_at=now(),record=record||jsonb_build_object('state',CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'failed' END,'generation',generation+1,'revision',revision+1,'errorCode','deadline_exceeded','updatedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'stages',(SELECT COALESCE(jsonb_agg(CASE WHEN stage->>'status'='running' THEN stage||jsonb_build_object('status',CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'unavailable' END,'finishedAt',COALESCE(stage->>'finishedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHEN stage->>'status'='pending' THEN stage||jsonb_build_object('status','skipped') ELSE stage END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(record->'stages') WITH ORDINALITY AS terminal_stages(stage,ordinal))) WHERE deleted_at IS NULL AND expires_at>now() AND created_at<=now()-interval '300 seconds' AND state IN('queued','validating','collecting','analyzing','cancel_requested') RETURNING id),
        expired AS (UPDATE scamwin_checks SET deleted_at=now(),state='canceled',generation=generation+1,revision=revision+1,record=(record-'intent'-'assessment'-'relatedCases')||jsonb_build_object('state','canceled','stages',(SELECT COALESCE(jsonb_agg(CASE WHEN stage->>'status'='running' THEN stage||jsonb_build_object('status','canceled','finishedAt',COALESCE(stage->>'finishedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHEN stage->>'status'='pending' THEN stage||jsonb_build_object('status','skipped') ELSE stage END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(record->'stages') WITH ORDINALITY AS terminal_stages(stage,ordinal)),'input',jsonb_build_object('url','','message','','promisedBenefit','','intendedAction','','images','[]'::jsonb)) WHERE deleted_at IS NULL AND expires_at<=now() RETURNING id),
        live_views AS (UPDATE scamwin_live_views SET status='ended',encrypted_locator=NULL,ended_at=now(),reason_code='expired' WHERE (expires_at<=now() OR check_id IN(SELECT id FROM overdue UNION ALL SELECT id FROM expired)) AND status IN('ready','connected')),
        artifacts AS (DELETE FROM scamwin_artifacts WHERE expires_at<=now() OR check_id IN(SELECT id FROM expired) RETURNING id),
        observations AS (DELETE FROM scamwin_observations WHERE check_id IN(SELECT id FROM expired)), messages AS (DELETE FROM scamwin_messages WHERE check_id IN(SELECT id FROM expired)), assessments AS (DELETE FROM scamwin_assessments WHERE check_id IN(SELECT id FROM expired)), indicators AS (DELETE FROM scamwin_indicators WHERE check_id IN(SELECT id FROM expired)),
        reviews AS (UPDATE scamwin_warning_submissions SET status=CASE WHEN status='pending' THEN 'withdrawn' ELSE status END,record=record||jsonb_build_object('evidence','[]'::jsonb,'status',CASE WHEN status='pending' THEN 'withdrawn' ELSE status END) WHERE (expires_at<=now() OR check_id IN(SELECT id FROM expired)) AND (record->'evidence'<>'[]'::jsonb OR status='pending') RETURNING id),
        outbox AS (UPDATE scamwin_job_outbox SET state='revoked' WHERE aggregate_id IN(SELECT id FROM expired UNION ALL SELECT id FROM overdue) AND kind='investigate' AND state<>'dispatched'),
        runs AS (UPDATE scamwin_runs SET state='failed',cleanup_state='pending' WHERE check_id IN(SELECT id FROM overdue UNION ALL SELECT id FROM expired)),
        audit AS (DELETE FROM scamwin_audit_events WHERE created_at<now()-interval '90 days')
      SELECT (SELECT count(*) FROM artifacts)::int AS artifacts,(SELECT count(*) FROM expired)::int AS checks,(SELECT count(*) FROM reviews)::int AS reviews,(SELECT count(*) FROM overdue)::int AS runs`,
    ], { isolationLevel: "ReadCommitted" }); return results[2][0] as PurgeResult;
  }
  async retractWarning(reviewerId: string, id: string, input: { reason: string; expectedRevision: number }) {
    if (!await this.hasRole(reviewerId, "reviewer")) fail("forbidden"); reviewSchema.parse({ ...input, decision: "reject" });
    const current = await this.getWarning(id); if (!current || current.revision !== input.expectedRevision) fail("review_conflict");
    const pub: PublicWarning = { ...current, status: "retracted", revision: current.revision+1, publication: { status: "queued", chainId: 84532, operationId: `scamwin:retract:${id}:${current.revision+1}` } }, sql = this.sql;
    const results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`WITH changed AS (UPDATE scamwin_public_warnings SET status='retracted',revision=revision+1,record=CASE WHEN EXISTS(SELECT 1 FROM scamwin_publications WHERE warning_id=${id} AND record->>'kind'='publish' AND (record->>'signedRawTransaction' IS NOT NULL OR status IN('submitted','included','safe','finalized'))) THEN ${JSON.stringify(pub)}::jsonb ELSE jsonb_set(${JSON.stringify(pub)}::jsonb,'{publication,status}','"local_only"'::jsonb) END WHERE id=${id} AND revision=${input.expectedRevision} AND NOT EXISTS(SELECT 1 FROM scamwin_publications WHERE warning_id=${id} AND record->>'signedRawTransaction' IS NOT NULL AND status NOT IN('finalized','failed')) RETURNING record),
        obsolete AS (UPDATE scamwin_publications SET status='failed',record=record||jsonb_build_object('status','failed') WHERE warning_id=${id} AND revision<=${input.expectedRevision} AND record->>'signedRawTransaction' IS NULL AND status IN('queued','unavailable','failed') AND EXISTS(SELECT 1 FROM changed) RETURNING operation_id),
        revoke AS (UPDATE scamwin_job_outbox SET state='revoked' WHERE idempotency_key IN(SELECT operation_id FROM obsolete)),
        publication AS (INSERT INTO scamwin_publications(id,warning_id,revision,operation_id,status,record) SELECT ${nanoid()},${id},${pub.revision},${pub.publication!.operationId},'queued',${JSON.stringify({ warningId: id, revision: pub.revision, kind: "retract", ...pub.publication })}::jsonb FROM changed WHERE record->'publication'->>'status'='queued' RETURNING id),
        outbox AS (INSERT INTO scamwin_job_outbox(id,kind,aggregate_id,generation,idempotency_key) SELECT ${nanoid()},'retract_warning',${id},${pub.revision},${pub.publication!.operationId} FROM publication),
        audit AS (INSERT INTO scamwin_audit_events(id,actor_class,action,object_id,code) SELECT ${nanoid()},'reviewer','retract',${id},'reviewed' FROM changed) SELECT record FROM changed`,
    ], { isolationLevel: "ReadCommitted" }); return (results[1][0]?.record as PublicWarning) ?? fail("review_conflict");
  }
  async getPublication(id: string, revision: number) { const rows = await this.sql`SELECT record FROM scamwin_publications WHERE warning_id=${id} AND revision=${revision}`; return (rows[0]?.record as PublicationRecord) ?? null; }
  async leasePublication(id: string, expectedRevision: number, kind: "publish" | "retract" = "publish") {
    const sql = this.sql, token = nanoid(), results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`UPDATE scamwin_publications p SET record=p.record||jsonb_build_object('leaseToken',${token}::text,'leaseUntil',to_char((now()+interval '120 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        WHERE p.warning_id=${id} AND p.revision=${expectedRevision} AND p.record->>'kind'=${kind} AND p.status NOT IN('finalized','failed')
        AND EXISTS(SELECT 1 FROM scamwin_public_warnings w WHERE w.id=p.warning_id AND w.revision=p.revision)
        AND (p.record->>'signedRawTransaction' IS NOT NULL OR NOT EXISTS(SELECT 1 FROM scamwin_registry_sync WHERE id='scamwin-operations' AND record->>'publicationPaused'='true'))
        AND NOT EXISTS(SELECT 1 FROM scamwin_publications q WHERE (q.record->>'leaseUntil')::timestamptz>now() OR (q.id<>p.id AND q.record->>'signedRawTransaction' IS NOT NULL AND q.status NOT IN('finalized','failed')))
        AND (p.record->>'signedRawTransaction' IS NOT NULL OR ${kind === "retract"} OR EXISTS(SELECT 1 FROM scamwin_warning_submissions s JOIN scamwin_checks c ON c.id=s.check_id WHERE s.id=p.warning_id AND s.status='approved' AND s.revision=p.revision AND c.deleted_at IS NULL AND c.expires_at>now() AND s.expires_at>now())) RETURNING p.record`,
    ], { isolationLevel: "ReadCommitted" }); return (results[1][0]?.record as PublicationRecord) ?? null;
  }
  async reservePublicationFee(id: string, revision: number, estimatedFeeWei: string, leaseToken?: string) {
    if (!/^\d+$/.test(estimatedFeeWei) || BigInt(estimatedFeeWei)>BigInt("1000000000000000")) return false;
    const sql = this.sql, results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`UPDATE scamwin_publications p SET record=CASE WHEN record->>'reservedFeeWei' IS NULL THEN record||jsonb_build_object('reservedFeeWei',${estimatedFeeWei}::text,'feeReservedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ELSE record END WHERE warning_id=${id} AND revision=${revision} AND record->>'leaseToken'=${leaseToken ?? ""} AND (record->>'leaseUntil')::timestamptz>now()
        AND ((record->>'reservedFeeWei')=${estimatedFeeWei} OR (record->>'reservedFeeWei' IS NULL AND (SELECT count(*) FROM scamwin_publications WHERE (record->>'feeReservedAt')::timestamptz>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')<25 AND (SELECT COALESCE(sum((record->>'reservedFeeWei')::numeric),0) FROM scamwin_publications WHERE (record->>'feeReservedAt')::timestamptz>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+${estimatedFeeWei}::numeric<=5000000000000000)) RETURNING id`,
    ], { isolationLevel: "ReadCommitted" }); return results[1].length>0;
  }
  async updatePublication(id: string, expectedRevision: number, value: PublicationPatch) {
    const patch = publicationPatchSchema.parse(value), current = await this.getPublication(id, expectedRevision); if (!current) return null;
    if (current.signedRawTransaction && patch.signedRawTransaction && current.signedRawTransaction !== patch.signedRawTransaction) fail("signed_transaction_immutable");
    if (current.signedRawTransaction && ((patch.transactionHash && patch.transactionHash !== current.transactionHash) || (patch.nonce !== undefined && patch.nonce !== current.nonce))) fail("signed_transaction_immutable");
    if (patch.status === "signed" && (!patch.signedRawTransaction || !patch.transactionHash || patch.nonce === undefined)) fail("signed_transaction_required");
    const projection = { status: patch.status, chainId: current.chainId, operationId: current.operationId, ...(patch.transactionHash ?? current.transactionHash ? { transactionHash: patch.transactionHash ?? current.transactionHash } : {}) }, sql = this.sql;
    const results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`WITH changed AS (UPDATE scamwin_publications p SET status=${patch.status},record=record||${JSON.stringify(patch)}::jsonb WHERE warning_id=${id} AND revision=${expectedRevision} AND EXISTS(SELECT 1 FROM scamwin_public_warnings w WHERE w.id=p.warning_id AND w.revision=p.revision)
        AND (${!patch.signedRawTransaction} OR (record->>'leaseToken'=${patch.leaseToken ?? ""} AND (record->>'leaseUntil')::timestamptz>now() AND record->>'reservedFeeWei' IS NOT NULL AND (record->>'signedRawTransaction' IS NULL OR record->>'signedRawTransaction'=${patch.signedRawTransaction ?? ""}))) RETURNING warning_id)
      UPDATE scamwin_public_warnings SET record=record||jsonb_build_object('publication',${JSON.stringify(projection)}::jsonb) WHERE id IN(SELECT warning_id FROM changed) AND revision=${expectedRevision} RETURNING record`,
    ], { isolationLevel: "ReadCommitted" }); return (results[1][0]?.record as PublicWarning) ?? null;
  }
  async listPendingPublications(limit = 20) {
    const rows = await this.sql`SELECT p.warning_id,p.record->>'kind' AS kind FROM scamwin_publications p WHERE p.status NOT IN('finalized','failed','local_only')
      AND (p.record->>'signedRawTransaction' IS NOT NULL OR EXISTS(SELECT 1 FROM scamwin_public_warnings w WHERE w.id=p.warning_id AND w.revision=p.revision AND (p.record->>'kind'='retract' OR EXISTS(SELECT 1 FROM scamwin_warning_submissions s JOIN scamwin_checks c ON c.id=s.check_id WHERE s.id=p.warning_id AND s.revision=p.revision AND s.status='approved' AND s.expires_at>now() AND c.deleted_at IS NULL AND c.expires_at>now()))))
      ORDER BY (p.record->>'signedRawTransaction' IS NOT NULL) DESC,p.created_at LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}`;
    return rows.map((r) => ({ warningId: r.warning_id as string, kind: r.kind === "retract" ? "retract_warning" as const : "publish_warning" as const }));
  }
  async saveIndicators(ownerId: string, checkId: string, value: IndicatorFingerprint[]) {
    const parsed = indicatorsSchema.parse(value); identity(ownerId); const entries = parsed.map((p) => ({ id: hash(JSON.stringify([ownerId, checkId, p.kind, p.fingerprint])), ...p })), sql = this.sql;
    await this.expireOverdue(ownerId, checkId);
    const results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext(${`scamwin-indicators:${checkId}`}))`,
      sql`WITH eligible AS (SELECT id FROM scamwin_checks WHERE id=${checkId} AND owner_id=${ownerId} AND deleted_at IS NULL AND expires_at>now() AND state IN('queued','validating','collecting','analyzing') FOR UPDATE),
        data AS (SELECT DISTINCT a->>'id' AS id,a->>'kind' AS kind,a->>'fingerprint' AS fingerprint FROM jsonb_array_elements(${JSON.stringify(entries)}::jsonb) a),
        missing AS (SELECT * FROM data WHERE NOT EXISTS(SELECT 1 FROM scamwin_indicators i WHERE i.id=data.id)),
        saved AS (INSERT INTO scamwin_indicators(id,check_id,owner_id,kind,fingerprint,value) SELECT m.id,${checkId},${ownerId},m.kind,m.fingerprint,'' FROM missing m WHERE EXISTS(SELECT 1 FROM eligible) AND (SELECT count(*) FROM scamwin_indicators WHERE check_id=${checkId})+(SELECT count(*) FROM missing)<=20 ON CONFLICT(id) DO NOTHING RETURNING id)
      SELECT EXISTS(SELECT 1 FROM eligible) AS allowed,(SELECT count(*) FROM scamwin_indicators WHERE check_id=${checkId})+(SELECT count(*) FROM missing)<=20 AS within_cap`,
    ], { isolationLevel: "ReadCommitted" });
    if (!results[1][0]?.allowed) fail("stale_or_missing_check"); if (!results[1][0]?.within_cap) fail("indicator_case_cap");
  }
  async findRelatedCases(ownerId: string, checkId: string, value: IndicatorFingerprint[]) {
    await this.owned(ownerId, checkId); const parsed = indicatorsSchema.parse(value);
    const rows = await this.sql`SELECT DISTINCT i.check_id,i.kind FROM scamwin_indicators i JOIN scamwin_checks c ON c.id=i.check_id JOIN jsonb_to_recordset(${JSON.stringify(parsed)}::jsonb) AS f(kind text,fingerprint text) ON f.kind=i.kind AND f.fingerprint=i.fingerprint WHERE i.owner_id=${ownerId} AND c.owner_id=${ownerId} AND c.id<>${checkId} AND c.deleted_at IS NULL AND c.expires_at>now() ORDER BY i.check_id,i.kind LIMIT 100`;
    return rows.map((r) => ({ checkId: r.check_id as string, kind: r.kind as IndicatorKind }));
  }
  async getOperationalState(): Promise<OperationalState> {
    const rows = await this.sql`SELECT record FROM scamwin_registry_sync WHERE id='scamwin-operations'`;
    return rows[0] ? operationalStateSchema.parse(rows[0].record) : { investigationPaused: false, publicationPaused: false };
  }
  async setOperationalPause(adminId: string, scope: "investigation" | "publication", paused: boolean) {
    operationalPauseSchema.parse({ scope, paused }); if (!await this.hasRole(adminId, "admin")) fail("forbidden");
    const patch = { [scope === "investigation" ? "investigationPaused" : "publicationPaused"]: paused, updatedAt: new Date().toISOString() }, sql = this.sql;
    const results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-admission'))`,
      sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-review'))`,
      sql`WITH changed AS (INSERT INTO scamwin_registry_sync(id,deployment,record) SELECT 'scamwin-operations','scamwin-operations',jsonb_build_object('investigationPaused',false,'publicationPaused',false)||${JSON.stringify(patch)}::jsonb WHERE ${this.trustedAdmins.has(adminId)} OR EXISTS(SELECT 1 FROM scamwin_roles WHERE owner_id=${adminId} AND role='admin')
        ON CONFLICT(id) DO UPDATE SET record=scamwin_registry_sync.record||${JSON.stringify(patch)}::jsonb,updated_at=now() RETURNING id),
        audit AS (INSERT INTO scamwin_audit_events(id,actor_class,action,object_id,code) SELECT ${nanoid()},'admin',${`pause_${scope}`},'scamwin-operations',${paused ? "paused" : "resumed"} FROM changed)
      SELECT id FROM changed`,
    ], { isolationLevel: "ReadCommitted" });
    if (!results[2].length) fail("forbidden");
  }
}

