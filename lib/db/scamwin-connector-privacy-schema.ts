import {pgTable,text,integer,timestamp} from 'drizzle-orm/pg-core';
/** Small durable fence; contains no provider content, credentials or external identity. */
export const connectorOwnerGenerations=pgTable('connector_owner_generations',{
 ownerId:text('owner_id').primaryKey(),generation:integer('generation').notNull().default(0),
});
/** Cross-database cleanup survives interruption; only app check references are retained. */
export const connectorErasureChecks=pgTable('connector_erasure_checks',{
 id:text('id').primaryKey(),checkId:text('check_id'),ownerId:text('owner_id').notNull(),
 admissionKey:text('admission_key').notNull(),admissionDeadlineAt:timestamp('admission_deadline_at',{withTimezone:true,mode:'string'}).notNull(),createdAt:timestamp('created_at',{withTimezone:true,mode:'string'}).notNull(),
});
