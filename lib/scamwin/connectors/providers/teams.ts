import {randomBytes,createHash} from 'node:crypto';
import type {ConnectionSettings,ProviderAdapter,ProviderItem,ProviderItemRef,SavedConnection,SyncBudget,SyncCursor,ProviderPage,ConnectorGrant} from '../contracts';
import type {ActivationBaseline} from '../oauth-contracts';
import {ProviderHttpError} from '../provider-http';
import {ConnectorStoreError} from '../store';
import {parseOutlookMessage} from './outlook-message';
import {TeamsStore,teamsId,teamsRecord,teamsResource,type TeamsResource,type TeamsMaintenance} from '../teams-store';
export {teamsResource} from '../teams-store';

/** One bounded request, fixed global stable Graph origin, no automatic retries and no redirect credential forwarding. */
export class TeamsGraphClient{
 constructor(private readonly fetcher:typeof fetch=fetch,private readonly now:()=>Date=()=>new Date()){}
 async request(path:string,token:string,signal:AbortSignal,method:'GET'|'POST'|'PATCH'|'DELETE'='GET',body?:unknown,query?:URLSearchParams,maxBytes=512*1024):Promise<unknown>{
  if(!/^\/v1\.0\/(?:me\/chats|chats\/[^/]+(?:\/messages(?:\/[^/]+)?)?|subscriptions(?:\/[^/]+)?)$/.test(path)||/[?#\\\x00-\x20]/.test(path)||path.split('/').some(p=>p==='.'||p==='..')||!token||token.length>16384||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2*1024*1024)throw new ProviderHttpError('invalid_provider_path');
  const url=new URL(path,'https://graph.microsoft.com');if(url.pathname!==path||url.origin!=='https://graph.microsoft.com')throw new ProviderHttpError('invalid_provider_path');url.search=query?.toString()??'';
  signal.throwIfAborted();const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const work=async()=>{
   try{
    const response=await this.fetcher(url,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,redirect:'error',cache:'no-store'});
    if(response.redirected||response.status>=300&&response.status<400)throw new ProviderHttpError('provider_rejected');
    if(response.status===429||response.status===503){const retry=response.headers.get('Retry-After');throw new ProviderHttpError('provider_backoff',retry&&/^\d+$/.test(retry)?Math.max(1000,Math.min(86400000,Number(retry)*1000)):60000);}
    if(response.status===401)throw new ProviderHttpError('reconnect_required');if(response.status===403)throw new ProviderHttpError('provider_denied');if(response.status===404||response.status===410)throw new ProviderHttpError('provider_not_found');if(!response.ok)throw new ProviderHttpError('provider_rejected');
    if(response.status===204)return null;
    const declared=response.headers.get('Content-Length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw new ProviderHttpError('response_too_large');
    if(!response.body)throw new ProviderHttpError('malformed_response');reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new ProviderHttpError('response_too_large');chunks.push(part.value);}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new ProviderHttpError('malformed_response');}
   }catch(error){if(error instanceof ProviderHttpError)throw error;throw new ProviderHttpError(controller.signal.aborted?'provider_aborted':'provider_network');}
  };
  try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ProviderHttpError('provider_timeout'));},15000);controller.signal.addEventListener('abort',()=>reject(new ProviderHttpError('provider_aborted')),{once:true});})]);}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
 }
 get(path:string,token:string,signal:AbortSignal,query?:URLSearchParams,maxBytes?:number){return this.request(path,token,signal,'GET',undefined,query,maxBytes);}
}

export function parseTeamsMessage(raw:Record<string,unknown>,opaqueId:string):ProviderItem{
 if(typeof raw.id!=='string'||typeof raw.createdDateTime!=='string'||!Number.isFinite(Date.parse(raw.createdDateTime)))throw new ProviderHttpError('malformed_response');
 const attachments:ProviderItem['attachments']=[],diagnostics:{reason:string;count:number}[]=[];
 if(!Array.isArray(raw.attachments))diagnostics.push({reason:'attachment_state_unavailable',count:1});
 else{
  for(const attachment of raw.attachments.slice(0,20)){
   if(!teamsRecord(attachment)){diagnostics.push({reason:'attachment_metadata_unavailable',count:1});continue;}
   const key=createHash('sha256').update(`${opaqueId}:${String(attachment.id??attachments.length)}`).digest('hex');
   attachments.push({id:key,name:typeof attachment.name==='string'?attachment.name.slice(0,200):'Teams attachment',mediaType:'application/octet-stream',supported:false});
  }
  if(raw.attachments.length>20)diagnostics.push({reason:'attachment_limit',count:raw.attachments.length-20});
  if(raw.attachments.length)diagnostics.push({reason:'teams_hosted_file_permission_unavailable',count:raw.attachments.length});
 }
 const parsed=parseOutlookMessage({body:raw.body,hasAttachments:attachments.length>0,receivedDateTime:raw.createdDateTime},attachments,diagnostics);
 const receivedAt=new Date(raw.createdDateTime).toISOString(),revisionHash=createHash('sha256').update(JSON.stringify({id:opaqueId,modified:raw.lastModifiedDateTime??null,text:parsed.text,urls:parsed.urls,attachments,extraction:parsed.extraction})).digest('hex');
 return {providerItemId:opaqueId,revisionHash,receivedAt,text:parsed.text,urls:parsed.urls,attachments,extraction:parsed.extraction};
}
export interface TeamsAdapterOptions{
 store:TeamsStore;accessToken:(connection:SavedConnection,signal:AbortSignal)=>Promise<string>;
 readGrant?:(connection:SavedConnection)=>Promise<ConnectorGrant|null>;
 enabled:()=>boolean;automaticEnabled:()=>boolean;notificationUrl:string;lifecycleUrl:string;
 fetch?:typeof fetch;now?:()=>Date;
 recordGap:(c:SavedConnection,reason:string,count:number)=>Promise<void>;
 deleteItem:(c:SavedConnection,id:string)=>Promise<void>;
}
export class TeamsAdapter implements ProviderAdapter{
 readonly capabilities={pull:true,history:false,selectedItem:true,push:true,edits:true,attachments:false};
 readonly client:TeamsGraphClient;
 constructor(private readonly options:TeamsAdapterOptions){this.client=new TeamsGraphClient(options.fetch,options.now);}
 private now(){return this.options.now?.()??new Date();}
 private async token(c:SavedConnection,signal:AbortSignal){if(!this.options.enabled()||c.provider!=='teams')throw new ConnectorStoreError('provider_unavailable');return this.options.accessToken(c,signal);}
 async discoverChats(c:SavedConnection,query:URLSearchParams,signal:AbortSignal){return this.client.get('/v1.0/me/chats',await this.token(c,signal),signal,query);}
 async activationHook(current:SavedConnection,settings:ConnectionSettings,signal:AbortSignal):Promise<ActivationBaseline>{
  if(!this.options.automaticEnabled())throw new ProviderHttpError('activation_required');
  const all=await this.options.store.resources(current,false),selected=settings.scope.map(handle=>all.find(r=>r.handle===handle));
  if(!selected.length||selected.length>20||selected.some(r=>!r))throw new ProviderHttpError('invalid_scope');
  const token=await this.token(current,signal);
  for(const resource of selected){const result=await this.client.get(`/v1.0/chats/${encodeURIComponent(resource!.chatId)}`,token,signal);if(!teamsRecord(result)||result.id!==resource!.chatId)throw new ProviderHttpError('provider_denied');}
  return {cursor:'0',capturedAt:this.now().toISOString()};
 }
 async createSubscription(c:SavedConnection,resource:TeamsResource,signal:AbortSignal,creation?:TeamsMaintenance){
  const clientState=randomBytes(32).toString('base64url'),token=await this.token(c,signal);
  for(const callback of [this.options.notificationUrl,this.options.lifecycleUrl]){const url=new URL(callback);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new ProviderHttpError('invalid_provider_path');}
  const expirationDateTime=new Date(this.now().getTime()+2*86400000).toISOString();
  const result=await this.client.request('/v1.0/subscriptions',token,signal,'POST',{changeType:'created,updated,deleted',notificationUrl:this.options.notificationUrl,lifecycleNotificationUrl:this.options.lifecycleUrl,resource:teamsResource(resource.chatId),includeResourceData:false,expirationDateTime,clientState});
  if(!teamsRecord(result)||typeof result.id!=='string'||typeof result.expirationDateTime!=='string'||result.resource!==teamsResource(resource.chatId)||result.clientState!==undefined&&result.clientState!==clientState)throw new ProviderHttpError('malformed_response');
  try{await this.options.store.saveSubscription(c,resource,{id:result.id,clientState,expiresAt:result.expirationDateTime},creation);}
  catch(error){await this.client.request(`/v1.0/subscriptions/${encodeURIComponent(teamsId(result.id))}`,token,signal,'DELETE').catch(()=>{});throw error;}
 }
 async cleanup(c:SavedConnection,signal:AbortSignal){
  const stale=await this.options.store.staleSubscriptions(c);if(!stale.length)return;
  const token=await this.token(c,signal);
  await this.cleanupSaved(stale,token,signal);
 }
 private async cleanupSaved(stale:Awaited<ReturnType<TeamsStore['staleSubscriptions']>>,token:string,signal:AbortSignal){
  for(const subscription of stale){if(subscription.value.id)try{await this.client.request(`/v1.0/subscriptions/${encodeURIComponent(teamsId(subscription.value.id))}`,token,signal,'DELETE');}catch(error){if(!(error instanceof ProviderHttpError)||error.code!=='provider_not_found'){await this.options.store.failCleanup(subscription.key);throw error;}}await this.options.store.forgetSubscription(subscription.key);}
 }
 /** Server-only capability: capture DELETE authority, commit Core disconnect immediately, then invoke this function.
  * The captured token must never cross an action DTO or be used to read a disconnected source. */
 async prepareDisconnect(c:SavedConnection,signal:AbortSignal){
  signal.throwIfAborted();const grant=await this.options.readGrant?.(c);if(!grant)throw new ConnectorStoreError('grant_missing');
  const subscriptions=await this.options.store.disconnectSubscriptions(c),expires=this.now().getTime()+300000;
  return async(cleanupSignal:AbortSignal)=>{if(this.now().getTime()>expires)throw new ConnectorStoreError('teams_cleanup_expired');await this.options.store.markDisconnected(c);await this.cleanupSaved(subscriptions,grant.accessToken,cleanupSignal);};
 }
 private async maintain(c:SavedConnection,signal:AbortSignal){
  await this.options.store.purge();await this.cleanup(c,signal);
  const selected=await this.options.store.resources(c),subscribed=await this.options.store.subscribed(c),missing=selected.find(r=>!subscribed.includes(r.handle));
  // One remote creation per tick bounds provider work; delayed installation is always a coverage gap.
  if(missing){await this.options.recordGap(c,'teams_subscription_activation_gap',1);await this.options.store.queueSubscription(c,missing);}
  const lease=await this.options.store.claimMaintenance(c);if(!lease)return;
  try{
   if(lease.kind==='recover'){
    // Graph returns current state, not an offline edit archive. Retain explicit missed coverage.
    await this.options.recordGap(c,'teams_missed_notifications',1);
    const currentResource=(await this.options.store.resources(c)).find(r=>r.handle===lease.value.resource.handle),boundary=currentResource?.recoveryAfter??c.activationAt;
    if(!boundary||!currentResource)throw new ProviderHttpError('source_unavailable');
    // Stable Graph requires matching lastModifiedDateTime order/filter. createdDateTime gt and $select are unsupported.
    const token=await this.token(c,signal),result=await this.client.get(`/v1.0${teamsResource(currentResource.chatId)}`,token,signal,new URLSearchParams({'$top':'10','$orderby':'lastModifiedDateTime desc','$filter':`lastModifiedDateTime gt ${boundary}`}));
    if(!teamsRecord(result)||!Array.isArray(result.value)||result.value.length>10)throw new ProviderHttpError('malformed_response');
    for(const raw of result.value){if(!teamsRecord(raw)||typeof raw.id!=='string'||typeof raw.createdDateTime!=='string'||!Number.isFinite(Date.parse(raw.createdDateTime))||typeof raw.lastModifiedDateTime!=='string'||!Number.isFinite(Date.parse(raw.lastModifiedDateTime)))throw new ProviderHttpError('malformed_response');if(Date.parse(raw.createdDateTime)>=Date.parse(boundary)&&Date.parse(raw.lastModifiedDateTime)>Date.parse(boundary))await this.options.store.saveManualReference(c,currentResource,raw.id,raw.createdDateTime,true);else await this.options.recordGap(c,'teams_recovery_preboundary_omitted',1);}
    if(result['@odata.nextLink'])await this.options.recordGap(c,'teams_recovery_partial',1);
    await this.options.store.finishMaintenance(lease,{});return;
   }
   if(lease.kind==='create'||lease.kind==='recreate'){if(lease.kind==='recreate')await this.options.recordGap(c,'teams_subscription_removed',1);await this.createSubscription(c,lease.value.resource,signal,lease);return;}
   const token=await this.token(c,signal),expirationDateTime=new Date(this.now().getTime()+2*86400000).toISOString();
   // PATCH renews and reauthorizes; never call reauthorize as a second operation within ten minutes.
   const result=await this.client.request(`/v1.0/subscriptions/${encodeURIComponent(teamsId(lease.value.id))}`,token,signal,'PATCH',{expirationDateTime});
   if(!teamsRecord(result)||result.id!==lease.value.id||typeof result.expirationDateTime!=='string')throw new ProviderHttpError('malformed_response');await this.options.store.finishMaintenance(lease,{expiresAt:result.expirationDateTime});
  }catch(error){await this.options.store.finishMaintenance(lease,{failed:true,recreate:lease.kind==='renew'&&error instanceof ProviderHttpError&&error.code==='provider_not_found',retryAfterMs:error instanceof ProviderHttpError?error.retryAfterMs:undefined});await this.options.recordGap(c,lease.attempts>=2?'teams_subscription_retries_exhausted':'teams_subscription_maintenance_failed',1);throw error;}
 }
 async pullChanges(c:SavedConnection,cursor:SyncCursor|null,budget:SyncBudget,signal:AbortSignal):Promise<ProviderPage>{
  if(!this.options.automaticEnabled()||c.mode==='manual'||c.status!=='active')throw new ConnectorStoreError('service_disabled');
  // Expired saved authority requires explicit discovery/reselection. An empty
  // local resource list must never masquerade as a successful empty provider page.
  const selected=await this.options.store.resources(c),missing=c.scope.filter(handle=>!selected.some(resource=>resource.handle===handle));
  if(missing.length){await this.options.recordGap(c,'teams_selection_expired',missing.length);throw new ProviderHttpError('source_unavailable');}
  if(this.now().getTime()>=budget.deadlineAtMs-3000)throw new ProviderHttpError('provider_timeout');await this.maintain(c,signal);
  const page=await this.options.store.events(c,cursor?.pageState??cursor?.cursor??'0',Math.min(50,budget.maxItemIds));
  for(const item of page.items){const pointer=await this.options.store.reference(c,item);if(pointer.changeType==='deleted')await this.options.deleteItem(c,item.id);}
  return page.items.length===50?{items:page.items,pageState:page.cursor,complete:false,gaps:[]}:{items:page.items,pageState:null,finalCursor:page.cursor,complete:true,gaps:[]};
 }
 async readItem(c:SavedConnection,reference:ProviderItemRef,signal:AbortSignal){
  const pointer=await this.options.store.reference(c,reference);
  if(pointer.changeType==='deleted'){await this.options.deleteItem(c,reference.id);throw new ProviderHttpError('source_unavailable');}
  const token=await this.token(c,signal),raw=await this.client.get(`/v1.0${teamsResource(pointer.resource.chatId)}/${encodeURIComponent(teamsId(pointer.messageId))}`,token,signal,undefined,2*1024*1024);
  const latest=await this.options.store.reference(c,reference);if(latest.changeType==='deleted'){await this.options.deleteItem(c,reference.id);throw new ProviderHttpError('source_unavailable');}
  if(!teamsRecord(raw)||raw.id!==pointer.messageId||raw.chatId!==undefined&&raw.chatId!==pointer.resource.chatId)throw new ProviderHttpError('malformed_response');
  if(raw.deletedDateTime){await this.options.deleteItem(c,reference.id);throw new ProviderHttpError('source_unavailable');}
  return parseTeamsMessage(raw,reference.id);
 }
 nextQuery(link:string,path:string){
  if(link.length>16000)throw new ProviderHttpError('invalid_cursor');let url:URL;try{url=new URL(link);}catch{throw new ProviderHttpError('invalid_cursor');}
  if(url.origin!=='https://graph.microsoft.com'||url.pathname!==path||url.username||url.password||url.hash||[...url.searchParams.keys()].some(key=>!['$skiptoken','$top','$orderby','$select'].includes(key)))throw new ProviderHttpError('invalid_cursor');return url.searchParams;
 }
 async revoke(c:SavedConnection,signal:AbortSignal){try{await this.cleanup(c,signal);return {status:'unavailable' as const,reason:'teams_remove_consent_in_microsoft'};}catch{return {status:'unavailable' as const,reason:'teams_subscription_cleanup_pending'};}}
}
