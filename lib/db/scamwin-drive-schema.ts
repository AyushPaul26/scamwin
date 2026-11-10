import {pgTable,text,integer,timestamp,uniqueIndex} from 'drizzle-orm/pg-core';
import {connectorConnections} from './scamwin-connector-schema';
/** Isolated connector database only. Raw Google file IDs and labels are encrypted. */
export const connectorDriveResources=pgTable('connector_drive_resources',{
 handle:text('handle').primaryKey(),connectionId:text('connection_id').notNull().references(()=>connectorConnections.id,{onDelete:'cascade'}),ownerId:text('owner_id').notNull(),epoch:integer('epoch').notNull(),resourceKey:text('resource_key').notNull(),encryptedValue:text('encrypted_value').notNull(),expiresAt:timestamp('expires_at',{withTimezone:true,mode:'string'}).notNull(),
},t=>[uniqueIndex('connector_drive_resource_key').on(t.connectionId,t.resourceKey)]);
