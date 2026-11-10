import {randomBytes,createHash} from 'node:crypto';
import type {ConnectionRef,ProviderItem,SavedConnection} from './contracts';
import {refSchema} from './contracts';
import {ConnectorStoreError,PostgresConnectorStore,type ConnectorDatabase,type ConnectorSql} from './store';
import {privateIdentifier,openConnectorSecret,sealConnectorSecret,type ConnectorKeyring} from './crypto';
import type {ProviderIdentityProof} from './oauth-contracts';

const DAY=86400000;
export type TelegramBusiness={id:string;user:{id:number|string};user_chat_id:number|string;date:number;is_enabled:boolean;rights?:Record<string,unknown>};
export type TelegramFile={id:string;fileId:string;mediaType:string;size:number};
export type TelegramEventValue={item:ProviderItem;files:TelegramFile[]};
type Link={ref:ConnectionRef;userId:string;started:boolean;startCompleted:boolean;disabled:boolean;business:TelegramBusiness|null;lastUpdate:number;coverageAt:string|null};
const fail=(code:string):never=>{throw new ConnectorStoreError(code);};
export function telegramUserId(value:unknown):string{
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return String(value);
 if(typeof value==='string'&&/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n)return value;
 return fail('telegram_identity_mismatch');
}
/** One atomic statement permits cleanup through ConnectorSql without encryption/provider configuration. */
export async function expireTelegramLinks(db:ConnectorSql,now:Date,filter:{ref?:ConnectionRef;userKey?:string;businessKey?:string}={}){
 const result=await db.query(`WITH expired AS MATERIALIZED (
  SELECT c.id,c.owner_id,c.epoch FROM connector_telegram_links l
  JOIN connector_connections c ON c.id=l.connection_id AND c.owner_id=l.owner_id AND c.epoch=l.epoch
  WHERE l.expires_at<=$1 AND c.provider='telegram' AND c.status<>'disconnected'
   AND ($2::text IS NULL OR (l.connection_id=$2 AND l.owner_id=$3 AND l.epoch=$4))
   AND ($5::text IS NULL OR l.user_key=$5) AND ($6::text IS NULL OR l.business_key=$6)
  ORDER BY l.expires_at,l.connection_id LIMIT 100 FOR UPDATE OF c,l
 ), revoked AS (
  UPDATE connector_connections c SET epoch=c.epoch+1,status='disconnected',encrypted_grant=NULL,encrypted_identity=NULL,
   refresh_lock_token=NULL,refresh_until=NULL,refresh_fence=refresh_fence+1,encrypted_cursor=NULL,encrypted_page=NULL,
   cursor_expires_at=NULL,sync_token=NULL,sync_until=NULL,updated_at=$1
  FROM expired e WHERE c.id=e.id AND c.owner_id=e.owner_id AND c.epoch=e.epoch RETURNING c.id,c.owner_id,c.epoch
 ), jobs AS (
  UPDATE connector_jobs j SET state='canceled',reason=CASE WHEN check_id IS NULL THEN 'disconnected' ELSE 'disconnect_cancel_pending' END,lease_token=NULL,lease_until=NULL
  FROM revoked r WHERE j.connection_id=r.id AND j.owner_id=r.owner_id AND j.epoch=r.epoch-1 AND j.state IN ('queued','leased') RETURNING j.id
 ), pending AS (
  DELETE FROM connector_pending_items p USING revoked r WHERE p.connection_id=r.id RETURNING p.id
 ), flows AS (
  DELETE FROM connector_oauth_flows f USING revoked r WHERE f.connection_id=r.id AND f.owner_id=r.owner_id RETURNING f.id
 ), activity AS (
  INSERT INTO connector_activity(id,owner_id,connection_id,epoch,kind,reason,count,created_at,expires_at)
  SELECT gen_random_uuid()::text,r.owner_id,r.id,r.epoch+v.epoch_offset,v.kind,v.reason,1,$1,$1::timestamptz+INTERVAL '90 days'
  FROM revoked r CROSS JOIN (VALUES ('gap','telegram_link_expired_relink_required',-1),('connection','disconnected',0)) v(kind,reason,epoch_offset)
  RETURNING id
 ) DELETE FROM connector_telegram_links l USING revoked r
 WHERE l.connection_id=r.id AND l.owner_id=r.owner_id AND l.epoch=r.epoch-1 AND l.expires_at<=$1 RETURNING l.connection_id`,[now.toISOString(),filter.ref?.id??null,filter.ref?.ownerId??null,filter.ref?.epoch??null,filter.userKey??null,filter.businessKey??null]);
 return result.rows.length>0;
}
/** Persistent identity/link/event boundary; no bodies are retained for unbound updates. */
export class TelegramBindingStore{
 constructor(readonly database:ConnectorDatabase,private readonly keyring:ConnectorKeyring,readonly now:()=>Date=()=>new Date()){}
 private at(ms=0){return new Date(this.now().getTime()+ms).toISOString();}
 private bind(ref:ConnectionRef,suffix:string){return {ownerId:ref.ownerId,connectionId:`${ref.id}:telegram:${suffix}`,epoch:ref.epoch,purpose:'content' as const};}
 private global(value:string){return privateIdentifier(value,this.bind({id:'service',ownerId:'telegram',epoch:1,provider:'telegram'},'identifier'),this.keyring);}
 private seal(value:unknown,ref:ConnectionRef,suffix:string){return sealConnectorSecret(JSON.stringify(value),this.bind(ref,suffix),this.keyring);}
 private open<T>(value:unknown,ref:ConnectionRef,suffix:string):T{return JSON.parse(openConnectorSecret(String(value),this.bind(ref,suffix),this.keyring));}
 private async current(db:ConnectorSql,ref:ConnectionRef){
  refSchema.parse(ref);if(ref.provider!=='telegram')fail('connection_unavailable');
  if(!(await db.query("SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider='telegram' AND status<>'disconnected'",[ref.id,ref.ownerId,ref.epoch])).rows.length)fail('connection_unavailable');
 }
 private link(row:Record<string,unknown>):Link{
  const ref:ConnectionRef={id:String(row.connection_id),ownerId:String(row.owner_id),epoch:Number(row.epoch),provider:'telegram'};
  return {ref,userId:this.open<string>(row.encrypted_identity,ref,'identity'),started:!!row.started_at,startCompleted:row.start_completed===1,disabled:row.disabled===1,business:row.encrypted_business?this.open<TelegramBusiness>(row.encrypted_business,ref,'business'):null,lastUpdate:Number(row.last_update),coverageAt:row.coverage_at?new Date(String(row.coverage_at)).toISOString():null};
 }
 /** Expiry is an authority transition, before a matching delivery can be acknowledged as unbound. */
 private async expireLinks(filter:{ref?:ConnectionRef;userKey?:string;businessKey?:string}={}){
  return expireTelegramLinks(this.database,this.now(),filter);
 }
 async expire(ref:ConnectionRef){refSchema.parse(ref);if(ref.provider!=='telegram')return false;return this.expireLinks({ref});}
 async wasLinkExpired(ref:ConnectionRef){return !!(await this.database.query("SELECT id FROM connector_activity WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND reason='telegram_link_expired_relink_required' AND expires_at>$4 LIMIT 1",[ref.id,ref.ownerId,ref.epoch-1,this.at()])).rows.length;}
 async begin(ref:ConnectionRef,proof:ProviderIdentityProof){
  if(proof.provider!=='telegram'||proof.expiresAt<=this.now().getTime()||proof.verifiedAt>this.now().getTime())return fail('telegram_identity_required');
  const userId=telegramUserId(proof.telegramUserId),nonce=randomBytes(32).toString('base64url'),expiresAt=this.at(600000);
  await this.database.transaction(async db=>{
   await this.current(db,ref);
   await db.query('INSERT INTO connector_telegram_links(connection_id,owner_id,epoch,user_key,encrypted_identity,nonce_hash,nonce_expires_at,started_at,start_update,start_completed,business_key,encrypted_business,last_update,disabled,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,NULL,0,NULL,NULL,-1,0,$8) ON CONFLICT(connection_id) DO UPDATE SET owner_id=excluded.owner_id,epoch=excluded.epoch,user_key=excluded.user_key,encrypted_identity=excluded.encrypted_identity,nonce_hash=excluded.nonce_hash,nonce_expires_at=excluded.nonce_expires_at,started_at=NULL,start_update=NULL,start_completed=0,coverage_at=NULL,business_key=NULL,encrypted_business=NULL,last_update=-1,disabled=0,expires_at=excluded.expires_at',[ref.id,ref.ownerId,ref.epoch,this.global(`user:${userId}`),this.seal(userId,ref,'identity'),createHash('sha256').update(nonce).digest('hex'),expiresAt,this.at(90*DAY)]);
  });return {nonce,expiresAt};
 }
 async consumeStart(nonce:string,user:unknown,updateId:number):Promise<Link>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(nonce))fail('telegram_link_unavailable');
  return this.database.transaction(async db=>{
   const row=(await db.query('SELECT * FROM connector_telegram_links WHERE nonce_hash=$1 AND nonce_expires_at>$2 AND expires_at>$2 FOR UPDATE',[createHash('sha256').update(nonce).digest('hex'),this.at()])).rows[0];
   if(!row)fail('telegram_link_unavailable');const link=this.link(row);await this.current(db,link.ref);
   if(link.userId!==telegramUserId(user))fail('telegram_identity_mismatch');
   if(row.start_update!==null){if(Number(row.start_update)!==updateId)fail('telegram_link_unavailable');return link;}
   // One claim belongs to one authenticated delivery. Keep its hash until the same
   // ten-minute deadline so provider/binding failures can resume that delivery.
   await db.query('UPDATE connector_telegram_links SET started_at=$1,start_update=$2,start_completed=0,last_update=$2 WHERE connection_id=$3',[this.at(),updateId,link.ref.id]);
   return {...link,started:true,lastUpdate:updateId};
  });
 }
 async completeStart(nonce:string,user:unknown,updateId:number){
  const expectedUser=telegramUserId(user),hash=createHash('sha256').update(nonce).digest('hex');
  await this.database.transaction(async db=>{
   const row=(await db.query('SELECT * FROM connector_telegram_links WHERE nonce_hash=$1 AND nonce_expires_at>$2 AND start_update=$3 FOR UPDATE',[hash,this.at(),updateId])).rows[0];
   if(!row)fail('telegram_link_unavailable');const link=this.link(row);await this.current(db,link.ref);
   if(link.userId!==expectedUser)fail('telegram_identity_mismatch');
   await db.query('UPDATE connector_telegram_links SET start_completed=1 WHERE connection_id=$1',[link.ref.id]);
  });
 }
 async forUser(user:unknown){
  await this.expireLinks({userKey:this.global(`user:${telegramUserId(user)}`)});
  const row=(await this.database.query("SELECT l.* FROM connector_telegram_links l JOIN connector_connections c ON c.id=l.connection_id AND c.owner_id=l.owner_id AND c.epoch=l.epoch WHERE l.user_key=$1 AND l.started_at IS NOT NULL AND l.disabled=0 AND l.expires_at>$2 AND c.status<>'disconnected' ORDER BY l.started_at DESC LIMIT 1",[this.global(`user:${telegramUserId(user)}`),this.at()])).rows[0];return row?this.link(row):null;
 }
 async forBusiness(id:string){
  await this.expireLinks({businessKey:this.global(`business:${id}`)});
  const row=(await this.database.query("SELECT l.* FROM connector_telegram_links l JOIN connector_connections c ON c.id=l.connection_id AND c.owner_id=l.owner_id AND c.epoch=l.epoch WHERE l.business_key=$1 AND l.expires_at>$2 AND c.status<>'disconnected' LIMIT 1",[this.global(`business:${id}`),this.at()])).rows[0];return row?this.link(row):null;
 }
 async get(ref:ConnectionRef){
  if(await this.expire(ref))return null;
  await this.current(this.database,ref);const row=(await this.database.query('SELECT * FROM connector_telegram_links WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND expires_at>$4',[ref.id,ref.ownerId,ref.epoch,this.at()])).rows[0];return row?this.link(row):null;
 }
 async canRead(ref:ConnectionRef){
  if(await this.expire(ref))return false;
  return !!(await this.database.query("SELECT c.id FROM connector_connections c JOIN connector_telegram_links l ON l.connection_id=c.id AND l.owner_id=c.owner_id AND l.epoch=c.epoch WHERE c.id=$1 AND c.owner_id=$2 AND c.epoch=$3 AND c.provider='telegram' AND c.status='active' AND c.mode<>'manual' AND c.activation_at IS NOT NULL AND l.started_at IS NOT NULL AND l.disabled=0 AND l.business_key IS NOT NULL AND l.expires_at>$4",[ref.id,ref.ownerId,ref.epoch,this.at()])).rows.length;
 }
 async pending(business:TelegramBusiness,updateId:number){
  const id=this.global(`business:${business.id}`),ref:ConnectionRef={id,ownerId:'telegram-unbound',epoch:1,provider:'telegram'};
  await this.database.transaction(async db=>{
   await db.query('DELETE FROM connector_telegram_pending_connections WHERE expires_at<=$1',[this.at()]);
   const count=Number((await db.query('SELECT count(*) AS n FROM connector_telegram_pending_connections')).rows[0].n);if(count>=1000)fail('telegram_pending_limit');
   await db.query('INSERT INTO connector_telegram_pending_connections(id,user_key,encrypted_value,update_id,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET encrypted_value=excluded.encrypted_value,update_id=excluded.update_id,expires_at=excluded.expires_at WHERE connector_telegram_pending_connections.update_id<excluded.update_id',[id,this.global(`user:${telegramUserId(business.user.id)}`),this.seal(business,ref,'pending'),updateId,this.at(DAY)]);
  });
 }
 async pendingForUser(user:string){
  const rows=(await this.database.query('SELECT * FROM connector_telegram_pending_connections WHERE user_key=$1 AND expires_at>$2 ORDER BY update_id DESC LIMIT 10',[this.global(`user:${user}`),this.at()])).rows;
  return rows.map(row=>({business:this.open<TelegramBusiness>(row.encrypted_value,{id:String(row.id),ownerId:'telegram-unbound',epoch:1,provider:'telegram'},'pending'),updateId:Number(row.update_id)}));
 }
 async bindBusiness(ref:ConnectionRef,business:TelegramBusiness,updateId:number){
  return this.database.transaction(async db=>{
   await this.current(db,ref);const row=(await db.query('SELECT * FROM connector_telegram_links WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 FOR UPDATE',[ref.id,ref.ownerId,ref.epoch])).rows[0];
   if(!row)fail('telegram_link_unavailable');const link=this.link(row);
   if(!link.started||link.disabled||link.userId!==telegramUserId(business.user.id))fail('telegram_identity_mismatch');
   if(updateId<=link.lastUpdate&&link.business)return false;
   // One account connection per epoch. Replacement requires fresh browser link.
   if(link.business&&link.business.id!==business.id)fail('telegram_connection_mismatch');
   await db.query('UPDATE connector_telegram_links SET business_key=$1,encrypted_business=$2,last_update=$3,disabled=$4 WHERE connection_id=$5',[this.global(`business:${business.id}`),this.seal(business,ref,'business'),Math.max(updateId,link.lastUpdate),business.is_enabled?0:1,ref.id]);return true;
  });
 }
 async carryEpoch(previous:ConnectionRef,next:SavedConnection){
  if(previous.epoch===next.epoch)return;
  await this.database.transaction(async db=>{
   await this.current(db,next);const row=(await db.query('SELECT * FROM connector_telegram_links WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 FOR UPDATE',[previous.id,previous.ownerId,previous.epoch])).rows[0];
   if(!row)fail('telegram_link_unavailable');const link=this.link(row);
   if(link.disabled||!link.business?.is_enabled)fail('telegram_automation_required');
   await db.query('UPDATE connector_telegram_links SET epoch=$1,encrypted_identity=$2,encrypted_business=$3,nonce_hash=NULL,nonce_expires_at=NULL WHERE connection_id=$4',[next.epoch,this.seal(link.userId,next,'identity'),this.seal(link.business,next,'business'),next.id]);
  });
 }
 async setCoverageBoundary(ref:ConnectionRef){await this.current(this.database,ref);await this.database.query('UPDATE connector_telegram_links SET coverage_at=$1 WHERE connection_id=$2 AND owner_id=$3 AND epoch=$4',[this.at(),ref.id,ref.ownerId,ref.epoch]);}
 /** Serializes materialization and edit/delete ordering across workers without holding core connection locks. */
 async serialize<T>(ref:ConnectionRef,fn:(bindings:TelegramBindingStore,core:PostgresConnectorStore,database:ConnectorDatabase)=>Promise<T>):Promise<T>{
  return this.database.transaction(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`telegram:${ref.id}`]);
   // Both stores participate in this actual transaction; nested operations reuse it.
   const database:ConnectorDatabase={query:db.query.bind(db),transaction:async callback=>callback(db)};
   return fn(new TelegramBindingStore(database,this.keyring,this.now),new PostgresConnectorStore(database,{keyring:this.keyring,now:this.now}),database);
  });
 }
 async saveEvent(ref:ConnectionRef,itemId:string,updateId:number,value:TelegramEventValue|null,deleted=false){
  return this.database.transaction(async db=>{
   await this.current(db,ref);const itemKey=this.global(`item:${ref.id}:${ref.epoch}:${itemId}`),id=this.global(`delivery:${ref.id}:${ref.epoch}:${updateId}:${itemId}`);
   const latest=(await db.query('SELECT update_id,deleted FROM connector_telegram_events WHERE connection_id=$1 AND epoch=$2 AND item_key=$3 ORDER BY update_id DESC LIMIT 1',[ref.id,ref.epoch,itemKey])).rows[0];
   if(latest&&(Number(latest.deleted)===1||!deleted&&Number(latest.update_id)>updateId))return 'stale' as const;
   const inserted=await db.query('INSERT INTO connector_telegram_events(id,connection_id,owner_id,epoch,item_key,update_id,deleted,encrypted_value,expires_at,content_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING RETURNING id',[id,ref.id,ref.ownerId,ref.epoch,itemKey,updateId,deleted?1:0,value?this.seal(value,ref,`event:${id}`):null,this.at(90*DAY),this.at(30*DAY)]);
   if(deleted)await db.query('UPDATE connector_telegram_events SET encrypted_value=NULL WHERE connection_id=$1 AND epoch=$2 AND item_key=$3',[ref.id,ref.epoch,itemKey]);
   if(inserted.rows.length)return 'saved' as const;
   const prior=(await db.query('SELECT encrypted_value FROM connector_telegram_events WHERE id=$1',[id])).rows[0];
   return prior?.encrypted_value?'duplicate' as const:'discarded' as const;
  });
 }
 async readEvent(ref:ConnectionRef,itemId:string,version?:string):Promise<TelegramEventValue|null>{
  if(await this.expire(ref))return null;
  await this.current(this.database,ref);
  if(!(await this.database.query("SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND status='active' AND mode<>'manual' AND activation_at IS NOT NULL",[ref.id,ref.ownerId,ref.epoch])).rows.length)return null;
  const key=this.global(`item:${ref.id}:${ref.epoch}:${itemId}`);
  const rows=(await this.database.query('SELECT * FROM connector_telegram_events WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND item_key=$4 AND expires_at>$5 ORDER BY update_id DESC LIMIT 1',[ref.id,ref.ownerId,ref.epoch,key,this.at()])).rows;
  const row=rows[0];if(!row||row.deleted===1||!row.encrypted_value||Date.parse(String(row.content_expires_at))<=this.now().getTime()||version!==undefined&&String(row.update_id)!==version)return null;
  return this.open<TelegramEventValue>(row.encrypted_value,ref,`event:${row.id}`);
 }
 async purge(){
  await this.expireLinks();
  await this.database.query('UPDATE connector_telegram_events SET encrypted_value=NULL WHERE content_expires_at<=$1',[this.at()]);
  for(const name of ['connector_telegram_events','connector_telegram_pending_connections'])await this.database.query(`DELETE FROM ${name} WHERE expires_at<=$1`,[this.at()]);
  // A bounded maintenance pass leaves any not-yet-fenced live link for the next pass or matching receipt.
  await this.database.query("DELETE FROM connector_telegram_links l WHERE l.expires_at<=$1 AND NOT EXISTS(SELECT 1 FROM connector_connections c WHERE c.id=l.connection_id AND c.owner_id=l.owner_id AND c.epoch=l.epoch AND c.provider='telegram' AND c.status<>'disconnected')",[this.at()]);
 }
}
