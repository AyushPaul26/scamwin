import {readOwnerGeneration,assertOwnerGeneration} from './privacy-fence';
import {randomUUID,ECDH} from 'node:crypto';
import {z} from 'zod';
import {sendNotification} from 'web-push';
import {createInsertSchema} from 'drizzle-zod';
import {connectorPushSubscriptions} from '../../db/scamwin-notification-schema';
import type {ConnectorDatabase} from './store';
import {ConnectorStoreError} from './store';
import {ownerSchema} from './contracts';
import {sealConnectorSecret,openConnectorSecret,privateIdentifier,type ConnectorKeyring} from './crypto';
const endpoint=z.string().max(2048).superRefine((value,ctx)=>{
 try{const u=new URL(value),paths:Record<string,RegExp>={'fcm.googleapis.com':/^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:-]+$/,'updates.push.services.mozilla.com':/^\/wpush\/v2\/[A-Za-z0-9_-]+$/,'web.push.apple.com':/^\/Q[A-Za-z0-9/_-]+$/};if(u.protocol!=='https:'||(u.port&&u.port!=='443')||u.username||u.password||u.search||u.hash||!paths[u.hostname]?.test(u.pathname))throw new Error();}catch{ctx.addIssue({code:'custom',message:'unsupported_push_service'});}
});
export const validatedSubscription=z.object({endpoint,expirationTime:z.number().finite().nonnegative().nullable().optional(),keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]{87}$/).refine(v=>{try{const bytes=Buffer.from(v,'base64url');if(bytes[0]!==4)return false;ECDH.convertKey(bytes,'prime256v1');return true;}catch{return false;}}),auth:z.string().regex(/^[A-Za-z0-9_-]{22}$/)}).strict()}).strict();
type Subscription=z.infer<typeof validatedSubscription>;
export const genericPushPayload=JSON.stringify({title:'Scamwin',body:'You have a private account update. Sign in to read it.',url:'/account/alerts'});
const insertSchema=createInsertSchema(connectorPushSubscriptions,{ownerId:ownerSchema}).strict();
export function pushConfiguration(env:Record<string,string|undefined>=process.env){
 if(env.SCAMWIN_PRIVATE_PUSH_ENABLED!=='true')return null;
 const publicKey=env.SCAMWIN_WEB_PUSH_PUBLIC_KEY,privateKey=env.SCAMWIN_WEB_PUSH_PRIVATE_KEY,subject=env.SCAMWIN_WEB_PUSH_SUBJECT;
 if(!publicKey||!privateKey||!subject||!/^mailto:[^\s]+@[^\s]+$/.test(subject)||!/^[A-Za-z0-9_-]{87}$/.test(publicKey)||!/^[A-Za-z0-9_-]{43}$/.test(privateKey))return null;
 return {publicKey,privateKey,subject};
}
export class PushSubscriptionService{
 constructor(private db:ConnectorDatabase,private keyring:ConnectorKeyring,private now:()=>Date=()=>new Date(),private transport:(subscription:Subscription)=>Promise<unknown>=async subscription=>{const c=pushConfiguration();if(!c)throw new ConnectorStoreError('push_unavailable');await sendNotification(subscription,genericPushPayload,{vapidDetails:c,TTL:300,timeout:5000,urgency:'normal'});}){}
 private binding(owner:string,epoch:number){return {ownerId:owner,connectionId:'private-account-device',epoch,purpose:'grant' as const};}
 async register(owner:string,input:unknown){
  const ownerGeneration=await readOwnerGeneration(this.db,owner);
  ownerSchema.parse(owner);const subscription=validatedSubscription.parse(input);if(subscription.expirationTime&&subscription.expirationTime<=this.now().getTime())throw new ConnectorStoreError('subscription_expired');
  const endpointKey=privateIdentifier(subscription.endpoint,{ownerId:'push-service',connectionId:'subscription',epoch:1,purpose:'identifier'},this.keyring);
  return this.db.transaction(async db=>{
   await assertOwnerGeneration(db,owner,ownerGeneration);
   const now=this.now().toISOString();await db.query('INSERT INTO connector_notification_preferences (owner_id,all_results,push_epoch,updated_at) VALUES ($1,0,1,$2) ON CONFLICT (owner_id) DO NOTHING',[owner,now]);
   const pref=(await db.query('SELECT push_epoch FROM connector_notification_preferences WHERE owner_id=$1 FOR UPDATE',[owner])).rows[0],epoch=Number(pref.push_epoch);
   const existing=(await db.query('SELECT owner_id FROM connector_push_subscriptions WHERE endpoint_key=$1 FOR UPDATE',[endpointKey])).rows[0];if(existing&&existing.owner_id!==owner)throw new ConnectorStoreError('subscription_owned');
   const v=insertSchema.parse({id:randomUUID(),ownerId:owner,endpointKey,epoch,generation:1,encryptedSubscription:sealConnectorSecret(JSON.stringify(subscription),this.binding(owner,epoch),this.keyring),createdAt:now,expiresAt:new Date(Math.min(this.now().getTime()+90*86400000,subscription.expirationTime??Infinity)).toISOString()});
   await db.query('INSERT INTO connector_push_subscriptions (id,owner_id,endpoint_key,epoch,generation,encrypted_subscription,created_at,expires_at) VALUES ($1,$2,$3,$4,1,$5,$6,$7) ON CONFLICT (endpoint_key) DO UPDATE SET epoch=$4,generation=connector_push_subscriptions.generation+1,encrypted_subscription=$5,expires_at=$7 WHERE connector_push_subscriptions.owner_id=$2',[v.id,owner,endpointKey,epoch,v.encryptedSubscription,now,v.expiresAt]);return {registered:true};
  });
 }
 async revoke(owner:string){ownerSchema.parse(owner);await this.db.transaction(async db=>{await db.query('INSERT INTO connector_notification_preferences (owner_id,all_results,push_epoch,updated_at) VALUES ($1,0,2,$2) ON CONFLICT (owner_id) DO UPDATE SET push_epoch=connector_notification_preferences.push_epoch+1,updated_at=$2',[owner,this.now().toISOString()]);await db.query('DELETE FROM connector_push_subscriptions WHERE owner_id=$1',[owner]);});return {registered:false};}
 async deliver(owner:string,signal?:AbortSignal){
  ownerSchema.parse(owner);const rows=(await this.db.query('SELECT s.* FROM connector_push_subscriptions s JOIN connector_notification_preferences p ON p.owner_id=s.owner_id AND p.push_epoch=s.epoch WHERE s.owner_id=$1 AND s.expires_at>$2 LIMIT 10',[owner,this.now().toISOString()])).rows;
  for(const row of rows){if(signal?.aborted)return;try{
   // Recheck the epoch immediately before dispatch. In-flight remote delivery is best effort.
   if(!(await this.db.query('SELECT id FROM connector_push_subscriptions s JOIN connector_notification_preferences p ON p.owner_id=s.owner_id AND p.push_epoch=s.epoch WHERE s.id=$1 AND s.owner_id=$2 AND s.epoch=$3 AND s.generation=$4',[row.id,owner,row.epoch,row.generation])).rows.length)continue;
   const subscription=validatedSubscription.parse(JSON.parse(openConnectorSecret(String(row.encrypted_subscription),this.binding(owner,Number(row.epoch)),this.keyring)));await this.transport(subscription);
  }catch(error){const code=error&&typeof error==='object'&&'statusCode'in error?error.statusCode:null;if(code===404||code===410)await this.db.query('DELETE FROM connector_push_subscriptions WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND generation=$4',[row.id,owner,row.epoch,row.generation]);}}
 }
}
