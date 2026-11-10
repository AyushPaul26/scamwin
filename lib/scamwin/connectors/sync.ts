import type { ConnectorStore, ProviderItemRef, SavedConnection, SyncLease } from './contracts';
import type { ConnectorRuntimeStore } from './runtime-store';
import { unavailableRevisionHash } from './runtime-store';
import type { ConnectorProviderRegistry } from './registry';
import { enqueueRevisionTargets } from './targets';
import { errorCode } from './limits';
import { ProviderHttpError } from './provider-http';

export interface SyncDependencies {connectorStore:ConnectorStore;runtime:ConnectorRuntimeStore;registry:ConnectorProviderRegistry;now?:()=>Date;automaticEnabled?:boolean}
export interface TickSummary {status:string;count:number}
export async function saveUnavailableReference(c:SavedConnection,reference:ProviderItemRef,reason:string,deps:Pick<SyncDependencies,'connectorStore'|'runtime'>,selected=false){
  const input={providerItemId:reference.id,revisionHash:unavailableRevisionHash(reference.id,reason),receivedAt:reference.receivedAt,text:'',urls:[],attachments:[],extraction:{coverage:'unavailable' as const,diagnostics:[{reason,count:1}],overflow:{textBytes:0,urls:0,attachments:0}}};
  const saved=await (selected?deps.connectorStore.saveSelectedRevision(c,input):deps.connectorStore.saveRevision(c,input));
  await deps.runtime.invalidateSource(c,saved.item.id,reason);
  return saved;
}
async function prepareOne(deps:SyncDependencies,signal:AbortSignal,deadlineAtMs:number,options:{revisionId?:string;computeReserved?:boolean}={}){
  if(!options.revisionId)await deps.runtime.discoverPreparations(deps.registry.ids());
  const prepared=await deps.runtime.claimPreparation(deps.registry.ids(),deps.automaticEnabled===false,options.revisionId);if(!prepared)return false;
  if(!options.computeReserved&&!(await deps.runtime.reserveUsage({calls:0,bytes:0,computeMs:54000})).allowed){await deps.runtime.finishPreparation(prepared,false);return false;}
  if(prepared.attempts>=3){
    // Exhaustion is a durable finalization task. Keep it leaseable until every
    // target projection commits, including recovery after a failed partial pass.
    try{
      const revision=await deps.connectorStore.getRevision(prepared.ref,prepared.revisionId),jobs=await deps.connectorStore.listRevisionJobs(prepared.ref,prepared.revisionId);
      for(const target of revision?.manifest.targets??[]){
        signal.throwIfAborted();
        if(target.status==='pending'&&!jobs.some(j=>j.targetId===target.id))await deps.connectorStore.recordTargetGap(prepared.ref,prepared.revisionId,target.id,'preparation_attempts_exhausted');
      }
      await deps.runtime.finishPreparation(prepared,true);
    }catch{await deps.runtime.finishPreparation(prepared,false);signal.throwIfAborted();}
    return true;
  }
  try{
    const adapter=deps.registry.get(prepared.ref.provider);
    await enqueueRevisionTargets(prepared.ref,prepared.revisionId,{connectorStore:deps.connectorStore,loadAttachment:adapter.readAttachment?.bind(adapter),signal,now:deps.now,deadlineAtMs});
    await deps.runtime.finishPreparation(prepared,true);
  }catch(error){
    const failure=!signal.aborted&&!['runtime_quota_paused','reconnect_required','refresh_in_progress'].includes(errorCode(error));
    await deps.runtime.finishPreparation(prepared,false,failure,error instanceof ProviderHttpError?error.retryAfterMs:undefined);
    signal.throwIfAborted();
  }
  return true;
}
/** One due connection/page; durable pending refs always precede a new provider page. */
export async function connectorTick(deps:SyncDependencies,signal:AbortSignal,deadlineAtMs:number):Promise<TickSummary>{
  const now=deps.now??(()=>new Date());signal.throwIfAborted();
  await deps.connectorStore.purgeExpired();await deps.runtime.purgeExpired();
  const allowance=await deps.runtime.reserveUsage({calls:0,bytes:0,computeMs:1000});
  if(!allowance.allowed)return {status:'runtime_quota_paused',count:0};
  const prepared=await prepareOne(deps,signal,deadlineAtMs);
  if(deps.automaticEnabled===false)return {status:'automatic_disabled',count:0};
  const due=await deps.runtime.claimDue(deps.registry.pullIds());if(!due)return {status:'idle',count:0};
  if(!prepared&&!(await deps.runtime.reserveUsage({calls:0,bytes:0,computeMs:54000})).allowed){await deps.runtime.finishSync(due,{reason:'runtime_quota_paused',delayMs:1800000});return {status:'runtime_quota_paused',count:0};}
  let lease:SyncLease|null=null,count=0,reason='ready',delayMs=allowance.cadenceMs,failed=false,synced=false;
  try{
    const c=await deps.connectorStore.getConnection(due.ref.ownerId,due.ref.id);
    if(!c||c.epoch!==due.ref.epoch||c.status!=='active'||c.mode==='manual')return {status:'connection_changed',count};
    lease=await deps.connectorStore.leaseConnection(c,55000);if(!lease)return {status:'leased',count};
    const adapter=deps.registry.get(c.provider),cursor=await deps.connectorStore.readSyncCursor(c);
    if(!cursor?.cursor){reason='activation_required';delayMs=86400000;await deps.connectorStore.recordCoverageGap(c,reason,1);return {status:reason,count};}
    let pending=await deps.connectorStore.listPendingProviderItems(c,{limit:50});
    if(!pending.items.length){
      signal.throwIfAborted();
      const budget={deadlineAtMs,maxItemIds:50 as const,maxBodies:10 as const,maxBodyBytes:262144 as const};
      let page;
      if(adapter.pullChangesWithReconciliation){
        const outcome=await adapter.pullChangesWithReconciliation(c,cursor,budget,signal);page=outcome.page;
        // A folder removal queues an authorized current-membership re-read; never fabricates mailbox deletion.
        const refs=new Map(page.items.map(item=>[item.id,item]));
        for(const removal of outcome.removals)if(!refs.has(removal.id))refs.set(removal.id,{id:removal.id,version:'folder_membership_recheck',receivedAt:now().toISOString()});
        page={...page,items:[...refs.values()]};
      }else page=await adapter.pullChanges(c,cursor,budget,signal);
      await deps.connectorStore.persistProviderPage(c,lease,page);
      synced=true;
      pending=await deps.connectorStore.listPendingProviderItems(c,{limit:50});
    }
    for(const ref of pending.items){
      if(count>=10||now().getTime()>=deadlineAtMs-3000)break;signal.throwIfAborted();
      if(await deps.runtime.isSourceSuppressed(c,ref.id)){await deps.connectorStore.acknowledgeProviderItem(c,ref);continue;}
      if(Date.parse(ref.receivedAt)+30*86400000<=now().getTime()){
        await deps.runtime.expirePendingReference(c,ref);await deps.connectorStore.recordCoverageGap(c,'content_expired',1);
        await deps.connectorStore.acknowledgeProviderItem(c,ref);await deps.runtime.clearFetch(c,ref);count++;continue;
      }
      const retry=await deps.runtime.fetchState(c,ref);if(retry.dueAt>now().getTime())continue;
      let bodyFetched=false,savedRevisionId:string|undefined;
      try{
        count++;
        let saved;
        if(retry.attempts>=3){bodyFetched=true;saved=await saveUnavailableReference(c,ref,'fetch_attempts_exhausted',deps);}
        else{const item=await adapter.readItem(c,ref,signal);bodyFetched=true;signal.throwIfAborted();saved=await deps.connectorStore.saveRevision(c,item);}
        await deps.runtime.stageRevision(c,saved.revision.id);
        await deps.connectorStore.acknowledgeProviderItem(c,ref);await deps.runtime.clearFetch(c,ref);
        savedRevisionId=saved.revision.id;
        synced=true;
      }catch(error){
        signal.throwIfAborted();const code=errorCode(error);
        if(code==='source_suppressed'){
          await deps.connectorStore.acknowledgeProviderItem(c,ref);await deps.runtime.clearFetch(c,ref);
        }else if(['source_unavailable','provider_not_found','response_too_large','provider_denied','content_expired'].includes(code)){
          if(code==='content_expired'){await deps.runtime.expirePendingReference(c,ref);await deps.connectorStore.recordCoverageGap(c,'content_expired',1);}
          else await saveUnavailableReference(c,ref,code,deps);
          await deps.connectorStore.acknowledgeProviderItem(c,ref);await deps.runtime.clearFetch(c,ref);
        }else if(['reconnect_required','missing_read_scope','grant_missing','provider_unavailable','service_disabled','runtime_quota_paused'].includes(code)){
          reason=code;delayMs=code==='runtime_quota_paused'?1800000:86400000;await deps.connectorStore.recordCoverageGap(c,code,1);break;
        }else{
          // Storage/staging/acknowledgement failures are not provider body-fetch attempts.
          if(bodyFetched)throw error;
          const wait=error instanceof ProviderHttpError?error.retryAfterMs:undefined;
          await deps.runtime.failFetch(c,ref,wait);reason=code;delayMs=Math.max(60000,wait??0);
          if(code==='provider_backoff')break;
        }
      }
      // The durable body has been acknowledged. Preparation owns its own lease,
      // retry budget and recovery, so a failing image cannot invalidate valid text.
      if(savedRevisionId)await prepareOne(deps,signal,deadlineAtMs,{revisionId:savedRevisionId,computeReserved:true});
    }
    return {status:reason,count};
  }catch(error){
    reason=signal.aborted?'sync_interrupted':errorCode(error);failed=!['queue_capacity','runtime_quota_paused','refresh_in_progress'].includes(reason);
    delayMs=error instanceof ProviderHttpError&&error.retryAfterMs?error.retryAfterMs:[60000,300000,1800000][Math.min(due.failures,2)];
    if(due.failures>=2)delayMs=Math.max(delayMs,86400000);
    if(reason==='checkpoint_changed'&&lease){await deps.connectorStore.recordCoverageGap(due.ref,'checkpoint_reconciliation_started',1);await deps.runtime.restartCheckpoint(due.ref,lease.token,lease.fence);}
    else if(!signal.aborted)await deps.connectorStore.recordCoverageGap(due.ref,reason,1).catch(()=>{});
    return {status:reason,count};
  }finally{
    if(lease)await deps.connectorStore.releaseConnectionLease(lease).catch(()=>{});
    await deps.runtime.finishSync(due,{reason,delayMs,failed,successful:synced&&reason==='ready'});
  }
}
