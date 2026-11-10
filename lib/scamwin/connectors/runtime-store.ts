import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionRef, ProviderId, ProviderItemRef } from './contracts';
import { refSchema } from './contracts';
import { ConnectorStoreError, type ConnectorDatabase, type ConnectorSql } from './store';
import { openConnectorSecret, sealConnectorSecret, privateIdentifier, type ConnectorKeyring } from './crypto';

const DAY=86400000;
export interface RuntimeLease {ref:ConnectionRef;token:string;fence:number;failures:number}
export interface Usage {calls:number;bytes:number;computeMs:number}
export const DAILY_RUNTIME_LIMITS:Usage={calls:1000,bytes:512*1024*1024,computeMs:3600000};
export const MONTHLY_RUNTIME_LIMITS:Usage={calls:15000,bytes:4*1024*1024*1024,computeMs:40000000};
const binding=(ref:ConnectionRef,suffix:string)=>({ownerId:ref.ownerId,connectionId:`${ref.id}:${suffix}`,epoch:ref.epoch,purpose:'page' as const});
/** Supplemental durable scheduler state; all writes use the isolated verified database. */
export class ConnectorRuntimeStore {
  constructor(readonly database:ConnectorDatabase,private readonly keyring:ConnectorKeyring,readonly now:()=>Date=()=>new Date()){}
  private at(ms=0){return new Date(this.now().getTime()+ms).toISOString();}
  private async active(db:ConnectorSql,ref:ConnectionRef,allowPaused=false){
    refSchema.parse(ref);
    if(!(await db.query("SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider=$4 AND (status='active' OR ($5 AND status='paused')) FOR UPDATE",[ref.id,ref.ownerId,ref.epoch,ref.provider,allowPaused])).rows.length)throw new ConnectorStoreError('connection_unavailable');
  }
  async consumeDelivery(id:string){
    z.string().uuid().parse(id);
    return !!(await this.database.query('INSERT INTO connector_dispatches(id,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',[id,this.at(DAY)])).rows.length;
  }
  async claimDue(providers:ProviderId[]):Promise<RuntimeLease|null>{
    if(!providers.length)return null;
    return this.database.transaction(async db=>{
      await db.query("INSERT INTO connector_schedule(connection_id,epoch,due_at,reason,failures,fence) SELECT id,epoch,$1,'ready',0,0 FROM connector_connections WHERE status='active' AND mode<>'manual' AND activation_at IS NOT NULL ON CONFLICT(connection_id) DO UPDATE SET epoch=excluded.epoch,due_at=excluded.due_at,reason='ready',failures=0,token=NULL,lease_until=NULL,last_sync_at=NULL,last_attempt_at=NULL WHERE connector_schedule.epoch<>excluded.epoch",[this.at()]);
      const row=(await db.query("SELECT c.id,c.owner_id,c.provider,c.epoch,s.failures,s.fence FROM connector_schedule s JOIN connector_connections c ON c.id=s.connection_id AND c.epoch=s.epoch WHERE c.status='active' AND c.mode<>'manual' AND c.activation_at IS NOT NULL AND c.provider=ANY($2::text[]) AND s.due_at<=$1 AND s.failures<3 AND (s.lease_until IS NULL OR s.lease_until<=$1) ORDER BY s.last_attempt_at NULLS FIRST,s.due_at,c.id FOR UPDATE OF s SKIP LOCKED LIMIT 1",[this.at(),providers])).rows[0];
      if(!row)return null;
      const token=randomUUID(),fence=Number(row.fence)+1;
      await db.query('UPDATE connector_schedule SET token=$1,lease_until=$2,fence=$3,last_attempt_at=$4 WHERE connection_id=$5',[token,this.at(55000),fence,this.at(),row.id]);
      return {ref:refSchema.parse({id:row.id,ownerId:row.owner_id,provider:row.provider,epoch:row.epoch}),token,fence,failures:Number(row.failures)};
    });
  }
  async finishSync(lease:RuntimeLease,result:{reason:string;delayMs:number;failed?:boolean;successful?:boolean}){
    const reason=z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).parse(result.reason);
    return !!(await this.database.query('UPDATE connector_schedule SET token=NULL,lease_until=NULL,due_at=$1,reason=$2,failures=$3,last_sync_at=CASE WHEN $9 THEN $8 ELSE last_sync_at END WHERE connection_id=$4 AND epoch=$5 AND token=$6 AND fence=$7 AND lease_until>$8 RETURNING connection_id',[this.at(result.delayMs),reason,result.failed?lease.failures+1:0,lease.ref.id,lease.ref.epoch,lease.token,lease.fence,this.at(),result.successful===true])).rows.length;
  }
  async readiness(ref:ConnectionRef){
    const r=(await this.database.query('SELECT s.due_at,s.last_sync_at,s.last_attempt_at,s.reason,s.failures FROM connector_schedule s JOIN connector_connections c ON c.id=s.connection_id AND c.epoch=s.epoch WHERE c.id=$1 AND c.owner_id=$2 AND c.epoch=$3',[ref.id,ref.ownerId,ref.epoch])).rows[0];
    return r?{dueAt:new Date(r.due_at as string).toISOString(),lastSyncAt:r.last_sync_at?new Date(r.last_sync_at as string).toISOString():null,lastAttemptAt:r.last_attempt_at?new Date(r.last_attempt_at as string).toISOString():null,reason:String(r.reason),retryRequired:Number(r.failures)>=3}:null;
  }
  async retrySync(ref:ConnectionRef){
    return this.database.transaction(async db=>{
      await this.active(db,ref);
      const row=(await db.query('UPDATE connector_schedule SET failures=0,due_at=$1,reason=\'retry_requested\',token=NULL,lease_until=NULL WHERE connection_id=$2 AND epoch=$3 AND (lease_until IS NULL OR lease_until<=$1) RETURNING connection_id',[this.at(),ref.id,ref.epoch])).rows[0];
      if(!row)throw new ConnectorStoreError('retry_unavailable');
      return {id:ref.id,epoch:ref.epoch};
    });
  }
  async reserveUsage(value:Usage,daily=DAILY_RUNTIME_LIMITS,monthly=MONTHLY_RUNTIME_LIMITS){
    for(const v of Object.values(value))z.number().int().nonnegative().max(2**40).parse(v);
    return this.database.transaction(async db=>{
      // Same mutex orders day/month reservations across concurrent routes/provider calls.
      await db.query("SELECT pg_advisory_xact_lock(hashtext('connector-runtime-usage'))");
      const date=this.at(), periods=[{id:`day:${date.slice(0,10)}`,limit:daily},{id:`month:${date.slice(0,7)}`,limit:monthly}];
      let low=false;
      for(const p of periods){
        const r=(await db.query('SELECT calls,bytes,compute_ms FROM connector_runtime_usage WHERE id=$1',[p.id])).rows[0];
        const current:Usage={calls:Number(r?.calls??0),bytes:Number(r?.bytes??0),computeMs:Number(r?.compute_ms??0)};
        for(const k of ['calls','bytes','computeMs'] as const){if(current[k]+value[k]>p.limit[k])return {allowed:false,cadenceMs:1800000};if(current[k]+value[k]>p.limit[k]*0.75)low=true;}
      }
      for(const p of periods)await db.query('INSERT INTO connector_runtime_usage(id,calls,bytes,compute_ms,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET calls=connector_runtime_usage.calls+excluded.calls,bytes=connector_runtime_usage.bytes+excluded.bytes,compute_ms=connector_runtime_usage.compute_ms+excluded.compute_ms',[p.id,value.calls,value.bytes,value.computeMs,this.at(62*DAY)]);
      return {allowed:true,cadenceMs:low?1800000:900000};
    });
  }
  private retryKey(ref:ConnectionRef,item:ProviderItemRef){return privateIdentifier(JSON.stringify([item.id,item.version??null]),{...binding(ref,'fetch'),purpose:'identifier'},this.keyring);}
  async fetchState(ref:ConnectionRef,item:ProviderItemRef){
    const r=(await this.database.query('SELECT attempts,due_at FROM connector_fetch_attempts WHERE id=$1',[this.retryKey(ref,item)])).rows[0];
    return {attempts:Number(r?.attempts??0),dueAt:r?new Date(r.due_at as string).getTime():0};
  }
  async failFetch(ref:ConnectionRef,item:ProviderItemRef,delayMs?:number){
    return this.database.transaction(async db=>{
      await this.active(db,ref);const id=this.retryKey(ref,item);
      const prior=(await db.query('SELECT attempts FROM connector_fetch_attempts WHERE id=$1 FOR UPDATE',[id])).rows[0];
      const attempts=Number(prior?.attempts??0)+1;
      await db.query('INSERT INTO connector_fetch_attempts(id,connection_id,epoch,attempts,due_at,expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET attempts=excluded.attempts,due_at=excluded.due_at',[id,ref.id,ref.epoch,attempts,this.at(delayMs??[60000,300000,1800000][Math.min(attempts-1,2)]),this.at(90*DAY)]);
      return attempts;
    });
  }
  async clearFetch(ref:ConnectionRef,item:ProviderItemRef){await this.database.query('DELETE FROM connector_fetch_attempts WHERE id=$1',[this.retryKey(ref,item)]);}
  async isKnownItem(ref:ConnectionRef,id:string){
    const key=privateIdentifier(id,{ownerId:ref.ownerId,connectionId:`${ref.id}:item`,epoch:ref.epoch,purpose:'identifier'},this.keyring);
    return !!(await this.database.query("SELECT i.id FROM connector_items i JOIN connector_connections c ON c.id=i.connection_id AND c.epoch=i.epoch WHERE i.provider_key=$1 AND c.id=$2 AND c.owner_id=$3 AND c.epoch=$4 AND c.status='active' AND i.expires_at>$5",[key,ref.id,ref.ownerId,ref.epoch,this.at()])).rows.length;
  }
  async saveHandle(ref:ConnectionRef,kind:'item'|'page',value:unknown){
    return this.database.transaction(async db=>{
      await this.active(db,ref);
      const count=(await db.query('SELECT count(*) AS n FROM connector_selection_handles WHERE owner_id=$1 AND expires_at>$2',[ref.ownerId,this.at()])).rows[0];
      if(Number(count.n)>=200)throw new ConnectorStoreError('selection_limit');
      const id=randomUUID(),encoded=sealConnectorSecret(JSON.stringify(value),binding(ref,`selection:${id}`),this.keyring);
      await db.query('INSERT INTO connector_selection_handles(id,owner_id,connection_id,epoch,kind,encrypted_value,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,ref.ownerId,ref.id,ref.epoch,kind,encoded,this.at(600000)]);return id;
    });
  }
  async consumeHandle(ref:ConnectionRef,id:string,kind:'item'|'page'):Promise<unknown>{
    z.string().uuid().parse(id);
    return this.database.transaction(async db=>{
      await this.active(db,ref);
      const r=(await db.query('DELETE FROM connector_selection_handles WHERE id=$1 AND owner_id=$2 AND connection_id=$3 AND epoch=$4 AND kind=$5 AND expires_at>$6 RETURNING encrypted_value',[id,ref.ownerId,ref.id,ref.epoch,kind,this.at()])).rows[0];
      if(!r)throw new ConnectorStoreError('selection_unavailable');
      return JSON.parse(openConnectorSecret(String(r.encrypted_value),binding(ref,`selection:${id}`),this.keyring));
    }).catch(error=>{if(error instanceof ConnectorStoreError&&error.code==='connection_unavailable')throw new ConnectorStoreError('selection_unavailable');throw error;});
  }
  /** Idempotent durable handoff for provider webhooks and interrupted attachment preparation. */
  async stageRevision(ref:ConnectionRef,revisionId:string){
    await this.database.transaction(async db=>{await this.active(db,ref);
      await db.query("INSERT INTO connector_preparations(revision_id,owner_id,connection_id,epoch,due_at,expires_at) SELECT r.id,r.owner_id,r.connection_id,r.epoch,$5,r.content_expires_at FROM connector_revisions r JOIN connector_items i ON i.id=r.item_id WHERE r.id=$1 AND r.owner_id=$2 AND r.connection_id=$3 AND r.epoch=$4 AND r.content_expires_at>$5 AND i.state NOT IN ('not_selected','deleted','expired','source_unavailable') ON CONFLICT DO NOTHING",[revisionId,ref.ownerId,ref.id,ref.epoch,this.at()]);});
  }
  async discoverPreparations(providers:ProviderId[]){
    await this.database.query("INSERT INTO connector_preparations(revision_id,owner_id,connection_id,epoch,due_at,expires_at) SELECT r.id,r.owner_id,r.connection_id,r.epoch,$1,r.content_expires_at FROM connector_revisions r JOIN connector_connections c ON c.id=r.connection_id AND c.epoch=r.epoch JOIN connector_items i ON i.id=r.item_id WHERE c.status='active' AND c.provider=ANY($2::text[]) AND r.content_expires_at>$1 AND r.encrypted_content IS NOT NULL AND i.state NOT IN ('not_selected','source_unavailable','expired','deleted') AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.manifest->'targets') t WHERE t->>'status'='pending' AND NOT EXISTS(SELECT 1 FROM connector_jobs j WHERE j.revision_id=r.id AND j.target_id=t->>'id')) ORDER BY r.created_at,r.id LIMIT 50 ON CONFLICT DO NOTHING",[this.at(),providers]);
  }
  /** Durable source cancellation intent shares the core's existing cancellation drain. */
  async invalidateSource(ref:ConnectionRef,itemId:string,reason:string){
    await this.database.transaction(db=>this.invalidateSourceIn(db,ref,itemId,reason));
  }
  private async invalidateSourceIn(db:ConnectorSql,ref:ConnectionRef,itemId:string,reason:string){
    z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).parse(reason);
      await this.active(db,ref,true);
      const item=(await db.query('SELECT id FROM connector_items WHERE id=$1 AND owner_id=$2 AND connection_id=$3 AND epoch=$4 FOR UPDATE',[itemId,ref.ownerId,ref.id,ref.epoch])).rows[0];
      if(!item)throw new ConnectorStoreError('source_unavailable');
      if(['owner_removed_source','provider_deleted'].includes(reason))await db.query('INSERT INTO connector_source_suppressions(item_id,reason,expires_at) VALUES($1,$2,$3) ON CONFLICT(item_id) DO UPDATE SET reason=excluded.reason,expires_at=excluded.expires_at',[itemId,reason,this.at(90*DAY)]);
      await db.query('UPDATE connector_items SET state=$2 WHERE id=$1',[itemId,reason==='provider_deleted'?'deleted':'source_unavailable']);
      await db.query('UPDATE connector_revisions SET encrypted_content=NULL WHERE item_id=$1',[itemId]);
      await db.query("UPDATE connector_jobs SET state='canceled',reason=CASE WHEN check_id IS NOT NULL THEN 'disconnect_cancel_pending' ELSE $2 END,lease_token=NULL,lease_until=NULL WHERE revision_id IN(SELECT id FROM connector_revisions WHERE item_id=$1) AND state IN ('queued','leased')",[itemId,reason]);
      await db.query('DELETE FROM connector_preparations WHERE revision_id IN(SELECT id FROM connector_revisions WHERE item_id=$1)',[itemId]);
      await db.query("INSERT INTO connector_activity(id,owner_id,connection_id,epoch,kind,reason,count,created_at,expires_at) VALUES($1,$2,$3,$4,'gap',$5,1,$6,$7)",[randomUUID(),ref.ownerId,ref.id,ref.epoch,reason,this.at(),this.at(90*DAY)]);
  }
  async deleteProviderItem(ref:ConnectionRef,providerId:string,reason='provider_deleted'){
    z.string().min(1).max(200).parse(providerId);
    const key=privateIdentifier(providerId,{ownerId:ref.ownerId,connectionId:`${ref.id}:item`,epoch:ref.epoch,purpose:'identifier'},this.keyring);
    return this.database.transaction(async db=>{
      await this.active(db,ref,true);
      const row=(await db.query('SELECT id FROM connector_items WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND provider_key=$4 FOR UPDATE',[ref.id,ref.ownerId,ref.epoch,key])).rows[0];
      const itemId=row?String(row.id):randomUUID();
      // A deletion may precede the first in-flight body save. Retain only the
      // private identity tombstone; no revision/body is invented or imported.
      if(!row)await db.query("INSERT INTO connector_items(id,owner_id,connection_id,epoch,provider_key,state,received_at,expires_at) VALUES($1,$2,$3,$4,$5,'deleted',$6,$7)",[itemId,ref.ownerId,ref.id,ref.epoch,key,this.at(),this.at(90*DAY)]);
      await this.invalidateSourceIn(db,ref,itemId,reason);
      return {found:!!row};
    });
  }
  async isSourceSuppressed(ref:ConnectionRef,providerId:string){
    const key=privateIdentifier(providerId,{ownerId:ref.ownerId,connectionId:`${ref.id}:item`,epoch:ref.epoch,purpose:'identifier'},this.keyring);
    return !!(await this.database.query('SELECT i.id FROM connector_items i JOIN connector_source_suppressions s ON s.item_id=i.id WHERE i.connection_id=$1 AND i.owner_id=$2 AND i.epoch=$3 AND i.provider_key=$4 AND s.expires_at>$5',[ref.id,ref.ownerId,ref.epoch,key,this.at()])).rows.length;
  }
  async expirePendingReference(ref:ConnectionRef,item:ProviderItemRef){
    const expiresAt=new Date(Date.parse(item.receivedAt)+90*DAY).toISOString();
    if(expiresAt<=this.at())return;
    await this.database.transaction(async db=>{
      await this.active(db,ref);
      const key=privateIdentifier(item.id,{ownerId:ref.ownerId,connectionId:`${ref.id}:item`,epoch:ref.epoch,purpose:'identifier'},this.keyring);
      const itemId=randomUUID(),revisionId=randomUUID(),manifest={extraction:{coverage:'unavailable',diagnostics:[{reason:'content_expired',count:1}],overflow:{textBytes:0,urls:0,attachments:0}},targets:[],coverage:'partial',overflow:{textBytes:0,urls:0,attachments:0},counts:{discovered:0,checked:0,pending:0,unsupported:0}};
      const saved=(await db.query("INSERT INTO connector_items(id,owner_id,connection_id,epoch,provider_key,state,received_at,expires_at) VALUES($1,$2,$3,$4,$5,'expired',$6,$7) ON CONFLICT(connection_id,epoch,provider_key) DO UPDATE SET state='expired' RETURNING id",[itemId,ref.ownerId,ref.id,ref.epoch,key,item.receivedAt,expiresAt])).rows[0];
      await db.query("INSERT INTO connector_revisions(id,owner_id,connection_id,epoch,item_id,revision_hash,manifest,selection_reason,created_at,content_expires_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'content_expired',$8,$8,$9) ON CONFLICT(item_id,revision_hash) DO NOTHING",[revisionId,ref.ownerId,ref.id,ref.epoch,saved.id,unavailableRevisionHash(item.id,'content_expired'),JSON.stringify(manifest),this.at(),expiresAt]);
      await db.query('UPDATE connector_items SET latest_revision_id=(SELECT id FROM connector_revisions WHERE item_id=$1 AND revision_hash=$2) WHERE id=$1',[saved.id,unavailableRevisionHash(item.id,'content_expired')]);
    });
  }
  async claimPreparation(providers:ProviderId[],selectedOnly=false,revisionId?:string){
    return this.database.transaction(async db=>{
      const r=(await db.query("SELECT p.revision_id,p.attempts,c.id,c.owner_id,c.epoch,c.provider FROM connector_preparations p JOIN connector_connections c ON c.id=p.connection_id AND c.epoch=p.epoch WHERE c.status='active' AND c.provider=ANY($2::text[]) AND ($3::boolean=false OR EXISTS(SELECT 1 FROM connector_revisions r WHERE r.id=p.revision_id AND r.selection_reason='user_selected')) AND ($4::text IS NULL OR p.revision_id=$4) AND p.expires_at>$1 AND p.due_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1) ORDER BY p.due_at,p.revision_id FOR UPDATE OF p SKIP LOCKED LIMIT 1",[this.at(),providers,selectedOnly,revisionId??null])).rows[0];
      if(!r)return null;const token=randomUUID();await db.query('UPDATE connector_preparations SET token=$1,lease_until=$2 WHERE revision_id=$3',[token,this.at(55000),r.revision_id]);
      return {ref:refSchema.parse({id:r.id,ownerId:r.owner_id,epoch:r.epoch,provider:r.provider}),revisionId:String(r.revision_id),token,attempts:Number(r.attempts)};
    });
  }
  async finishPreparation(value:{revisionId:string;token:string},complete:boolean,failure=false,retryAfterMs=0){
    if(complete){await this.database.query('DELETE FROM connector_preparations WHERE revision_id=$1 AND token=$2',[value.revisionId,value.token]);return 0;}
    const r=(await this.database.query('UPDATE connector_preparations SET token=NULL,lease_until=NULL,attempts=attempts+$3,due_at=$4::timestamptz+(greatest($5,CASE WHEN attempts=0 THEN 60000 WHEN attempts=1 THEN 300000 ELSE 1800000 END)*interval \'1 millisecond\') WHERE revision_id=$1 AND token=$2 RETURNING attempts',[value.revisionId,value.token,failure?1:0,this.at(),retryAfterMs])).rows[0];
    return Number(r?.attempts??0);
  }
  async restartCheckpoint(ref:ConnectionRef,token:string,fence:number){
    const result=await this.database.query('UPDATE connector_connections SET encrypted_page=NULL WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND sync_token=$4 AND sync_fence=$5 AND sync_until>$6',[ref.id,ref.ownerId,ref.epoch,token,fence,this.at()]);
    return result;
  }
  async purgeExpired(){
    for(const table of ['connector_dispatches','connector_selection_handles','connector_fetch_attempts','connector_runtime_usage','connector_preparations','connector_source_suppressions'])await this.database.query(`DELETE FROM ${table} WHERE expires_at<=$1`,[this.at()]);
  }
}
export const unavailableRevisionHash=(id:string,reason:string)=>createHash('sha256').update(JSON.stringify(['unavailable',id,reason])).digest('hex');
