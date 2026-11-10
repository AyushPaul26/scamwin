import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {ConnectionRef,ConnectorStore,ProviderItemRef,SavedConnection} from './contracts';
import {PostgresConnectorStore,ConnectorStoreError,type ConnectorDatabase,type ConnectorSql} from './store';
import {privateIdentifier,sealConnectorSecret,openConnectorSecret,type ConnectorKeyring} from './crypto';
import type {ExpandedIdentity,PostgresExpandedAuthorizationPersistence} from './expanded-auth';
import {SlackApiError,type SlackConversationClass} from './slack-protocol';
import {ConnectorRuntimeStore} from './runtime-store';
export interface SlackResource {channelId:string;label:string;kind:SlackConversationClass}
const resourceSchema=z.object({channelId:z.string().regex(/^[A-Z][A-Z0-9]{1,79}$/),label:z.string().min(1).max(200),kind:z.enum(['public','private','dm','group_dm'])});
export class SlackStore {
 constructor(readonly database:ConnectorDatabase,private readonly keyring:ConnectorKeyring,private readonly core:ConnectorStore,private readonly auth:PostgresExpandedAuthorizationPersistence,private readonly now:()=>Date=()=>new Date()){}
 private at(ms=0){return new Date(this.now().getTime()+ms).toISOString();}
 private binding(ref:ConnectionRef,suffix:string,epoch=1){return {ownerId:ref.ownerId,connectionId:`${ref.id}:slack:${suffix}`,epoch,purpose:'content' as const};}
 private key(value:string){return privateIdentifier(value,{ownerId:'slack',connectionId:'slack-installation',epoch:1,purpose:'identifier'},this.keyring);}
 async current(ref:ConnectionRef){const c=await this.core.getConnection(ref.ownerId,ref.id);if(!c||c.epoch!==ref.epoch||c.provider!=='slack'||c.status==='disconnected')throw new ConnectorStoreError('connection_unavailable');return c;}
 async identity(ref:ConnectionRef){await this.current(ref);const identity=await this.auth.readIdentity(ref);if(!identity?.metadata.teamId||!identity.metadata.appId)throw new ConnectorStoreError('invalid_identity');return identity;}
 async bindInstallation(ref:ConnectionRef){const identity=await this.identity(ref);await this.database.query('INSERT INTO connector_slack_installations(connection_id,owner_id,team_key,app_key,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(connection_id) DO UPDATE SET team_key=excluded.team_key,app_key=excluded.app_key,expires_at=excluded.expires_at',[ref.id,ref.ownerId,this.key(identity.metadata.teamId),this.key(identity.metadata.appId),this.at(90*86400000)]);}
 async installations(teamId:string,appId:string):Promise<SavedConnection[]>{const rows=(await this.database.query("SELECT c.id,c.owner_id FROM connector_slack_installations s JOIN connector_connections c ON c.id=s.connection_id AND c.owner_id=s.owner_id WHERE s.team_key=$1 AND s.app_key=$2 AND c.provider='slack' AND c.status<>'disconnected' AND (s.expires_at>$3 OR (c.encrypted_grant IS NOT NULL AND c.encrypted_identity IS NOT NULL)) LIMIT 100",[this.key(teamId),this.key(appId),this.at()])).rows;const results=await Promise.all(rows.map(r=>this.core.getConnection(String(r.owner_id),String(r.id))));return results.filter((v):v is SavedConnection=>!!v);}
 async saveResource(ref:ConnectionRef,resource:SlackResource){await this.current(ref);const v=resourceSchema.parse(resource),key=this.key(v.channelId);const existing=(await this.database.query('SELECT id FROM connector_slack_resources WHERE connection_id=$1 AND resource_key=$2',[ref.id,key])).rows[0];const id=existing?String(existing.id):randomUUID();await this.database.query('INSERT INTO connector_slack_resources(id,connection_id,owner_id,resource_key,encrypted_value,expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(connection_id,resource_key) DO UPDATE SET encrypted_value=excluded.encrypted_value,expires_at=excluded.expires_at',[id,ref.id,ref.ownerId,key,sealConnectorSecret(JSON.stringify(v),this.binding(ref,`resource:${id}`),this.keyring),this.at(90*86400000)]);return {handle:id,label:v.label,kind:v.kind};}
 async resource(ref:ConnectionRef,handle:string):Promise<SlackResource>{await this.current(ref);z.string().uuid().parse(handle);const row=(await this.database.query("SELECT r.encrypted_value FROM connector_slack_resources r JOIN connector_connections c ON c.id=r.connection_id AND c.owner_id=r.owner_id WHERE r.id=$1 AND r.connection_id=$2 AND r.owner_id=$3 AND (r.expires_at>$4 OR (c.scope ? r.id AND c.encrypted_grant IS NOT NULL AND c.encrypted_identity IS NOT NULL))",[handle,ref.id,ref.ownerId,this.at()])).rows[0];if(!row)throw new ConnectorStoreError('selection_unavailable');return resourceSchema.parse(JSON.parse(openConnectorSecret(String(row.encrypted_value),this.binding(ref,`resource:${handle}`),this.keyring)));}
 async selectedHandle(ref:ConnectionRef,channelId:string){const c=await this.current(ref);const row=(await this.database.query("SELECT r.id FROM connector_slack_resources r JOIN connector_connections c ON c.id=r.connection_id AND c.owner_id=r.owner_id WHERE r.connection_id=$1 AND r.resource_key=$2 AND (r.expires_at>$3 OR (c.scope ? r.id AND c.encrypted_grant IS NOT NULL AND c.encrypted_identity IS NOT NULL))",[ref.id,this.key(channelId),this.at()])).rows[0];return row&&c.scope.includes(String(row.id))?String(row.id):null;}
 /** The row lock orders provider revocation against reconnect, refresh and job admission. */
 async lifecycle(ref:ConnectionRef,notice:{teamId:string;appId:string;eventId:string;eventTime:number;kind:'app_uninstalled'|'tokens_revoked'|'app_rate_limited';botUsers?:string[]}){
  return this.database.transaction(async sql=>{
   const row=(await sql.query("SELECT encrypted_identity FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider='slack' AND status<>'disconnected' FOR UPDATE",[ref.id,ref.ownerId,ref.epoch])).rows[0];
   if(!row)return false;
   if(!row.encrypted_identity)throw new ConnectorStoreError('invalid_identity');
   const identity=JSON.parse(openConnectorSecret(String(row.encrypted_identity),{ownerId:ref.ownerId,connectionId:`${ref.id}:identity`,epoch:ref.epoch,purpose:'grant'},this.keyring)) as ExpandedIdentity;
   if(identity.metadata.teamId!==notice.teamId||identity.metadata.appId!==notice.appId)throw new ConnectorStoreError('invalid_identity');
   // Slack event_time has one-second precision. An older generation cannot fence a reinstall.
   const authorizedAt=Date.parse(identity.metadata.authorizedAt);
   if(!Number.isFinite(authorizedAt))throw new ConnectorStoreError('reconnect_required');
   if(notice.eventTime+(notice.kind==='app_rate_limited'?60:0)<Math.floor(authorizedAt/1000))return false;
   if(notice.kind==='tokens_revoked'&&!notice.botUsers?.includes(identity.metadata.botUserId))return false;
   const id=this.key(JSON.stringify([ref.id,'lifecycle',notice.eventId]));
   const saved=await sql.query('INSERT INTO connector_slack_events(id,connection_id,owner_id,epoch,item_key,version,deleted,created_at,expires_at) VALUES($1,$2,$3,$4,$1,$5,0,$6,$7) ON CONFLICT DO NOTHING RETURNING id',[id,ref.id,ref.ownerId,ref.epoch,notice.kind,this.at(),this.at(90*86400000)]);
   if(!saved.rows.length)return false;
   const scoped:ConnectorDatabase={query:sql.query.bind(sql),transaction:fn=>fn(sql)};
   const core=new PostgresConnectorStore(scoped,{keyring:this.keyring,now:this.now});
   if(notice.kind==='app_rate_limited'){
    await core.recordCoverageGap(ref,'slack_event_delivery_rate_limited',1);
    await sql.query("UPDATE connector_schedule SET due_at=LEAST(due_at,$2::timestamptz),reason='slack_event_delivery_rate_limited' WHERE connection_id=$1 AND epoch=$3",[ref.id,this.at(),ref.epoch]);
   }else{
    await core.recordCoverageGap(ref,notice.kind==='app_uninstalled'?'slack_app_uninstalled_reconnect_required':'slack_bot_token_revoked_reconnect_required',1);
    await core.revokeConnection(ref.ownerId,ref.id,ref.epoch);
   }
   return true;
  });
 }
 /** Delivery metadata only. Raw webhook message bodies are never persisted. */
 private async releaseDelivered(db:ConnectorSql,ref:ConnectionRef,encryptedCursor:unknown){
  await db.query('UPDATE connector_slack_events SET encrypted_reference=NULL WHERE connection_id=$1 AND epoch<>$2 AND encrypted_reference IS NOT NULL',[ref.id,ref.epoch]);
  if(!encryptedCursor)return;
  const cursor=JSON.parse(openConnectorSecret(String(encryptedCursor),{ownerId:ref.ownerId,connectionId:ref.id,epoch:ref.epoch,purpose:'cursor'},this.keyring)) as string;
  let parsed:unknown;try{parsed=JSON.parse(cursor);}catch{return;}
  const checkpoint=z.object({v:z.literal(1),epoch:z.literal(ref.epoch),after:z.object({at:z.string().datetime(),id:z.string()}).nullable()}).safeParse(parsed);
  if(!checkpoint.success||!checkpoint.data.after)return;
  await db.query('UPDATE connector_slack_events SET encrypted_reference=NULL WHERE connection_id=$1 AND epoch=$2 AND encrypted_reference IS NOT NULL AND (created_at,id)<=($3::timestamptz,$4::text)',[ref.id,ref.epoch,checkpoint.data.after.at,checkpoint.data.after.id]);
 }
 async event(ref:ConnectionRef,eventId:string,reference:ProviderItemRef|null,version:string,itemId?:string,deleted=false){
  const result=await this.database.transaction(async db=>{
   const c=(await db.query("SELECT mode,status,activation_at,encrypted_cursor FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider='slack' AND status<>'disconnected' FOR UPDATE",[ref.id,ref.ownerId,ref.epoch])).rows[0];
   if(!c)throw new ConnectorStoreError('connection_unavailable');
   const id=this.key(JSON.stringify([ref.id,ref.epoch,eventId]));
   if((await db.query('SELECT id FROM connector_slack_events WHERE id=$1',[id])).rows.length)return false;
   await this.releaseDelivered(db,ref,c.encrypted_cursor);
   const retained=reference&&c.status==='active'&&c.mode!=='manual'&&c.activation_at&&Date.parse(reference.receivedAt)>=new Date(c.activation_at as string).getTime()?reference:null;
   const pauseId=this.key(JSON.stringify([ref.id,ref.epoch,'capacity_pause']));
   const scoped:ConnectorDatabase={query:db.query.bind(db),transaction:fn=>fn(db)};
   const core=new PostgresConnectorStore(scoped,{keyring:this.keyring,now:this.now});
   if(retained){
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`connector-capacity:${ref.ownerId}`]);
    const counts=(await db.query("SELECT (SELECT count(*) FROM connector_slack_events e JOIN connector_connections c ON c.id=e.connection_id AND c.epoch=e.epoch WHERE e.owner_id=$1 AND e.expires_at>$2 AND e.encrypted_reference IS NOT NULL AND c.status<>'disconnected' AND c.mode<>'manual')+(SELECT count(*) FROM connector_pending_items WHERE owner_id=$1 AND expires_at>$2)+(SELECT count(*) FROM connector_revisions r JOIN connector_items i ON i.id=r.item_id WHERE r.owner_id=$1 AND r.content_expires_at>$2 AND i.state NOT IN ('not_selected','source_unavailable','deleted','expired') AND (EXISTS(SELECT 1 FROM connector_jobs j WHERE j.revision_id=r.id AND j.state IN ('queued','leased')) OR (NOT EXISTS(SELECT 1 FROM connector_jobs j WHERE j.revision_id=r.id) AND (r.manifest->'counts'->>'pending')::int>0))) AS n",[ref.ownerId,this.at()])).rows[0];
    if(Number(counts.n)>=1000){
     const warning=await db.query("INSERT INTO connector_slack_events(id,connection_id,owner_id,epoch,item_key,version,deleted,created_at,expires_at) VALUES($1,$2,$3,$4,$1,'capacity_pause',0,$5,$6) ON CONFLICT DO NOTHING RETURNING id",[pauseId,ref.id,ref.ownerId,ref.epoch,this.at(),this.at(90*86400000)]);
     if(warning.rows.length)await core.recordCoverageGap(ref,'slack_event_backlog_capacity',1);
     return 'overflow' as const;
    }
    const resumed=await db.query('DELETE FROM connector_slack_events WHERE id=$1 RETURNING id',[pauseId]);
    if(resumed.rows.length)await core.recordCoverageGap(ref,'slack_event_backlog_recovered',1);
   }
   return (await db.query("INSERT INTO connector_slack_events(id,connection_id,owner_id,epoch,item_key,version,encrypted_reference,created_at,expires_at,deleted) VALUES($1,$2,$3,$4,$5,$6,$7,GREATEST($8::timestamptz,COALESCE((SELECT max(created_at)+INTERVAL '1 millisecond' FROM connector_slack_events WHERE connection_id=$2),$8::timestamptz)),$9,$10) ON CONFLICT DO NOTHING RETURNING id",[id,ref.id,ref.ownerId,ref.epoch,this.key(itemId??reference?.id??eventId),version,retained?sealConnectorSecret(JSON.stringify(retained),this.binding(ref,`event:${id}`,ref.epoch),this.keyring):null,this.at(),this.at(90*86400000),deleted?1:0])).rows.length>0;
  });
  // Throw only after the warning transaction commits so finite provider retries leave evidence.
  if(result==='overflow')throw new ConnectorStoreError('queue_capacity');
  return result;
 }
 async events(ref:ConnectionRef,after:{at:string;id:string}|null){await this.current(ref);const rows=(await this.database.query('SELECT * FROM connector_slack_events WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND encrypted_reference IS NOT NULL AND expires_at>$4 AND ($5::timestamptz IS NULL OR (created_at,id)>($5::timestamptz,$6::text)) ORDER BY created_at,id LIMIT 50',[ref.id,ref.ownerId,ref.epoch,this.at(),after?.at??null,after?.id??''])).rows;return {items:rows.map(r=>JSON.parse(openConnectorSecret(String(r.encrypted_reference),this.binding(ref,`event:${r.id}`,ref.epoch),this.keyring)) as ProviderItemRef),after:rows.length?{at:new Date(rows.at(-1)!.created_at as string).toISOString(),id:String(rows.at(-1)!.id)}:after};}
 async reserveHistory(identity:ExpandedIdentity,method:'history'|'replies'){const id=this.key(JSON.stringify([identity.metadata.appId,identity.metadata.teamId,method]));return this.database.transaction(async db=>{await db.query('INSERT INTO connector_slack_limits(id,due_at,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,this.at(),this.at(90*86400000)]);const row=(await db.query('SELECT due_at FROM connector_slack_limits WHERE id=$1 FOR UPDATE',[id])).rows[0];if(new Date(row.due_at as string).getTime()>this.now().getTime())throw new SlackApiError('runtime_quota_paused',new Date(row.due_at as string).getTime()-this.now().getTime());await db.query('UPDATE connector_slack_limits SET due_at=$1 WHERE id=$2',[this.at(60000),id]);});}
 async deferHistory(identity:ExpandedIdentity,method:'history'|'replies',delayMs:number){const id=this.key(JSON.stringify([identity.metadata.appId,identity.metadata.teamId,method]));await this.database.query('UPDATE connector_slack_limits SET due_at=GREATEST(due_at,$1::timestamptz) WHERE id=$2',[this.at(Math.max(60000,Math.min(86400000,delayMs))),id]);}
 async suppress(ref:ConnectionRef,providerId:string,receivedAt:string){await this.database.transaction(async sql=>{const c=(await sql.query("SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 AND provider='slack' AND epoch=$3 AND status<>'disconnected' FOR UPDATE",[ref.id,ref.ownerId,ref.epoch])).rows[0];if(!c)throw new ConnectorStoreError('connection_unavailable');const key=privateIdentifier(providerId,{ownerId:ref.ownerId,connectionId:`${ref.id}:item`,epoch:ref.epoch,purpose:'identifier'},this.keyring);await sql.query("INSERT INTO connector_items(id,owner_id,connection_id,epoch,provider_key,state,received_at,expires_at) VALUES($1,$2,$3,$4,$5,'deleted',$6,$7) ON CONFLICT(connection_id,epoch,provider_key) DO NOTHING",[randomUUID(),ref.ownerId,ref.id,ref.epoch,key,receivedAt,this.at(90*86400000)]);const scoped:ConnectorDatabase={query:sql.query.bind(sql),transaction:fn=>fn(sql)};await new ConnectorRuntimeStore(scoped,this.keyring,this.now).deleteProviderItem(ref,providerId);});}
 async deleted(ref:ConnectionRef,id:string){await this.current(ref);return !!(await this.database.query('SELECT id FROM connector_slack_events WHERE connection_id=$1 AND epoch=$2 AND item_key=$3 AND deleted=1 AND expires_at>$4 LIMIT 1',[ref.id,ref.epoch,this.key(id),this.at()])).rows.length;}
 async purge(){
  // Current authority follows the saved connection lifetime. Historical delivery/resource metadata does not.
  await this.database.query("UPDATE connector_slack_installations s SET expires_at=$1 FROM connector_connections c WHERE c.id=s.connection_id AND c.owner_id=s.owner_id AND c.provider='slack' AND c.status<>'disconnected' AND c.encrypted_grant IS NOT NULL AND c.encrypted_identity IS NOT NULL",[this.at(90*86400000)]);
  await this.database.query("UPDATE connector_slack_resources r SET expires_at=$1 FROM connector_connections c WHERE c.id=r.connection_id AND c.owner_id=r.owner_id AND c.provider='slack' AND c.status<>'disconnected' AND c.encrypted_grant IS NOT NULL AND c.encrypted_identity IS NOT NULL AND c.scope ? r.id",[this.at(90*86400000)]);
  await this.database.query('DELETE FROM connector_slack_events WHERE expires_at<=$1',[this.at()]);await this.database.query('DELETE FROM connector_slack_resources WHERE expires_at<=$1',[this.at()]);await this.database.query('DELETE FROM connector_slack_installations WHERE expires_at<=$1',[this.at()]);await this.database.query('DELETE FROM connector_slack_limits WHERE expires_at<=$1',[this.at()]);
 }
}
