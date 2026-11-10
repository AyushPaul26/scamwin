import type {ConnectorStore,ConnectionRef} from './contracts';
import type {ExpandedIdentity} from './expanded-auth';
import {ConnectorStoreError} from './store';
import {TeamsStore,teamsRecord,teamsId} from './teams-store';
import {TeamsAdapter} from './providers/teams';
import {teamsConnectionInput,teamsFormSchema,teamsMessageInput,type TeamsSetupStatus} from './teams-ui';
const fail=(code:string):never=>{throw new ConnectorStoreError(code);};
/** A user-selected permalink is input evidence, never a fetch destination or owner assertion. */
export function teamsMessageLink(value:string,resource:{chatId:string;tenantId:string}){
 let url:URL;try{url=new URL(value);}catch{return fail('teams_message_link_invalid');}
 if(url.origin!=='https://teams.microsoft.com'||url.username||url.password||url.hash||url.searchParams.getAll('tenantId').length!==1||url.searchParams.get('tenantId')!==resource.tenantId)return fail('teams_message_link_invalid');
 const parts=url.pathname.split('/');if(parts.length!==5||parts[1]!=='l'||parts[2]!=='message')return fail('teams_message_link_invalid');
 let chatId:string,messageId:string;try{chatId=decodeURIComponent(parts[3]);messageId=decodeURIComponent(parts[4]);}catch{return fail('teams_message_link_invalid');}
 if(chatId!==resource.chatId)return fail('teams_message_link_invalid');return teamsId(messageId);
}
export class TeamsService{
 constructor(private readonly deps:{core:ConnectorStore;store:TeamsStore;adapter:TeamsAdapter;enabled:()=>boolean;automaticEnabled:()=>boolean;readIdentity:(ref:ConnectionRef)=>Promise<ExpandedIdentity|null>;savePage:(ref:ConnectionRef,value:unknown)=>Promise<string>;consumePage:(ref:ConnectionRef,handle:string)=>Promise<unknown>;stageRevision?:(ref:ConnectionRef,id:string)=>Promise<void>}){}
 private async owned(owner:string,id:string,epoch:number){const c=await this.deps.core.getConnection(owner,id);if(!c||c.provider!=='teams'||c.status==='disconnected')return fail('connection_unavailable');if(c.epoch!==epoch)return fail('stale_connection');return c;}
 private enabled(){if(!this.deps.enabled())fail('service_disabled');}
 async status(owner:string,input:unknown):Promise<TeamsSetupStatus>{
  const v=teamsConnectionInput.parse(input),c=await this.owned(owner,v.id,v.epoch),resources=await this.deps.store.resources(c,false),subscriptions=await this.deps.store.liveSubscriptionCount(c);
  return {epoch:c.epoch,mode:c.mode,paused:c.status==='paused',contains:c.rules.contains?.join('\n')??'',automaticDailyLimit:c.automaticDailyLimit,resources:resources.map(r=>({handle:r.handle,label:r.label,selected:c.scope.includes(r.handle)})),subscriptions,enabled:this.deps.enabled(),automaticEnabled:this.deps.automaticEnabled()};
 }
 async discover(owner:string,input:unknown){
  this.enabled();const v=teamsConnectionInput.extend({pageHandle:teamsConnectionInput.shape.id.uuid().optional()}).parse(input),c=await this.owned(owner,v.id,v.epoch),identity=await this.deps.readIdentity(c);
  const tenantId=identity?.metadata.tenantId;if(identity?.metadata.grantKind!=='delegated'||!tenantId||!/^[a-f0-9-]{36}$/.test(tenantId)||tenantId==='9188040d-6c67-4c5b-b112-36a304b66dad')return fail('teams_work_school_required');
  const token=v.pageHandle?await this.deps.consumePage(c,v.pageHandle):null;if(token!==null&&typeof token!=='string')return fail('invalid_cursor');
  const path='/v1.0/me/chats',query=token?this.deps.adapter.nextQuery(token as string,path):new URLSearchParams({'$top':'10','$select':'id,topic,chatType,tenantId'});
  const raw=await this.deps.adapter.discoverChats(c,query,AbortSignal.timeout(15000));
  await this.owned(owner,v.id,v.epoch);if(!teamsRecord(raw)||!Array.isArray(raw.value)||raw.value.length>10)return fail('malformed_response');const items=[];
  for(const chat of raw.value){
   if(!teamsRecord(chat)||typeof chat.id!=='string')return fail('malformed_response');teamsId(chat.id);
   // Work/school tenant-specific subscription coverage; federated or unidentified tenants stay excluded.
   if(chat.tenantId!==tenantId)continue;
   const label=typeof chat.topic==='string'&&chat.topic.trim()?chat.topic.slice(0,200):`Teams ${chat.chatType==='oneOnOne'?'one-to-one':'group'} chat`;
   const saved=await this.deps.store.saveResource(c,{chatId:chat.id,label,tenantId});items.push({handle:saved.handle,label:saved.label,selected:c.scope.includes(saved.handle)});
  }
  const next=raw['@odata.nextLink'];if(next!==undefined){if(typeof next!=='string')return fail('invalid_cursor');this.deps.adapter.nextQuery(next,path);}
  return {items,nextHandle:next?await this.deps.savePage(c,next):null};
 }
 async configure(owner:string,input:unknown){
  this.enabled();const v=teamsFormSchema.parse(input),c=await this.owned(owner,v.id,v.epoch);
  if(v.mode!=='manual'&&!this.deps.automaticEnabled())return fail('teams_automatic_pilot_required');
  const settings={mode:v.mode,scope:v.scope.length?v.scope:['unselected'],rules:v.mode==='selective'?{contains:v.contains.split('\n').map(p=>p.trim()).filter(Boolean)}:{},consent:v.consent,paused:v.paused,automaticDailyLimit:v.automaticDailyLimit};
  const baseline=v.mode!=='manual'&&!v.paused?await this.deps.adapter.activationHook(c,settings,AbortSignal.timeout(20000)):undefined;
  const saved=await this.deps.store.configure(c,settings,baseline);
  if(v.mode!=='manual'&&!v.paused&&(c.mode==='manual'||c.status==='paused'))await this.deps.core.recordCoverageGap(saved,'teams_inactive_interval_unavailable',1);
  // Local fencing and selection commit first. Failed remote cleanup cannot restore the old epoch.
  let cleanupPending=false;try{await this.deps.adapter.cleanup(saved,AbortSignal.timeout(10000));}catch{cleanupPending=true;}
  return {epoch:saved.epoch,mode:saved.mode,paused:saved.status==='paused',cleanupPending};
 }
 async importMessage(owner:string,input:unknown){
  this.enabled();if(!this.deps.stageRevision)return fail('provider_unavailable');const v=teamsMessageInput.parse(input),c=await this.owned(owner,v.id,v.epoch);
  if(c.status!=='active')return fail('connection_unavailable');
  const identity=await this.deps.readIdentity(c),resource=(await this.deps.store.resources(c)).find(r=>r.handle===v.resourceHandle);
  if(!resource||identity?.metadata.tenantId!==resource.tenantId||identity.metadata.grantKind!=='delegated')return fail('teams_selection_required');
  const messageId=teamsMessageLink(v.messageLink,resource),reference=await this.deps.store.saveManualReference(c,resource,messageId,this.deps.store.now().toISOString());
  const item=await this.deps.adapter.readItem(c,reference,AbortSignal.timeout(15000));await this.owned(owner,v.id,v.epoch);
  const saved=await this.deps.core.saveSelectedRevision(c,item);await this.deps.stageRevision(c,saved.revision.id);return {itemId:saved.item.id,revisionId:saved.revision.id};
 }
}
