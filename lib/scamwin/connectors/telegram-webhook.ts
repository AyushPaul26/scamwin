import {timingSafeEqual} from 'node:crypto';
import {ConnectorStoreError} from './store';

const MAX_UPDATE_BYTES=512*1024;
/** Authentication precedes even opening the request stream. Never echoes provider text or errors. */
export async function telegramWebhook(request:Request,deps:{secret:string|undefined;handle:(value:unknown)=>Promise<unknown>}):Promise<Response>{
 const headers={'Cache-Control':'no-store'};
 if(!deps.secret||!/^[A-Za-z0-9_-]{32,256}$/.test(deps.secret))return Response.json({ok:false},{status:503,headers});
 const provided=request.headers.get('x-telegram-bot-api-secret-token');
 if(!provided||!/^[A-Za-z0-9_-]+$/.test(provided)||provided.length!==deps.secret.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(deps.secret)))return Response.json({ok:false},{status:401,headers});
 const length=request.headers.get('content-length');
 if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_UPDATE_BYTES))return Response.json({ok:false},{status:413,headers});
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return Response.json({ok:false},{status:415,headers});
 let value:unknown;
 try{
  if(!request.body)return Response.json({ok:false},{status:400,headers});
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_UPDATE_BYTES)return Response.json({ok:false},{status:413,headers});chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 }catch{return Response.json({ok:false},{status:400,headers});}
 try{await deps.handle(value);return Response.json({ok:true},{status:200,headers});}
 catch(error){
  const malformed=error instanceof ConnectorStoreError&&['telegram_malformed_update','telegram_identity_mismatch','telegram_link_unavailable','telegram_mutation_rights','telegram_connection_mismatch'].includes(error.code);
  return Response.json({ok:false},{status:malformed?400:503,headers});
 }
}
