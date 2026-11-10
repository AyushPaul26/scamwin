import {pgTable,text,integer,bigserial,timestamp,index,uniqueIndex} from 'drizzle-orm/pg-core';
import {connectorConnections} from './scamwin-connector-schema';
const time=(name:string)=>timestamp(name,{withTimezone:true,mode:'string'});
// Supplemental schema: isolated connector database only. No production DDL is performed here.
export const connectorTeamsResources=pgTable('connector_teams_resources',{
 handle:text('handle').primaryKey(),connectionId:text('connection_id').notNull().references(()=>connectorConnections.id,{onDelete:'cascade'}),
 ownerId:text('owner_id').notNull(),epoch:integer('epoch').notNull(),resourceKey:text('resource_key').notNull(),encryptedValue:text('encrypted_value').notNull(),expiresAt:time('expires_at').notNull(),
},t=>[uniqueIndex('connector_teams_resource_key').on(t.connectionId,t.resourceKey)]);
export const connectorTeamsSubscriptions=pgTable('connector_teams_subscriptions',{
 key:text('key').primaryKey(),connectionId:text('connection_id').notNull().references(()=>connectorConnections.id,{onDelete:'cascade'}),
 ownerId:text('owner_id').notNull(),epoch:integer('epoch').notNull(),resourceHandle:text('resource_handle').notNull(),encryptedValue:text('encrypted_value').notNull(),
 expirationAt:time('expiration_at').notNull(),lastOperationAt:time('last_operation_at'),leaseToken:text('lease_token'),leaseUntil:time('lease_until'),
 state:text('state').notNull(),attempts:integer('attempts').notNull(),dueAt:time('due_at').notNull(),expiresAt:time('expires_at').notNull(),
},t=>[index('connector_teams_subscription_connection').on(t.connectionId,t.epoch)]);
export const connectorTeamsEvents=pgTable('connector_teams_events',{
 sequence:bigserial('sequence',{mode:'number'}).primaryKey(),connectionId:text('connection_id').notNull().references(()=>connectorConnections.id,{onDelete:'cascade'}),
 ownerId:text('owner_id').notNull(),epoch:integer('epoch').notNull(),itemKey:text('item_key').notNull(),automatic:integer('automatic').notNull(),
 encryptedValue:text('encrypted_value').notNull(),receivedAt:time('received_at').notNull(),expiresAt:time('expires_at').notNull(),
},t=>[index('connector_teams_event_connection').on(t.connectionId,t.epoch,t.sequence)]);
