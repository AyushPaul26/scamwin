import {ConnectorStoreError} from './store';
/** A Graph validation challenge proves only callback reachability; normal notifications always use saved bindings. */
export async function teamsWebhook(request:Request,deps:{enabled:()=>boolean;handle:(value:unknown)=>Promise<unknown>}):Promise<Response>{
 const headers={'Cache-Control':'no-store'};
 const url=new URL(request.url),tokens=url.searchParams.getAll('validationToken');
 if(request.method!=='POST')return new Response(null,{status:405,headers});
 if(tokens.length){const token=tokens[0];if(tokens.length!==1||!token||Buffer.byteLength(token)>2048||/[\x00-\x1f\x7f]/.test(token))return new Response(null,{status:400,headers});return new Response(token,{status:200,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});}
 const length=request.headers.get('Content-Length');if(length&&(!/^\d+$/.test(length)||Number(length)>262144))return new Response(null,{status:413,headers});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return new Response(null,{status:415,headers});
 // Gates off still authenticate and discard body-free references through the service, never parse resourceData as source content.
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 try{
  if(!request.body)return new Response(null,{status:400,headers});reader=request.body.getReader();
  const read=async()=>{const chunks:Uint8Array[]=[];let bytes=0;while(true){const part=await reader!.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>262144)throw new ConnectorStoreError('response_too_large');chunks.push(part.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));};
  const process=async()=>{const value=await read();await deps.handle(value);return new Response(null,{status:202,headers});};
  // A slow database gets no acknowledgement. An eventual commit can be safely retried by Graph;
  // source revision hashes dedupe the body later, while no response invents durable completion.
  return await Promise.race([process(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ConnectorStoreError('provider_timeout')),8000);})]);
 }catch(error){const code=error instanceof ConnectorStoreError?error.code:'';return new Response(null,{status:code==='response_too_large'?413:['teams_notification_invalid','teams_resource_invalid'].includes(code)||error instanceof SyntaxError?400:503,headers});}
 finally{clearTimeout(timer);if(reader)void reader.cancel().catch(()=>{});}
}
