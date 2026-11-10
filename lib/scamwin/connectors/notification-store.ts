import {readOwnerGeneration,assertOwnerGeneration} from './privacy-fence';
import {randomUUID} from 'node:crypto';
import {createInsertSchema} from 'drizzle-zod';
import {z} from 'zod';
import {connectorPrivateOutcomes} from '../../db/scamwin-notification-schema';
import type {ConnectorDatabase} from './store';
import {ConnectorStoreError} from './store';
import {ownerSchema,idSchema,manifestSchema,reasonSchema} from './contracts';
import {listInput} from './ui';
import {canonicalHash} from './policy';
import type {PrivateAlert,PrivateAlertPage,PrivateOutcomeInput} from './notification-ui';
const insertSchema=createInsertSchema(connectorPrivateOutcomes,{ownerId:ownerSchema,counts:manifestSchema.shape.counts,reason:reasonSchema}).strict();
const iso=(v:unknown)=>v===null?null:v instanceof Date?v.toISOString():String(v);
const alert=(r:Record<string,unknown>):PrivateAlert=>({id:String(r.id),connectionId:String(r.connection_id),epoch:Number(r.epoch),revisionId:r.revision_id?String(r.revision_id):null,itemId:r.item_id?String(r.item_id):null,kind:r.kind as PrivateAlert['kind'],reason:String(r.reason),counts:manifestSchema.shape.counts.parse(r.counts),revision:Number(r.revision),seenAt:iso(r.seen_at),createdAt:iso(r.created_at)!,expiresAt:iso(r.expires_at)!});
export class PrivateNotificationStore{
 constructor(readonly db:ConnectorDatabase,private now:()=>Date=()=>new Date()){}
 async preferences(owner:string){ownerSchema.parse(owner);const r=(await this.db.query('SELECT all_results,push_epoch FROM connector_notification_preferences WHERE owner_id=$1',[owner])).rows[0];return {allResults:r?.all_results===1,pushEpoch:Number(r?.push_epoch??1)};}
 async setAllResults(owner:string,value:boolean){ownerSchema.parse(owner);z.boolean().parse(value);const generation=await readOwnerGeneration(this.db,owner);await this.db.transaction(async sql=>{await assertOwnerGeneration(sql,owner,generation);await sql.query('INSERT INTO connector_notification_preferences (owner_id,all_results,push_epoch,updated_at) VALUES ($1,$2,1,$3) ON CONFLICT (owner_id) DO UPDATE SET all_results=$2,updated_at=$3',[owner,value?1:0,this.now().toISOString()]);});return {allResults:value};}
 async publish(owner:string,input:PrivateOutcomeInput,expectedGeneration?:number):Promise<PrivateAlert|null>{
  const generation=expectedGeneration??await readOwnerGeneration(this.db,owner);
  ownerSchema.parse(owner);if(input.kind==='result'&&input.reason==='result_ready'&&!(await this.preferences(owner)).allResults)return null;
  const now=this.now().toISOString(),eventKey=canonicalHash({connection:input.connectionId,epoch:input.epoch,revision:input.revisionId,material:input.material});
  const v=insertSchema.parse({id:randomUUID(),ownerId:owner,connectionId:input.connectionId,epoch:input.epoch,revisionId:input.revisionId,itemId:input.itemId,noticeId:input.noticeId??null,eventKey,kind:input.kind,reason:input.reason,counts:input.counts,revision:1,seenAt:null,createdAt:now,expiresAt:new Date(this.now().getTime()+90*86400000).toISOString()});
  return this.db.transaction(async db=>{
   await assertOwnerGeneration(db,owner,generation);
   if(expectedGeneration!==undefined&&!(await db.query('SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 FOR UPDATE',[input.connectionId,owner,input.epoch])).rows.length)return null;
  await db.query('INSERT INTO connector_private_outcomes (id,owner_id,connection_id,epoch,revision_id,item_id,event_key,kind,reason,counts,revision,seen_at,created_at,expires_at,notice_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,NULL,$11,$12,$13) ON CONFLICT (owner_id,event_key) DO NOTHING',[v.id,v.ownerId,v.connectionId,v.epoch,v.revisionId,v.itemId,v.eventKey,v.kind,v.reason,JSON.stringify(v.counts),v.createdAt,v.expiresAt,v.noticeId]);
  const row=(await db.query('SELECT * FROM connector_private_outcomes WHERE owner_id=$1 AND event_key=$2 AND expires_at>$3',[owner,eventKey,now])).rows[0];return row?alert(row):null;
  });
 }
 async list(owner:string,input:unknown):Promise<PrivateAlertPage>{
  ownerSchema.parse(owner);const p=listInput.parse(input);let cursor:{at:string;id:string}|null=null;
  if(p.before)try{cursor=z.object({at:z.string().datetime(),id:idSchema}).strict().parse(JSON.parse(Buffer.from(p.before,'base64url').toString('utf8')));}catch{throw new ConnectorStoreError('invalid_cursor');}
  if(!['all','unread','read'].includes(p.filter))throw new ConnectorStoreError('invalid_input');
  const now=this.now().toISOString();const rows=(await this.db.query(`SELECT * FROM connector_private_outcomes WHERE owner_id=$1 AND expires_at>$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::text)) AND ($5='all' OR ($5='unread' AND seen_at IS NULL) OR ($5='read' AND seen_at IS NOT NULL)) AND ($6='' OR position(lower($6) in lower(kind || ' ' || reason))>0) ORDER BY created_at DESC,id DESC LIMIT 21`,[owner,now,cursor?.at??null,cursor?.id??null,p.filter,p.query])).rows;
  const items=rows.slice(0,20).map(alert),last=items.at(-1),count=(await this.db.query('SELECT COUNT(*) AS count FROM connector_private_outcomes WHERE owner_id=$1 AND expires_at>$2 AND seen_at IS NULL',[owner,now])).rows[0];
  return {items,nextCursor:rows.length>20&&last?Buffer.from(JSON.stringify({at:last.createdAt,id:last.id})).toString('base64url'):null,allResults:(await this.preferences(owner)).allResults,unreadCount:Number(count?.count??0)};
 }
 async setRead(owner:string,id:string,expectedRevision:number,read:boolean){
  ownerSchema.parse(owner);idSchema.parse(id);z.number().int().positive().parse(expectedRevision);z.boolean().parse(read);
  const rows=(await this.db.query('UPDATE connector_private_outcomes SET seen_at=$5,revision=revision+1 WHERE owner_id=$1 AND id=$2 AND revision=$3 AND expires_at>$4 RETURNING id',[owner,id,expectedRevision,this.now().toISOString(),read?this.now().toISOString():null])).rows;if(rows.length)return true;
  // Retrying the same operation is harmless; a stale opposite operation is rejected.
  const row=(await this.db.query('SELECT revision,seen_at FROM connector_private_outcomes WHERE owner_id=$1 AND id=$2 AND expires_at>$3',[owner,id,this.now().toISOString()])).rows[0];return !!row&&Number(row.revision)===expectedRevision+1&&(row.seen_at!==null)===read;
 }
 async purgeExpired(){for(const table of ['connector_private_outcomes','connector_push_subscriptions','connector_notification_projection'])await this.db.query(`DELETE FROM ${table} WHERE expires_at<=$1`,[this.now().toISOString()]);}
 async deleteAccount(owner:string){ownerSchema.parse(owner);await this.db.transaction(async db=>{for(const table of ['connector_push_subscriptions','connector_private_outcomes','connector_notification_projection','connector_notification_preferences'])await db.query(`DELETE FROM ${table} WHERE owner_id=$1`,[owner]);});}
}
