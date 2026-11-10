import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as model from '../../db/scamwin-connector-schema';
import {
  ownerSchema, idSchema, refSchema, connectionCreateSchema, connectionSettingsSchema, providerPageSchema, providerItemSchema, targetJobSchema,
  grantSchema, oauthFlowSchema, jobOutcomeSchema, alertInputSchema, manifestSchema, rulesSchema, normalizedCheckInputSchema, providerItemRefSchema, reasonSchema,
  type ConnectorStore, type ConnectionRef, type SavedConnection, type ConnectionSettings, type ConnectorGrant, type OAuthFlowInput, type ConsumedOAuthFlow,
  type SyncLease, type SyncCursor, type ProviderPage, type ProviderItemRef, type ProviderItem, type SavedRevision, type SourceItem, type SourceRevision,
  type RevisionContent, type TargetJobInput, type ConnectorJob, type JobLease, type JobOutcome, type NormalizedCheckInput, type AlertInput, type Alert,
  type Activity, type PageOptions, type BoundedPage, type QuotaReservation, type AdmissionIntent,
} from './contracts';
import { sealConnectorSecret, openConnectorSecret, privateIdentifier, type ConnectorKeyring, type SecretBinding } from './crypto';
import { CONNECTOR_LIMITS, selectItem, boundManifest, metadataManifest, admissionKey, canonicalHash } from './policy';
import { CONNECTOR_ADMISSION_WINDOW_MS } from './limits';
import {PostgresOAuthPersistence,assertGrantRefreshIdle} from './oauth-persistence';
import type {ProtectedOAuthFlow,RefreshLease,ActivationBaseline} from './oauth-contracts';
import type {OAuthCallbackInput} from './oauth-protocol';
import type {VerifiedProviderIdentity} from './oidc';

export interface ConnectorSql { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
export interface ConnectorDatabase extends ConnectorSql { transaction<T>(fn: (sql: ConnectorSql) => Promise<T>): Promise<T> }
export class ConnectorStoreError extends Error { constructor(public readonly code: string) { super(code); this.name = 'ConnectorStoreError'; } }
const fail = (code: string): never => { throw new ConnectorStoreError(code); };
const DAY = 86400000;
type ConnectionRow = typeof model.connectorConnections.$inferSelect;
type ItemRow = typeof model.connectorItems.$inferSelect;
type RevisionRow = typeof model.connectorRevisions.$inferSelect;
type JobRow = typeof model.connectorJobs.$inferSelect;
type AlertRow = typeof model.connectorAlerts.$inferSelect;
type FlowRow = typeof model.connectorOAuthFlows.$inferSelect;
type PendingRow = typeof model.connectorPendingItems.$inferSelect;
type ActivityRow = typeof model.connectorActivity.$inferSelect;
const snake = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
async function rows<T>(db: ConnectorSql, query: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.query(query, values);
  return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v instanceof Date ? v.toISOString() : v]))) as T[];
}
const tableNames = {
  connection: 'connector_connections', oauth: 'connector_oauth_flows', item: 'connector_items', revision: 'connector_revisions', delivery: 'connector_deliveries', pending: 'connector_pending_items', job: 'connector_jobs', alert: 'connector_alerts', activity: 'connector_activity', quota: 'connector_quotas',
} as const;
/** Only static model tables/columns are interpolated; all caller values remain parameters. */
async function insert(db: ConnectorSql, kind: keyof typeof tableNames, value: Record<string, unknown>, conflict = '') {
  const parsed = model.connectorInsertSchemas[kind].parse(value) as Record<string, unknown>;
  const entries = Object.entries(parsed).filter(([, v]) => v !== undefined);
  const values = entries.map(([, v]) => v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  await db.query(`INSERT INTO ${tableNames[kind]} (${entries.map(([k]) => snake(k)).join(',')}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(',')}) ${conflict}`, values);
}
function connection(row: ConnectionRow): SavedConnection {
  return { id: row.id, ownerId: row.ownerId, provider: row.provider as SavedConnection['provider'], epoch: row.epoch, mode: row.mode as SavedConnection['mode'], status: row.status as SavedConnection['status'], scope: z.array(idSchema).parse(row.scope), rules: rulesSchema.parse(row.rules), scopeVersion: row.scopeVersion, activationAt: row.activationAt, automaticDailyLimit: row.automaticDailyLimit as 1 | 2, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function item(row: ItemRow): SourceItem { return { id: row.id, connectionId: row.connectionId, epoch: row.epoch, state: row.state as SourceItem['state'], latestRevisionId: row.latestRevisionId, receivedAt: row.receivedAt, expiresAt: row.expiresAt }; }
function revision(row: RevisionRow): SourceRevision { return { id: row.id, itemId: row.itemId, revisionHash: row.revisionHash, manifest: manifestSchema.parse(row.manifest), selectionReason: row.selectionReason, createdAt: row.createdAt, contentExpiresAt: row.contentExpiresAt, expiresAt: row.expiresAt }; }
function job(row: JobRow): ConnectorJob { return { id: row.id, connectionId: row.connectionId, epoch: row.epoch, revisionId: row.revisionId, targetId: row.targetId, generation: row.generation, admissionKey: row.admissionKey, state: row.state as ConnectorJob['state'], checkId: row.checkId, dueAt: row.dueAt, reason: row.reason }; }
function admissionIntent(row: JobRow, ref: ConnectionRef): AdmissionIntent {
  if (!row.admissionAttemptedAt) fail('admission_intent_unavailable');
  return { ref, jobId: row.id, admissionKey: row.admissionKey, checkId: row.checkId, admissionClass: row.admissionClass as AdmissionIntent['admissionClass'], state: row.state as AdmissionIntent['state'], admissionDeadlineAt: new Date(Date.parse(row.admissionAttemptedAt!) + CONNECTOR_ADMISSION_WINDOW_MS).toISOString() };
}
function alert(row: AlertRow): Alert { return { id: row.id, connectionId: row.connectionId, epoch:row.epoch, revisionId: row.revisionId, kind: row.kind as Alert['kind'], reason: row.reason, counts: manifestSchema.shape.counts.parse(row.counts), seenAt: row.seenAt, createdAt: row.createdAt, expiresAt: row.expiresAt }; }
function pageOptions(input: PageOptions = {}) { return z.object({ before: z.string().min(1).max(600).optional(), limit: z.number().int().min(1).max(50).default(20), query:z.string().trim().max(200).default(''),filter:z.string().max(40).default('all') }).strict().parse(input); }
function page<T>(all: T[], limit: number, id: (v: T) => string): BoundedPage<T> { return { items: all.slice(0, limit), nextCursor: all.length > limit ? id(all[limit - 1]) : null }; }
function accountCursor(value?:string):{createdAt:string;id:string}|null {
  if(!value)return null;
  try {return z.object({createdAt:z.string().datetime(),id:idSchema}).strict().parse(JSON.parse(Buffer.from(value,'base64url').toString('utf8')));}catch{ return fail('invalid_cursor'); }
}
function accountPage<T extends {id:string;createdAt:string}>(all:T[],limit:number):BoundedPage<T>{return page(all,limit,v=>Buffer.from(JSON.stringify({createdAt:v.createdAt,id:v.id})).toString('base64url'));}
const sameRef = (a: ConnectionRef, b: ConnectionRef) => a.id === b.id && a.ownerId === b.ownerId && a.provider === b.provider && a.epoch === b.epoch;

/** Durable Postgres implementation. Test databases must be explicitly injected; there is no memory fallback. */
export class PostgresConnectorStore implements ConnectorStore {
  constructor(private readonly db: ConnectorDatabase, private readonly options: { keyring: ConnectorKeyring; now?: () => Date }) {}
  private oauthPersistence(){return new PostgresOAuthPersistence(this.db,this.options);}
  saveProtectedOAuthFlow(value:ProtectedOAuthFlow){return this.oauthPersistence().saveProtectedOAuthFlow(value);}
  claimProtectedOAuthFlow(input:OAuthCallbackInput){return this.oauthPersistence().claimProtectedOAuthFlow(input);}
  attachOAuthGrant(saved:ProtectedOAuthFlow,identity:VerifiedProviderIdentity,grant:ConnectorGrant|null){return this.oauthPersistence().attachOAuthGrant(saved,identity,grant);}
  readIdentityProof(ref:ConnectionRef){return this.oauthPersistence().readIdentityProof(ref);}
  leaseGrantRefresh(ref:ConnectionRef){return this.oauthPersistence().leaseGrantRefresh(ref);}
  finishGrantRefresh(lease:RefreshLease,grant:ConnectorGrant){return this.oauthPersistence().finishGrantRefresh(lease,grant);}
  releaseGrantRefresh(lease:RefreshLease){return this.oauthPersistence().releaseGrantRefresh(lease);}
  private now() { return (this.options.now?.() ?? new Date()).toISOString(); }
  private at(ms: number) { return new Date(Date.parse(this.now()) + ms).toISOString(); }
  private binding(ref: ConnectionRef, purpose: SecretBinding['purpose'], suffix = ''): SecretBinding { return { ownerId: ref.ownerId, connectionId: suffix ? `${ref.id}:${suffix}` : ref.id, epoch: ref.epoch, purpose }; }
  private seal(value: unknown, ref: ConnectionRef, purpose: SecretBinding['purpose'], suffix = '') { return sealConnectorSecret(JSON.stringify(value), this.binding(ref, purpose, suffix), this.options.keyring); }
  private open<T>(value: string, ref: ConnectionRef, purpose: SecretBinding['purpose'], suffix = ''): T { return JSON.parse(openConnectorSecret(value, this.binding(ref, purpose, suffix), this.options.keyring)) as T; }
  private privateId(value: string, ref: ConnectionRef, suffix = '') { return privateIdentifier(value, this.binding(ref, 'identifier', suffix), this.options.keyring); }
  private async findConnection(db: ConnectorSql, ref: ConnectionRef, lock = false, allowDisconnected = false): Promise<ConnectionRow | null> {
    refSchema.parse(ref);
    return (await rows<ConnectionRow>(db, `SELECT * FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider=$4 ${allowDisconnected ? '' : "AND status <> 'disconnected'"} ${lock ? 'FOR UPDATE' : ''}`, [ref.id, ref.ownerId, ref.epoch, ref.provider]))[0] ?? null;
  }
  private async requireConnection(db: ConnectorSql, ref: ConnectionRef) { return await this.findConnection(db, ref, true) ?? fail('connection_unavailable'); }
  private active(c: ConnectionRow) { if (c.status !== 'active' || c.mode === 'manual') fail('background_import_disabled'); }
  /** Caller holds the connection row lock shared with source invalidation. */
  private async assertSourceNotSuppressed(db: ConnectorSql, itemId: string) {
    if ((await rows<{ itemId: string }>(db, 'SELECT item_id FROM connector_source_suppressions WHERE item_id=$1 AND expires_at>$2', [itemId, this.now()])).length) fail('source_suppressed');
  }
  private async backlogCapacity(db: ConnectorSql, ownerId: string, additional: number) {
    // Serializes page/import capacity checks for different connections owned by one subject.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`connector-capacity:${ownerId}`]);
    const [counts] = await rows<{ pending: number; revisions: number }>(db, "SELECT (SELECT count(*) FROM connector_pending_items WHERE owner_id=$1 AND expires_at>$2) AS pending,(SELECT count(*) FROM connector_revisions r JOIN connector_items i ON i.id=r.item_id WHERE r.owner_id=$1 AND r.content_expires_at>$2 AND i.state NOT IN ('not_selected','source_unavailable','deleted','expired') AND (EXISTS(SELECT 1 FROM connector_jobs j WHERE j.revision_id=r.id AND j.state IN ('queued','leased')) OR (NOT EXISTS(SELECT 1 FROM connector_jobs j WHERE j.revision_id=r.id) AND (r.manifest->'counts'->>'pending')::int>0))) AS revisions", [ownerId, this.now()]);
    if (Number(counts.pending) + Number(counts.revisions) + additional > 1000) fail('queue_capacity');
  }
  private async activity(db: ConnectorSql, ref: ConnectionRef, kind: Activity['kind'], reason: string, count = 1) {
    await insert(db, 'activity', { id: randomUUID(), ownerId: ref.ownerId, connectionId: ref.id, epoch: ref.epoch, kind, reason, count, createdAt: this.now(), expiresAt: this.at(90 * DAY) });
  }
  async createConnection(subject: string, input: z.infer<typeof connectionCreateSchema>) {
    ownerSchema.parse(subject); const parsed = connectionCreateSchema.parse(input);
    // Stable provider-wide account binding intentionally excludes owner and connection epoch.
    const accountKey = this.privateId(parsed.providerAccountId, { id: `account:${parsed.provider}`, ownerId: 'provider-account', epoch: 1, provider: parsed.provider });
    return this.db.transaction(async db => {
      const existing = (await rows<ConnectionRow>(db, 'SELECT * FROM connector_connections WHERE provider=$1 AND account_key=$2 FOR UPDATE', [parsed.provider, accountKey]))[0];
      if (existing) { if (existing.ownerId !== subject) fail('provider_account_owned'); return connection(existing); }
      const record = { id: randomUUID(), ownerId: subject, provider: parsed.provider, accountKey, epoch: 1, mode: 'manual', status: 'active', scope: parsed.scope, scopeVersion: 1, rules: {}, automaticDailyLimit: 1, activationAt: null, encryptedGrant: null, encryptedCursor: null, encryptedPage: null, cursorExpiresAt: null, syncToken: null, syncFence: 0, syncUntil: null, createdAt: this.now(), updatedAt: this.now() };
      await insert(db, 'connection', record, 'ON CONFLICT (provider, account_key) DO NOTHING');
      const saved = (await rows<ConnectionRow>(db, 'SELECT * FROM connector_connections WHERE provider=$1 AND account_key=$2', [parsed.provider, accountKey]))[0];
      if (saved.ownerId !== subject) fail('provider_account_owned');
      return connection(saved);
    });
  }
  async getConnection(subject: string, id: string) { ownerSchema.parse(subject); idSchema.parse(id); const row = (await rows<ConnectionRow>(this.db, 'SELECT * FROM connector_connections WHERE owner_id=$1 AND id=$2', [subject, id]))[0]; return row ? connection(row) : null; }
  async listConnections(subject: string, options: PageOptions = {}) {
    ownerSchema.parse(subject); const p = pageOptions(options);
    const cursor=accountCursor(p.before);
    const found = await rows<ConnectionRow>(this.db, "SELECT * FROM connector_connections WHERE owner_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::text)) AND ($5='' OR position(lower($5) in lower(provider || ' ' || mode || ' ' || status))>0) AND ($6='all' OR status=$6 OR provider=$6) ORDER BY created_at DESC,id DESC LIMIT $4", [subject,cursor?.createdAt??null,cursor?.id??null,p.limit+1,p.query,p.filter]);
    return accountPage(found.map(connection),p.limit);
  }
  async configureConnection(ref: ConnectionRef, settings: ConnectionSettings, activation?:ActivationBaseline) {
    const value = connectionSettingsSchema.parse(settings);
    const baseline=activation?z.object({cursor:z.string().min(1).max(16384),capturedAt:z.string().datetime()}).strict().parse(activation):undefined;
    if(baseline&&(value.mode==='manual'||Date.parse(baseline.capturedAt)>Date.parse(this.now())||Date.parse(this.now())-Date.parse(baseline.capturedAt)>30000))fail('invalid_activation');
    if (value.mode !== 'manual' && !value.consent) fail('automatic_consent_required');
    if (value.mode === 'selective' && !value.rules.contains?.length) fail('selection_rules_required');
    return this.db.transaction(async db => {
      const old = await this.requireConnection(db, ref);
      const scopeChanged = canonicalHash([...z.array(idSchema).parse(old.scope)].sort()) !== canonicalHash([...value.scope].sort());
      const changed = old.mode !== value.mode || scopeChanged || canonicalHash(rulesSchema.parse(old.rules)) !== canonicalHash(value.rules) || (!!baseline && value.mode!=='manual' && !old.activationAt);
      if(changed)assertGrantRefreshIdle(old.refreshUntil,Date.parse(this.now()));
      const nextRef = { ...ref, epoch: old.epoch + (changed ? 1 : 0) };
      const encryptedGrant = old.encryptedGrant && changed ? this.seal(this.open(old.encryptedGrant, ref, 'grant'), nextRef, 'grant') : old.encryptedGrant;
      const encryptedIdentity=old.encryptedIdentity&&changed?this.seal(this.open(old.encryptedIdentity,ref,'grant','identity'),nextRef,'grant','identity'):old.encryptedIdentity;
      await db.query(`UPDATE connector_connections SET epoch=$1, mode=$2, status=$3, scope=$4::jsonb, scope_version=$5, rules=$6::jsonb, automatic_daily_limit=$7, activation_at=$8, encrypted_grant=$9, encrypted_cursor=$10, encrypted_page=$11, sync_token=NULL, sync_until=NULL, sync_fence=sync_fence+1, updated_at=$12 WHERE id=$13 AND owner_id=$14 AND epoch=$15`, [nextRef.epoch, value.mode, value.paused ? 'paused' : 'active', JSON.stringify(value.scope), old.scopeVersion + (scopeChanged ? 1 : 0), JSON.stringify(value.rules), value.automaticDailyLimit, changed ? (value.mode === 'manual' ? null : baseline?.capturedAt ?? this.now()) : old.activationAt, encryptedGrant, changed ? (baseline ? this.seal(baseline.cursor,nextRef,'cursor') : null) : old.encryptedCursor, changed ? null : old.encryptedPage, this.now(), ref.id, ref.ownerId, ref.epoch]);
      if (changed) {
        await db.query('UPDATE connector_connections SET cursor_expires_at=$1,encrypted_identity=$2,refresh_lock_token=NULL,refresh_until=NULL,refresh_fence=refresh_fence+1 WHERE id=$3', [baseline?this.at(90*DAY):null,encryptedIdentity,ref.id]);
        await db.query("UPDATE connector_jobs SET state='canceled', reason='connection_changed', lease_token=NULL, lease_until=NULL WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND state IN ('queued','leased')", [ref.id, ref.ownerId, ref.epoch]);
        await db.query('DELETE FROM connector_pending_items WHERE connection_id=$1 AND epoch=$2', [ref.id, ref.epoch]);
      }
      await this.activity(db, nextRef, 'connection', value.paused ? 'paused' : 'mode_saved');
      const row = (await rows<ConnectionRow>(db, 'SELECT * FROM connector_connections WHERE id=$1', [ref.id]))[0];
      return connection(row);
    });
  }
  async reconnectConnection(subject: string, id: string, expectedEpoch: number, providerAccountId: string, grant: ConnectorGrant) {
    ownerSchema.parse(subject); idSchema.parse(id); z.number().int().positive().parse(expectedEpoch);
    z.string().min(1).max(1000).parse(providerAccountId); const value = grantSchema.parse(grant);
    return this.db.transaction(async db => {
      const old = (await rows<ConnectionRow>(db, 'SELECT * FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 FOR UPDATE', [id, subject, expectedEpoch]))[0] ?? fail('connection_unavailable');
      const accountRef: ConnectionRef = { id: `account:${old.provider}`, ownerId: 'provider-account', epoch: 1, provider: old.provider as ConnectionRef['provider'] };
      if (this.privateId(providerAccountId, accountRef) !== old.accountKey) fail('provider_account_mismatch');
      assertGrantRefreshIdle(old.refreshUntil,Date.parse(this.now()));
      const ref: ConnectionRef = { id, ownerId: subject, epoch: old.epoch + 1, provider: old.provider as ConnectionRef['provider'] };
      await db.query("UPDATE connector_connections SET epoch=$1,mode='manual',status='active',activation_at=NULL,encrypted_grant=$2,encrypted_identity=NULL,refresh_lock_token=NULL,refresh_until=NULL,refresh_fence=refresh_fence+1,encrypted_cursor=NULL,encrypted_page=NULL,cursor_expires_at=NULL,sync_token=NULL,sync_until=NULL,sync_fence=sync_fence+1,updated_at=$3 WHERE id=$4 AND owner_id=$5 AND epoch=$6", [ref.epoch, this.seal(value, ref, 'grant'), this.now(), id, subject, expectedEpoch]);
      await db.query("UPDATE connector_jobs SET state='canceled',reason='reconnected',lease_token=NULL,lease_until=NULL WHERE connection_id=$1 AND owner_id=$2 AND state IN ('queued','leased')", [id, subject]);
      await db.query('DELETE FROM connector_pending_items WHERE connection_id=$1', [id]);
      await this.activity(db, ref, 'connection', 'reconnected_manual');
      await this.activity(db, ref, 'gap', 'reconnect_coverage_gap');
      return (await this.getConnectionIn(db, subject, id))!;
    });
  }
  async revokeConnection(subject: string, id: string, expectedEpoch: number) {
    ownerSchema.parse(subject); idSchema.parse(id); z.number().int().positive().parse(expectedEpoch);
    return this.db.transaction(async db => {
      const c = (await rows<ConnectionRow>(db, 'SELECT * FROM connector_connections WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, subject]))[0] ?? fail('connection_unavailable');
      if(c.epoch!==expectedEpoch && !(c.status==='disconnected'&&c.epoch===expectedEpoch+1))fail('stale_connection');
      if(c.status==='disconnected')return {connection:connection(c),cancelCheckIds:await this.pendingDisconnects(db,subject,id)};
      await db.query("UPDATE connector_connections SET epoch=epoch+1,status='disconnected',encrypted_grant=NULL,encrypted_identity=NULL,refresh_lock_token=NULL,refresh_until=NULL,refresh_fence=refresh_fence+1,encrypted_cursor=NULL,encrypted_page=NULL,cursor_expires_at=NULL,sync_token=NULL,sync_until=NULL,updated_at=$1 WHERE id=$2 AND owner_id=$3 AND epoch=$4", [this.now(), id, subject, expectedEpoch]);
      await db.query("UPDATE connector_jobs SET state='canceled',reason=CASE WHEN check_id IS NULL THEN 'disconnected' ELSE 'disconnect_cancel_pending' END,lease_token=NULL,lease_until=NULL WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND state IN ('queued','leased')", [id, subject, expectedEpoch]);
      await db.query('DELETE FROM connector_pending_items WHERE connection_id=$1', [id]);
      await db.query('DELETE FROM connector_oauth_flows WHERE connection_id=$1 AND owner_id=$2', [id, subject]);
      await this.activity(db, { id, ownerId: subject, provider: c.provider as ConnectionRef['provider'], epoch: expectedEpoch + 1 }, 'connection', 'disconnected');
      return { connection: (await this.getConnectionIn(db, subject, id))!, cancelCheckIds: await this.pendingDisconnects(db,subject,id) };
    });
  }
  async listPendingDisconnectCancellations() {
    return rows<{ ownerId: string; connectionId: string; checkId: string }>(this.db, "SELECT DISTINCT owner_id,connection_id,check_id FROM connector_jobs WHERE state='canceled' AND reason='disconnect_cancel_pending' AND check_id IS NOT NULL AND expires_at>$1 ORDER BY owner_id,connection_id,check_id LIMIT 50", [this.now()]);
  }
  private async pendingDisconnects(db:ConnectorSql,subject:string,id:string){return (await rows<{checkId:string}>(db,"SELECT DISTINCT check_id FROM connector_jobs WHERE connection_id=$1 AND owner_id=$2 AND state='canceled' AND reason='disconnect_cancel_pending' AND check_id IS NOT NULL AND expires_at>$3 ORDER BY check_id LIMIT 50",[id,subject,this.now()])).map(v=>v.checkId);}
  async listPendingDisconnectCheckIds(subject:string,id:string){ownerSchema.parse(subject);idSchema.parse(id);return this.pendingDisconnects(this.db,subject,id);}
  async acknowledgeDisconnectCancellation(subject:string,id:string,checkId:string){ownerSchema.parse(subject);idSchema.parse(id);idSchema.parse(checkId);await this.db.query("UPDATE connector_jobs SET reason='disconnect_cancel_requested' WHERE connection_id=$1 AND owner_id=$2 AND check_id=$3 AND state='canceled' AND reason='disconnect_cancel_pending'",[id,subject,checkId]);}
  private async getConnectionIn(db: ConnectorSql, ownerId: string, id: string) { const row = (await rows<ConnectionRow>(db, 'SELECT * FROM connector_connections WHERE id=$1 AND owner_id=$2', [id, ownerId]))[0]; return row ? connection(row) : null; }
  async saveGrant(ref: ConnectionRef, grant: ConnectorGrant) {
    const value = grantSchema.parse(grant);
    await this.db.transaction(async db => { await this.requireConnection(db, ref); await db.query('UPDATE connector_connections SET encrypted_grant=$1 WHERE id=$2 AND owner_id=$3 AND epoch=$4', [this.seal(value, ref, 'grant'), ref.id, ref.ownerId, ref.epoch]); });
  }
  async readGrant(ref: ConnectionRef) { const c = await this.findConnection(this.db, ref); return c?.encryptedGrant ? grantSchema.parse(this.open(c.encryptedGrant, ref, 'grant')) : null; }
  async saveOAuthFlow(subject: string, input: OAuthFlowInput) {
    ownerSchema.parse(subject); const value = oauthFlowSchema.parse(input);
    const redirect = new URL(value.redirectUri); if (redirect.protocol !== 'https:' || redirect.hash || redirect.username || redirect.password) fail('invalid_callback');
    await this.db.transaction(async db => {
      if (value.connectionId) {
        const current = await this.getConnectionIn(db, subject, value.connectionId);
        if (!current || current.epoch !== value.expectedEpoch || current.provider !== value.provider) fail('connection_unavailable');
      }
      const ref = { id: 'oauth', ownerId: subject, epoch: 1, provider: value.provider };
      const id = this.privateId(value.state, ref);
      await insert(db, 'oauth', { id, ownerId: subject, provider: value.provider, connectionId: value.connectionId ?? null, expectedEpoch: value.expectedEpoch ?? null, encryptedFlow: this.seal({ ...value, state: undefined }, ref, 'oauth', id), expiresAt: this.at(10 * 60000) });
    });
  }
  async consumeOAuthFlow(subject: string, state: string) {
    ownerSchema.parse(subject); z.string().min(32).max(200).parse(state);
    return this.db.transaction(async db => {
      // Provider is authenticated inside the encrypted flow; the state HMAC is provider-independent.
      const ref: ConnectionRef = { id: 'oauth', ownerId: subject, epoch: 1, provider: 'gmail' };
      const id = this.privateId(state, ref);
      const flow = (await rows<FlowRow>(db, 'DELETE FROM connector_oauth_flows WHERE id=$1 AND owner_id=$2 AND expires_at > $3 RETURNING *', [id, subject, this.now()]))[0];
      if (!flow) return null;
      if (flow.connectionId) { const c = await this.getConnectionIn(db, subject, flow.connectionId); if (!c || c.epoch !== flow.expectedEpoch || c.provider !== flow.provider) return null; }
      return { ...this.open<Omit<OAuthFlowInput, 'state'>>(flow.encryptedFlow, ref, 'oauth', id), ownerId: subject } as ConsumedOAuthFlow;
    });
  }
  async leaseConnection(ref: ConnectionRef, durationMs = 45000) {
    z.number().int().min(1000).max(55000).parse(durationMs);
    return this.db.transaction(async db => {
      const c = await this.requireConnection(db, ref); this.active(c);
      if (c.syncUntil && c.syncUntil > this.now()) return null;
      const token = randomUUID(), expiresAt = this.at(durationMs), fence = c.syncFence + 1;
      await db.query('UPDATE connector_connections SET sync_token=$1,sync_fence=$2,sync_until=$3 WHERE id=$4 AND owner_id=$5 AND epoch=$6', [token, fence, expiresAt, ref.id, ref.ownerId, ref.epoch]);
      return { ref: refSchema.parse(ref), token, fence, expiresAt };
    });
  }
  async readSyncCursor(ref: ConnectionRef): Promise<SyncCursor | null> {
    const c = await this.findConnection(this.db, ref); if (!c) return null;
    if (c.cursorExpiresAt && c.cursorExpiresAt <= this.now()) return { cursor: null, pageState: null };
    return { cursor: c.encryptedCursor ? this.open<string>(c.encryptedCursor, ref, 'cursor') : null, pageState: c.encryptedPage ? this.open<string>(c.encryptedPage, ref, 'page') : null };
  }
  async persistProviderPage(ref: ConnectionRef, lease: SyncLease, input: ProviderPage) {
    const result = providerPageSchema.safeParse(input); const value = result.success ? result.data : fail('invalid_provider_page');
    await this.db.transaction(async db => {
      const c = await this.requireConnection(db, ref); this.active(c);
      if (!sameRef(ref, lease.ref) || c.syncToken !== lease.token || c.syncFence !== lease.fence || !c.syncUntil || c.syncUntil <= this.now()) fail('stale_lease');
      const candidateIds = value.items.filter(r => c.activationAt && r.receivedAt >= c.activationAt).map(r => this.privateId(JSON.stringify([r.id, r.version ?? null]), ref, 'pending'));
      const known = await rows<{ id: string }>(db, 'SELECT id FROM connector_pending_items WHERE connection_id=$1 AND epoch=$2', [ref.id, ref.epoch]);
      const additional = [...new Set(candidateIds)].filter(id => !known.some(r => r.id === id)).length;
      if (additional && known.length + additional > 50) fail('queue_capacity');
      await this.backlogCapacity(db, ref.ownerId, additional);
      for (const reference of value.items) {
        if (!c.activationAt || reference.receivedAt < c.activationAt) continue;
        const id = this.privateId(JSON.stringify([reference.id, reference.version ?? null]), ref, 'pending');
        await insert(db, 'pending', { id, ownerId: ref.ownerId, connectionId: ref.id, epoch: ref.epoch, encryptedRef: this.seal(reference, ref, 'page', id), expiresAt: this.at(90 * DAY) }, 'ON CONFLICT (id) DO NOTHING');
      }
      await db.query('UPDATE connector_connections SET encrypted_cursor=$1,encrypted_page=$2,cursor_expires_at=$3 WHERE id=$4 AND owner_id=$5 AND epoch=$6', [value.complete ? this.seal(value.finalCursor!, ref, 'cursor') : c.encryptedCursor, value.pageState === null ? null : this.seal(value.pageState, ref, 'page'), this.at(90 * DAY), ref.id, ref.ownerId, ref.epoch]);
      for (const gap of value.gaps) await this.activity(db, ref, 'gap', gap.reason, gap.count);
    });
  }
  async releaseConnectionLease(lease: SyncLease) {
    await this.db.transaction(async db => {
      const c = await this.requireConnection(db, lease.ref);
      if (c.syncToken !== lease.token || c.syncFence !== lease.fence || !c.syncUntil || c.syncUntil <= this.now()) fail('stale_lease');
      await db.query('UPDATE connector_connections SET sync_token=NULL,sync_until=NULL WHERE id=$1 AND owner_id=$2 AND epoch=$3', [lease.ref.id, lease.ref.ownerId, lease.ref.epoch]);
    });
  }
  async acknowledgeProviderItem(ref: ConnectionRef, reference: ProviderItemRef) {
    const value = providerItemRefSchema.parse(reference);
    await this.db.transaction(async db => {
      await this.requireConnection(db, ref);
      const id = this.privateId(JSON.stringify([value.id, value.version ?? null]), ref, 'pending');
      await db.query('DELETE FROM connector_pending_items WHERE id=$1 AND owner_id=$2 AND connection_id=$3 AND epoch=$4', [id, ref.ownerId, ref.id, ref.epoch]);
    });
  }
  async recordCoverageGap(ref: ConnectionRef, reason: string, count: number) {
    reasonSchema.parse(reason); z.number().int().min(0).max(1000000).parse(count);
    await this.db.transaction(async db => { await this.requireConnection(db, ref); await this.activity(db, ref, 'gap', reason, count); });
  }
  async listPendingProviderItems(ref: ConnectionRef, options: PageOptions = {}) {
    const p = pageOptions(options); if (!await this.findConnection(this.db, ref)) return { items: [], nextCursor: null };
    const found = await rows<PendingRow>(this.db, 'SELECT * FROM connector_pending_items WHERE owner_id=$1 AND connection_id=$2 AND epoch=$3 AND expires_at>$4 AND ($5::text IS NULL OR id<$5) ORDER BY id DESC LIMIT $6', [ref.ownerId, ref.id, ref.epoch, this.now(), p.before ?? null, p.limit + 1]);
    return { items: found.slice(0, p.limit).map(r => this.open<ProviderItemRef>(r.encryptedRef, ref, 'page', r.id)), nextCursor: found.length > p.limit ? found[p.limit - 1].id : null };
  }
  async saveRevision(ref: ConnectionRef, input: ProviderItem): Promise<SavedRevision> { return this.persistRevision(ref, input, false); }
  async saveSelectedRevision(ref: ConnectionRef, input: ProviderItem): Promise<SavedRevision> { return this.persistRevision(ref, input, true); }
  private async persistRevision(ref: ConnectionRef, input: ProviderItem, selectedByUser: boolean): Promise<SavedRevision> {
    const value = providerItemSchema.parse(input);
    return this.db.transaction(async db => {
      const c = await this.requireConnection(db, ref);
      if (selectedByUser) { if (c.status !== 'active' || !c.encryptedGrant) fail('selected_import_unavailable'); } else this.active(c);
      if (!selectedByUser && (!c.activationAt || value.receivedAt < c.activationAt)) fail('before_activation');
      if (Date.parse(value.receivedAt) > Date.parse(this.now()) + 60000) fail('invalid_receipt_time');
      if (Date.parse(value.receivedAt) + 30 * DAY <= Date.parse(this.now())) fail('content_expired');
      const providerKey = this.privateId(value.providerItemId, ref, 'item');
      const deliveryKey = value.deliveryId ? this.privateId(value.deliveryId, ref, 'delivery') : null;
      const existing = (await rows<ItemRow>(db, 'SELECT * FROM connector_items WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND provider_key=$4 FOR UPDATE', [ref.id, ref.ownerId, ref.epoch, providerKey]))[0];
      // Source invalidation takes these same connection/item locks. An in-flight
      // provider read may not recreate content after its removal commits.
      if (existing) await this.assertSourceNotSuppressed(db, existing.id);
      if (deliveryKey && !selectedByUser) {
        const duplicate = (await rows<{ revisionId: string }>(db, 'SELECT revision_id FROM connector_deliveries WHERE id=$1 AND connection_id=$2 AND epoch=$3 AND expires_at>$4', [deliveryKey, ref.id, ref.epoch, this.now()]))[0];
        if (duplicate) { const r = await this.revisionRow(db, ref, duplicate.revisionId); if (r) { const i = (await rows<ItemRow>(db, 'SELECT * FROM connector_items WHERE id=$1', [r.itemId]))[0]; return { item: item(i), revision: revision(r) }; } }
      }
      const selected = selectedByUser ? { selected: true, state: 'queued' as const, reason: 'user_selected' } : selectItem(c.mode as SavedConnection['mode'], rulesSchema.parse(c.rules), value);
      const record: ItemRow = existing ?? { id: randomUUID(), ownerId: ref.ownerId, connectionId: ref.id, epoch: ref.epoch, providerKey, latestRevisionId: null, state: selected.state, receivedAt: value.receivedAt, expiresAt: new Date(Date.parse(value.receivedAt) + 90 * DAY).toISOString() };
      if (!existing) await insert(db, 'item', record);
      let r = (await rows<RevisionRow>(db, 'SELECT * FROM connector_revisions WHERE item_id=$1 AND revision_hash=$2', [record.id, value.revisionHash]))[0];
      if (!r) {
        const pending = selectedByUser ? [] : await rows<PendingRow>(db, 'SELECT * FROM connector_pending_items WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND expires_at>$4 LIMIT 50', [ref.id, ref.ownerId, ref.epoch, this.now()]);
        const staged = pending.some(p => this.open<ProviderItemRef>(p.encryptedRef, ref, 'page', p.id).id === value.providerItemId);
        await this.backlogCapacity(db, ref.ownerId, staged ? 0 : 1);
        const bounded = boundManifest(value), id = randomUUID();
        r = { id, ownerId: ref.ownerId, connectionId: ref.id, epoch: ref.epoch, itemId: record.id, revisionHash: value.revisionHash, manifest: metadataManifest(bounded), selectionReason: selected.reason, encryptedContent: this.seal({ sourceReference: { id: value.providerItemId, receivedAt: value.receivedAt }, text: bounded.text, urls: bounded.urls, attachments: bounded.attachments }, ref, 'content', id), createdAt: this.now(), contentExpiresAt: new Date(Date.parse(value.receivedAt) + 30 * DAY).toISOString(), expiresAt: new Date(Date.parse(value.receivedAt) + 90 * DAY).toISOString() };
        await insert(db, 'revision', r);
        const manifest = manifestSchema.parse(r.manifest);
        const state: SourceItem['state'] = selected.selected && !manifest.counts.pending ? (manifest.extraction?.coverage === 'unavailable' ? 'source_unavailable' : 'partial') : selected.state;
        await db.query('UPDATE connector_items SET latest_revision_id=$1,state=$2 WHERE id=$3 AND owner_id=$4 AND epoch=$5', [r.id, state, record.id, ref.ownerId, ref.epoch]);
        record.latestRevisionId = r.id; record.state = state;
      }
      if (selectedByUser && r.selectionReason !== 'user_selected') {
        await db.query("UPDATE connector_revisions SET selection_reason='user_selected' WHERE id=$1 AND owner_id=$2", [r.id, ref.ownerId]);
        r.selectionReason = 'user_selected';
        await db.query("UPDATE connector_items SET state='queued' WHERE id=$1 AND latest_revision_id=$2 AND state='not_selected'", [record.id, r.id]);
      }
      if (deliveryKey) await insert(db, 'delivery', { id: deliveryKey, connectionId: ref.id, epoch: ref.epoch, revisionId: r.id, expiresAt: r.expiresAt }, 'ON CONFLICT (id) DO NOTHING');
      // The sync caller acknowledges the exact persisted provider reference after this transaction commits.
      return { item: item(record), revision: revision(r) };
    });
  }
  async getItem(ref: ConnectionRef, itemId: string) {
    idSchema.parse(itemId); if (!await this.findConnection(this.db, ref, false, true)) return null;
    const r = (await rows<ItemRow>(this.db, 'SELECT * FROM connector_items WHERE id=$1 AND owner_id=$2 AND connection_id=$3 AND expires_at>$4', [itemId, ref.ownerId, ref.id, this.now()]))[0]; return r ? item(r) : null;
  }
  async listItems(ref: ConnectionRef, options: PageOptions = {}) {
    const p = pageOptions(options); if (!await this.findConnection(this.db, ref, false, true)) return { items: [], nextCursor: null };
    const all = await rows<ItemRow>(this.db, 'SELECT * FROM connector_items WHERE owner_id=$1 AND connection_id=$2 AND expires_at>$3 AND ($4::text IS NULL OR id<$4) ORDER BY id DESC LIMIT $5', [ref.ownerId, ref.id, this.now(), p.before ?? null, p.limit + 1]);
    return page(all.map(item), p.limit, i => i.id);
  }
  private async revisionRow(db: ConnectorSql, ref: ConnectionRef, id: string) { return (await rows<RevisionRow>(db, 'SELECT * FROM connector_revisions WHERE id=$1 AND owner_id=$2 AND connection_id=$3 AND expires_at>$4', [id, ref.ownerId, ref.id, this.now()]))[0] ?? null; }
  async getRevision(ref: ConnectionRef, revisionId: string) { idSchema.parse(revisionId); if (!await this.findConnection(this.db, ref, false, true)) return null; const r = await this.revisionRow(this.db, ref, revisionId); return r ? revision(r) : null; }
  async readRevisionContent(ref: ConnectionRef, revisionId: string): Promise<RevisionContent | null> {
    idSchema.parse(revisionId); if (!await this.findConnection(this.db, ref)) return null;
    const r = await this.revisionRow(this.db, ref, revisionId); return r?.encryptedContent && r.contentExpiresAt > this.now() ? this.open(r.encryptedContent, { ...ref, epoch: r.epoch }, 'content', r.id) : null;
  }
  async eraseTerminalRevisionContent(ref: ConnectionRef, revisionId: string) {
    idSchema.parse(revisionId);
    await this.db.transaction(async db => {
      await this.requireConnection(db, ref);
      const r = await this.revisionRow(db, ref, revisionId) ?? fail('revision_unavailable');
      const targets = manifestSchema.parse(r.manifest).targets.filter(t => t.status !== 'unsupported' && t.status !== 'unavailable');
      const jobs = await rows<JobRow>(db, 'SELECT * FROM connector_jobs WHERE revision_id=$1 AND owner_id=$2 ORDER BY generation DESC', [r.id, ref.ownerId]);
      for (const target of targets) {
        const latest = jobs.find(j => j.targetId === target.id);
        if (!latest || !['completed', 'suppressed'].includes(latest.state)) fail('targets_pending');
      }
      await db.query('UPDATE connector_revisions SET encrypted_content=NULL WHERE id=$1 AND owner_id=$2', [r.id, ref.ownerId]);
      await db.query('UPDATE connector_jobs SET encrypted_input=NULL WHERE revision_id=$1 AND owner_id=$2', [r.id, ref.ownerId]);
    });
  }
  async enqueueTarget(ref: ConnectionRef, input: TargetJobInput): Promise<ConnectorJob> {
    const value = targetJobSchema.parse(input);
    return this.db.transaction(async db => {
      const c = await this.requireConnection(db, ref);
      const r = await this.revisionRow(db, ref, value.revisionId) ?? fail('revision_unavailable');
      await this.assertSourceNotSuppressed(db, r.itemId);
      if (c.status !== 'active' || (c.mode === 'manual' && r.selectionReason !== 'user_selected')) fail('background_import_disabled');
      if (r.epoch !== ref.epoch || r.contentExpiresAt <= this.now()) fail('revision_unavailable');
      if (r.selectionReason === 'rules_nonmatch') fail('item_not_selected');
      const previous = (await rows<JobRow>(db, 'SELECT * FROM connector_jobs WHERE revision_id=$1 AND target_id=$2 ORDER BY generation DESC LIMIT 1', [r.id, value.targetId]))[0];
      const key = admissionKey(ref, r.itemId, r.revisionHash, value.targetId, value.generation), inputHash = canonicalHash(value.input);
      if (previous?.generation === value.generation) { if (previous.inputHash !== inputHash) fail('immutable_input'); return job(previous); }
      if (previous?.state === 'suppressed') fail('recheck_requires_user');
      if (!manifestSchema.parse(r.manifest).targets.some(t => t.id === value.targetId && ['pending', 'not_checked'].includes(t.status))) fail('target_unavailable');
      if (value.generation > 2 || value.generation !== (previous ? previous.generation + 1 : 1) || previous && (previous.state !== 'failed' || previous.reason !== 'interrupted_terminal' || !previous.checkId)) fail('retry_not_authorized');
      const contentExpiresAt = value.input.images.length ? new Date(Math.min(Date.parse(r.contentExpiresAt), Date.parse(r.contentExpiresAt) - 23 * DAY)).toISOString() : r.contentExpiresAt;
      if (contentExpiresAt <= this.now()) fail('content_expired');
      const record: JobRow = { id: randomUUID(), ownerId: ref.ownerId, connectionId: ref.id, epoch: ref.epoch, revisionId: r.id, targetId: value.targetId, generation: value.generation, admissionKey: key, inputHash, encryptedInput: this.seal(value.input, ref, 'input', key), state: 'queued', dueAt: this.now(), leaseToken: null, leaseFence: 0, leaseUntil: null, checkId: null, reason: null, quotaReservedAt: null, admissionClass: null, admissionAttemptedAt: null, admissionResolvedAt: null, createdAt: this.now(), contentExpiresAt, expiresAt: r.expiresAt };
      await insert(db, 'job', record); return job(record);
    });
  }
  private async lockAutomatic(db: ConnectorSql) {
    await insert(db, 'quota', { id: 'automatic-lock', used: 0, expiresAt: '9999-12-31T00:00:00.000Z' }, 'ON CONFLICT (id) DO NOTHING');
    await db.query("SELECT id FROM connector_quotas WHERE id='automatic-lock' FOR UPDATE");
  }
  async leaseDueJob(durationMs = 300000, admittedOnly = false, selectedOnly = false): Promise<JobLease | null> {
    z.number().int().min(1000).max(300000).parse(durationMs);
    return this.db.transaction(async db => {
      await this.lockAutomatic(db);
      const running = await rows<JobRow>(db, "SELECT j.* FROM connector_jobs j JOIN connector_connections c ON c.id=j.connection_id AND c.owner_id=j.owner_id AND c.epoch=j.epoch WHERE j.state='leased' AND j.lease_until>$1 AND c.status<>'disconnected' LIMIT 1", [this.now()]);
      if (running.length) return null;
      const candidate = (await rows<JobRow & { provider: ConnectionRef['provider'] }>(db, "SELECT j.*, c.provider FROM connector_jobs j JOIN connector_connections c ON c.id=j.connection_id AND c.owner_id=j.owner_id AND c.epoch=j.epoch WHERE c.status='active' AND (c.mode<>'manual' OR EXISTS(SELECT 1 FROM connector_revisions r WHERE r.id=j.revision_id AND r.selection_reason='user_selected')) AND ($2::boolean=false OR j.check_id IS NOT NULL) AND ($3::boolean=false OR EXISTS(SELECT 1 FROM connector_revisions selected WHERE selected.id=j.revision_id AND selected.selection_reason='user_selected')) AND (EXISTS(SELECT 1 FROM connector_revisions r WHERE r.id=j.revision_id AND r.selection_reason='user_selected') OR NOT EXISTS(SELECT 1 FROM connector_jobs occupied WHERE occupied.id<>j.id AND occupied.admission_class='automatic' AND occupied.admission_attempted_at IS NOT NULL AND occupied.admission_resolved_at IS NULL AND occupied.expires_at>$1)) AND j.expires_at>$1 AND (j.encrypted_input IS NOT NULL OR j.check_id IS NOT NULL) AND (j.content_expires_at>$1 OR j.check_id IS NOT NULL) AND ((j.state='queued' AND j.due_at<=$1) OR (j.state='leased' AND j.lease_until<=$1)) ORDER BY CASE WHEN EXISTS(SELECT 1 FROM connector_revisions selected WHERE selected.id=j.revision_id AND selected.selection_reason='user_selected') THEN 0 ELSE 1 END,j.due_at,j.id LIMIT 1", [this.now(), admittedOnly, selectedOnly]))[0];
      if (!candidate) return null;
      const ref = { id: candidate.connectionId, ownerId: candidate.ownerId, provider: candidate.provider, epoch: candidate.epoch };
      await this.requireConnection(db, ref);
      const token = randomUUID(), fence = candidate.leaseFence + 1, expiresAt = this.at(durationMs);
      await db.query("UPDATE connector_jobs SET state='leased',lease_token=$1,lease_fence=$2,lease_until=$3 WHERE id=$4 AND owner_id=$5 AND epoch=$6", [token, fence, expiresAt, candidate.id, ref.ownerId, ref.epoch]);
      return { ref, token, fence, expiresAt, job: job({ ...candidate, state: 'leased' }) };
    });
  }
  private async requireJob(db: ConnectorSql, lease: JobLease): Promise<JobRow> {
    await this.requireConnection(db, lease.ref);
    const r = (await rows<JobRow>(db, "SELECT * FROM connector_jobs WHERE id=$1 AND owner_id=$2 AND connection_id=$3 AND epoch=$4 AND state='leased' AND lease_token=$5 AND lease_fence=$6 AND lease_until>$7 FOR UPDATE", [lease.job.id, lease.ref.ownerId, lease.ref.id, lease.ref.epoch, lease.token, lease.fence, this.now()]))[0];
    return r ?? fail('stale_lease');
  }
  async validateJobLease(lease: JobLease) {
    return this.db.transaction(async db => {
      const j = await this.requireJob(db, lease), c = await this.requireConnection(db, lease.ref);
      if (c.status !== 'active') fail('connection_paused');
      const r = await this.revisionRow(db, lease.ref, j.revisionId) ?? fail('revision_unavailable');
      if (c.mode === 'manual' && r.selectionReason !== 'user_selected') fail('background_import_disabled');
      return job(j);
    });
  }
  async listRevisionJobs(ref: ConnectionRef, revisionId: string) {
    idSchema.parse(revisionId); if (!await this.findConnection(this.db, ref, false, true)) return [];
    return (await rows<JobRow>(this.db, 'SELECT * FROM connector_jobs WHERE revision_id=$1 AND owner_id=$2 AND connection_id=$3 AND epoch=$4 AND expires_at>$5 ORDER BY generation DESC LIMIT 500', [revisionId, ref.ownerId, ref.id, ref.epoch, this.now()])).map(job);
  }
  async recordTargetGap(ref: ConnectionRef, revisionId: string, targetId: string, reason: string) {
    idSchema.parse(revisionId); idSchema.parse(targetId); reasonSchema.parse(reason);
    await this.db.transaction(async db => {
      await this.requireConnection(db, ref);
      const r = await this.revisionRow(db, ref, revisionId) ?? fail('revision_unavailable');
      await this.assertSourceNotSuppressed(db, r.itemId);
      if (r.epoch !== ref.epoch) fail('revision_unavailable');
      const manifest = manifestSchema.parse(r.manifest), target = manifest.targets.find(t => t.id === targetId);
      if (!target || target.status !== 'pending') return;
      const existing = await rows(db, 'SELECT id FROM connector_jobs WHERE revision_id=$1 AND target_id=$2 LIMIT 1', [r.id, targetId]);
      if (existing.length) return;
      target.status = 'unavailable'; target.reason = reason; manifest.coverage = 'partial';
      manifest.counts.pending = manifest.targets.filter(t => t.status === 'pending').length;
      await db.query('UPDATE connector_revisions SET manifest=$1::jsonb WHERE id=$2 AND owner_id=$3', [JSON.stringify(manifest), r.id, ref.ownerId]);
      await db.query("UPDATE connector_items SET state='partial' WHERE id=$1 AND latest_revision_id=$2", [r.itemId, r.id]);
    });
  }
  async releaseAutomaticQuota(lease: JobLease) {
    await this.db.transaction(async db => {
      await this.lockAutomatic(db); const j = await this.requireJob(db, lease);
      if (!j.quotaReservedAt || j.checkId) return;
      const day = j.quotaReservedAt.slice(0, 10), month = day.slice(0, 7);
      const ids = [`global-day:${day}`, `global-month:${month}`, `owner-day:${this.privateId(lease.ref.ownerId, { ...lease.ref, id: 'quota-owner', epoch: 1 })}:${day}`];
      for (const id of ids) await db.query('UPDATE connector_quotas SET used=GREATEST(0,used-1) WHERE id=$1', [id]);
      await db.query('UPDATE connector_jobs SET quota_reserved_at=NULL WHERE id=$1', [j.id]);
    });
  }
  async readJobInput(lease: JobLease): Promise<NormalizedCheckInput> {
    return this.db.transaction(async db => { const j = await this.requireJob(db, lease); const encrypted = j.encryptedInput ?? fail('content_expired'); if (j.contentExpiresAt <= this.now()) fail('content_expired'); return normalizedCheckInputSchema.parse(this.open(encrypted, lease.ref, 'input', j.admissionKey)); });
  }
  async recordAdmissionIntent(lease: JobLease) {
    return this.db.transaction(async db => {
      await this.lockAutomatic(db);
      const j = await this.requireJob(db, lease), c = await this.requireConnection(db, lease.ref);
      if (c.status !== 'active') fail('connection_paused');
      const r = await this.revisionRow(db, lease.ref, j.revisionId) ?? fail('revision_unavailable');
      const kind = j.admissionClass ?? (r.selectionReason === 'user_selected' ? 'selected' : 'automatic');
      if (kind === 'automatic' && (await rows(db, "SELECT id FROM connector_jobs WHERE id<>$1 AND admission_class='automatic' AND admission_attempted_at IS NOT NULL AND admission_resolved_at IS NULL AND expires_at>$2 LIMIT 1", [j.id, this.now()])).length) fail('automatic_slot_occupied');
      const attemptedAt = j.admissionAttemptedAt ?? this.now();
      await db.query('UPDATE connector_jobs SET admission_class=$1,admission_attempted_at=COALESCE(admission_attempted_at,$2) WHERE id=$3', [kind, attemptedAt, j.id]);
      return admissionIntent({ ...j, admissionClass: kind, admissionAttemptedAt: attemptedAt }, lease.ref);
    });
  }
  async clearUncommittedAdmissionIntent(lease: JobLease) {
    await this.db.transaction(async db => {
      await this.lockAutomatic(db); const j = await this.requireJob(db, lease);
      if (j.checkId) fail('admission_already_recorded');
      await db.query('UPDATE connector_jobs SET admission_class=NULL,admission_attempted_at=NULL,admission_resolved_at=NULL WHERE id=$1', [j.id]);
    });
  }
  async listAdmissionIntents(): Promise<AdmissionIntent[]> {
    const pending = await rows<JobRow & { provider: ConnectionRef['provider'] }>(this.db, 'SELECT j.*,c.provider FROM connector_jobs j JOIN connector_connections c ON c.id=j.connection_id AND c.owner_id=j.owner_id WHERE j.admission_attempted_at IS NOT NULL AND j.admission_resolved_at IS NULL AND j.expires_at>$1 ORDER BY j.admission_attempted_at,j.id LIMIT 50', [this.now()]);
    return pending.map(j => admissionIntent(j, { id: j.connectionId, ownerId: j.ownerId, epoch: j.epoch, provider: j.provider }));
  }
  async recordRecoveredAdmission(intent: AdmissionIntent, checkId: string, terminal: boolean) {
    refSchema.parse(intent.ref); idSchema.parse(checkId); idSchema.parse(intent.jobId);
    await this.db.transaction(async db => {
      await this.lockAutomatic(db);
      await db.query('SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 FOR UPDATE', [intent.ref.id, intent.ref.ownerId]);
      const j = (await rows<JobRow>(db, 'SELECT * FROM connector_jobs WHERE id=$1 AND owner_id=$2 AND connection_id=$3 AND epoch=$4 AND admission_key=$5 AND admission_attempted_at IS NOT NULL AND expires_at>$6 FOR UPDATE', [intent.jobId, intent.ref.ownerId, intent.ref.id, intent.ref.epoch, intent.admissionKey, this.now()]))[0] ?? fail('admission_intent_unavailable');
      if (admissionIntent(j, intent.ref).admissionDeadlineAt !== intent.admissionDeadlineAt) fail('stale_admission_intent');
      if (j.checkId && j.checkId !== checkId) fail('admission_conflict');
      await db.query("UPDATE connector_jobs SET check_id=$1,admission_resolved_at=CASE WHEN $2 THEN COALESCE(admission_resolved_at,$3) ELSE admission_resolved_at END,reason=CASE WHEN state='canceled' THEN CASE WHEN $2 THEN 'disconnect_cancel_requested' ELSE 'disconnect_cancel_pending' END ELSE reason END WHERE id=$4", [checkId, terminal, this.now(), j.id]);
    });
  }
  async resolveUnavailableAdmission(intent: AdmissionIntent, reason: 'main_check_unavailable' | 'admission_deadline_expired', checkId?: string) {
    refSchema.parse(intent.ref); idSchema.parse(intent.jobId);
    z.enum(['main_check_unavailable', 'admission_deadline_expired']).parse(reason); if (checkId) idSchema.parse(checkId);
    await this.db.transaction(async db => {
      await this.lockAutomatic(db);
      await db.query('SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 FOR UPDATE', [intent.ref.id, intent.ref.ownerId]);
      const j = (await rows<JobRow>(db, 'SELECT * FROM connector_jobs WHERE id=$1 AND owner_id=$2 AND connection_id=$3 AND epoch=$4 AND admission_key=$5 AND admission_attempted_at IS NOT NULL AND expires_at>$6 FOR UPDATE', [intent.jobId, intent.ref.ownerId, intent.ref.id, intent.ref.epoch, intent.admissionKey, this.now()]))[0] ?? fail('admission_intent_unavailable');
      if (j.admissionResolvedAt) return; // A terminal predecessor may already own a queued retry.
      if (admissionIntent(j, intent.ref).admissionDeadlineAt !== intent.admissionDeadlineAt) fail('stale_admission_intent');
      if (checkId && j.checkId && j.checkId !== checkId) fail('admission_conflict');
      await db.query("UPDATE connector_jobs SET check_id=COALESCE(check_id,$1),admission_resolved_at=COALESCE(admission_resolved_at,$2),state=CASE WHEN state='canceled' THEN state ELSE 'suppressed' END,reason=$3,lease_token=NULL,lease_until=NULL,encrypted_input=NULL WHERE id=$4", [checkId ?? null, this.now(), reason, j.id]);
      const r = await this.revisionRow(db, intent.ref, j.revisionId); if (!r) return;
      const manifest = manifestSchema.parse(r.manifest), target = manifest.targets.find(t => t.id === j.targetId);
      if (target) { target.status = 'not_checked'; target.reason = reason; }
      manifest.counts.pending = manifest.targets.filter(t => t.status === 'pending').length;
      manifest.counts.checked = manifest.targets.filter(t => t.status === 'checked').length;
      manifest.coverage = 'partial';
      await db.query('UPDATE connector_revisions SET manifest=$1::jsonb WHERE id=$2 AND owner_id=$3', [JSON.stringify(manifest), r.id, intent.ref.ownerId]);
      await db.query("UPDATE connector_items SET state='partial' WHERE id=$1 AND owner_id=$2 AND latest_revision_id=$3", [r.itemId, intent.ref.ownerId, r.id]);
    });
  }
  async recordAdmission(lease: JobLease, checkId: string) {
    idSchema.parse(checkId);
    await this.recordAdmissionIntent(lease);
    await this.db.transaction(async db => { const j = await this.requireJob(db, lease); if (j.checkId && j.checkId !== checkId) fail('admission_conflict'); await db.query('UPDATE connector_jobs SET check_id=$1 WHERE id=$2 AND owner_id=$3 AND epoch=$4', [checkId, j.id, lease.ref.ownerId, lease.ref.epoch]); });
  }
  async recordOrphanedAdmission(lease: JobLease, checkId: string) {
    refSchema.parse(lease.ref); idSchema.parse(checkId);
    await this.db.transaction(async db => {
      const j = (await rows<JobRow>(db, "SELECT * FROM connector_jobs WHERE id=$1 AND owner_id=$2 AND connection_id=$3 AND epoch=$4 AND admission_key=$5 AND state='canceled' AND expires_at>$6 FOR UPDATE", [lease.job.id, lease.ref.ownerId, lease.ref.id, lease.ref.epoch, lease.job.admissionKey, this.now()]))[0] ?? fail('stale_lease');
      if (j.checkId && j.checkId !== checkId) fail('admission_conflict');
      await db.query("UPDATE connector_jobs SET check_id=$1,reason='disconnect_cancel_pending' WHERE id=$2", [checkId, j.id]);
    });
  }
  async finishJob(lease: JobLease, input: JobOutcome) {
    const value = jobOutcomeSchema.parse(input);
    await this.db.transaction(async db => {
      await this.lockAutomatic(db);
      const j = await this.requireJob(db, lease);
      if (value.status === 'completed' && !j.checkId) fail('admission_required');
      if (value.status === 'deferred' && value.retryAt! <= this.now()) fail('invalid_retry_time');
      await db.query('UPDATE connector_jobs SET state=$1,reason=$2,due_at=$3,lease_token=NULL,lease_until=NULL,encrypted_input=CASE WHEN $4 THEN NULL ELSE encrypted_input END WHERE id=$5 AND owner_id=$6 AND epoch=$7', [value.status === 'deferred' ? 'queued' : value.status, value.reason ?? null, value.retryAt ?? j.dueAt, ['completed', 'suppressed'].includes(value.status), j.id, lease.ref.ownerId, lease.ref.epoch]);
      if ((j.checkId && ['completed', 'failed'].includes(value.status)) || (value.status === 'suppressed' && ['submission_expired', 'admission_deadline_expired'].includes(value.reason ?? ''))) await db.query('UPDATE connector_jobs SET admission_resolved_at=$1 WHERE id=$2 AND admission_attempted_at IS NOT NULL', [this.now(), j.id]);
      const r = await this.revisionRow(db, lease.ref, j.revisionId) ?? fail('revision_unavailable');
      const manifest = manifestSchema.parse(r.manifest);
      let retryQueued = false;
      if (value.status === 'failed' && value.reason === 'interrupted_terminal' && j.generation === 1 && j.checkId && j.encryptedInput && j.contentExpiresAt > this.now()) {
        const c = await this.requireConnection(db, lease.ref);
        const latest = (await rows<ItemRow>(db, 'SELECT * FROM connector_items WHERE id=$1 AND owner_id=$2', [r.itemId, lease.ref.ownerId]))[0];
        if (c.status === 'active' && latest?.latestRevisionId === r.id) {
          const input = normalizedCheckInputSchema.parse(this.open(j.encryptedInput, lease.ref, 'input', j.admissionKey));
          const key = admissionKey(lease.ref, r.itemId, r.revisionHash, j.targetId, 2);
          await insert(db, 'job', { ...j, id: randomUUID(), generation: 2, admissionKey: key, encryptedInput: this.seal(input, lease.ref, 'input', key), state: 'queued', dueAt: this.now(), leaseToken: null, leaseFence: 0, leaseUntil: null, checkId: null, reason: null, quotaReservedAt: null, admissionClass: null, admissionAttemptedAt: null, admissionResolvedAt: null, createdAt: this.now() }, 'ON CONFLICT (revision_id,target_id,generation) DO NOTHING');
          retryQueued = true;
        }
      }
      const target = manifest.targets.find(t => t.id === j.targetId);
      if (target) {
        target.status = retryQueued ? 'pending' : value.status === 'completed' ? (value.childState === 'partial' ? 'partial' : 'checked') : value.status === 'deferred' ? 'pending' : 'not_checked';
        if (value.reason && !retryQueued) target.reason = value.reason; else delete target.reason;
      }
      manifest.counts.checked = manifest.targets.filter(t => t.status === 'checked').length;
      manifest.counts.pending = manifest.targets.filter(t => t.status === 'pending').length;
      const hasGap = (manifest.extraction && (manifest.extraction.coverage !== 'complete' || manifest.extraction.diagnostics.length > 0)) || !manifest.targets.length || Object.values(manifest.overflow).some(Boolean) || manifest.targets.some(t => ['partial', 'unsupported', 'unavailable', 'not_checked'].includes(t.status));
      manifest.coverage = hasGap ? 'partial' : manifest.counts.pending ? 'pending' : 'complete';
      await db.query('UPDATE connector_revisions SET manifest=$1::jsonb WHERE id=$2 AND owner_id=$3', [JSON.stringify(manifest), r.id, lease.ref.ownerId]);
      const state = value.status === 'deferred' ? 'quota_paused' : manifest.counts.pending ? 'queued' : hasGap ? 'partial' : 'result_ready';
      await db.query('UPDATE connector_items SET state=$1 WHERE id=$2 AND owner_id=$3 AND latest_revision_id=$4', [state, r.itemId, lease.ref.ownerId, r.id]);
      await this.activity(db, lease.ref, 'job', value.reason ?? value.status);
    });
  }
  async reserveAutomaticQuota(lease: JobLease): Promise<QuotaReservation> {
    return this.db.transaction(async db => {
      await this.lockAutomatic(db); const j = await this.requireJob(db, lease);
      const c = await this.requireConnection(db, lease.ref), day = this.now().slice(0, 10), month = day.slice(0, 7);
      // An existing main check is recovery, never a new admission. Unadmitted work
      // must be accounted in the actual UTC admission window after lease recovery.
      if (j.quotaReservedAt && (j.checkId || j.quotaReservedAt.slice(0, 10) === day)) return { allowed: true, alreadyReserved: true };
      const specs = [
        { id: `global-day:${day}`, cap: CONNECTOR_LIMITS.automaticDay, reason: 'automatic_global_day' as const, accounted: j.quotaReservedAt?.slice(0, 10) === day },
        { id: `global-month:${month}`, cap: CONNECTOR_LIMITS.automaticMonth, reason: 'automatic_global_month' as const, accounted: j.quotaReservedAt?.slice(0, 7) === month },
        { id: `owner-day:${this.privateId(lease.ref.ownerId, { ...lease.ref, id: 'quota-owner', epoch: 1 })}:${day}`, cap: c.automaticDailyLimit, reason: 'automatic_owner_day' as const, accounted: j.quotaReservedAt?.slice(0, 10) === day },
      ].filter(s => !s.accounted);
      for (const s of specs) { const q = (await rows<{ used: number }>(db, 'SELECT used FROM connector_quotas WHERE id=$1', [s.id]))[0]; if (q && q.used >= s.cap) return { allowed: false, reason: s.reason, alreadyReserved: false }; }
      for (const s of specs) await insert(db, 'quota', { id: s.id, used: 1, expiresAt: this.at(90 * DAY) }, 'ON CONFLICT (id) DO UPDATE SET used=connector_quotas.used+1');
      await db.query('UPDATE connector_jobs SET quota_reserved_at=$1 WHERE id=$2', [this.now(), j.id]);
      return { allowed: true, alreadyReserved: false };
    });
  }
  async saveAlert(ref: ConnectionRef, input: AlertInput) {
    const value = alertInputSchema.parse(input);
    return this.db.transaction(async db => {
      await this.requireConnection(db, ref); const r = await this.revisionRow(db, ref, value.revisionId) ?? fail('revision_unavailable');
      await insert(db, 'alert', { id: randomUUID(), ownerId: ref.ownerId, connectionId: ref.id, epoch: ref.epoch, ...value, createdAt: this.now(), expiresAt: r.expiresAt, seenAt: null }, 'ON CONFLICT (revision_id,kind) DO NOTHING');
      return alert((await rows<AlertRow>(db, 'SELECT * FROM connector_alerts WHERE revision_id=$1 AND kind=$2 AND owner_id=$3', [value.revisionId, value.kind, ref.ownerId]))[0]);
    });
  }
  async listAlerts(subject: string, options: PageOptions = {}) {
    ownerSchema.parse(subject); const p = pageOptions(options);
    const cursor=accountCursor(p.before);
    const all = await rows<AlertRow>(this.db, "SELECT * FROM connector_alerts WHERE owner_id=$1 AND expires_at>$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::text)) AND ($6='' OR position(lower($6) in lower(kind || ' ' || reason))>0) AND ($7='all' OR ($7='unread' AND seen_at IS NULL) OR ($7='read' AND seen_at IS NOT NULL) OR kind=$7) ORDER BY created_at DESC,id DESC LIMIT $5", [subject,this.now(),cursor?.createdAt??null,cursor?.id??null,p.limit+1,p.query,p.filter]);
    return accountPage(all.map(alert),p.limit);
  }
  async markAlertSeen(subject: string, id: string) { ownerSchema.parse(subject); idSchema.parse(id); return (await rows(this.db, 'UPDATE connector_alerts SET seen_at=$1 WHERE id=$2 AND owner_id=$3 AND expires_at>$1 RETURNING id', [this.now(), id, subject])).length > 0; }
  async listActivity(subject: string, options: PageOptions = {}) {
    ownerSchema.parse(subject); const p = pageOptions(options);
    const cursor=accountCursor(p.before);
    const all = await rows<ActivityRow>(this.db, "SELECT * FROM connector_activity WHERE owner_id=$1 AND expires_at>$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::text)) AND ($6='' OR position(lower($6) in lower(kind || ' ' || reason))>0) AND ($7='all' OR kind=$7) ORDER BY created_at DESC,id DESC LIMIT $5", [subject,this.now(),cursor?.createdAt??null,cursor?.id??null,p.limit+1,p.query,p.filter]);
    return accountPage(all.map(a => ({ id: a.id, connectionId: a.connectionId, epoch:a.epoch, kind: a.kind as Activity['kind'], reason: a.reason, count: a.count, createdAt: a.createdAt, expiresAt: a.expiresAt })),p.limit);
  }
  async purgeExpired() {
    await this.db.transaction(async db => {
      const now = this.now();
      // Same order as admission/finish: automatic mutex -> connections -> jobs ->
      // revisions. Read manifests only after acquiring their parent serialization.
      // Maintenance conservatively serializes retained connections in ID order.
      await this.lockAutomatic(db);
      await db.query('SELECT id FROM connector_connections ORDER BY id FOR UPDATE');
      await db.query('SELECT id FROM connector_jobs ORDER BY id FOR UPDATE');
      await db.query('UPDATE connector_connections SET encrypted_cursor=NULL,encrypted_page=NULL,cursor_expires_at=NULL WHERE cursor_expires_at<=$1', [now]);
      const expired = await rows<RevisionRow>(db, "SELECT r.* FROM connector_revisions r WHERE (r.content_expires_at<=$1 OR EXISTS(SELECT 1 FROM connector_jobs j WHERE j.revision_id=r.id AND j.content_expires_at<=$1 AND j.check_id IS NULL AND j.state IN ('queued','leased'))) AND r.expires_at>$1 ORDER BY r.id FOR UPDATE", [now]);
      for (const r of expired) {
        const manifest = manifestSchema.parse(r.manifest);
        const jobs = await rows<JobRow>(db, 'SELECT * FROM connector_jobs WHERE revision_id=$1 ORDER BY generation DESC', [r.id]);
        let expiredTarget = false;
        for (const target of manifest.targets) {
          const latest = jobs.find(j => j.targetId === target.id);
          // An admitted/ambiguous run can still finalize without its source body.
          // Keep that coverage pending until authoritative main reconciliation.
          const awaitingMain = latest && (latest.checkId || (latest.admissionAttemptedAt && !latest.admissionResolvedAt));
          if (target.status === 'pending' && !awaitingMain && (r.contentExpiresAt <= now || (latest && latest.contentExpiresAt <= now))) {
            target.status = 'not_checked'; target.reason = 'content_expired'; expiredTarget = true;
          }
        }
        manifest.counts.pending = manifest.targets.filter(t => t.status === 'pending').length;
        manifest.counts.checked = manifest.targets.filter(t => t.status === 'checked').length;
        if (expiredTarget) manifest.coverage = 'partial';
        await db.query('UPDATE connector_revisions SET manifest=$1::jsonb WHERE id=$2', [JSON.stringify(manifest), r.id]);
        if (expiredTarget) await db.query("UPDATE connector_items SET state='expired' WHERE id=$1 AND latest_revision_id=$2", [r.itemId, r.id]);
      }
      await db.query('UPDATE connector_jobs SET encrypted_input=NULL WHERE content_expires_at<=$1', [now]);
      await db.query("UPDATE connector_jobs SET state='suppressed',reason='content_expired' WHERE content_expires_at<=$1 AND check_id IS NULL AND admission_attempted_at IS NULL AND state IN ('queued','leased')", [now]);
      await db.query('UPDATE connector_revisions SET encrypted_content=NULL WHERE content_expires_at<=$1', [now]);
      for (const table of ['connector_oauth_flows', 'connector_pending_items', 'connector_deliveries', 'connector_activity', 'connector_alerts', 'connector_jobs', 'connector_revisions', 'connector_items', 'connector_quotas']) await db.query(`DELETE FROM ${table} WHERE expires_at<=$1`, [now]);
    });
  }
}
