import {z} from 'zod';
import {verifySlackRequest} from './slack-protocol';
import {ConnectorStoreError} from './store';
import type {ConnectorStore,SavedConnection} from './contracts';
import type {ConnectorRuntimeStore} from './runtime-store';
import type {SlackStore} from './slack-store';
const ts=z.string().regex(/^\d{10}\.\d{6}$/);
const eventSchema=z.object({type:z.literal('event_callback'),api_app_id:z.string().max(80),team_id:z.string().max(80),event_id:z.string().min(1).max(200),event_time:z.number().int().nonnegative().optional(),event:z.object({type:z.string(),channel:z.string().max(80).optional(),ts:ts.optional(),event_ts:ts.optional(),subtype:z.string().optional(),deleted_ts:ts.optional(),message:z.object({ts:ts}).passthrough().optional()}).passthrough()});
const envelopeSchema=z.union([eventSchema,z.object({type:z.literal('app_rate_limited'),api_app_id:z.string().max(80),team_id:z.string().max(80),minute_rate_limited:z.number().int().nonnegative()})]);
export class SlackWebhookService {
 constructor(private readonly deps:{store:SlackStore;core:ConnectorStore;runtime:ConnectorRuntimeStore;appId:string;automaticEnabled:boolean}){}
 async handle(value:unknown){const v=envelopeSchema.parse(value);if(v.api_app_id!==this.deps.appId)throw new ConnectorStoreError('invalid_identity');const connections=await this.deps.store.installations(v.team_id,v.api_app_id);for(const c of connections)await this.handleForConnection(c,v);}
 async handleForConnection(connection:SavedConnection,value:unknown){const v=envelopeSchema.parse(value);if(v.api_app_id!==this.deps.appId)throw new ConnectorStoreError('invalid_identity');
  if(v.type==='app_rate_limited'){
   await this.deps.store.lifecycle(connection,{teamId:v.team_id,appId:v.api_app_id,eventId:`app_rate_limited:${v.minute_rate_limited}`,eventTime:v.minute_rate_limited,kind:'app_rate_limited'});return;
  }
  const event=v.event;
  if(event.type==='app_uninstalled'||event.type==='tokens_revoked'){
   const eventTime=z.number().int().nonnegative().parse(v.event_time);
   const tokens=event.type==='tokens_revoked'?z.object({bot:z.array(z.string().max(80)).max(1000).default([]),oauth:z.array(z.string().max(80)).max(1000).optional()}).parse(event.tokens):undefined;
   await this.deps.store.lifecycle(connection,{teamId:v.team_id,appId:v.api_app_id,eventId:v.event_id,eventTime,kind:event.type,botUsers:tokens?.bot});return;
  }
  if(event.type!=='message'||!event.channel)return;const current=await this.deps.store.current(connection);const identity=await this.deps.store.identity(current);if(identity.metadata.teamId!==v.team_id||identity.metadata.appId!==v.api_app_id)throw new ConnectorStoreError('invalid_identity');const handle=await this.deps.store.selectedHandle(current,event.channel);if(!handle)return;const stamp=event.subtype==='message_deleted'?event.deleted_ts:event.subtype==='message_changed'?event.message?.ts:event.ts;if(!stamp)return;const message=event.subtype==='message_changed'?event.message:event;const edited=message?.edited as {ts?:unknown}|undefined;const revision=typeof edited?.ts==='string'&&ts.safeParse(edited.ts).success?edited.ts:stamp;const thread=typeof message?.thread_ts==='string'&&ts.safeParse(message.thread_ts).success?message.thread_ts:null;const version=thread&&thread!==stamp?`thread|${thread}|${revision}`:revision;const id=`${handle}:${stamp}`;
  // Persist no incoming text. Fetch only after membership is revalidated by the adapter.
  if(event.subtype==='message_deleted'){await this.deps.store.suppress(current,id,new Date(Number(stamp)*1000).toISOString());await this.deps.store.event(current,v.event_id,null,version,id,true);return;}
  const active=this.deps.automaticEnabled&&current.status==='active'&&current.mode!=='manual'&&!!current.activationAt&&Number(stamp)*1000>=Date.parse(current.activationAt);
  const saved=await this.deps.store.event(current,v.event_id,active?{id,version,receivedAt:new Date(Number(stamp)*1000).toISOString()}:null,version);
  if(saved&&!active)await this.deps.core.recordCoverageGap(current,'slack_delivery_not_collected',1);
 }
}
export async function slackWebhook(request:Request,deps:{secret:string;appId:string;now?:()=>number;handle:(value:unknown)=>Promise<unknown>}):Promise<Response>{
 const headers={'Cache-Control':'no-store'};if(!deps.secret||!deps.appId)return Response.json({ok:false},{status:503,headers});if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return Response.json({ok:false},{status:415,headers});
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
 try{const work=async()=>{if(!request.body)throw new Error();reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>262144)throw new Error();chunks.push(part.value);}return Buffer.concat(chunks,size);};const raw=await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error()),2000);})]);if(!verifySlackRequest(raw,request.headers.get('x-slack-request-timestamp'),request.headers.get('x-slack-signature'),deps.secret,deps.now?.()))return Response.json({ok:false},{status:401,headers});
 const value:unknown=JSON.parse(raw.toString('utf8'));if(!value||typeof value!=='object')throw new Error();const v=value as Record<string,unknown>;if(v.type==='url_verification'){if(typeof v.challenge!=='string'||v.challenge.length>200)return Response.json({ok:false},{status:400,headers});return Response.json({challenge:v.challenge},{headers});}if(v.api_app_id!==deps.appId)return Response.json({ok:false},{status:401,headers});await deps.handle(value);return Response.json({ok:true},{headers});
 }catch{return Response.json({ok:false},{status:503,headers});}finally{clearTimeout(timer);void reader?.cancel().catch(()=>{});}
}
