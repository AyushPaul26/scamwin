import type { ScamwinStore } from '../contracts';
import type { runInvestigation } from '../pipeline';
import type { ConnectorStore } from './contracts';
import type { ConnectorRuntimeStore } from './runtime-store';
import { reconcileConnectorJobs } from './reconcile';
import { runConnectorTarget } from './runner';
export interface DrainDependencies {
  connectorStore:ConnectorStore;mainStore:ScamwinStore;runtime:ConnectorRuntimeStore;
  automaticEnabled:boolean;now?:()=>Date;loadPipeline?:()=>Promise<typeof runInvestigation>;
}
/** Reconcile independently, load worker before admission, then execute exactly the leased connector child. */
export async function connectorDrain(deps:DrainDependencies,signal:AbortSignal){
  const now=deps.now??(()=>new Date());
  await reconcileConnectorJobs(now(),deps);signal.throwIfAborted();
  if(!(await deps.runtime.reserveUsage({calls:0,bytes:0,computeMs:1000})).allowed)return {status:'runtime_quota_paused',count:0};
  const run=await (deps.loadPipeline?deps.loadPipeline():import('../pipeline').then(p=>p.runInvestigation));
  signal.throwIfAborted();
  const lease=await deps.connectorStore.leaseDueJob(300000,false,!deps.automaticEnabled);
  if(!lease)return {status:'idle',count:0};
  const allowance=await deps.runtime.reserveUsage({calls:0,bytes:0,computeMs:299000});
  if(!allowance.allowed){await deps.connectorStore.finishJob(lease,{status:'deferred',reason:'runtime_quota_paused',retryAt:new Date(now().getTime()+1800000).toISOString()});return {status:'runtime_quota_paused',count:0};}
  const outcome=await runConnectorTarget(lease,{...deps,workerReady:true,signal,run,now});
  return {status:outcome.status,count:1};
}
