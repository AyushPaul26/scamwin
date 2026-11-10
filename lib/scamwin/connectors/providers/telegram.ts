import {createHash} from 'node:crypto';
import type {ProviderAdapter,ProviderItem,ProviderItemRef,SavedConnection,RevocationResult} from '../contracts';
import {ProviderHttpError} from '../provider-http';
import {boundManifest} from '../policy';
import {TelegramBindingStore,type TelegramEventValue,type TelegramFile,telegramUserId} from '../telegram-store';

export const telegramRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const telegramDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const RASTER=new Set(['image/jpeg','image/png','image/webp']),MAX_FILE=10*1024*1024;
export function telegramChatId(value:unknown):string{
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value!==0)return String(value);
 if(typeof value==='string'&&/^-?[1-9]\d{0,18}$/.test(value)&&BigInt(value)>=-9223372036854775808n&&BigInt(value)<=9223372036854775807n)return value;
 throw new ProviderHttpError('malformed_response');
}
/** Discards participant profile data. File IDs stay in encrypted provider storage, never in model content. */
export function parseTelegramMessage(message:Record<string,unknown>,updateId:number,receivedAt:string):TelegramEventValue{
 if(!telegramRecord(message.chat)||message.chat.type!=='private'||!Number.isSafeInteger(message.message_id)||Number(message.message_id)<=0)throw new ProviderHttpError('source_unavailable');
 const itemId=`${telegramChatId(message.chat.id)}:${message.message_id}`;
 const text=[message.text,message.caption].filter((v):v is string=>typeof v==='string').join('\n');
 const urls:string[]=[];const diagnostics:{reason:string;count:number}[]=[];
 for(const [entities,source] of [[message.entities,message.text],[message.caption_entities,message.caption]] as const){
  if(!Array.isArray(entities))continue;
  for(const entity of entities.slice(0,1000)){
   if(!telegramRecord(entity))continue;
   if(entity.type==='text_link'&&typeof entity.url==='string'&&entity.url.length<=4096)urls.push(entity.url);
   else if(entity.type==='url'&&typeof source==='string'&&Number.isSafeInteger(entity.offset)&&Number.isSafeInteger(entity.length)&&Number(entity.offset)>=0&&Number(entity.length)>0){const url=source.slice(Number(entity.offset),Number(entity.offset)+Number(entity.length));if(url.length<=4096)urls.push(url);}
  }
  if(entities.length>1000)diagnostics.push({reason:'telegram_entity_limit',count:entities.length-1000});
 }
 // Plain URLs remain independently visible even when Telegram entity metadata is absent.
 for(const match of text.matchAll(/https?:\/\/[^\s<>"']+/g))if(match[0].length<=4096)urls.push(match[0]);
 const attachments:ProviderItem['attachments']=[],files:TelegramFile[]=[];
 const add=(raw:unknown,mediaType:string,name:string)=>{
  if(!telegramRecord(raw)||typeof raw.file_id!=='string'||raw.file_id.length>4096||!raw.file_id.length){diagnostics.push({reason:'attachment_metadata_unavailable',count:1});return;}
  const size=Number.isSafeInteger(raw.file_size)&&Number(raw.file_size)>0?Number(raw.file_size):0;
  const id=`tg-file-${telegramDigest([itemId,raw.file_unique_id??raw.file_id])}`;
  const supported=RASTER.has(mediaType)&&size>0&&size<=MAX_FILE;
  attachments.push({id,name:name.slice(0,200),mediaType,supported,...(size?{byteLength:size}:{})});files.push({id,fileId:raw.file_id,mediaType,size});
 };
 if(Array.isArray(message.photo)&&message.photo.length){const variants=message.photo.filter(telegramRecord);const largest=variants.sort((a,b)=>Number(b.file_size??0)-Number(a.file_size??0))[0];add(largest,'image/jpeg','photo.jpg');}
 for(const kind of ['document','video','animation','audio','voice','video_note','sticker'] as const){
  const raw=message[kind];if(raw!==undefined)add(raw,telegramRecord(raw)&&typeof raw.mime_type==='string'?raw.mime_type.toLowerCase().slice(0,150):kind==='sticker'?'application/x-telegram-sticker':'application/octet-stream',telegramRecord(raw)&&typeof raw.file_name==='string'?raw.file_name:kind);
 }
 if(attachments.length)diagnostics.push({reason:'attachment_not_analyzed',count:attachments.length});
 if(['poll','location','venue','contact','dice','game','invoice','paid_media','story','checklist','passport_data'].some(k=>message[k]!==undefined))diagnostics.push({reason:'telegram_unsupported_content',count:1});
 if(message.reply_to_message!==undefined||message.external_reply!==undefined||message.quote!==undefined)diagnostics.push({reason:'telegram_reply_context_unavailable',count:1});
 if(!text&&!attachments.length&&!diagnostics.length)diagnostics.push({reason:'telegram_unsupported_content',count:1});
 const bounded=boundManifest({text,urls,attachments});
 if(Object.values(bounded.overflow).some(Boolean))diagnostics.push({reason:'parser_limit',count:1});
 const item:ProviderItem={providerItemId:itemId,deliveryId:`telegram:${updateId}`,revisionHash:telegramDigest({text:bounded.text,urls:bounded.urls,attachments:bounded.attachments,diagnostics}),receivedAt,text:bounded.text,urls:bounded.urls.map(u=>u.original),attachments:bounded.attachments,extraction:{coverage:diagnostics.length?'partial':'complete',diagnostics,overflow:bounded.overflow}};
 return {item,files:files.filter(f=>item.attachments.some(a=>a.id===f.id))};
}
export interface TelegramAdapterOptions{
 bindings:TelegramBindingStore;botToken:string;enabled:()=>boolean;fetch?:typeof fetch;now?:()=>Date;
}
async function boundedBytes(response:Response,max:number):Promise<Uint8Array>{
 if(!response.ok||!response.body)throw new ProviderHttpError('provider_denied');
 const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>max))throw new ProviderHttpError('response_too_large');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max)throw new ProviderHttpError('response_too_large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
/** Only fixed Bot API methods and saved provider file IDs can select fetch authority. */
export class TelegramBotClient{
 constructor(private readonly token:string,private readonly fetcher:typeof fetch=fetch){if(!/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(token))throw new ProviderHttpError('provider_rejected');}
 async method(method:'getBusinessConnection'|'getFile',input:Record<string,string>,signal:AbortSignal){
  try{
   const response=await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
   const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(response,65536)));
   if(!telegramRecord(value)||value.ok!==true||!telegramRecord(value.result))throw new Error();return value.result;
  }catch{throw new ProviderHttpError(signal.aborted?'provider_aborted':'provider_network');}
 }
 async download(filePath:string,max:number,signal:AbortSignal){
  if(!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(filePath)||filePath.includes('..')||filePath.length>1000)throw new ProviderHttpError('attachment_unavailable');
  try{return await boundedBytes(await this.fetcher(`https://api.telegram.org/file/bot${this.token}/${filePath}`,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])}),max);}catch{throw new ProviderHttpError(signal.aborted?'provider_aborted':'attachment_unavailable');}
 }
}
/** Push-only account automation. No inbox history, polling or group-installation coverage is claimed. */
export class TelegramAdapter implements ProviderAdapter{
 readonly capabilities={pull:false,history:false,selectedItem:false,push:true,edits:true,attachments:true};
 private readonly client:TelegramBotClient;
 constructor(private readonly options:TelegramAdapterOptions){this.client=new TelegramBotClient(options.botToken,options.fetch);}
 async pullChanges():Promise<never>{throw new ProviderHttpError('source_unavailable');}
 async revoke():Promise<RevocationResult>{return {status:'unavailable',reason:'remove_bot_in_telegram_settings'};}
 private async current(c:SavedConnection,signal:AbortSignal){
  if(signal.aborted)throw new ProviderHttpError('provider_aborted');
  if(!this.options.enabled()||c.provider!=='telegram'||c.status!=='active'||c.mode==='manual')throw new ProviderHttpError('source_unavailable');
  const link=await this.options.bindings.get(c);if(!link?.started||link.disabled||!link.business?.is_enabled)throw new ProviderHttpError('source_unavailable');
  if(!await this.options.bindings.canRead(c))throw new ProviderHttpError('source_unavailable');
 }
 async readItem(c:SavedConnection,reference:ProviderItemRef,signal:AbortSignal){
  await this.current(c,signal);const value=await this.options.bindings.readEvent(c,reference.id,reference.version);if(!value)throw new ProviderHttpError('source_unavailable');return value.item;
 }
 async readAttachment(c:SavedConnection,reference:ProviderItemRef,attachment:ProviderItem['attachments'][number],budget:{maxBytes:number;deadlineAtMs:number},signal:AbortSignal){
  await this.current(c,signal);const maximum=Math.min(MAX_FILE,budget.maxBytes);
  const remaining=budget.deadlineAtMs-(this.options.now?.()??new Date()).getTime();
  if(!Number.isSafeInteger(maximum)||maximum<=0||remaining<=0||!attachment.supported||!RASTER.has(attachment.mediaType))throw new ProviderHttpError('attachment_unavailable');
  const timeoutSignal=AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(remaining,20000)))]);
  const value=await this.options.bindings.readEvent(c,reference.id,reference.version);
  const file=value?.files.find(f=>f.id===attachment.id),saved=value?.item.attachments.find(a=>a.id===attachment.id);
  if(!file||!saved||!saved.supported||file.mediaType!==attachment.mediaType||file.size!==attachment.byteLength||file.size>maximum)throw new ProviderHttpError('attachment_unavailable');
  const raw=await this.client.method('getFile',{file_id:file.fileId},timeoutSignal);
  if(raw.file_id!==file.fileId||typeof raw.file_path!=='string'||!Number.isSafeInteger(raw.file_size)||Number(raw.file_size)>maximum)throw new ProviderHttpError('attachment_unavailable');
  // Revalidate after provider metadata and again before returning downloaded bytes.
  await this.current(c,timeoutSignal);const bytes=await this.client.download(raw.file_path,maximum,timeoutSignal);await this.current(c,timeoutSignal);return bytes;
 }
}
export {telegramUserId};
