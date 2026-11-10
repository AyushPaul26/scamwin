import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createConnectorTestStore } from './utils/scamwin-connector-test-db';
import { ConnectorRuntimeStore } from '../lib/scamwin/connectors/runtime-store';
import { createConnectorDispatchHandler } from '../lib/scamwin/connectors/dispatch';
import { signDispatch } from '../lib/scamwin/connectors/crypto';
import { connectorTick } from '../lib/scamwin/connectors/sync';
import { ConnectorProviderRegistry,createMailboxRegistry,mailboxActivationHook } from '../lib/scamwin/connectors/registry';
import { ConnectorSelectionService } from '../lib/scamwin/connectors/selection';
import type { ProviderItemRef } from '../lib/scamwin/connectors/contracts';
import { ProviderHttpError } from '../lib/scamwin/connectors/provider-http';
import { GmailAdapter } from '../lib/scamwin/connectors/providers/gmail';
import { connectorDrain } from '../lib/scamwin/connectors/drain';
import { MemoryStore } from '../lib/scamwin/store';
import { enqueueRevisionTargets } from '../lib/scamwin/connectors/targets';
import {ConnectorCredentialService} from '../lib/scamwin/connectors/credentials';
import type {ScamwinStore} from '../lib/scamwin/contracts';

const instant = Date.parse('2026-11-10T12:00:00.000Z');
const secret = 'test-only-dispatch-secret-never-production';
test('signed dispatch consumes a durable delivery once, rejects wrong action/signature and bounds bytes', async () => {
  const fixture = await createConnectorTestStore();
  try {
    const runtime = new ConnectorRuntimeStore(fixture.database, fixture.keyring, () => new Date(instant));
    let calls = 0;
    const handler = createConnectorDispatchHandler('tick', { enabled: true, secret, now: () => instant, consume: id => runtime.consumeDelivery(id), work: async () => { calls++; return { status: 'idle', count: 0 }; } });
    const body = JSON.stringify({version:1, action:'tick', deliveryId:randomUUID()});
    const signature = signDispatch(body, instant, createHash('sha256').update(secret).digest());
    const request = (text=body, sig=signature) => new Request('https://example.test/api/scamwin/connectors/tick', {method:'POST',body:text,headers:{'X-Scamwin-Dispatch-Signature':sig}});
    const race = await Promise.all([handler(request()), handler(request())]);
    assert.deepEqual(race.map(r=>r.status).sort(),[200,409]); assert.equal(calls,1);
    assert.equal((await handler(request(body,'bad'))).status,401);
    assert.equal((await handler(request('x'.repeat(2049)))).status,413);
    const wrong = JSON.stringify({version:1,action:'drain',deliveryId:randomUUID()});
    assert.equal((await handler(request(wrong,signDispatch(wrong,instant,createHash('sha256').update(secret).digest())))).status,400);
    assert.equal(calls,1);
    const disabled = createConnectorDispatchHandler('tick',{enabled:false,secret,consume:async()=>{throw Error('must_not_touch_database');},work:async()=>{throw Error('must_not_run');}});
    assert.equal((await disabled(request())).status,503);
  } finally { await fixture.close(); }
});

test('durable fair scheduler skips manual, fences stale completion and recovers a killed lease',async()=>{
  const f=await createConnectorTestStore(); let now=instant;
  try {
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    const active=[];
    for(const owner of ['a','b','manual']){
      const c=await f.store.createConnection(owner,{provider:'gmail',providerAccountId:owner,scope:['inbox']});
      if(owner!=='manual')active.push(await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1},{cursor:'123',capturedAt:new Date(now).toISOString()}));
    }
    const one=await runtime.claimDue(['gmail']); const two=await runtime.claimDue(['gmail']);
    assert.ok(one);assert.ok(two);assert.notEqual(one.ref.id,two.ref.id);assert.equal(await runtime.claimDue(['gmail']),null);
    assert.equal((await runtime.readiness(one.ref))?.lastSyncAt,null,'a lease claim is not a successful sync');
    now+=56000;f.advance(56000);
    const recovered=await runtime.claimDue(['gmail']);assert.ok(recovered);
    assert.equal(await runtime.finishSync(recovered,{reason:'ready',delayMs:900000}),true);
    assert.equal(await runtime.finishSync(one,{reason:'ready',delayMs:0}),false);
    assert.equal(active.length,2);
  }finally{await f.close();}
});

test('opaque handles are encrypted, owner and epoch scoped, expiring and one-use',async()=>{
  const f=await createConnectorTestStore();let now=instant;
  try{
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    const c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'secret-account',scope:['inbox']});
    const handle=await runtime.saveHandle(c,'item',{id:'private-mail-id',receivedAt:new Date(now).toISOString()});
    assert.doesNotMatch(JSON.stringify((await f.database.query('SELECT * FROM connector_selection_handles')).rows),/private-mail-id/);
    await assert.rejects(runtime.consumeHandle({...c,ownerId:'attacker'},handle,'item'),/selection_unavailable/);
    assert.deepEqual(await runtime.consumeHandle(c,handle,'item'),{id:'private-mail-id',receivedAt:new Date(now).toISOString()});
    await assert.rejects(runtime.consumeHandle(c,handle,'item'),/selection_unavailable/);
    const expired=await runtime.saveHandle(c,'page','private-page');now+=600001;
    await assert.rejects(runtime.consumeHandle(c,expired,'page'),/selection_unavailable/);
  }finally{await f.close();}
});

test('conservative reservations are persisted, hard limited and reset on UTC day',async()=>{
  const f=await createConnectorTestStore();let now=instant;
  try{
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    assert.equal((await runtime.reserveUsage({calls:100,bytes:1000,computeMs:1000},{calls:100,bytes:2000,computeMs:2000})).allowed,true);
    assert.equal((await runtime.reserveUsage({calls:1,bytes:1,computeMs:1},{calls:100,bytes:2000,computeMs:2000})).allowed,false);
    now+=86400000;
    assert.equal((await runtime.reserveUsage({calls:1,bytes:1,computeMs:1},{calls:100,bytes:2000,computeMs:2000})).allowed,true);
  }finally{await f.close();}
});

test('tick stages a bounded page, fetches ten bodies, commits before ack and finishes pending refs before pulling again',async()=>{
  const f=await createConnectorTestStore();let now=instant,pulls=0,bodies=0;
  try{
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    let c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    c=await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1},{cursor:'100',capturedAt:new Date(now).toISOString()});
    const registry=new ConnectorProviderRegistry();registry.register('gmail',{
      capabilities:{pull:true,history:true,selectedItem:true,push:false,edits:true,attachments:false},
      pullChanges:async()=>{pulls++;return {items:Array.from({length:12},(_,i)=>({id:`mail-${i}`,receivedAt:new Date(instant).toISOString()})),pageState:null,finalCursor:'101',complete:true,gaps:[]};},
      readItem:async(_c,ref)=>{bodies++;if(ref.id==='mail-0')throw new ProviderHttpError('source_unavailable');return {providerItemId:ref.id,revisionHash:createHash('sha256').update(ref.id).digest('hex'),receivedAt:ref.receivedAt,text:'Untrusted message',urls:[],attachments:[]};},
      revoke:async()=>({status:'unavailable'}),
    });
    const deps={connectorStore:f.store,runtime,registry,now:()=>new Date(now)};
    await connectorTick(deps,new AbortController().signal,now+50000);
    assert.equal((await runtime.readiness(c))?.lastSyncAt,new Date(now).toISOString());
    assert.equal(pulls,1);assert.equal(bodies,10);assert.equal((await f.store.listPendingProviderItems(c)).items.length,2);
    now+=900001;f.advance(900001);await connectorTick(deps,new AbortController().signal,now+50000);
    assert.equal(pulls,1);assert.equal(bodies,12);assert.equal((await f.store.listPendingProviderItems(c)).items.length,0);
    assert.ok((await f.store.listItems(c)).items.some(i=>i.state==='source_unavailable'));
    assert.equal((await f.database.query('SELECT count(*) AS n FROM connector_jobs')).rows[0].n,11);
  }finally{await f.close();}
});

test('manual listing returns opaque metadata handles and selected import consumes only after owner/epoch checks',async()=>{
  const f=await createConnectorTestStore();let reads=0;
  try{
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(instant));
    const c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    await f.store.saveGrant(c,{accessToken:'fixture',scopes:['https://www.googleapis.com/auth/gmail.readonly']});
    const registry=new ConnectorProviderRegistry();registry.register('gmail',{
      capabilities:{pull:true,history:true,selectedItem:true,push:false,edits:true,attachments:false},
      pullChanges:async()=>{throw Error('manual_must_not_poll');},
      listSelected:async()=>({items:[{id:'private-provider-id',receivedAt:new Date(instant).toISOString(),subject:'Private subject'}],nextPageToken:'private-provider-cursor'}),
      readItem:async(_c,ref:ProviderItemRef)=>{reads++;return {providerItemId:ref.id,revisionHash:'a'.repeat(64),receivedAt:ref.receivedAt,text:'Selected source',urls:[],attachments:[]};},revoke:async()=>({status:'unavailable'}),
    });
    const service=new ConnectorSelectionService({connectorStore:f.store,runtime,registry,enabled:true});
    const page=await service.list('owner',{id:c.id,epoch:c.epoch});assert.equal(reads,0);
    assert.doesNotMatch(JSON.stringify(page),/private-provider/);assert.equal(page.items[0].subject,'Private subject');
    await assert.rejects(service.import('attacker',{id:c.id,epoch:c.epoch,handle:page.items[0].handle}),/connection_unavailable/);
    const saved=await service.import('owner',{id:c.id,epoch:c.epoch,handle:page.items[0].handle});assert.ok(saved.revisionId);assert.equal(reads,1);
    await assert.rejects(service.import('owner',{id:c.id,epoch:c.epoch,handle:page.items[0].handle}),/selection_unavailable/);
    assert.equal((await f.store.getRevision(c,saved.revisionId))?.selectionReason,'user_selected');
    assert.equal((await f.database.query('SELECT count(*) AS n FROM connector_preparations')).rows[0].n,1);
  }finally{await f.close();}
});

test('owner backlog capacity rejects whole page without advancing cursor and selected jobs take priority',async()=>{
  const f=await createConnectorTestStore();
  try{
    let c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    await f.store.saveGrant(c,{accessToken:'fixture',scopes:['https://www.googleapis.com/auth/gmail.readonly']});
    c=await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1},{cursor:'100',capturedAt:new Date(instant).toISOString()});
    const automatic=await f.store.saveRevision(c,{providerItemId:'automatic',revisionHash:'a'.repeat(64),receivedAt:new Date(instant).toISOString(),text:'automatic',urls:[],attachments:[]});
    await f.store.enqueueTarget(c,{revisionId:automatic.revision.id,targetId:'body-0',generation:1,input:{message:'automatic',url:null,images:[]}});
    f.advance(1);
    const selected=await f.store.saveSelectedRevision(c,{providerItemId:'selected',revisionHash:'b'.repeat(64),receivedAt:new Date(instant).toISOString(),text:'selected',urls:[],attachments:[]});
    await f.store.enqueueTarget(c,{revisionId:selected.revision.id,targetId:'body-0',generation:1,input:{message:'selected',url:null,images:[]}});
    const lease=await f.store.leaseDueJob();assert.equal(lease?.job.revisionId,selected.revision.id);
    await f.store.finishJob(lease!,{status:'failed',reason:'fixture_unavailable'});
    assert.equal(await f.store.leaseDueJob(300000,false,true),null);
    await f.database.query("INSERT INTO connector_pending_items(id,owner_id,connection_id,epoch,encrypted_ref,expires_at) SELECT 'capacity-'||n,$1,$2,$3,'unread-fixture',$4 FROM generate_series(1,999) n",[c.ownerId,c.id,c.epoch,'2026-12-01T00:00:00.000Z']);
    const sync=await f.store.leaseConnection(c);assert.ok(sync);
    await assert.rejects(f.store.persistProviderPage(c,sync,{items:[{id:'overflow',receivedAt:new Date(instant).toISOString()}],pageState:null,finalCursor:'101',complete:true,gaps:[]}),/queue_capacity/);
    assert.equal((await f.store.readSyncCursor(c))?.cursor,'100');
  }finally{await f.close();}
});

test('dispatch bounds stalled input and ignored-abort work and returns sanitized deadline',async()=>{
  const body=JSON.stringify({version:1,action:'drain',deliveryId:randomUUID()});
  const signature=signDispatch(body,instant,createHash('sha256').update(secret).digest());
  const handler=createConnectorDispatchHandler('drain',{enabled:true,secret,now:()=>instant,timeoutMs:15,consume:async()=>true,work:async()=>new Promise(()=>{})});
  const response=await handler(new Request('https://example.test/drain',{method:'POST',body,headers:{'X-Scamwin-Dispatch-Signature':signature}}));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{status:'deadline',count:0});
  const stalled=await handler(new Request('https://example.test/drain',{method:'POST',body:new ReadableStream(),duplex:'half'} as RequestInit));
  assert.equal(stalled.status,503);assert.deepEqual(await stalled.json(),{status:'deadline',count:0});
});

test('actual Gmail HTTP transport feeds SQL source/job ledger and removed source is suppressed before a body re-read',async()=>{
  const f=await createConnectorTestStore();let now=instant,bodyReads=0;
  try{
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    let c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    c=await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1},{cursor:'100',capturedAt:new Date(now).toISOString()});
    const http:typeof fetch=async(input,init)=>{
      assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-token');assert.equal(init?.redirect,'error');
      const url=new URL(String(input));assert.equal(url.origin,'https://gmail.googleapis.com');
      if(url.pathname.endsWith('/history'))return Response.json({historyId:'101',history:[{id:'101',messagesAdded:[{message:{id:'mail',labelIds:['INBOX']}}]}]});
      if(url.searchParams.get('format')==='metadata')return Response.json({id:'mail',labelIds:['INBOX']});
      bodyReads++;return Response.json({id:'mail',labelIds:['INBOX'],payload:{mimeType:'text/plain',body:{data:Buffer.from('Hello from the fixture').toString('base64url')}}});
    };
    const registry=new ConnectorProviderRegistry().register('gmail',new GmailAdapter({accessToken:async()=> 'fixture-token',revoke:async()=>({status:'unavailable'}),fetch:http,now:()=>new Date(now)}));
    await connectorTick({connectorStore:f.store,runtime,registry,now:()=>new Date(now)},new AbortController().signal,now+50000);
    assert.equal(bodyReads,1);const item=(await f.store.listItems(c)).items[0];assert.ok(item.latestRevisionId);
    assert.equal((await f.store.listRevisionJobs(c,item.latestRevisionId)).length,1);
    await runtime.invalidateSource(c,item.id,'owner_removed_source');
    assert.equal(await runtime.isSourceSuppressed(c,'mail'),true);
    now+=900001;f.advance(900001);
    await connectorTick({connectorStore:f.store,runtime,registry,now:()=>new Date(now)},new AbortController().signal,now+50000);
    assert.equal(bodyReads,1);assert.equal((await f.store.getItem(c,item.id))?.state,'source_unavailable');
  }finally{await f.close();}
});

test('provider backoff during raster preparation preserves the pending target and durable recovery',async()=>{
  const f=await createConnectorTestStore();
  try{
    let c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    c=await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1});
    const saved=await f.store.saveRevision(c,{providerItemId:'image',revisionHash:'a'.repeat(64),receivedAt:new Date(instant).toISOString(),text:'',urls:[],attachments:[{id:'image',name:'image.png',mediaType:'image/png',supported:true}]});
    await assert.rejects(enqueueRevisionTargets(c,saved.revision.id,{connectorStore:f.store,now:()=>new Date(instant),loadAttachment:async()=>{throw new ProviderHttpError('provider_backoff',300000);}}),/provider_backoff/);
    assert.equal((await f.store.getRevision(c,saved.revision.id))?.manifest.targets[0].status,'pending');
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(instant));await runtime.discoverPreparations(['gmail']);
    const lease=await runtime.claimPreparation(['gmail']);assert.equal(lease?.revisionId,saved.revision.id);
  }finally{await f.close();}
});

test('drain loads pipeline before leasing, runs one selected target, and idle recovery does not spend a full-run estimate',async()=>{
  const f=await createConnectorTestStore();let calls=0;
  try{
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(instant));
    const mainStore=new MemoryStore({now:()=>new Date(instant)});
    const c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    await f.store.saveGrant(c,{accessToken:'fixture',scopes:['https://www.googleapis.com/auth/gmail.readonly']});
    const saved=await f.store.saveSelectedRevision(c,{providerItemId:'selected',revisionHash:'a'.repeat(64),receivedAt:new Date(instant).toISOString(),text:'Selected evidence',urls:[],attachments:[]});
    await enqueueRevisionTargets(c,saved.revision.id,{connectorStore:f.store});
    const deps={connectorStore:f.store,runtime,mainStore,automaticEnabled:false,now:()=>new Date(instant),loadPipeline:async()=>async(id:string,generation:number,store:ScamwinStore)=>{
      calls++;assert.deepEqual(await store.leaseOutbox(1,['investigate'],id),[]);const check=await store.claimRun(id,generation);assert.ok(check);await store.updateRun(id,generation,check.revision,{state:'failed',errorCode:'fixture_terminal'});
    }};
    const first=await connectorDrain(deps,new AbortController().signal);assert.equal(first.count,1);assert.equal(calls,1);
    const before=Number((await f.database.query("SELECT compute_ms FROM connector_runtime_usage WHERE id LIKE 'day:%'")).rows[0].compute_ms);
    const idle=await connectorDrain(deps,new AbortController().signal);assert.equal(idle.count,0);assert.equal(calls,1);
    const after=Number((await f.database.query("SELECT compute_ms FROM connector_runtime_usage WHERE id LIKE 'day:%'")).rows[0].compute_ms);
    assert.ok(after-before<300000,'an idle scheduler wakeup must not reserve an investigation');
  }finally{await f.close();}
});

test('three transient fetch failures are deferred with persisted 1/5/30 minute delays then become a per-item unavailable record',async()=>{
  const f=await createConnectorTestStore();let now=instant,reads=0;
  try{
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    let c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    c=await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1},{cursor:'100',capturedAt:new Date(now).toISOString()});
    const ref={id:'failed',receivedAt:new Date(now).toISOString()};
    const registry=new ConnectorProviderRegistry().register('gmail',{
      capabilities:{pull:true,history:true,selectedItem:true,push:false,edits:false,attachments:false},
      pullChanges:async()=>({items:[ref],pageState:null,finalCursor:'101',complete:true,gaps:[]}),
      readItem:async()=>{reads++;throw new ProviderHttpError('provider_network');},revoke:async()=>({status:'unavailable'}),
    });
    for(const delay of [60000,300000,1800000]){
      await connectorTick({connectorStore:f.store,runtime,registry,now:()=>new Date(now)},new AbortController().signal,now+50000);
      const retry=await runtime.fetchState(c,ref);assert.equal(retry.dueAt-now,delay);assert.equal((await runtime.readiness(c))?.lastSyncAt,null);
      now+=Math.max(delay,900001);f.advance(Math.max(delay,900001));
    }
    await connectorTick({connectorStore:f.store,runtime,registry,now:()=>new Date(now)},new AbortController().signal,now+50000);
    assert.equal(reads,3);assert.equal((await f.store.listPendingProviderItems(c)).items.length,0);
    assert.equal((await f.store.listItems(c)).items[0].state,'source_unavailable');
  }finally{await f.close();}
});

test('Outlook activation authenticates current grant and persists a cursor bound to the upcoming epoch',async()=>{
  const f=await createConnectorTestStore();
  try{
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(instant));
    const c=await f.store.createConnection('owner',{provider:'outlook',providerAccountId:'account',scope:['inbox']});
    await f.store.saveGrant(c,{accessToken:'fixture-token',scopes:['Mail.Read'],expiresAt:new Date(instant+3600000).toISOString()});
    const http:typeof fetch=async(input,init)=>{
      assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-token');
      const url=new URL(String(input));if(url.pathname.endsWith('/mailFolders/inbox'))return Response.json({id:'folder'});
      assert.equal(url.pathname,'/v1.0/me/mailFolders/folder/messages/delta');
      return Response.json({value:[],'@odata.deltaLink':'https://graph.microsoft.com/v1.0/me/mailFolders/folder/messages/delta?$deltatoken=fixture'});
    };
    const credentials=new ConnectorCredentialService(f.store,{configuration:{enabled:true,origin:'https://example.test',providers:{outlook:{clientId:'fixture',clientSecret:'fixture',pilotSubjects:null}}},http:{fetch:(url,init)=>http(url,init)},now:()=>instant});
    const settings={mode:'all_new' as const,scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1 as const};
    const activate=mailboxActivationHook({credentials,fetch:http,now:()=>new Date(instant),automaticEnabled:true});
    const baseline=await activate(c,settings,new AbortController().signal);
    const saved=await f.store.configureConnection(c,settings,baseline);assert.equal(saved.epoch,c.epoch+1);
    const provider=createMailboxRegistry({credentials,runtime,fetch:http,now:()=>new Date(instant)}).get('outlook');
    const page=await provider.pullChanges(saved,await f.store.readSyncCursor(saved),{deadlineAtMs:instant+50000,maxItemIds:50,maxBodies:10,maxBodyBytes:262144},new AbortController().signal);
    assert.equal(page.complete,true);
  }finally{await f.close();}
});

test('saved revision preparation retries are bounded independently of provider-page fetches',async()=>{
  const f=await createConnectorTestStore();let now=instant,loads=0;
  try{
    let c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    c=await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1});
    await f.store.saveGrant(c,{accessToken:'fixture',scopes:['https://www.googleapis.com/auth/gmail.readonly']});
    const saved=await f.store.saveSelectedRevision(c,{providerItemId:'image',revisionHash:'a'.repeat(64),receivedAt:new Date(now).toISOString(),text:'',urls:[],attachments:[{id:'image',name:'image.png',mediaType:'image/png',supported:true}]});
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    const registry=new ConnectorProviderRegistry().register('gmail',{
      capabilities:{pull:false,history:false,selectedItem:false,push:true,edits:true,attachments:true},
      pullChanges:async()=>{throw Error('must_not_poll');},readItem:async()=>{throw Error('must_not_refetch');},revoke:async()=>({status:'unavailable'}),
      readAttachment:async()=>{loads++;throw new ProviderHttpError('provider_backoff',60000);},
    });
    for(const delay of [60001,300001,1800001]){await connectorTick({connectorStore:f.store,runtime,registry,automaticEnabled:false,now:()=>new Date(now)},new AbortController().signal,now+50000);now+=delay;f.advance(delay);}
    await connectorTick({connectorStore:f.store,runtime,registry,automaticEnabled:false,now:()=>new Date(now)},new AbortController().signal,now+50000);
    assert.equal(loads,3);assert.equal((await f.store.getRevision(c,saved.revision.id))?.manifest.targets[0].reason,'preparation_attempts_exhausted');
    assert.equal((await f.store.listRevisionJobs(c,saved.revision.id)).length,0);
  }finally{await f.close();}
});

test('a pending reference older than body retention becomes expired without a provider body request',async()=>{
  const f=await createConnectorTestStore();let now=instant,reads=0;
  try{
    let c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    c=await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1},{cursor:'100',capturedAt:new Date(now).toISOString()});
    const lease=await f.store.leaseConnection(c);assert.ok(lease);await f.store.persistProviderPage(c,lease,{items:[{id:'old',receivedAt:new Date(now).toISOString()}],pageState:null,finalCursor:'101',complete:true,gaps:[]});await f.store.releaseConnectionLease(lease);
    now+=31*86400000;f.advance(31*86400000);
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    const registry=new ConnectorProviderRegistry().register('gmail',{
      capabilities:{pull:true,history:true,selectedItem:false,push:false,edits:false,attachments:false},pullChanges:async()=>{throw Error('must_finish_pending');},
      readItem:async()=>{reads++;throw new ProviderHttpError('source_unavailable');},revoke:async()=>({status:'unavailable'}),
    });
    await connectorTick({connectorStore:f.store,runtime,registry,now:()=>new Date(now)},new AbortController().signal,now+50000);
    assert.equal(reads,0);assert.equal((await f.store.listItems(c)).items[0].state,'expired');assert.equal((await f.store.listPendingProviderItems(c)).items.length,0);
  }finally{await f.close();}
});

test('automatic rollback does not prepare an older automatic revision',async()=>{
  const f=await createConnectorTestStore();let loads=0;
  try{
    let c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});
    c=await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1});
    const saved=await f.store.saveRevision(c,{providerItemId:'image',revisionHash:'a'.repeat(64),receivedAt:new Date(instant).toISOString(),text:'',urls:[],attachments:[{id:'image',name:'image.png',mediaType:'image/png',supported:true}]});
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(instant));
    const registry=new ConnectorProviderRegistry().register('gmail',{
      capabilities:{pull:true,history:true,selectedItem:true,push:false,edits:true,attachments:true},pullChanges:async()=>{throw Error('must_not_poll');},readItem:async()=>{throw Error('must_not_read');},revoke:async()=>({status:'unavailable'}),
      readAttachment:async()=>{loads++;throw new ProviderHttpError('provider_backoff');},
    });
    await connectorTick({connectorStore:f.store,runtime,registry,automaticEnabled:false,now:()=>new Date(instant)},new AbortController().signal,instant+50000);
    assert.equal(loads,0);assert.equal((await f.store.getRevision(c,saved.revision.id))?.manifest.targets[0].status,'pending');
  }finally{await f.close();}
});
