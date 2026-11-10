import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { connectorConnections, connectorRevisions } from './scamwin-connector-schema';
const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
// Isolated connector database only; root composition imports these tables explicitly.
export const connectorDiscordLinks = pgTable('connector_discord_links', {
    connectionId: text('connection_id').primaryKey().references(() => connectorConnections.id, { onDelete: 'cascade' }), ownerId: text('owner_id').notNull(), actorKey: text('actor_key').notNull(), applicationKey: text('application_key').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_discord_actor').on(t.actorKey, t.applicationKey), index('connector_discord_link_expiry').on(t.expiresAt)]);
export const connectorDiscordEvents = pgTable('connector_discord_events', {
    id: text('id').primaryKey(), connectionId: text('connection_id').notNull().references(() => connectorConnections.id, { onDelete: 'cascade' }), epoch: integer('epoch').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_discord_event_expiry').on(t.expiresAt)]);
export const connectorDiscordMedia = pgTable('connector_discord_media', {
    id: text('id').primaryKey(), connectionId: text('connection_id').notNull().references(() => connectorConnections.id, { onDelete: 'cascade' }), ownerId: text('owner_id').notNull(), epoch: integer('epoch').notNull(), revisionId: text('revision_id').notNull().references(() => connectorRevisions.id, { onDelete: 'cascade' }), encryptedReference: text('encrypted_reference').notNull(), expiresAt: time('expires_at').notNull(),
}, t => [index('connector_discord_media_expiry').on(t.expiresAt)]);
