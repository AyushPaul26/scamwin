import { z } from 'zod';
import { checkInputSchema } from '../input';
import type {OAuthPersistence,ActivationBaseline} from './oauth-contracts';

export const providerIds = ['gmail', 'outlook', 'telegram', 'slack', 'teams', 'discord', 'drive', 'extension'] as const;
export const connectionModes = ['manual', 'selective', 'all_new'] as const;
export const itemStates = ['pending_sync', 'queued', 'checking', 'quota_paused', 'paused', 'result_ready', 'partial', 'failed', 'source_unavailable', 'deleted', 'expired', 'not_selected'] as const;
export const idSchema = z.string().min(1).max(200);
export const ownerSchema = z.string().min(1).max(300);
export const reasonSchema = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const providerSchema = z.enum(providerIds);
export const refSchema = z.object({ id: idSchema, ownerId: ownerSchema, epoch: z.number().int().positive(), provider: providerSchema });
export type ProviderId = z.infer<typeof providerSchema>;
export type ConnectionMode = typeof connectionModes[number];
export type ConnectionRef = z.infer<typeof refSchema>;
export const rulesSchema = z.object({ contains: z.array(z.string().trim().min(1).max(200)).max(20).optional() }).strict();
export type SelectionRules = z.infer<typeof rulesSchema>;
export const connectionCreateSchema = z.object({ provider: providerSchema, providerAccountId: z.string().min(1).max(1000), scope: z.array(idSchema).min(1).max(50) }).strict();
export const connectionSettingsSchema = z.object({ mode: z.enum(connectionModes), scope: z.array(idSchema).min(1).max(50), rules: rulesSchema, consent: z.boolean(), paused: z.boolean(), automaticDailyLimit: z.union([z.literal(1), z.literal(2)]) }).strict();
export type ConnectionSettings = z.infer<typeof connectionSettingsSchema>;
/** Safe for authenticated UI. Tokens, account identifiers, provider cursors and bodies are never included. */
export interface SavedConnection extends ConnectionRef {
  mode: ConnectionMode; status: 'active' | 'paused' | 'disconnected'; scope: string[]; scopeVersion: number;
  rules: SelectionRules; activationAt: string | null; automaticDailyLimit: 1 | 2; createdAt: string; updatedAt: string;
}
export interface ProviderCapabilities { pull: boolean; history: boolean; selectedItem: boolean; push: boolean; edits: boolean; attachments: boolean }
export type SyncBudget = { deadlineAtMs: number; maxItemIds: 50; maxBodies: 10; maxBodyBytes: 262144 };
export interface SyncCursor { cursor: string | null; pageState: string | null }
export const providerItemRefSchema = z.object({ id: idSchema, version: z.string().max(500).optional(), receivedAt: z.string().datetime() }).strict();
export type ProviderItemRef = z.infer<typeof providerItemRefSchema>;
export const providerPageSchema = z.object({
  items: z.array(providerItemRefSchema).max(50), pageState: z.string().max(16384).nullable(), finalCursor: z.string().max(16384).optional(),
  complete: z.boolean(), gaps: z.array(z.object({ reason: reasonSchema, count: z.number().int().nonnegative().max(1000000) }).strict()).max(20),
}).strict().refine(p => p.complete ? typeof p.finalCursor === 'string' && p.pageState === null : p.finalCursor === undefined && p.pageState !== null, 'invalid_provider_page');
export type ProviderPage = z.infer<typeof providerPageSchema>;
export const attachmentSchema = z.object({ id: idSchema, name: z.string().max(200), mediaType: z.string().max(150), supported: z.boolean(), byteLength: z.number().int().nonnegative().optional() }).strict();
export const extractionSchema = z.object({
  coverage: z.enum(['complete', 'partial', 'unavailable']),
  diagnostics: z.array(z.object({ reason: reasonSchema, count: z.number().int().nonnegative().max(1000000000) }).strict()).max(40),
  /** Known omitted counts only; diagnostics preserve unknown/traversal omissions without invented totals. */
  overflow: z.object({ textBytes: z.number().int().nonnegative().max(1000000000), urls: z.number().int().nonnegative().max(1000000000), attachments: z.number().int().nonnegative().max(1000000000) }).strict(),
}).strict();
export const providerItemSchema = z.object({
  providerItemId: idSchema, deliveryId: idSchema.optional(), revisionHash: hashSchema, receivedAt: z.string().datetime(),
  extraction: extractionSchema.optional(),
  text: z.string().max(4 * 1024 * 1024), urls: z.array(z.string().max(4096)).max(10000), attachments: z.array(attachmentSchema).max(1000),
}).strict();
export type ProviderItem = z.infer<typeof providerItemSchema>;
export type RevocationResult = { status: 'revoked' | 'already_revoked' | 'unavailable'; reason?: string };
export interface ProviderAdapter {
  capabilities: ProviderCapabilities;
  pullChanges(connection: SavedConnection, cursor: SyncCursor | null, budget: SyncBudget, signal: AbortSignal): Promise<ProviderPage>;
  readItem(connection: SavedConnection, reference: ProviderItemRef, signal: AbortSignal): Promise<ProviderItem>;
  revoke(connection: SavedConnection, signal: AbortSignal): Promise<RevocationResult>;
}
export type TargetKind = 'text' | 'url' | 'image' | 'attachment';
export const targetSchema = z.object({ id: idSchema, kind: z.enum(['text', 'url', 'image', 'attachment']), status: z.enum(['pending', 'checked', 'partial', 'unsupported', 'unavailable', 'not_checked']), reason: reasonSchema.optional() }).strict();
export const manifestSchema = z.object({
  extraction: extractionSchema.optional(),
  targets: z.array(targetSchema).max(250), coverage: z.enum(['pending', 'complete', 'partial']),
  overflow: z.object({ textBytes: z.number().int().nonnegative(), urls: z.number().int().nonnegative(), attachments: z.number().int().nonnegative() }).strict(),
  counts: z.object({ discovered: z.number().int().nonnegative(), checked: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), unsupported: z.number().int().nonnegative() }).strict(),
}).strict();
/** Metadata only. Link destinations and attachment names live in the expiring encrypted content. */
export type TargetManifest = z.infer<typeof manifestSchema>;
export interface SourceItem { id: string; connectionId: string; epoch: number; state: typeof itemStates[number]; latestRevisionId: string | null; receivedAt: string; expiresAt: string }
export interface SourceRevision { id: string; itemId: string; revisionHash: string; manifest: TargetManifest; selectionReason: string; createdAt: string; contentExpiresAt: string; expiresAt: string }
export interface RevisionContent { sourceReference: ProviderItemRef; text: string; urls: { original: string; normalized: string }[]; attachments: z.infer<typeof attachmentSchema>[] }
export interface SavedRevision { item: SourceItem; revision: SourceRevision }
export interface SyncLease { ref: ConnectionRef; token: string; fence: number; expiresAt: string }
export const normalizedCheckInputSchema = z.object({
  message: z.string().max(12000), url: z.string().max(4096).nullable(), images: checkInputSchema.shape.images,
  promisedBenefit: z.string().max(12000).optional(), intendedAction: z.string().max(12000).optional(),
}).strict().superRefine((v, ctx) => {
  const result = checkInputSchema.safeParse({ ...v, url: v.url ?? '', promisedBenefit: v.promisedBenefit ?? '', intendedAction: v.intendedAction ?? '' });
  if (!result.success) ctx.addIssue({ code: 'custom', message: 'invalid_check_input' });
});
export type NormalizedCheckInput = z.infer<typeof normalizedCheckInputSchema>;
export const targetJobSchema = z.object({ revisionId: idSchema, targetId: idSchema, generation: z.number().int().positive().max(100), input: normalizedCheckInputSchema }).strict();
export type TargetJobInput = z.infer<typeof targetJobSchema>;
export const jobOutcomeSchema = z.object({ status: z.enum(['completed', 'failed', 'deferred', 'suppressed']), reason: reasonSchema.optional(), retryAt: z.string().datetime().optional(), childState: z.enum(['completed', 'partial']).optional() }).strict().refine(v => v.status !== 'completed' || !!v.childState, 'child_state_required').refine(v => v.status !== 'suppressed' || ['owner_deleted', 'submission_expired', 'main_check_unavailable', 'content_expired', 'admission_deadline_expired'].includes(v.reason ?? ''), 'invalid_suppression').refine(v => v.status !== 'deferred' || !!v.retryAt, 'retry_time_required');
export type JobOutcome = z.infer<typeof jobOutcomeSchema>;
export interface ConnectorJob { id: string; connectionId: string; epoch: number; revisionId: string; targetId: string; generation: number; admissionKey: string; state: 'queued' | 'leased' | 'completed' | 'failed' | 'suppressed' | 'canceled'; checkId: string | null; dueAt: string; reason: string | null }
export interface JobLease { ref: ConnectionRef; job: ConnectorJob; token: string; fence: number; expiresAt: string }
export interface AdmissionIntent { ref: ConnectionRef; jobId: string; admissionKey: string; checkId: string | null; admissionClass: 'automatic' | 'selected'; state: ConnectorJob['state']; admissionDeadlineAt: string }
export const grantSchema = z.object({ accessToken: z.string().min(1).max(16384), refreshToken: z.string().max(16384).optional(), scopes: z.array(z.string().max(200)).max(50), expiresAt: z.string().datetime().optional() }).strict();
export type ConnectorGrant = z.infer<typeof grantSchema>;
export const oauthFlowSchema = z.object({ state: z.string().min(32).max(200), provider: providerSchema, redirectUri: z.url().max(2000), verifier: z.string().min(1).max(200), connectionId: idSchema.optional(), expectedEpoch: z.number().int().positive().optional() }).strict().refine(v => Boolean(v.connectionId) === Boolean(v.expectedEpoch), 'epoch_required');
export type OAuthFlowInput = z.infer<typeof oauthFlowSchema>;
export interface ConsumedOAuthFlow extends Omit<OAuthFlowInput, 'state'> { ownerId: string }
export const alertInputSchema = z.object({ revisionId: idSchema, kind: z.enum(['result', 'coverage', 'connection', 'quota']), reason: reasonSchema, counts: manifestSchema.shape.counts }).strict();
export type AlertInput = z.infer<typeof alertInputSchema>;
export interface Alert extends AlertInput { id: string; connectionId: string; epoch: number; createdAt: string; expiresAt: string; seenAt: string | null }
export interface Activity { id: string; connectionId: string; epoch: number; kind: 'sync' | 'gap' | 'connection' | 'job'; reason: string; count: number; createdAt: string; expiresAt: string }
export interface BoundedPage<T> { items: T[]; nextCursor: string | null }
export interface PageOptions { before?: string; limit?: number; query?: string; filter?: string }
export interface QuotaReservation { allowed: boolean; reason?: 'automatic_global_day' | 'automatic_global_month' | 'automatic_owner_day'; alreadyReserved: boolean }
export interface ConnectorStore extends OAuthPersistence {
  createConnection(subject: string, input: z.infer<typeof connectionCreateSchema>): Promise<SavedConnection>;
  getConnection(subject: string, id: string): Promise<SavedConnection | null>;
  listConnections(subject: string, options?: PageOptions): Promise<BoundedPage<SavedConnection>>;
  configureConnection(ref: ConnectionRef, settings: ConnectionSettings, activation?:ActivationBaseline): Promise<SavedConnection>;
  /** Server callback only: providerAccountId must come from authenticated provider identity, never a browser assertion. */
  reconnectConnection(subject: string, id: string, expectedEpoch: number, providerAccountId: string, grant: ConnectorGrant): Promise<SavedConnection>;
  revokeConnection(subject: string, id: string, expectedEpoch: number): Promise<{ connection: SavedConnection; cancelCheckIds: string[] }>;
  /** Internal worker projection; browser callers must use the owner-bound method below. */
  listPendingDisconnectCancellations(): Promise<{ ownerId: string; connectionId: string; checkId: string }[]>;
  listPendingDisconnectCheckIds(subject: string, id: string): Promise<string[]>;
  acknowledgeDisconnectCancellation(subject: string, id: string, checkId: string): Promise<void>;
  saveGrant(ref: ConnectionRef, grant: ConnectorGrant): Promise<void>;
  readGrant(ref: ConnectionRef): Promise<ConnectorGrant | null>;
  saveOAuthFlow(subject: string, input: OAuthFlowInput): Promise<void>;
  consumeOAuthFlow(subject: string, state: string): Promise<ConsumedOAuthFlow | null>;
  leaseConnection(ref: ConnectionRef, durationMs?: number): Promise<SyncLease | null>;
  readSyncCursor(ref: ConnectionRef): Promise<SyncCursor | null>;
  persistProviderPage(ref: ConnectionRef, lease: SyncLease, page: ProviderPage): Promise<void>;
  releaseConnectionLease(lease: SyncLease): Promise<void>;
  acknowledgeProviderItem(ref: ConnectionRef, reference: ProviderItemRef): Promise<void>;
  recordCoverageGap(ref: ConnectionRef, reason: string, count: number): Promise<void>;
  listPendingProviderItems(ref: ConnectionRef, options?: PageOptions): Promise<BoundedPage<ProviderItemRef>>;
  /** Trusted server selected-item path; caller authenticates subject and fetches through the authorized adapter. */
  saveSelectedRevision(ref: ConnectionRef, item: ProviderItem): Promise<SavedRevision>;
  saveRevision(ref: ConnectionRef, item: ProviderItem): Promise<SavedRevision>;
  getItem(ref: ConnectionRef, itemId: string): Promise<SourceItem | null>;
  listItems(ref: ConnectionRef, options?: PageOptions): Promise<BoundedPage<SourceItem>>;
  getRevision(ref: ConnectionRef, revisionId: string): Promise<SourceRevision | null>;
  readRevisionContent(ref: ConnectionRef, revisionId: string): Promise<RevisionContent | null>;
  /** Erases early only after every supported manifest target has a terminal completed/suppressed job. */
  eraseTerminalRevisionContent(ref: ConnectionRef, revisionId: string): Promise<void>;
  enqueueTarget(ref: ConnectionRef, input: TargetJobInput): Promise<ConnectorJob>;
  leaseDueJob(durationMs?: number, admittedOnly?: boolean, selectedOnly?: boolean): Promise<JobLease | null>;
  validateJobLease(lease: JobLease): Promise<ConnectorJob>;
  listRevisionJobs(ref: ConnectionRef, revisionId: string): Promise<ConnectorJob[]>;
  recordTargetGap(ref: ConnectionRef, revisionId: string, targetId: string, reason: string): Promise<void>;
  releaseAutomaticQuota(lease: JobLease): Promise<void>;
  readJobInput(lease: JobLease): Promise<NormalizedCheckInput>;
  recordAdmission(lease: JobLease, checkId: string): Promise<void>;
  recordAdmissionIntent(lease: JobLease): Promise<AdmissionIntent>;
  clearUncommittedAdmissionIntent(lease: JobLease): Promise<void>;
  listAdmissionIntents(): Promise<AdmissionIntent[]>;
  /** Worker supplies an owned existing main ID and terminal truth; never changes connector job state. */
  recordRecoveredAdmission(intent: AdmissionIntent, checkId: string, terminal: boolean): Promise<void>;
  resolveUnavailableAdmission(intent: AdmissionIntent, reason: 'main_check_unavailable' | 'admission_deadline_expired', checkId?: string): Promise<void>;
  /** Recovery after main commit raced an epoch invalidation; records cancellation only, never revives work. */
  recordOrphanedAdmission(lease: JobLease, checkId: string): Promise<void>;
  finishJob(lease: JobLease, outcome: JobOutcome): Promise<void>;
  reserveAutomaticQuota(lease: JobLease): Promise<QuotaReservation>;
  saveAlert(ref: ConnectionRef, input: AlertInput): Promise<Alert>;
  listAlerts(subject: string, options?: PageOptions): Promise<BoundedPage<Alert>>;
  markAlertSeen(subject: string, id: string): Promise<boolean>;
  listActivity(subject: string, options?: PageOptions): Promise<BoundedPage<Activity>>;
  purgeExpired(): Promise<void>;
}
