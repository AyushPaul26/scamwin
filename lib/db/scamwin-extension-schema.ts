import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { connectorConnections } from './scamwin-connector-schema';
const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
export const connectorExtensionPairs = pgTable('connector_extension_pairs', {
    codeHash: text('code_hash').primaryKey(), connectionId: text('connection_id').notNull().references(() => connectorConnections.id, { onDelete: 'cascade' }), ownerId: text('owner_id').notNull(), epoch: integer('epoch').notNull(), clientId: text('client_id').notNull(), challenge: text('challenge').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_extension_pair_expiry').on(t.expiresAt)]);
export const connectorExtensionGrants = pgTable('connector_extension_grants', {
    tokenHash: text('token_hash').primaryKey(), connectionId: text('connection_id').notNull().references(() => connectorConnections.id, { onDelete: 'cascade' }), ownerId: text('owner_id').notNull(), epoch: integer('epoch').notNull(), clientId: text('client_id').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_extension_grant_expiry').on(t.expiresAt)]);
export const connectorExtensionEvents = pgTable('connector_extension_events', {
    id: text('id').primaryKey(), connectionId: text('connection_id').notNull().references(() => connectorConnections.id, { onDelete: 'cascade' }), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_extension_event_expiry').on(t.expiresAt)]);
