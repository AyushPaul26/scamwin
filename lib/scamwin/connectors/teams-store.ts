import {randomUUID,timingSafeEqual} from 'node:crypto';
import type {ConnectionRef,ConnectionSettings,SavedConnection,ProviderItemRef} from './contracts';
import type {ActivationBaseline} from './oauth-contracts';
import {PostgresConnectorStore,ConnectorStoreError,type ConnectorDatabase,type ConnectorSql} from './store';
import {privateIdentifier,sealConnectorSecret,openConnectorSecret,type ConnectorKeyring} from './crypto';

const DAY=86400000;
const fail=(code='teams_notification_invalid'):never=>{throw new ConnectorStoreError(code);};
export const teamsRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function teamsId(value:unknown):string{if(typeof value!=='string'||!value.length||value.length>512||/[\x00-\x20\x7f/\\?#%]/.test(value)||value==='.'||value==='..')return fail('teams_resource_invalid');return value;}
export function teamsResource(chatId:string){return `/chats/${encodeURIComponent(teamsId(chatId))}/messages`;}
export type TeamsResource={handle:string;chatId:string;label:string;tenantId:string;recoveryAfter?:string};
type Subscription={id:string;clientState:string;resource:TeamsResource};
export type TeamsMaintenance={ref:ConnectionRef;key:string;token:string;kind:'create'|'renew'|'recreate'|'recover';value:Subscription;attempts:number};
type EventValue={resourceHandle:string;messageId:string;changeType:'created'|'updated'|'deleted'};
export class TeamsStore{
 constructor(readonly database:ConnectorDatabase,private readonly keyring:ConnectorKeyring,readonly now:()=>Date=()=>new Date()){}
 private at(ms=0){return new Date(this.now().getTime()+ms).toISOString();}
 private bind(ref:ConnectionRef,suffix:string){return {ownerId:ref.ownerId,connectionId:`${ref.id}:teams:${suffix}`,epoch:ref.epoch,purpose:'subscription' as const};}
 private seal(value:unknown,ref:ConnectionRef,suffix:string){return sealConnectorSecret(JSON.stringify(value),this.bind(ref,suffix),this.keyring);}
 private open<T>(value:unknown,ref:ConnectionRef,suffix:string):T{return JSON.parse(openConnectorSecret(String(value),this.bind(ref,suffix),this.keyring));}
 private key(value:string){return privateIdentifier(value,this.bind({id:'service',ownerId:'teams',epoch:1,provider:'teams'},'identifier'),this.keyring);}
 private ref(row:Record<string,unknown>):ConnectionRef{return {id:String(row.connection_id),ownerId:String(row.owner_id),epoch:Number(row.epoch),provider:'teams'};}
 private async discardedGap(db:ConnectorSql,ref:ConnectionRef){const scoped:ConnectorDatabase={query:db.query.bind(db),transaction:fn=>fn(db)};await new PostgresConnectorStore(scoped,{keyring:this.keyring,now:this.now}).recordCoverageGap(ref,'teams_inactive_delivery_discarded',1);}
 private async current(db:ConnectorSql,ref:ConnectionRef,lock=false){
  if(ref.provider!=='teams')return fail('connection_unavailable');
  const row=(await db.query(`SELECT * FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider='teams' AND status<>'disconnected'${lock?' FOR UPDATE':''}`,[ref.id,ref.ownerId,ref.epoch])).rows[0];
  if(!row)return fail('connection_unavailable');return row;
 }
 /** 1 is provider-pending; 2 retains acknowledged references needed by Core body reads.
  * Core advances its encrypted cursor/page checkpoint only after its pending refs commit. */
 private async queueEvent(db:ConnectorSql,ref:ConnectionRef,itemKey:string,event:EventValue,receivedAt:string,automatic:boolean){
  const scoped:ConnectorDatabase={query:db.query.bind(db),transaction:fn=>fn(db)},core=new PostgresConnectorStore(scoped,{keyring:this.keyring,now:this.now});
  if(automatic){
   const cursor=await core.readSyncCursor(ref),checkpoint=cursor?.pageState??cursor?.cursor??'0';
   if(/^\d{1,16}$/.test(checkpoint)&&Number.isSafeInteger(Number(checkpoint)))await db.query('UPDATE connector_teams_events SET automatic=2 WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND automatic=1 AND sequence<=$4',[ref.id,ref.ownerId,ref.epoch,Number(checkpoint)]);
  }
  const latest=(await db.query('SELECT * FROM connector_teams_events WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND item_key=$4 AND expires_at>$5 ORDER BY sequence DESC LIMIT 1',[ref.id,ref.ownerId,ref.epoch,itemKey,this.at()])).rows[0];
  if(latest){
   const previous=this.open<EventValue>(latest.encrypted_value,ref,`event:${itemKey}`);
   if(previous.changeType==='deleted'||!automatic)return 'known' as const;
   // Basic notifications identify current state, not a revision archive. One
   // still-pending pointer can fetch the latest state without duplicate queue slots.
   if(Number(latest.automatic)===1){await db.query('UPDATE connector_teams_events SET encrypted_value=$1,expires_at=$2 WHERE sequence=$3',[this.seal(event,ref,`event:${itemKey}`),this.at(30*DAY),latest.sequence]);return 'known' as const;}
  }
  if(automatic){
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`connector-capacity:${ref.ownerId}`]);
   const count=Number((await db.query("SELECT (SELECT count(*) FROM connector_teams_events e JOIN connector_connections c ON c.id=e.connection_id AND c.epoch=e.epoch WHERE e.owner_id=$1 AND e.automatic=1 AND e.expires_at>$2 AND c.status<>'disconnected' AND c.mode<>'manual')+(SELECT count(*) FROM connector_pending_items WHERE owner_id=$1 AND expires_at>$2)+(SELECT count(*) FROM connector_revisions r JOIN connector_items i ON i.id=r.item_id WHERE r.owner_id=$1 AND r.content_expires_at>$2 AND i.state NOT IN ('not_selected','source_unavailable','deleted','expired') AND (EXISTS(SELECT 1 FROM connector_jobs j WHERE j.revision_id=r.id AND j.state IN ('queued','leased')) OR (NOT EXISTS(SELECT 1 FROM connector_jobs j WHERE j.revision_id=r.id) AND (r.manifest->'counts'->>'pending')::int>0))) AS n",[ref.ownerId,this.at()])).rows[0].n);
   if(count>=1000){await core.recordCoverageGap(ref,'teams_event_backlog_capacity',1);return 'overflow' as const;}
  }
  await db.query('INSERT INTO connector_teams_events(connection_id,owner_id,epoch,item_key,automatic,encrypted_value,received_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ref.id,ref.ownerId,ref.epoch,itemKey,automatic?1:0,this.seal(event,ref,`event:${itemKey}`),receivedAt,this.at(30*DAY)]);
  return 'queued' as const;
 }
 async saveResource(ref:ConnectionRef,value:Omit<TeamsResource,'handle'>){
  teamsId(value.chatId);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.tenantId)||typeof value.label!=='string'||value.label.length>300)return fail('teams_resource_invalid');
  return this.database.transaction(async db=>{
   await this.current(db,ref,true);const key=this.key(`${ref.id}:${value.chatId}`);
   const old=(await db.query('SELECT handle,epoch,encrypted_value FROM connector_teams_resources WHERE connection_id=$1 AND resource_key=$2',[ref.id,key])).rows[0];
   const previous=old&&Number(old.epoch)===ref.epoch?this.open<TeamsResource>(old.encrypted_value,ref,`resource:${old.handle}`):null;
   if(!old&&Number((await db.query('SELECT count(*) AS n FROM connector_teams_resources WHERE connection_id=$1',[ref.id])).rows[0].n)>=200)return fail('teams_resource_limit');
   const resource={...value,...(previous?.recoveryAfter?{recoveryAfter:previous.recoveryAfter}:{}),handle:old?String(old.handle):randomUUID()};
   await db.query('INSERT INTO connector_teams_resources(handle,connection_id,owner_id,epoch,resource_key,encrypted_value,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(handle) DO UPDATE SET epoch=excluded.epoch,encrypted_value=excluded.encrypted_value,expires_at=excluded.expires_at',[resource.handle,ref.id,ref.ownerId,ref.epoch,key,this.seal(resource,ref,`resource:${resource.handle}`),this.at(90*DAY)]);return resource;
  });
 }
 async resources(ref:ConnectionRef,selectedOnly=true):Promise<TeamsResource[]>{
  const c=await this.current(this.database,ref);const scope=Array.isArray(c.scope)?c.scope:JSON.parse(String(c.scope));
  const rows=(await this.database.query('SELECT * FROM connector_teams_resources WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND expires_at>$4 ORDER BY handle LIMIT 200',[ref.id,ref.ownerId,ref.epoch,this.at()])).rows;
  return rows.filter(row=>!selectedOnly||scope.includes(row.handle)).map(row=>this.open<TeamsResource>(row.encrypted_value,ref,`resource:${row.handle}`));
 }
 /** Core epoch and encrypted selected-resource binding change atomically, using the same isolated SQL transaction. */
 async configure(c:SavedConnection,settings:ConnectionSettings,baseline:ActivationBaseline|undefined){
  return this.database.transaction(async db=>{
   await this.current(db,c,true);
   const rows=(await db.query('SELECT * FROM connector_teams_resources WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND expires_at>$4',[c.id,c.ownerId,c.epoch,this.at()])).rows;
   if(settings.scope.some(handle=>!rows.some(row=>row.handle===handle))&&!(settings.mode==='manual'&&settings.scope.length===1&&settings.scope[0]==='unselected'))return fail('teams_selection_required');
   const adapter:ConnectorDatabase={query:db.query.bind(db),transaction:async fn=>fn(db)};
   const next=await new PostgresConnectorStore(adapter,{keyring:this.keyring,now:this.now}).configureConnection(c,settings,baseline);
   // Core keeps the epoch/cursor for unchanged settings, pause/resume and daily limits.
   // Preserve the same recovery boundary instead of skipping still-retrievable missed messages.
   const changedBoundary=baseline&&next.epoch!==c.epoch;
   for(const row of rows){const value=this.open<TeamsResource>(row.encrypted_value,c,`resource:${row.handle}`),updated={...value,...(changedBoundary?{recoveryAfter:baseline.capturedAt}:{})};await db.query('UPDATE connector_teams_resources SET epoch=$1,encrypted_value=$2 WHERE handle=$3',[next.epoch,this.seal(updated,next,`resource:${row.handle}`),row.handle]);}
   // Old subscriptions can only deliver under their old epoch; they are retained briefly for explicit server cleanup.
   await db.query("UPDATE connector_teams_subscriptions SET state='stale',lease_token=NULL,lease_until=NULL WHERE connection_id=$1 AND epoch<>$2",[next.id,next.epoch]);
   await db.query('DELETE FROM connector_teams_events WHERE connection_id=$1 AND epoch<>$2',[next.id,next.epoch]);return next;
  });
 }
 async saveSubscription(ref:ConnectionRef,resource:TeamsResource,input:{id:string;clientState:string;expiresAt:string},creation?:TeamsMaintenance){
  teamsId(input.id);if(!/^[A-Za-z0-9_-]{32,128}$/.test(input.clientState)||Date.parse(input.expiresAt)<=this.now().getTime()||Date.parse(input.expiresAt)>this.now().getTime()+4320*60000)return fail('teams_subscription_invalid');
  await this.database.transaction(async db=>{
   const c=await this.current(db,ref,true),scope=Array.isArray(c.scope)?c.scope:JSON.parse(String(c.scope));if(!scope.includes(resource.handle))return fail('teams_selection_required');
   const selected=(await db.query('SELECT encrypted_value FROM connector_teams_resources WHERE handle=$1 AND connection_id=$2 AND epoch=$3',[resource.handle,ref.id,ref.epoch])).rows[0];
   if(!selected||JSON.stringify(this.open<TeamsResource>(selected.encrypted_value,ref,`resource:${resource.handle}`))!==JSON.stringify(resource))return fail('teams_selection_required');
   const key=this.key(`subscription:${input.id}`);
   await db.query('INSERT INTO connector_teams_subscriptions(key,connection_id,owner_id,epoch,resource_handle,encrypted_value,expiration_at,last_operation_at,lease_token,lease_until,state,attempts,due_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,NULL,NULL,$8,0,$9,$10)',[key,ref.id,ref.ownerId,ref.epoch,resource.handle,this.seal({id:input.id,clientState:input.clientState,resource},ref,`subscription:${key}`),input.expiresAt,'active',this.at(),this.at(90*DAY)]);
   if(creation){const removed=await db.query('DELETE FROM connector_teams_subscriptions WHERE key=$1 AND lease_token=$2 AND connection_id=$3 AND epoch=$4 RETURNING key',[creation.key,creation.token,ref.id,ref.epoch]);if(!removed.rows.length)return fail('teams_subscription_lease_lost');}
  });
 }
 async subscribed(ref:ConnectionRef){await this.current(this.database,ref);return (await this.database.query("SELECT resource_handle FROM connector_teams_subscriptions WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND state<>'stale' AND expires_at>$4",[ref.id,ref.ownerId,ref.epoch,this.at()])).rows.map(row=>String(row.resource_handle));}
 async liveSubscriptionCount(ref:ConnectionRef){await this.current(this.database,ref);return Number((await this.database.query("SELECT count(*) AS n FROM connector_teams_subscriptions WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND state IN ('active','renew','recover') AND expiration_at>$4 AND expires_at>$4",[ref.id,ref.ownerId,ref.epoch,this.at()])).rows[0].n);}
 /** Reserve creation before remote I/O, so failed provisioning cannot loop forever or create concurrent duplicate subscriptions. */
 async queueSubscription(ref:ConnectionRef,resource:TeamsResource){
  await this.database.transaction(async db=>{
   await this.current(db,ref,true);const existing=(await db.query("SELECT key FROM connector_teams_subscriptions WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND resource_handle=$4 AND state<>'stale'",[ref.id,ref.ownerId,ref.epoch,resource.handle])).rows[0];if(existing)return;
   const key=this.key(`pending:${ref.id}:${ref.epoch}:${resource.handle}`);
   await db.query('INSERT INTO connector_teams_subscriptions(key,connection_id,owner_id,epoch,resource_handle,encrypted_value,expiration_at,last_operation_at,lease_token,lease_until,state,attempts,due_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,NULL,NULL,$8,0,$7,$9)',[key,ref.id,ref.ownerId,ref.epoch,resource.handle,this.seal({id:'',clientState:'',resource},ref,`subscription:${key}`),this.at(),'create',this.at(90*DAY)]);
  });
 }
 /** Basic Graph notifications are authenticated by persisted subscription/clientState/tenant/exact saved resource, never a URL challenge. */
 async receive(body:unknown,automaticEnabled:boolean,deleteItem?:(ref:ConnectionRef,itemKey:string,database:ConnectorDatabase)=>Promise<void>){
  if(!teamsRecord(body)||!Array.isArray(body.value)||!body.value.length||body.value.length>100)return fail();const notifications=body.value;
  const overflow=await this.database.transaction(async db=>{
   for(const raw of notifications){
    if(!teamsRecord(raw)||typeof raw.subscriptionId!=='string'||raw.subscriptionId.length>512||typeof raw.clientState!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(raw.clientState)||raw.encryptedContent!==undefined||raw.validationTokens!==undefined)return fail();
    const key=this.key(`subscription:${raw.subscriptionId}`),row=(await db.query('SELECT * FROM connector_teams_subscriptions WHERE key=$1 AND expires_at>$2 FOR UPDATE',[key,this.at()])).rows[0];if(!row)return fail();
    const ref=this.ref(row),value=this.open<Subscription>(row.encrypted_value,ref,`subscription:${key}`),c=await this.current(db,ref,true);
    const scope=Array.isArray(c.scope)?c.scope:JSON.parse(String(c.scope));
    if(value.id!==raw.subscriptionId||raw.clientState.length!==value.clientState.length||!timingSafeEqual(Buffer.from(raw.clientState),Buffer.from(value.clientState))||raw.tenantId!==value.resource.tenantId||!scope.includes(value.resource.handle)||Date.parse(String(row.expiration_at))<=this.now().getTime())return fail();
    const exact=`chats/${value.resource.chatId}/messages`,resource=typeof raw.resource==='string'?raw.resource.replace(/^\//,''):'';
    if(raw.lifecycleEvent!==undefined){
     // Microsoft's documented lifecycle payload has no resource. Validate the saved exact resource binding;
     // when a sender supplies resource, it must agree. A challenge token never establishes this binding.
     if(!['reauthorizationRequired','subscriptionRemoved','missed'].includes(String(raw.lifecycleEvent))||raw.resource!==undefined&&resource!==exact)return fail();
     if(!automaticEnabled||c.mode==='manual'||c.status!=='active'){if(row.state!=='stale')await this.discardedGap(db,ref);await db.query("UPDATE connector_teams_subscriptions SET state='stale' WHERE key=$1",[key]);continue;}
     if(row.state==='stale')continue;
     await db.query('UPDATE connector_teams_subscriptions SET state=$1,due_at=$2 WHERE key=$3',[raw.lifecycleEvent==='subscriptionRemoved'?'recreate':raw.lifecycleEvent==='missed'?'recover':'renew',this.at(),key]);continue;
    }
    if(!['created','updated','deleted'].includes(String(raw.changeType))||!teamsRecord(raw.resourceData)||raw.resourceData['@odata.type']!=='#Microsoft.Graph.chatMessage')return fail();
    const messageId=teamsId(raw.resourceData.id);
    // Accept only exact Graph path forms for the saved chat. Notification URLs are never fetched.
    const encoded=`chats/${encodeURIComponent(value.resource.chatId)}/messages/${encodeURIComponent(messageId)}`;
    const odata=`chats('${value.resource.chatId.replaceAll("'","''")}')/messages('${messageId.replaceAll("'","''")}')`;
    if(resource!==`${exact}/${messageId}`&&resource!==encoded&&resource!==odata)return fail();
    const itemKey=this.key(`${ref.id}:${value.resource.handle}:${messageId}`);
    if(raw.changeType==='deleted'&&deleteItem){const scoped:ConnectorDatabase={query:db.query.bind(db),transaction:fn=>fn(db)};await deleteItem(ref,itemKey,scoped);}
    if(!automaticEnabled||c.mode==='manual'||c.status!=='active'||!c.activation_at||row.state==='stale'){
     // Drop all message references on Manual/paused/gates-off; no hidden catch-up checkpoint survives.
     await db.query('DELETE FROM connector_teams_events WHERE connection_id=$1 AND epoch=$2',[ref.id,ref.epoch]);
     if(row.state!=='stale')await this.discardedGap(db,ref);
     await db.query("UPDATE connector_teams_subscriptions SET state='stale' WHERE key=$1",[key]);continue;
    }
    const event:EventValue={resourceHandle:value.resource.handle,messageId,changeType:raw.changeType as EventValue['changeType']};
    if(await this.queueEvent(db,ref,itemKey,event,this.at(),true)==='overflow')return true;
   }
   return false;
  });
  // Commit the capacity warning (and any earlier authenticated entries) before
  // rejecting acknowledgement; retry safely reuses still-pending references.
  if(overflow)return fail('queue_capacity');
 }
 async events(ref:ConnectionRef,cursor:string,limit:number){
  await this.current(this.database,ref);if(!/^\d{1,16}$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))return fail('invalid_cursor');
  const rows=(await this.database.query('SELECT * FROM connector_teams_events WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND automatic=1 AND sequence>$4 AND expires_at>$5 ORDER BY sequence LIMIT $6',[ref.id,ref.ownerId,ref.epoch,Number(cursor),this.at(),Math.min(50,limit)])).rows;
  return {items:rows.map(row=>({id:String(row.item_key),version:String(row.sequence),receivedAt:new Date(String(row.received_at)).toISOString()})),cursor:rows.length?String(rows[rows.length-1].sequence):cursor};
 }
 async reference(ref:ConnectionRef,item:ProviderItemRef){
  await this.current(this.database,ref);const row=(await this.database.query('SELECT * FROM connector_teams_events WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND item_key=$4 AND expires_at>$5 ORDER BY sequence DESC LIMIT 1',[ref.id,ref.ownerId,ref.epoch,item.id,this.at()])).rows[0];if(!row)return fail('source_unavailable');
  const value=this.open<EventValue>(row.encrypted_value,ref,`event:${row.item_key}`),resource=(await this.resources(ref)).find(r=>r.handle===value.resourceHandle);if(!resource)return fail('source_unavailable');return {...value,resource,sequence:String(row.sequence)};
 }
 async saveManualReference(ref:ConnectionRef,resource:TeamsResource,messageId:string,receivedAt:string,automatic=false){
  const itemKey=this.key(`${ref.id}:${resource.handle}:${teamsId(messageId)}`);
  const result=await this.database.transaction(async db=>{await this.current(db,ref,true);return this.queueEvent(db,ref,itemKey,{resourceHandle:resource.handle,messageId,changeType:'created'},receivedAt,automatic);});
  if(result==='overflow')return fail('queue_capacity');return {id:itemKey,receivedAt};
 }
 async claimMaintenance(ref:ConnectionRef):Promise<TeamsMaintenance|null>{
  return this.database.transaction(async db=>{
   await this.current(db,ref,true);
   const row=(await db.query("SELECT * FROM connector_teams_subscriptions WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND state<>'stale' AND attempts<3 AND due_at<=$4 AND (lease_until IS NULL OR lease_until<=$4) AND (last_operation_at IS NULL OR last_operation_at<=$5) AND (state<>'active' OR expiration_at<=$6) ORDER BY expiration_at LIMIT 1 FOR UPDATE",[ref.id,ref.ownerId,ref.epoch,this.at(),this.at(-600000),this.at(3600000)])).rows[0];if(!row)return null;
   const token=randomUUID();await db.query('UPDATE connector_teams_subscriptions SET lease_token=$1,lease_until=$2,last_operation_at=$3 WHERE key=$4',[token,this.at(60000),this.at(),row.key]);
   return {ref,key:String(row.key),token,kind:row.state==='create'?'create':row.state==='recreate'?'recreate':row.state==='recover'?'recover':'renew',value:this.open<Subscription>(row.encrypted_value,ref,`subscription:${row.key}`),attempts:Number(row.attempts)};
  });
 }
 async finishMaintenance(lease:TeamsMaintenance,result:{expiresAt?:string;failed?:boolean;removed?:boolean;recreate?:boolean;retryAfterMs?:number}){
  if(result.expiresAt&&(!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=this.now().getTime()||Date.parse(result.expiresAt)>this.now().getTime()+4320*60000))return fail('teams_subscription_invalid');
  await this.database.transaction(async db=>{
   await this.current(db,lease.ref,true);
   if(result.removed){await db.query('DELETE FROM connector_teams_subscriptions WHERE key=$1 AND lease_token=$2',[lease.key,lease.token]);return;}
   await db.query('UPDATE connector_teams_subscriptions SET state=$1,expiration_at=COALESCE($2,expiration_at),attempts=CASE WHEN $3 THEN attempts+1 ELSE 0 END,due_at=$4,lease_token=NULL,lease_until=NULL WHERE key=$5 AND lease_token=$6',[result.recreate?'recreate':result.failed?lease.kind:'active',result.expiresAt??null,!!result.failed,this.at(result.failed?Math.max(600000,Math.min(86400000,result.retryAfterMs??[600000,1800000,86400000][Math.min(lease.attempts,2)])):600000),lease.key,lease.token]);
  });
 }
 async staleSubscriptions(ref:ConnectionRef){
  const rows=(await this.database.query("SELECT * FROM connector_teams_subscriptions WHERE connection_id=$1 AND owner_id=$2 AND state='stale' AND attempts<3 AND due_at<=$3 LIMIT 20",[ref.id,ref.ownerId,this.at()])).rows;
  return rows.map(row=>({key:String(row.key),value:this.open<Subscription>(row.encrypted_value,this.ref(row),`subscription:${row.key}`)}));
 }
 async disconnectSubscriptions(ref:ConnectionRef){await this.current(this.database,ref);const rows=(await this.database.query('SELECT * FROM connector_teams_subscriptions WHERE connection_id=$1 AND owner_id=$2 LIMIT 100',[ref.id,ref.ownerId])).rows;return rows.map(row=>({key:String(row.key),value:this.open<Subscription>(row.encrypted_value,this.ref(row),`subscription:${row.key}`)}));}
 async markDisconnected(ref:ConnectionRef){const fenced=(await this.database.query("SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 AND provider='teams' AND status='disconnected' AND epoch>$3",[ref.id,ref.ownerId,ref.epoch])).rows[0];if(!fenced)return fail('teams_local_fence_required');await this.database.query("UPDATE connector_teams_subscriptions SET state='stale',due_at=$3 WHERE connection_id=$1 AND owner_id=$2",[ref.id,ref.ownerId,this.at()]);}
 async failCleanup(key:string){await this.database.query('UPDATE connector_teams_subscriptions SET attempts=attempts+1,due_at=$2 WHERE key=$1',[key,this.at(600000)]);}
 async forgetSubscription(key:string){await this.database.query('DELETE FROM connector_teams_subscriptions WHERE key=$1',[key]);}
 async purge(){await this.database.query('DELETE FROM connector_teams_events WHERE expires_at<=$1',[this.at()]);await this.database.query('DELETE FROM connector_teams_resources WHERE expires_at<=$1',[this.at()]);await this.database.query('DELETE FROM connector_teams_subscriptions WHERE expires_at<=$1',[this.at()]);}
}
