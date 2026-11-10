import { createHash } from 'node:crypto';
import { z } from 'zod';
import { verifyDispatch } from './crypto';
export const TICK_DEADLINE_MS=50000, DRAIN_DEADLINE_MS=290000;
export type DispatchAction='tick'|'drain';
const envelope=z.object({version:z.literal(1),action:z.enum(['tick','drain']),deliveryId:z.string().uuid()}).strict();
export interface DispatchDependencies {
  enabled:boolean;secret?:string;now?:()=>number;timeoutMs?:number;
  consume:(id:string)=>Promise<boolean>;
  work:(signal:AbortSignal,deadlineAtMs:number)=>Promise<{status:string;count:number}>;
}
const response=(status:number,reason:string,count=0)=>Response.json({status:reason,count},{status,headers:{'Cache-Control':'private, no-store'}});
export function createConnectorDispatchHandler(action:DispatchAction,deps:DispatchDependencies){
  return async(request:Request)=>{
    if(!deps.enabled||!deps.secret||[...deps.secret].length<32)return response(503,'disabled');
    const now=deps.now??Date.now,controller=new AbortController(),deadline=now()+Math.min(deps.timeoutMs??Infinity,action==='tick'?TICK_DEADLINE_MS:DRAIN_DEADLINE_MS);
    const timer=setTimeout(()=>controller.abort(),Math.max(1,deadline-now()));
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    const wait=async<T>(pending:Promise<T>):Promise<T>=>{
      controller.signal.throwIfAborted();let abort!:()=>void;
      const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(Error('deadline'));controller.signal.addEventListener('abort',abort,{once:true});});
      try{return await Promise.race([pending,stopped]);}finally{controller.signal.removeEventListener('abort',abort);}
    };
    try{
      if(request.method!=='POST')return response(405,'method_not_allowed');
      if(Number(request.headers.get('Content-Length'))>2048)return response(413,'body_too_large');
      reader=request.body?.getReader();if(!reader)return response(400,'invalid_dispatch');
      const chunks:Uint8Array[]=[];let size=0;
      while(true){
        const value=await wait(reader.read());
        if(value.done)break;size+=value.value.length;if(size>2048)return response(413,'body_too_large');chunks.push(value.value);
      }
      const body=Buffer.concat(chunks,size).toString('utf8');
      if(!verifyDispatch(body,request.headers.get('X-Scamwin-Dispatch-Signature')??'',createHash('sha256').update(deps.secret).digest(),now()))return response(401,'invalid_signature');
      let parsed:z.infer<typeof envelope>;try{parsed=envelope.parse(JSON.parse(body));}catch{return response(400,'invalid_dispatch');}
      if(parsed.action!==action)return response(400,'invalid_dispatch');
      if(!await wait(deps.consume(parsed.deliveryId)))return response(409,'replayed_dispatch');
      controller.signal.throwIfAborted();
      const result=await wait(deps.work(controller.signal,deadline));
      // Only public status/count is serializable, even when an injected implementation has extra fields.
      return response(200,/^[a-z][a-z0-9_]{0,79}$/.test(result.status)?result.status:'completed',Number.isSafeInteger(result.count)&&result.count>=0?result.count:0);
    }catch{return response(503,controller.signal.aborted?'deadline':'deferred');}
    finally{clearTimeout(timer);void reader?.cancel().catch(()=>{});}
  };
}
