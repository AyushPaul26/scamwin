import {pgTable,text,integer,timestamp,jsonb,index,uniqueIndex} from 'drizzle-orm/pg-core';
const time=(name:string)=>timestamp(name,{withTimezone:true,mode:'string'});
/** Supplemental tables belong exclusively to scamwin_connectors, never the main schema. */
export const connectorPrivateOutcomes=pgTable('connector_private_outcomes',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),connectionId:text('connection_id').notNull(),epoch:integer('epoch').notNull(),revisionId:text('revision_id'),itemId:text('item_id'),noticeId:text('notice_id'),eventKey:text('event_key').notNull(),kind:text('kind').notNull(),reason:text('reason').notNull(),counts:jsonb('counts').notNull(),revision:integer('revision').notNull(),seenAt:time('seen_at'),pushAttemptedAt:time('push_attempted_at'),createdAt:time('created_at').notNull(),expiresAt:time('expires_at').notNull(),
},t=>[uniqueIndex('connector_private_outcome_identity').on(t.ownerId,t.eventKey),index('connector_private_outcome_owner').on(t.ownerId,t.createdAt,t.id),index('connector_private_outcome_expiry').on(t.expiresAt)]);
export const connectorNotificationPreferences=pgTable('connector_notification_preferences',{
 ownerId:text('owner_id').primaryKey(),allResults:integer('all_results').notNull(),pushEpoch:integer('push_epoch').notNull(),updatedAt:time('updated_at').notNull(),
});
export const connectorNotificationProjection=pgTable('connector_notification_projection',{
 revisionId:text('revision_id').primaryKey(),ownerId:text('owner_id').notNull(),checkedAt:time('checked_at').notNull(),expiresAt:time('expires_at').notNull(),
});
export const connectorPushSubscriptions=pgTable('connector_push_subscriptions',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),endpointKey:text('endpoint_key').notNull(),epoch:integer('epoch').notNull(),generation:integer('generation').notNull(),encryptedSubscription:text('encrypted_subscription').notNull(),createdAt:time('created_at').notNull(),expiresAt:time('expires_at').notNull(),
},t=>[uniqueIndex('connector_push_endpoint_identity').on(t.endpointKey),index('connector_push_owner').on(t.ownerId,t.epoch),index('connector_push_expiry').on(t.expiresAt)]);
