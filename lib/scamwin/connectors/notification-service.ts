import {readOwnerGeneration,assertOwnerGeneration} from './privacy-fence';
import type {ConnectorDatabase} from './store';
import type {ConnectorSourceService} from './source-service';
import type {PrivateAlert} from './notification-ui';
import {canonicalHash} from './policy';
import {PrivateNotificationStore} from './notification-store';

/** Reads saved connector/main truth only. Never fetches a provider body or creates a check. */
export class PrivateOutcomeService{
 constructor(private db:ConnectorDatabase,private notifications:PrivateNotificationStore,private sources:ConnectorSourceService,private push?:(owner:string,signal?:AbortSignal)=>Promise<void>,private now:()=>Date=()=>new Date()){}
 async publishPrivateOutcome(owner:string,connectionId:string,itemId:string,signal?:AbortSignal){
  const generation=await readOwnerGeneration(this.db,owner);
  const detail=await this.sources.detail(owner,connectionId,itemId);if(!detail.item.latestRevisionId)return null;
  let reason:string,kind:PrivateAlert['kind']='coverage';
  if(['high_risk','needs_caution'].includes(detail.risk)){reason=detail.risk;kind='result';}
  else if(detail.item.state==='failed'||detail.targets.some(t=>t.jobState==='failed'))reason='failed';
  else if(detail.targets.some(t=>/quota|limit|automatic_(owner|global)_/.test(t.reason??''))){reason='quota_paused';kind='quota';}
  else if(['source_unavailable','deleted','expired'].includes(detail.item.state))reason=detail.item.state;
  else if(detail.item.state==='quota_paused'||detail.targets.some(t=>t.reason&&t.dueAt&&Date.parse(t.dueAt)>this.now().getTime()))reason='delayed';
  else if(detail.coverage==='partial')reason='partial';
  else if(detail.coverage==='complete'){reason='result_ready';kind='result';}
  else return null;
  const material=canonicalHash({reason,risk:detail.risk,coverage:detail.coverage,counts:detail.counts,targets:detail.targets.map(t=>({id:t.id,state:t.state,reason:t.reason,risk:t.risk})),gaps:detail.gaps});
  const alert=await this.notifications.publish(owner,{connectionId,epoch:detail.item.epoch,revisionId:detail.item.latestRevisionId,itemId,kind,reason,counts:detail.counts,material},generation);
  if(alert)await this.deliver(owner,alert.id,signal);return alert;
 }
 private async deliver(owner:string,id:string,signal?:AbortSignal){
  if(!this.push||signal?.aborted)return;
  // Durable alert commits before a single best-effort generic device notification.
  const claim=await this.db.query('UPDATE connector_private_outcomes SET push_attempted_at=$3 WHERE id=$1 AND owner_id=$2 AND push_attempted_at IS NULL RETURNING id',[id,owner,this.now().toISOString()]);
  if(claim.rows.length)try{await this.push(owner,signal);}catch{/* Delivery failure never rolls back or hides the private alert. */}
 }
 async refresh(owner?:string,signal?:AbortSignal){
  if(signal?.aborted)return;
  const now=this.now().toISOString();
  const rows=(await this.db.query(`SELECT r.owner_id,r.connection_id,r.item_id,r.id,r.expires_at FROM connector_revisions r JOIN connector_items i ON i.latest_revision_id=r.id AND i.owner_id=r.owner_id LEFT JOIN connector_notification_projection p ON p.revision_id=r.id WHERE r.expires_at>$1 AND ($2::text IS NULL OR r.owner_id=$2) ORDER BY p.checked_at ASC NULLS FIRST,r.created_at DESC,r.id DESC LIMIT 20`,[now,owner??null])).rows;
  for(const row of rows){if(signal?.aborted)return;try{await this.publishPrivateOutcome(String(row.owner_id),String(row.connection_id),String(row.item_id),signal);}catch{/* Saved alerts remain readable during a main-store interruption. */}finally{await this.db.transaction(async sql=>{const generation=await readOwnerGeneration(sql,String(row.owner_id));await assertOwnerGeneration(sql,String(row.owner_id),generation);await sql.query('INSERT INTO connector_notification_projection (revision_id,owner_id,checked_at,expires_at) SELECT id,owner_id,$3,expires_at FROM connector_revisions WHERE id=$1 AND owner_id=$2 ON CONFLICT (revision_id) DO UPDATE SET checked_at=$3',[row.id,row.owner_id,now]);});}}
  if(signal?.aborted)return;
  // Provider-level notices can exist without any source item/revision.
  const notices=(await this.db.query(`SELECT a.* FROM connector_activity a WHERE a.kind='connection' AND a.expires_at>$1 AND ($2::text IS NULL OR a.owner_id=$2) AND NOT EXISTS (SELECT 1 FROM connector_private_outcomes o WHERE o.owner_id=a.owner_id AND o.notice_id=a.id) AND (a.reason LIKE '%expired%' OR a.reason LIKE '%reconnect%' OR a.reason LIKE '%unavailable%' OR a.reason LIKE '%denied%' OR a.reason LIKE '%failed%') ORDER BY a.created_at DESC,a.id DESC LIMIT 20`,[now,owner??null])).rows;
  for(const row of notices){if(signal?.aborted)return;const generation=await readOwnerGeneration(this.db,String(row.owner_id));const alert=await this.notifications.publish(String(row.owner_id),{connectionId:String(row.connection_id),epoch:Number(row.epoch),revisionId:null,itemId:null,noticeId:String(row.id),kind:'connection',reason:String(row.reason),counts:{discovered:0,checked:0,pending:0,unsupported:0},material:canonicalHash({notice:row.id})},generation);if(alert)await this.deliver(String(row.owner_id),alert.id,signal);}
 }
}
