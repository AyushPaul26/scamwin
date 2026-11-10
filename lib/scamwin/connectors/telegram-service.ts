import {z} from 'zod';
import type {ConnectorStore,ConnectionRef} from './contracts';
import {connectionSettingsSchema} from './contracts';
import {ConnectorStoreError,type ConnectorDatabase} from './store';
import {TelegramBindingStore,telegramUserId,type TelegramBusiness} from './telegram-store';
import {parseTelegramMessage,telegramRecord,telegramChatId} from './providers/telegram';

const fail=(code:string):never=>{throw new ConnectorStoreError(code);};
export interface TelegramServiceOptions{
 username:string;enabled:()=>boolean;now?:()=>Date;
 automaticEnabled?:()=>boolean;
 getBusinessConnection:(id:string,signal:AbortSignal)=>Promise<unknown>;
 stageRevision:(ref:ConnectionRef,revisionId:string)=>Promise<void>;
 deleteItem:(ref:ConnectionRef,itemId:string,database:ConnectorDatabase)=>Promise<void>;
}
export type TelegramOutcome={status:'linked'|'bound'|'unbound'|'ignored'|'gap'|'saved'|'deleted'|'disabled';count?:number};
function business(value:unknown,allowMutationRights=false):TelegramBusiness{
 if(!telegramRecord(value)||typeof value.id!=='string'||!value.id.length||value.id.length>200||!telegramRecord(value.user)||!Number.isSafeInteger(value.date)||Number(value.date)<0||typeof value.is_enabled!=='boolean')return fail('telegram_malformed_update');
 telegramUserId(value.user.id);telegramChatId(value.user_chat_id);
 if(value.rights!==undefined&&!telegramRecord(value.rights))return fail('telegram_malformed_update');
 if(telegramRecord(value.rights)&&(Object.keys(value.rights).length>30||Object.keys(value.rights).some(k=>!/^[a-z_]{1,80}$/.test(k))))return fail('telegram_malformed_update');
 // can_read_messages is a mark-as-read mutation; it is not required for content receipt.
 const mutationRights=telegramRecord(value.rights)&&Object.values(value.rights).some(v=>v!==false&&v!==undefined);
 if(mutationRights&&!allowMutationRights)return fail('telegram_mutation_rights');
 return {id:value.id,user:{id:telegramUserId(value.user.id)},user_chat_id:telegramChatId(value.user_chat_id),date:Number(value.date),is_enabled:value.is_enabled,...(telegramRecord(value.rights)?{rights:mutationRights?{can_mutate:true}:{}}:{})};
}
/** Server-only API. Authenticated website callers supply their Auth0 subject, never a Telegram identity. */
export class TelegramService{
 constructor(private readonly core:ConnectorStore,readonly bindings:TelegramBindingStore,private readonly options:TelegramServiceOptions){}
 private now(){return this.options.now?.()??new Date();}
 private async owned(subject:string,id:string,epoch:number){
  const c=await this.core.getConnection(subject,id);
  if(!c||c.provider!=='telegram')return fail('connection_unavailable');
  if(c.status==='disconnected'&&await this.bindings.wasLinkExpired(c))return fail('telegram_link_expired_relink_required');
  if(c.epoch!==epoch||c.status==='disconnected')return fail('connection_unavailable');
  if(await this.bindings.expire(c))return fail('telegram_link_expired_relink_required');
  return c;
 }
 async beginTelegramLink(subject:string,id:string,epoch:number){
  if(!this.options.enabled())return fail('provider_unavailable');
  if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(this.options.username))return fail('provider_unavailable');
  const c=await this.owned(subject,id,epoch);
  if(c.mode!=='manual')return fail('telegram_manual_link_required');
  const proof=await this.core.readIdentityProof(c);if(!proof||proof.provider!=='telegram')return fail('telegram_identity_required');
  const {nonce,expiresAt}=await this.bindings.begin(c,proof);return {deepLink:`https://t.me/${this.options.username}?start=${nonce}`,expiresAt};
 }
 async status(subject:string,id:string,epoch:number){
  const c=await this.owned(subject,id,epoch),link=await this.bindings.get(c);
  return {state:!link?.started?'identity_only':link.disabled?'automation_disabled':link.business?.is_enabled?'automation_connected':'awaiting_automation',mode:c.mode,paused:c.status==='paused',epoch:c.epoch,contains:c.rules.contains?.join('\n')??'',automaticDailyLimit:c.automaticDailyLimit,coverage:'Selected private chats authorized in Telegram. No inbox history. Bot-to-bot coverage is unverified until the controlled pilot.',enabled:this.options.enabled(),automaticEnabled:this.options.automaticEnabled?.()??this.options.enabled()};
 }
 async configure(subject:string,id:string,epoch:number,input:unknown){
  if(!this.options.enabled())return fail('provider_unavailable');
  const c=await this.owned(subject,id,epoch),settings=connectionSettingsSchema.parse(input);
  if(settings.scope.length!==1||settings.scope[0]!=='identity')return fail('invalid_scope');
  const link=await this.bindings.get(c);
  if(settings.mode!=='manual'){
   if(!(this.options.automaticEnabled?.()??this.options.enabled()))return fail('service_disabled');
   if(!settings.consent||!link?.started||link.disabled||!link.business?.is_enabled)return fail('telegram_automation_required');
   const verified=business(await this.options.getBusinessConnection(link.business.id,AbortSignal.timeout(10000)));
   if(verified.id!==link.business.id||telegramUserId(verified.user.id)!==link.userId||!verified.is_enabled)return fail('telegram_automation_required');
  }
  const next=await this.bindings.serialize(c,async(bindings,core)=>{
   const current=await core.getConnection(subject,id);if(!current||current.epoch!==epoch)return fail('stale_connection');
   const baseline=settings.mode!=='manual'?{cursor:'telegram:no-history',capturedAt:this.now().toISOString()}:undefined;
   const saved=await core.configureConnection(c,settings,baseline);
   if(link?.business?.is_enabled)await bindings.carryEpoch(c,saved);
   if(settings.mode!=='manual'&&!settings.paused)await bindings.setCoverageBoundary(saved);
   if(c.status==='paused'&&!settings.paused||c.mode==='manual'&&settings.mode!=='manual')await core.recordCoverageGap(saved,'telegram_history_recovery_unavailable',1);
   return saved;
  });return {epoch:next.epoch,mode:next.mode,paused:next.status==='paused'};
 }
 async handleUpdate(input:unknown):Promise<TelegramOutcome>{
  if(!telegramRecord(input)||!Number.isSafeInteger(input.update_id)||Number(input.update_id)<0)return fail('telegram_malformed_update');
  const updateId=Number(input.update_id);
  if(input.message!==undefined){
   const message=input.message;
   if(!telegramRecord(message)||!telegramRecord(message.chat)||!telegramRecord(message.from)||message.chat.type!=='private'||telegramChatId(message.chat.id)!==telegramUserId(message.from.id)||typeof message.text!=='string'||!/^\/start [A-Za-z0-9_-]{43}$/.test(message.text))return fail('telegram_link_unavailable');
   const link=await this.bindings.consumeStart(message.text.slice(7),message.from.id,updateId);
   if(link.startCompleted)return {status:'linked'};
   // A connection that arrived before /start is only a hint. Query current Bot API state.
   for(const pending of await this.bindings.pendingForUser(link.userId)){
    const verified=business(await this.options.getBusinessConnection(pending.business.id,AbortSignal.timeout(10000)));
    if(verified.id!==pending.business.id||telegramUserId(verified.user.id)!==link.userId||!verified.is_enabled)continue;
    await this.bindings.bindBusiness(link.ref,verified,pending.updateId);break;
   }
   await this.bindings.completeStart(message.text.slice(7),message.from.id,updateId);
   return {status:'linked'};
  }
  if(input.business_connection!==undefined){
   const connection=business(input.business_connection,true),mutationRights=connection.rights?.can_mutate===true;
   const link=await this.bindings.forBusiness(connection.id)??await this.bindings.forUser(connection.user.id);
   if(mutationRights&&!link?.business)return fail('telegram_mutation_rights');
   if(!link){await this.bindings.pending(connection,updateId);return {status:'unbound'};}
   return this.bindings.serialize(link.ref,async(bindings,core)=>{
    const updated=await bindings.bindBusiness(link.ref,mutationRights?{...connection,is_enabled:false}:connection,updateId);if(!updated)return {status:'ignored'};
    if(mutationRights||!connection.is_enabled){await core.revokeConnection(link.ref.ownerId,link.ref.id,link.ref.epoch);return {status:'disabled'};}
    return {status:'bound'};
   });
  }
  const event=input.business_message??input.edited_business_message??input.deleted_business_messages;
  if(!telegramRecord(event)||typeof event.business_connection_id!=='string'||event.business_connection_id.length>200)return {status:'ignored'};
  const link=await this.bindings.forBusiness(event.business_connection_id);if(!link||!link.started||link.disabled||!link.business?.is_enabled)return {status:'unbound'};
  let staged:string|null=null;
  const outcome=await this.bindings.serialize(link.ref,async(bindings,core,database):Promise<TelegramOutcome>=>{
   const c=await core.getConnection(link.ref.ownerId,link.ref.id);if(!c||c.epoch!==link.ref.epoch||c.status==='disconnected')return {status:'ignored'};
   const live=await bindings.get(c);if(!live?.business?.is_enabled||live.disabled||live.business.id!==event.business_connection_id)return {status:'unbound'};
   if(!telegramRecord(event.chat)||event.chat.type!=='private'){await core.recordCoverageGap(c,'telegram_non_private_chat_excluded',1);return {status:'gap'};}
   if(input.deleted_business_messages!==undefined){
    if(!Array.isArray(event.message_ids)||event.message_ids.length>1000||!event.message_ids.every(id=>Number.isSafeInteger(id)&&id>0))return fail('telegram_malformed_update');
    let count=0;for(const id of event.message_ids){const itemId=`${telegramChatId(event.chat.id)}:${id}`;if(await bindings.saveEvent(c,itemId,updateId,null,true)==='saved'){await this.options.deleteItem(c,itemId,database);count++;}}
    return {status:'deleted',count};
   }
   // Drop body before parsing/normalization whenever ingestion is disabled.
   if(!this.options.enabled()||!(this.options.automaticEnabled?.()??true)||c.mode==='manual'||c.status!=='active'||!c.activationAt){
    if(!Number.isSafeInteger(event.message_id)||Number(event.message_id)<=0)return fail('telegram_malformed_update');
    const saved=await bindings.saveEvent(c,`${telegramChatId(event.chat.id)}:${event.message_id}`,updateId,null);
    if(saved!=='saved')return {status:'ignored'};
    await core.recordCoverageGap(c,'telegram_history_recovery_unavailable',1);return {status:'gap'};
   }
   const eventTime=Number(event.edit_date??event.date);
   if(!Number.isSafeInteger(eventTime)||eventTime*1000<Math.max(Date.parse(c.activationAt),live.coverageAt?Date.parse(live.coverageAt):0)||eventTime*1000>this.now().getTime()+60000){await core.recordCoverageGap(c,'telegram_outside_activation',1);return {status:'gap'};}
   const value=parseTelegramMessage(event,updateId,this.now().toISOString());
   const delivery=await bindings.saveEvent(c,value.item.providerItemId,updateId,value);
   if(delivery==='stale'||delivery==='discarded')return {status:'ignored'};
   const saved=await core.saveRevision(c,value.item);staged=saved.revision.id;return {status:'saved'};
  });
  if(staged)await this.options.stageRevision(link.ref,staged);return outcome;
 }
}
export const telegramSetupInput=z.object({id:z.string().min(1).max(200),epoch:z.number().int().positive()}).strict();
