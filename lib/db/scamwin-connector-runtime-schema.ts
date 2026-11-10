import { pgTable, text, integer, timestamp, bigint, index } from 'drizzle-orm/pg-core';
import { connectorConnections, connectorRevisions,connectorItems } from './scamwin-connector-schema';
const time=(name:string)=>timestamp(name,{withTimezone:true,mode:'string'});
// Isolated connector database only. No main schema export or live DDL.
export const connectorDispatches=pgTable('connector_dispatches',{
  id:text('id').primaryKey(),expiresAt:time('expires_at').notNull(),
},t=>[index('connector_dispatch_expiry').on(t.expiresAt)]);
export const connectorSchedule=pgTable('connector_schedule',{
  connectionId:text('connection_id').primaryKey().references(()=>connectorConnections.id,{onDelete:'cascade'}),epoch:integer('epoch').notNull(),
  dueAt:time('due_at').notNull(),lastSyncAt:time('last_sync_at'),lastAttemptAt:time('last_attempt_at'),reason:text('reason').notNull(),failures:integer('failures').notNull(),
  token:text('token'),leaseUntil:time('lease_until'),fence:integer('fence').notNull(),
},t=>[index('connector_schedule_due').on(t.dueAt)]);
export const connectorRuntimeUsage=pgTable('connector_runtime_usage',{
  id:text('id').primaryKey(),calls:bigint('calls',{mode:'number'}).notNull(),bytes:bigint('bytes',{mode:'number'}).notNull(),computeMs:bigint('compute_ms',{mode:'number'}).notNull(),expiresAt:time('expires_at').notNull(),
});
export const connectorFetchAttempts=pgTable('connector_fetch_attempts',{
  id:text('id').primaryKey(),connectionId:text('connection_id').notNull().references(()=>connectorConnections.id,{onDelete:'cascade'}),epoch:integer('epoch').notNull(),attempts:integer('attempts').notNull(),dueAt:time('due_at').notNull(),expiresAt:time('expires_at').notNull(),
});
export const connectorSelectionHandles=pgTable('connector_selection_handles',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),connectionId:text('connection_id').notNull().references(()=>connectorConnections.id,{onDelete:'cascade'}),epoch:integer('epoch').notNull(),kind:text('kind').notNull(),encryptedValue:text('encrypted_value').notNull(),expiresAt:time('expires_at').notNull(),
},t=>[index('connector_selection_expiry').on(t.expiresAt)]);
export const connectorPreparations=pgTable('connector_preparations',{
  revisionId:text('revision_id').primaryKey().references(()=>connectorRevisions.id,{onDelete:'cascade'}),ownerId:text('owner_id').notNull(),connectionId:text('connection_id').notNull(),epoch:integer('epoch').notNull(),dueAt:time('due_at').notNull(),token:text('token'),leaseUntil:time('lease_until'),attempts:integer('attempts').notNull().default(0),expiresAt:time('expires_at').notNull(),
},t=>[index('connector_preparation_due').on(t.dueAt)]);
export const connectorSourceSuppressions=pgTable('connector_source_suppressions',{
  itemId:text('item_id').primaryKey().references(()=>connectorItems.id,{onDelete:'cascade'}),reason:text('reason').notNull(),expiresAt:time('expires_at').notNull(),
});
