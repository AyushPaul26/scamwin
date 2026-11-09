import { z } from "zod";
import type { LiveViewScope, LiveViewRecord, LiveViewPatch } from "./live-view-contracts";

export const checkStates = ["queued", "validating", "collecting", "analyzing", "completed", "partial", "blocked", "failed", "cancel_requested", "canceled"] as const;
export type CheckState = (typeof checkStates)[number];
export const risks = ["high_risk", "needs_caution", "no_observed_red_flags", "inconclusive"] as const;
export type Risk = (typeof risks)[number];
export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";
export type PreparedImage = { name: string; mediaType: ImageMediaType; dataUrl: string };
export type CheckInput = { url: string; message: string; promisedBenefit: string; intendedAction: string; images: PreparedImage[] };
export const offerIntentSchema = z.object({
  promisedBenefit: z.string().max(3000).nullable(), claimedOrganization: z.string().max(500).nullable(),
  intendedAction: z.string().max(3000).nullable(), requestedActions: z.array(z.string().max(1000)).max(20),
  extractedCandidates: z.array(z.object({ kind: z.string().max(80), value: z.string().max(4096), sourceRef: z.string().max(500) }).strict()).max(20),
  uncertainties: z.array(z.string().max(1000)).max(20),
}).strict();
export type OfferIntent = z.infer<typeof offerIntentSchema>;

// Bounded evidence records: no arbitrary nested model JSON or executable values.
const evidenceValueSchema = z.union([z.string().max(102400), z.number().finite(), z.boolean(), z.null(), z.array(z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()])).max(100)]);
export const observationDataSchema = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), evidenceValueSchema).refine((data) => Object.keys(data).length <= 40 && JSON.stringify(data).length <= 120000, "Evidence record is too large");
export type ObservationData = z.infer<typeof observationDataSchema>;
export const observationSchema = z.object({
  id: z.string().min(1).max(120), checkId: z.string().min(1).max(120), runId: z.string().min(1).max(120), kind: z.string().min(1).max(100),
  status: z.enum(["observed", "blocked", "unavailable", "not_checked", "not_applicable"]),
  sourceKind: z.enum(["user_text", "user_image", "live_page", "origin_probe", "official_source", "registry"]),
  sourceRef: z.string().max(4096), observedAt: z.string().datetime(), data: observationDataSchema,
  artifactId: z.string().max(120).nullable().optional(), collectorVersion: z.string().min(1).max(100), policyVersion: z.string().min(1).max(100),
}).strict();
export type Observation = z.infer<typeof observationSchema>;
export type ObservationStatus = Observation["status"];
export const assessmentSchema = z.object({
  schemaVersion: z.literal(1), risk: z.enum(risks), summary: z.string().min(1).max(6000),
  findings: z.array(z.object({ id: z.string().min(1).max(120), statement: z.string().min(1).max(3000), classification: z.enum(["observation", "inference"]), evidenceIds: z.array(z.string().max(120)).max(50) }).strict()).max(30),
  missingChecks: z.array(z.string().max(1000)).max(30), nextSteps: z.array(z.string().max(1000)).max(20),
}).strict();
export type Assessment = z.infer<typeof assessmentSchema>;
export type CheckStage = { id: string; label: string; status: "pending" | "running" | "completed" | "unavailable" | "blocked" | "skipped" | "canceled"; startedAt?: string; finishedAt?: string; detailCode?: string };
export type RelatedCase = { checkId: string; reason: string; evidenceIds: string[] };
export type IndicatorKind = "hostname" | "recipient" | "endpoint";
export type IndicatorFingerprint = { kind: IndicatorKind; fingerprint: string };
export type OperationalState = { investigationPaused: boolean; publicationPaused: boolean; updatedAt?: string };
export type CheckRecord = {
  id: string; ownerId: string; submissionKey: string; input: CheckInput; runId: string;
  state: CheckState; generation: number; revision: number; createdAt: string; updatedAt: string; expiresAt: string;
  cancelRequestedAt?: string; intent?: OfferIntent; assessment?: Assessment; stages: CheckStage[];
  errorCode?: string; availability?: string; relatedCases?: RelatedCase[];
  inputArtifactIds?: string[];
  submissionHash?: string;
};
export type RunPatch = Partial<Pick<CheckRecord, "state" | "intent" | "assessment" | "stages" | "errorCode" | "availability" | "relatedCases">>;
export type Artifact = { id: string; checkId: string; runId?: string; name: string; mediaType: ImageMediaType; dataUrl: string; kind: "input" | "capture"; byteLength: number; sha256: string; createdAt: string; expiresAt: string };
export type ArtifactInput = Pick<Artifact, "checkId" | "runId" | "name" | "mediaType" | "dataUrl" | "kind">;
export type CheckMessage = { id: string; checkId: string; role: "user" | "assistant"; content: string; evidenceIds: string[]; createdAt: string };
export type MessageInput = Pick<CheckMessage, "checkId" | "role" | "content"> & { evidenceIds?: string[] };
export type WarningDraftInput = { checkId: string; hostname: string; summary: string; category?: string; evidenceIds: string[]; consent: true };
export type WarningSubmission = { schemaVersion: 1; ttlSeconds: 604800; id: string; ownerId: string; checkId: string; hostname: string; summary: string; category: string; evidenceIds: string[]; evidence: Observation[]; consentAt: string; payloadHash: string; revision: number; status: "pending" | "approved" | "rejected" | "needs_information" | "withdrawn"; createdAt: string; expiresAt: string; reviewerId?: string; reviewReason?: string; reviewedAt?: string };
export type PublicationStatus = "queued" | "signed" | "submitted" | "included" | "safe" | "finalized" | "failed" | "unavailable" | "local_only";
export type PublicWarning = { id: string; hostname: string; summary: string; category: string; publisher: string; createdAt: string; expiresAt: string; status: "active" | "expired" | "retracted"; revision: number; publication?: { status: PublicationStatus; chainId: number; transactionHash?: string; operationId: string } };
export type PublicationRecord = { warningId: string; revision: number; operationId: string; kind: "publish" | "retract"; status: PublicationStatus; chainId: number; transactionHash?: string; signedRawTransaction?: string; nonce?: number; contractAddress?: string; publisherAddress?: string; leaseToken?: string; leaseUntil?: string; reservedFeeWei?: string; epoch?: string; assertionRevision?: number };
export type PublicationPatch = Partial<Omit<PublicationRecord, "warningId" | "revision" | "operationId" | "kind" | "chainId">> & { status: PublicationStatus };
export type OutboxJob = { id: string; kind: "investigate" | "publish_warning" | "retract_warning"; aggregateId: string; generation: number; idempotencyKey: string; state: "pending" | "leased" | "dispatched" | "failed" | "revoked"; attempts: number; leaseUntil?: string };
export type PurgeResult = { artifacts: number; checks: number; reviews: number; runs: number };
export type ReviewInput = { decision: "approve" | "reject" | "request_information"; reason: string; expectedRevision: number };
export type ScamwinRole = "reviewer" | "admin";
export type CheckPage = { checks: CheckRecord[]; total: number; page: number; pageSize: number };
export interface ScamwinStore {
  putLiveView(scope: LiveViewScope, record: LiveViewRecord): Promise<boolean>;
  getLiveView(ownerId: string, checkId: string, expectedRun: { runId: string; generation: number }): Promise<LiveViewRecord | null>;
  updateLiveView(scope: LiveViewScope, sessionId: string, patch: LiveViewPatch): Promise<boolean>;
  createCheck(ownerId: string, input: CheckInput, submissionKey: string): Promise<CheckRecord>;
  getCheck(ownerId: string, id: string): Promise<CheckRecord | null>;
  getInternalCheck(id: string): Promise<CheckRecord | null>;
  listChecks(ownerId: string, options: { page?: number; query?: string }): Promise<CheckPage>;
  claimRun(id: string, generation: number): Promise<CheckRecord | null>;
  updateRun(id: string, generation: number, expectedRevision: number, patch: RunPatch): Promise<CheckRecord | null>;
  requestCancel(ownerId: string, id: string): Promise<CheckRecord | null>;
  deleteCheck(ownerId: string, id: string): Promise<boolean>;
  saveObservation(ownerId: string, observation: Observation): Promise<Observation>;
  getObservation(ownerId: string, id: string): Promise<Observation | null>;
  listObservations(ownerId: string, checkId: string): Promise<Observation[]>;
  saveArtifact(ownerId: string, input: ArtifactInput): Promise<Artifact>;
  getArtifact(ownerId: string, id: string): Promise<Artifact | null>;
  listArtifacts(ownerId: string, checkId: string): Promise<Artifact[]>;
  appendMessage(ownerId: string, input: MessageInput): Promise<CheckMessage>;
  listMessages(ownerId: string, checkId: string): Promise<CheckMessage[]>;
  submitWarning(ownerId: string, input: WarningDraftInput): Promise<WarningSubmission>;
  listWarnings(ownerId: string): Promise<WarningSubmission[]>;
  getPublicWarnings(query?: string): Promise<PublicWarning[]>;
  getWarning(id: string): Promise<PublicWarning | null>;
  getReviewQueue(reviewerId: string): Promise<WarningSubmission[]>;
  reviewWarning(reviewerId: string, id: string, input: ReviewInput): Promise<WarningSubmission>;
  hasRole(ownerId: string, role: ScamwinRole): Promise<boolean>;
  grantRole(actorId: string, ownerId: string, role: ScamwinRole): Promise<void>;
  leaseOutbox(limit?: number, kinds?: OutboxJob["kind"][]): Promise<OutboxJob[]>;
  finishOutbox(id: string, expectedAttempt: number, status: "dispatched" | "failed"): Promise<boolean>;
  purgeExpired(): Promise<PurgeResult>;
  retractWarning(reviewerId: string, id: string, input: { reason: string; expectedRevision: number }): Promise<PublicWarning>;
  getPublication(id: string, revision: number): Promise<PublicationRecord | null>;
  leasePublication(id: string, expectedRevision: number, kind?: "publish" | "retract"): Promise<PublicationRecord | null>;
  reservePublicationFee(id: string, revision: number, estimatedFeeWei: string, leaseToken?: string): Promise<boolean>;
  updatePublication(id: string, expectedRevision: number, patch: PublicationPatch): Promise<PublicWarning | null>;
  listPendingPublications(limit?: number): Promise<{ warningId: string; kind: "publish_warning" | "retract_warning" }[]>;
  saveIndicators(ownerId: string, checkId: string, indicators: IndicatorFingerprint[]): Promise<void>;
  findRelatedCases(ownerId: string, checkId: string, fingerprints: IndicatorFingerprint[]): Promise<{ checkId: string; kind: IndicatorKind }[]>;
  getOperationalState(): Promise<OperationalState>;
  setOperationalPause(adminId: string, scope: "investigation" | "publication", paused: boolean): Promise<void>;
}
