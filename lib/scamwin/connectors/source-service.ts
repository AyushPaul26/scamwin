import {z} from 'zod';
import type {ScamwinStore} from '../contracts';
import type {ConnectorStore,ConnectorJob,SourceItem} from './contracts';
import {idSchema,itemStates,manifestSchema} from './contracts';
import {listInput} from './ui';
import {ConnectorStoreError,type ConnectorDatabase} from './store';
import {readParentOutcome} from './targets';
import type {SourcePage,SourceDetail} from './source-ui';
const cursorSchema=z.object({receivedAt:z.string().datetime(),id:idSchema}).strict();
const iso=(value:unknown)=>value instanceof Date?value.toISOString():String(value);

/** Private read model. Provider identifiers remain in encrypted storage, never in these DTOs. */
export class ConnectorSourceService{
 constructor(private db:ConnectorDatabase,private store:ConnectorStore,private main:ScamwinStore,private now:()=>Date=()=>new Date(),private enabled=false){}
 private async owned(owner:string,id:string){idSchema.parse(id);const c=await this.store.getConnection(owner,id);if(!c)throw new ConnectorStoreError('connection_unavailable');return c;}
 async list(owner:string,id:string,input:unknown):Promise<SourcePage>{
  const c=await this.owned(owner,id),p=listInput.parse(input);let cursor:z.infer<typeof cursorSchema>|null=null;
  if(p.before)try{cursor=cursorSchema.parse(JSON.parse(Buffer.from(p.before,'base64url').toString('utf8')));}catch{throw new ConnectorStoreError('invalid_cursor');}
  if(p.filter!=='all'&&!itemStates.includes(p.filter as typeof itemStates[number]))throw new ConnectorStoreError('invalid_input');
  const found=await this.db.query(`SELECT i.id,i.connection_id,i.epoch,i.state,i.latest_revision_id,i.received_at,i.expires_at,r.manifest FROM connector_items i LEFT JOIN connector_revisions r ON r.id=i.latest_revision_id AND r.owner_id=i.owner_id AND r.expires_at>$3 WHERE i.owner_id=$1 AND i.connection_id=$2 AND i.expires_at>$3 AND ($4::timestamptz IS NULL OR (i.received_at,i.id)<($4::timestamptz,$5::text)) AND ($6='all' OR i.state=$6) AND ($7='' OR position(lower($7) in lower(i.state))>0) ORDER BY i.received_at DESC,i.id DESC LIMIT 21`,[owner,id,this.now().toISOString(),cursor?.receivedAt??null,cursor?.id??null,p.filter,p.query]);
  const items=found.rows.slice(0,20).map(r=>{const manifest=r.manifest?manifestSchema.parse(r.manifest):null;return {id:String(r.id),connectionId:String(r.connection_id),epoch:Number(r.epoch),state:r.state as SourceItem['state'],latestRevisionId:r.latest_revision_id?String(r.latest_revision_id):null,receivedAt:iso(r.received_at),expiresAt:iso(r.expires_at),counts:manifest?.counts??null,coverage:manifest?.coverage??null};});
  const last=items.at(-1),scopeLabels=c.scope.map(scope=>scope==='inbox'?'Inbox':scope==='all_mail'?'All mail, including Spam and Trash':c.provider==='gmail'?'Saved Gmail label':c.provider==='outlook'?'Saved Outlook folder':c.provider==='telegram'?'Connected Telegram business scope':'Saved app resource');return {items,nextCursor:found.rows.length>20&&last?Buffer.from(JSON.stringify({receivedAt:last.receivedAt,id:last.id})).toString('base64url'):null,connection:{id:c.id,epoch:c.epoch,provider:c.provider,mode:c.mode,status:c.status,scopeLabels},enabled:this.enabled};
 }
 async detail(owner:string,id:string,itemId:string):Promise<SourceDetail>{
  const c=await this.owned(owner,id),item=await this.store.getItem(c,idSchema.parse(itemId));if(!item)throw new ConnectorStoreError('source_unavailable');
  const revision=item.latestRevisionId?await this.store.getRevision(c,item.latestRevisionId):null;
  if(!revision)return {item,provider:c.provider,selectionReason:null,risk:'inconclusive',coverage:'partial',counts:{discovered:0,checked:0,pending:0,unsupported:0},gaps:[{reason:'source_unavailable',count:1}],targets:[],context:null};
  // Historical epochs remain readable after disconnect/reconnect. Admission keys and raw IDs
  // are deliberately omitted; main check ownership is rechecked by readParentOutcome.
  const raw=await this.db.query('SELECT id,connection_id,epoch,revision_id,target_id,generation,state,check_id,due_at,reason FROM connector_jobs WHERE owner_id=$1 AND connection_id=$2 AND revision_id=$3 AND expires_at>$4 ORDER BY generation DESC',[owner,id,revision.id,this.now().toISOString()]);
  const jobs=raw.rows.map(r=>({id:String(r.id),connectionId:String(r.connection_id),epoch:Number(r.epoch),revisionId:String(r.revision_id),targetId:String(r.target_id),generation:Number(r.generation),admissionKey:'',state:r.state as ConnectorJob['state'],checkId:r.check_id?String(r.check_id):null,dueAt:iso(r.due_at),reason:r.reason?String(r.reason):null}));
  // The established parent projector is the authority for grounded concern and coverage.
  const reader=new Proxy(this.store,{get:(target,key)=>key==='listRevisionJobs'?async()=>jobs:typeof target[key as keyof ConnectorStore]==='function'?(target[key as keyof ConnectorStore] as (...args:unknown[])=>unknown).bind(target):target[key as keyof ConnectorStore]});
  const outcome=await readParentOutcome(c,revision.id,{connectorStore:reader,mainStore:this.main});
  const manifest=outcome?.manifest??revision.manifest;
  const context=Date.parse(revision.contentExpiresAt)>this.now().getTime()?await this.store.readRevisionContent(c,revision.id):null;
  const targets=await Promise.all(manifest.targets.map(async t=>{const job=jobs.find(j=>j.targetId===t.id),child=outcome?.children.find(v=>v.checkId===job?.checkId);const check=job?.checkId?await this.main.getCheck(owner,job.checkId):null;return {id:t.id,kind:t.kind,state:t.status,reason:t.reason??job?.reason??null,checkHref:check?`/checks/${encodeURIComponent(check.id)}`:null,risk:child?.risk??null,generation:job?.generation??null,dueAt:job?.dueAt??null,jobState:job?.state??null};}));
  const gaps=[...(manifest.extraction?.diagnostics??[])];for(const [kind,count]of Object.entries(manifest.overflow))if(count)gaps.push({reason:`omitted_${kind.replace(/[A-Z]/g,m=>'_'+m.toLowerCase())}`,count});
  return {item,provider:c.provider,selectionReason:revision.selectionReason,risk:outcome?.risk??'inconclusive',coverage:outcome?.coverage??'partial',counts:manifest.counts,gaps,targets,context:context?{text:context.text,urls:context.urls.map(u=>u.original),attachmentNames:context.attachments.map(a=>a.name),expiresAt:revision.contentExpiresAt}:null};
 }
}
