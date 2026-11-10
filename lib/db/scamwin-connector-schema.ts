import { pgTable, text, integer, timestamp, jsonb, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { ownerSchema, idSchema, providerSchema, rulesSchema, manifestSchema } from '../scamwin/connectors/contracts';

// Intentionally NOT re-exported from the main schema. This database has no cross-database FKs.
const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
export const connectorConnections = pgTable('connector_connections', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), provider: text('provider').notNull(), accountKey: text('account_key').notNull(),
  epoch: integer('epoch').notNull(), mode: text('mode').notNull(), status: text('status').notNull(), scope: jsonb('scope').notNull(), scopeVersion: integer('scope_version').notNull(), rules: jsonb('rules').notNull(), automaticDailyLimit: integer('automatic_daily_limit').notNull(),
  activationAt: time('activation_at'), encryptedGrant: text('encrypted_grant'), encryptedCursor: text('encrypted_cursor'), encryptedPage: text('encrypted_page'), cursorExpiresAt: time('cursor_expires_at'),
  encryptedIdentity: text('encrypted_identity'), refreshLockToken: text('refresh_lock_token'), refreshFence: integer('refresh_fence').notNull().default(0), refreshUntil: time('refresh_until'),
  syncToken: text('sync_token'), syncFence: integer('sync_fence').notNull().default(0), syncUntil: time('sync_until'),
  createdAt: time('created_at').notNull(), updatedAt: time('updated_at').notNull(),
}, t => [uniqueIndex('connector_account_unique').on(t.provider, t.accountKey), index('connector_owner_idx').on(t.ownerId, t.id), check('connector_epoch_positive', sql`${t.epoch} > 0`), check('connector_mode_valid', sql`${t.mode} IN ('manual','selective','all_new')`), check('connector_status_valid', sql`${t.status} IN ('active','paused','disconnected')`), check('connector_owner_limit_valid', sql`${t.automaticDailyLimit} IN (1,2)`)]);
export const connectorOAuthFlows = pgTable('connector_oauth_flows', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), provider: text('provider').notNull(), connectionId: text('connection_id'), expectedEpoch: integer('expected_epoch'), encryptedFlow: text('encrypted_flow').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_oauth_expiry').on(t.expiresAt)]);
export const connectorItems = pgTable('connector_items', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), connectionId: text('connection_id').notNull().references(() => connectorConnections.id, { onDelete: 'cascade' }), epoch: integer('epoch').notNull(), providerKey: text('provider_key').notNull(),
  latestRevisionId: text('latest_revision_id'), state: text('state').notNull(), receivedAt: time('received_at').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [uniqueIndex('connector_item_identity').on(t.connectionId, t.epoch, t.providerKey), index('connector_item_owner').on(t.ownerId, t.connectionId, t.epoch, t.id), index('connector_item_expiry').on(t.expiresAt)]);
export const connectorRevisions = pgTable('connector_revisions', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), connectionId: text('connection_id').notNull(), epoch: integer('epoch').notNull(), itemId: text('item_id').notNull().references(() => connectorItems.id, { onDelete: 'cascade' }),
  revisionHash: text('revision_hash').notNull(), manifest: jsonb('manifest').notNull(), selectionReason: text('selection_reason').notNull(), encryptedContent: text('encrypted_content'),
  createdAt: time('created_at').notNull(), contentExpiresAt: time('content_expires_at').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [uniqueIndex('connector_revision_identity').on(t.itemId, t.revisionHash), index('connector_revision_expiry').on(t.expiresAt)]);
export const connectorDeliveries = pgTable('connector_deliveries', {
  id: text('id').primaryKey(), connectionId: text('connection_id').notNull().references(() => connectorConnections.id, { onDelete: 'cascade' }), epoch: integer('epoch').notNull(), revisionId: text('revision_id').notNull().references(() => connectorRevisions.id, { onDelete: 'cascade' }), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_delivery_expiry').on(t.expiresAt)]);
export const connectorPendingItems = pgTable('connector_pending_items', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), connectionId: text('connection_id').notNull().references(() => connectorConnections.id, { onDelete: 'cascade' }), epoch: integer('epoch').notNull(), encryptedRef: text('encrypted_ref').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_pending_scope').on(t.connectionId, t.epoch, t.id)]);
export const connectorJobs = pgTable('connector_jobs', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), connectionId: text('connection_id').notNull(), epoch: integer('epoch').notNull(), revisionId: text('revision_id').notNull().references(() => connectorRevisions.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull(), generation: integer('generation').notNull(), admissionKey: text('admission_key').notNull(), inputHash: text('input_hash').notNull(), encryptedInput: text('encrypted_input'), state: text('state').notNull(),
  dueAt: time('due_at').notNull(), leaseToken: text('lease_token'), leaseFence: integer('lease_fence').notNull().default(0), leaseUntil: time('lease_until'), checkId: text('check_id'), reason: text('reason'), quotaReservedAt: time('quota_reserved_at'),
  admissionClass: text('admission_class'), admissionAttemptedAt: time('admission_attempted_at'), admissionResolvedAt: time('admission_resolved_at'),
  createdAt: time('created_at').notNull(), contentExpiresAt: time('content_expires_at').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [uniqueIndex('connector_job_admission').on(t.admissionKey), uniqueIndex('connector_target_generation').on(t.revisionId, t.targetId, t.generation), index('connector_job_due').on(t.state, t.dueAt), index('connector_job_owner').on(t.ownerId, t.connectionId, t.epoch), check('connector_generation_positive', sql`${t.generation} > 0`)]);
export const connectorAlerts = pgTable('connector_alerts', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), connectionId: text('connection_id').notNull(), epoch: integer('epoch').notNull(), revisionId: text('revision_id').notNull().references(() => connectorRevisions.id, { onDelete: 'cascade' }), kind: text('kind').notNull(), reason: text('reason').notNull(), counts: jsonb('counts').notNull(), seenAt: time('seen_at'), createdAt: time('created_at').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [uniqueIndex('connector_alert_identity').on(t.revisionId, t.kind), index('connector_alert_owner').on(t.ownerId, t.id)]);
export const connectorActivity = pgTable('connector_activity', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), connectionId: text('connection_id').notNull(), epoch: integer('epoch').notNull(), kind: text('kind').notNull(), reason: text('reason').notNull(), count: integer('count').notNull(), createdAt: time('created_at').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_activity_owner').on(t.ownerId, t.id), index('connector_activity_expiry').on(t.expiresAt)]);
export const connectorQuotas = pgTable('connector_quotas', {
  id: text('id').primaryKey(), used: integer('used').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [check('connector_quota_nonnegative', sql`${t.used} >= 0`)]);

// Model-derived insert validation is used before writes, including internal generated fields.
const scope = z.array(idSchema).min(1).max(50), encrypted = z.string().min(1).max(3 * 1024 * 1024);
export const connectorInsertSchemas = {
  connection: createInsertSchema(connectorConnections, { id: idSchema, ownerId: ownerSchema, provider: providerSchema, scope, rules: rulesSchema }).strict(),
  oauth: createInsertSchema(connectorOAuthFlows, { ownerId: ownerSchema, encryptedFlow: encrypted }).strict(),
  item: createInsertSchema(connectorItems, { ownerId: ownerSchema }).strict(),
  revision: createInsertSchema(connectorRevisions, { ownerId: ownerSchema, manifest: manifestSchema, encryptedContent: encrypted.nullable() }).strict(),
  delivery: createInsertSchema(connectorDeliveries).strict(),
  pending: createInsertSchema(connectorPendingItems, { ownerId: ownerSchema, encryptedRef: encrypted }).strict(),
  job: createInsertSchema(connectorJobs, { ownerId: ownerSchema, encryptedInput: encrypted.nullable() }).strict(),
  alert: createInsertSchema(connectorAlerts, { ownerId: ownerSchema, counts: manifestSchema.shape.counts }).strict(),
  activity: createInsertSchema(connectorActivity, { ownerId: ownerSchema }).strict(),
  quota: createInsertSchema(connectorQuotas).strict(),
};
