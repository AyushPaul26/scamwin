import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectorTestStore } from './utils/scamwin-connector-test-db';
import { ConnectorRuntimeStore } from '../lib/scamwin/connectors/runtime-store';
import { ConnectorProviderRegistry } from '../lib/scamwin/connectors/registry';
import { ConnectorSelectionService } from '../lib/scamwin/connectors/selection';
import { connectorTick } from '../lib/scamwin/connectors/sync';
import { ProviderHttpError } from '../lib/scamwin/connectors/provider-http';
import { enqueueRevisionTargets } from '../lib/scamwin/connectors/targets';
import type { ProviderItem } from '../lib/scamwin/connectors/contracts';
import { PostgresConnectorStore,type ConnectorSql } from '../lib/scamwin/connectors/store';
const initial=Date.parse('2026-11-10T12:00:00.000Z');
async function connection(f:Awaited<ReturnType<typeof createConnectorTestStore>>){
  let c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
  await f.store.saveGrant(c,{accessToken:'fixture',scopes:['https://www.googleapis.com/auth/gmail.readonly']});
  c=await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1},{cursor:'100',capturedAt:new Date(initial).toISOString()});
  return c;
}
const source=(hash='a'):ProviderItem=>({providerItemId:'source',revisionHash:hash.repeat(64),receivedAt:new Date(initial).toISOString(),text:`Valid text revision ${hash}`,urls:[],attachments:[]});
for(const path of ['selected','automatic','direct'] as const)test(`R1 suppression transaction rejects a changed revision after removal during ${path} read`,async()=>{
  const f=await createConnectorTestStore();
  try{
    const c=await connection(f),runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(initial));
    const old=await f.store.saveRevision(c,source());await enqueueRevisionTargets(c,old.revision.id,{connectorStore:f.store});
    const registry=new ConnectorProviderRegistry().register('gmail',{
      capabilities:{pull:true,history:true,selectedItem:true,push:false,edits:true,attachments:false},
      pullChanges:async()=>({items:[{id:'source',version:'changed',receivedAt:new Date(initial).toISOString()}],pageState:null,finalCursor:'101',complete:true,gaps:[]}),
      readItem:async()=>{await runtime.invalidateSource(c,old.item.id,'owner_removed_source');return source('b');},
      revoke:async()=>({status:'unavailable'}),
    });
    if(path==='selected'){
      const handle=await runtime.saveHandle(c,'item',{id:'source',receivedAt:new Date(initial).toISOString()});
      const selected=new ConnectorSelectionService({connectorStore:f.store,runtime,registry,enabled:true});
      await assert.rejects(selected.import(c.ownerId,{id:c.id,epoch:c.epoch,handle}),/source_suppressed/);
    }else if(path==='automatic'){
      await connectorTick({connectorStore:f.store,runtime,registry,now:()=>new Date(initial)},new AbortController().signal,initial+50000);
      assert.equal((await f.store.listPendingProviderItems(c)).items.length,0);
    }else{
      await runtime.invalidateSource(c,old.item.id,'provider_deleted');
      await assert.rejects(f.store.saveRevision(c,source('b')),/source_suppressed/);
    }
    const revisions=(await f.database.query('SELECT revision_hash,encrypted_content FROM connector_revisions WHERE item_id=$1',[old.item.id])).rows;
    assert.equal(revisions.length,1);assert.equal(revisions[0].encrypted_content,null);
    assert.equal((await f.store.getItem(c,old.item.id))?.state,path==='direct'?'deleted':'source_unavailable');
    assert.ok((await f.store.listRevisionJobs(c,old.revision.id)).every(j=>j.state==='canceled'));
  }finally{await f.close();}
});

test('R1 attachment failures do not refetch a saved body or consume its fetch retry budget',async()=>{
  const f=await createConnectorTestStore();let now=initial,bodyReads=0,imageReads=0,pages=0;
  try{
    const c=await connection(f),runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    const body={...source(),attachments:[{id:'image',name:'image.png',mediaType:'image/png',supported:true}]};
    const registry=new ConnectorProviderRegistry().register('gmail',{
      capabilities:{pull:true,history:true,selectedItem:true,push:false,edits:true,attachments:true},
      pullChanges:async()=>({items:pages++===0?[{id:'source',receivedAt:new Date(initial).toISOString()}]:[],pageState:null,finalCursor:'101',complete:true,gaps:[]}),
      readItem:async()=>{bodyReads++;return body;},readAttachment:async()=>{imageReads++;throw new ProviderHttpError('provider_backoff',60000);},revoke:async()=>({status:'unavailable'}),
    });
    for(let i=0;i<5;i++){
      await connectorTick({connectorStore:f.store,runtime,registry,now:()=>new Date(now)},new AbortController().signal,now+50000);
      assert.equal((await runtime.fetchState(c,{id:'source',receivedAt:new Date(initial).toISOString()})).attempts,0);
      assert.equal((await f.store.listPendingProviderItems(c)).items.length,0);
      now+=1800001;f.advance(1800001);
    }
    assert.equal(bodyReads,1);assert.equal(imageReads,3);
    const item=(await f.store.listItems(c)).items[0],revision=await f.store.getRevision(c,item.latestRevisionId!);
    assert.ok(await f.store.readRevisionContent(c,revision!.id));
    const jobs=await f.store.listRevisionJobs(c,revision!.id);
    assert.equal(jobs.length,1);assert.equal(jobs[0].state,'queued');assert.equal(jobs[0].targetId,'body-0');
    assert.equal(revision!.manifest.targets.find(t=>t.kind==='image')?.reason,'preparation_attempts_exhausted');
    assert.notEqual(item.state,'source_unavailable');
  }finally{await f.close();}
});

test('R1 exhaustion committed before target finalization is reclaimed without a fourth attachment attempt',async()=>{
  const f=await createConnectorTestStore();let now=initial,loads=0;
  try{
    const c=await connection(f),runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    const saved=await f.store.saveSelectedRevision(c,{...source(),text:'',attachments:[{id:'image',name:'image.png',mediaType:'image/png',supported:true}]});
    await runtime.stageRevision(c,saved.revision.id);
    // Execute the real failure-state write three times, then abandon the worker before target projection.
    for(const delay of [60001,300001,1800001]){
      const lease=await runtime.claimPreparation(['gmail']);assert.ok(lease);
      await runtime.finishPreparation(lease,false,true);
      now+=delay;f.advance(delay);
    }
    assert.equal((await f.store.getRevision(c,saved.revision.id))?.manifest.targets[0].status,'pending');
    const registry=new ConnectorProviderRegistry().register('gmail',{
      capabilities:{pull:false,history:false,selectedItem:true,push:true,edits:true,attachments:true},
      pullChanges:async()=>{throw Error('must_not_poll');},readItem:async()=>{throw Error('must_not_fetch');},
      readAttachment:async()=>{loads++;throw new ProviderHttpError('provider_backoff');},revoke:async()=>({status:'unavailable'}),
    });
    const restarted=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    await connectorTick({connectorStore:f.store,runtime:restarted,registry,automaticEnabled:false,now:()=>new Date(now)},new AbortController().signal,now+50000);
    const target=(await f.store.getRevision(c,saved.revision.id))?.manifest.targets[0];
    assert.equal(target?.reason,'preparation_attempts_exhausted');assert.equal(target?.status,'unavailable');assert.equal(loads,0);
    assert.equal((await f.database.query('SELECT count(*) AS n FROM connector_preparations WHERE revision_id=$1',[saved.revision.id])).rows[0].n,0);
  }finally{await f.close();}
});

test('R1 partial exhausted-target finalization survives a database failure and resumes only pending targets',async()=>{
  const f=await createConnectorTestStore();let now=initial,updates=0,loads=0;
  try{
    const c=await connection(f),runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    const saved=await f.store.saveSelectedRevision(c,{...source(),text:'',attachments:[1,2].map(i=>({id:`image-${i}`,name:'image.png',mediaType:'image/png',supported:true}))});
    await runtime.stageRevision(c,saved.revision.id);
    for(const delay of [60001,300001,1800001]){const lease=await runtime.claimPreparation(['gmail']);assert.ok(lease);await runtime.finishPreparation(lease,false,true);now+=delay;f.advance(delay);}
    const registry=new ConnectorProviderRegistry().register('gmail',{
      capabilities:{pull:false,history:false,selectedItem:true,push:true,edits:true,attachments:true},
      pullChanges:async()=>{throw Error('must_not_poll');},readItem:async()=>{throw Error('must_not_fetch');},
      readAttachment:async()=>{loads++;throw new ProviderHttpError('provider_backoff');},revoke:async()=>({status:'unavailable'}),
    });
    const failSecondProjection=(db:ConnectorSql):ConnectorSql=>({query:async(text,params)=>{
      if(text.startsWith('UPDATE connector_revisions SET manifest=')&&++updates===2)throw Error('injected_database_interruption');
      return db.query(text,params);
    }});
    const interruptedStore=new PostgresConnectorStore({query:f.database.query.bind(f.database),transaction:fn=>f.database.transaction(db=>fn(failSecondProjection(db)))},{keyring:f.keyring,now:()=>new Date(now)});
    await connectorTick({connectorStore:interruptedStore,runtime,registry,automaticEnabled:false,now:()=>new Date(now)},new AbortController().signal,now+50000);
    const partial=(await f.store.getRevision(c,saved.revision.id))!.manifest.targets;
    assert.equal(updates,2);assert.deepEqual(partial.map(t=>t.status),['unavailable','pending']);
    const persisted=(await f.database.query('SELECT attempts FROM connector_preparations WHERE revision_id=$1',[saved.revision.id])).rows[0];assert.equal(persisted.attempts,3);
    now+=1800001;f.advance(1800001);
    await connectorTick({connectorStore:f.store,runtime:new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now)),registry,automaticEnabled:false,now:()=>new Date(now)},new AbortController().signal,now+50000);
    assert.ok((await f.store.getRevision(c,saved.revision.id))!.manifest.targets.every(t=>t.reason==='preparation_attempts_exhausted'));
    assert.equal(loads,0);assert.equal((await f.database.query('SELECT count(*) AS n FROM connector_preparations WHERE revision_id=$1',[saved.revision.id])).rows[0].n,0);
  }finally{await f.close();}
});

for(const operation of ['enqueue','coverage'] as const)test(`R1 suppression fences a late ${operation} write using previously saved source content`,async()=>{
  const f=await createConnectorTestStore();
  try{
    const c=await connection(f),runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(initial));
    const saved=await f.store.saveRevision(c,source());
    await runtime.invalidateSource(c,saved.item.id,'owner_removed_source');
    if(operation==='enqueue')await assert.rejects(f.store.enqueueTarget(c,{revisionId:saved.revision.id,targetId:'body-0',generation:1,input:{message:'Prepared before removal',url:null,images:[]}}),/source_suppressed/);
    else await assert.rejects(f.store.recordTargetGap(c,saved.revision.id,'body-0','preparation_attempts_exhausted'),/source_suppressed/);
    assert.equal((await f.store.getItem(c,saved.item.id))?.state,'source_unavailable');
    assert.equal((await f.store.listRevisionJobs(c,saved.revision.id)).length,0);
    assert.equal(await f.store.readRevisionContent(c,saved.revision.id),null);
  }finally{await f.close();}
});

test('R1 provider deletion before the first source save blocks the in-flight first revision',async()=>{
  const f=await createConnectorTestStore();
  try{
    const c=await connection(f),runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(initial));
    assert.deepEqual(await runtime.deleteProviderItem(c,'source'),{found:false});
    await assert.rejects(f.store.saveRevision(c,source('b')),/source_suppressed/);
    assert.equal(await runtime.isSourceSuppressed(c,'source'),true);
    const items=(await f.store.listItems(c)).items;assert.equal(items.length,1);assert.equal(items[0].state,'deleted');assert.equal(items[0].latestRevisionId,null);
    assert.equal((await f.database.query('SELECT count(*) AS n FROM connector_revisions')).rows[0].n,0);
  }finally{await f.close();}
});
