import {pgTable,text,integer,bigint,timestamp,index} from 'drizzle-orm/pg-core';
import {connectorConnections} from './scamwin-connector-schema';
const time=(name:string)=>timestamp(name,{withTimezone:true,mode:'string'});
// Supplemental tables belong only to the isolated connector database. No live DDL.
export const connectorTelegramLinks=pgTable('connector_telegram_links',{
 connectionId:text('connection_id').primaryKey().references(()=>connectorConnections.id,{onDelete:'cascade'}),
 ownerId:text('owner_id').notNull(),epoch:integer('epoch').notNull(),userKey:text('user_key').notNull(),
 encryptedIdentity:text('encrypted_identity').notNull(),nonceHash:text('nonce_hash'),nonceExpiresAt:time('nonce_expires_at'),
 startedAt:time('started_at'),startUpdate:bigint('start_update',{mode:'number'}),startCompleted:integer('start_completed').notNull(),coverageAt:time('coverage_at'),businessKey:text('business_key'),encryptedBusiness:text('encrypted_business'),
 lastUpdate:bigint('last_update',{mode:'number'}).notNull(),disabled:integer('disabled').notNull(),
 expiresAt:time('expires_at').notNull(),
},t=>[index('connector_telegram_user').on(t.userKey),index('connector_telegram_business').on(t.businessKey)]);
export const connectorTelegramPendingConnections=pgTable('connector_telegram_pending_connections',{
 id:text('id').primaryKey(),userKey:text('user_key').notNull(),encryptedValue:text('encrypted_value').notNull(),
 updateId:bigint('update_id',{mode:'number'}).notNull(),expiresAt:time('expires_at').notNull(),
},t=>[index('connector_telegram_pending_user').on(t.userKey)]);
export const connectorTelegramEvents=pgTable('connector_telegram_events',{
 id:text('id').primaryKey(),connectionId:text('connection_id').notNull().references(()=>connectorConnections.id,{onDelete:'cascade'}),
 ownerId:text('owner_id').notNull(),epoch:integer('epoch').notNull(),itemKey:text('item_key').notNull(),
 updateId:bigint('update_id',{mode:'number'}).notNull(),deleted:integer('deleted').notNull(),
 encryptedValue:text('encrypted_value'),expiresAt:time('expires_at').notNull(),contentExpiresAt:time('content_expires_at').notNull(),
},t=>[index('connector_telegram_event_item').on(t.connectionId,t.epoch,t.itemKey)]);
