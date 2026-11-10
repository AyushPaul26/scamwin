import {ConnectorStoreError} from './store';
/** Streaming byte and deadline limits cover headers and bodies, even a transport ignoring abort. */
export async function driveBoundedRequest(fetcher:typeof fetch,url:string,init:RequestInit,maxBytes:number,signal:AbortSignal){
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(10000)]);
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const work=async()=>{
  const r=await fetcher(url,{...init,redirect:'error',cache:'no-store',signal:bounded});
  const cancel=()=>{void r.body?.cancel().catch(()=>{});};
  if(bounded.aborted){cancel();throw new ConnectorStoreError('provider_timeout');}
  if(r.redirected||r.status>=300&&r.status<400||r.url&&r.url!==url){cancel();throw new ConnectorStoreError('provider_rejected');}
  if(!r.ok){cancel();throw new ConnectorStoreError(r.status===410?'cursor_expired':r.status===401?'reconnect_required':r.status===404?'source_unavailable':'provider_denied');}
  const length=r.headers.get('content-length');
  if(length&&(!/^\d+$/.test(length)||Number(length)>maxBytes)){cancel();throw new ConnectorStoreError('response_too_large');}
  reader=r.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
  if(reader)while(true){const p=await reader.read();if(bounded.aborted)throw new ConnectorStoreError('provider_timeout');if(p.done)break;size+=p.value.byteLength;if(size>maxBytes)throw new ConnectorStoreError('response_too_large');chunks.push(p.value);}
  return Buffer.concat(chunks);
 };
 let rejectAbort:()=>void=()=>{};
 const stopped=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(new ConnectorStoreError('provider_timeout'));bounded.addEventListener('abort',rejectAbort,{once:true});if(bounded.aborted)rejectAbort();});
 try{return await Promise.race([work(),stopped]);}
 finally{bounded.removeEventListener('abort',rejectAbort);void reader?.cancel().catch(()=>{});reader?.releaseLock();}
}
