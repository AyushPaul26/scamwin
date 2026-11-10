import assert from 'node:assert/strict';
import test from 'node:test';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import * as model from '../lib/db/scamwin-notification-schema';
import {PrivateNotificationStore} from '../lib/scamwin/connectors/notification-store';
import {PrivateOutcomeService} from '../lib/scamwin/connectors/notification-service';
import {ConnectorSourceService} from '../lib/scamwin/connectors/source-service';
import {MemoryStore} from '../lib/scamwin/store';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {ConnectorStoreError} from '../lib/scamwin/connectors/store';

test('material outcomes dedupe persistently, default to actionable events, and read changes are owner/revision fenced',async()=>{
 const f=await createConnectorTestStore(Object.values(model));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),s=new PrivateNotificationStore(f.database,now);
  const input={connectionId:'connection',epoch:2,revisionId:'revision',itemId:'item',kind:'coverage' as const,reason:'partial',counts:{discovered:2,checked:1,pending:0,unsupported:1},material:'a'.repeat(64)};
  const a=await s.publish('alice',input);assert.ok(a);
  assert.equal((await s.publish('alice',input))?.id,a.id);
  assert.equal((await s.list('alice',{})).items.length,1);assert.equal((await s.list('mallory',{})).items.length,0);
  assert.equal(await s.setRead('mallory',a.id,a.revision,true),false);
  assert.equal(await s.setRead('alice',a.id,a.revision,true),true);
  assert.equal(await s.setRead('alice',a.id,a.revision,true),true,'same retry remains idempotent');
  assert.equal(await s.setRead('alice',a.id,a.revision,false),false,'stale opposite operation cannot overwrite read state');
  const seen=(await s.list('alice',{})).items[0];assert.equal(await s.setRead('alice',seen.id,seen.revision,false),true);
  assert.equal(await s.publish('alice',{...input,kind:'result',reason:'result_ready',material:'b'.repeat(64)}),null);
  await s.setAllResults('alice',true);assert.ok(await s.publish('alice',{...input,kind:'result',reason:'result_ready',material:'b'.repeat(64)}));
  assert.equal((await s.list('alice',{})).items.length,2);
 }finally{await f.close();}
});

test('real saved failed and deferred targets produce distinct durable alerts despite push failure',async()=>{
 const f=await createConnectorTestStore(Object.values(model));
 try{const now=()=>new Date('2026-11-10T12:00:00Z'),main=new MemoryStore({now}),s=new PrivateNotificationStore(f.database,now),sources=new ConnectorSourceService(f.database,f.store,main,now);let pushes=0;const outcomes=new PrivateOutcomeService(f.database,s,sources,async()=>{pushes++;throw new Error('synthetic offline device');},now);
 const c=await f.store.createConnection('alice',{provider:'gmail',providerAccountId:'synthetic-outcomes',scope:['inbox']});await f.store.saveGrant(c,{accessToken:'fixture',scopes:['inbox']});
 const first=await f.store.saveSelectedRevision(c,{providerItemId:'failed-source',revisionHash:'a'.repeat(64),receivedAt:now().toISOString(),text:'selected evidence',urls:[],attachments:[]});await f.store.enqueueTarget(c,{revisionId:first.revision.id,targetId:'body-0',generation:1,input:{message:'selected evidence',url:null,images:[]}});const lease=await f.store.leaseDueJob();assert.ok(lease);await f.store.finishJob(lease,{status:'failed',reason:'child_unavailable'});
 assert.equal((await outcomes.publishPrivateOutcome('alice',c.id,first.item.id))?.reason,'failed');await outcomes.publishPrivateOutcome('alice',c.id,first.item.id);assert.equal(pushes,1,'retry never re-notifies an identical material outcome');
 const second=await f.store.saveSelectedRevision(c,{providerItemId:'deferred-source',revisionHash:'b'.repeat(64),receivedAt:now().toISOString(),text:'deferred evidence',urls:[],attachments:[]});await f.store.enqueueTarget(c,{revisionId:second.revision.id,targetId:'body-0',generation:1,input:{message:'deferred evidence',url:null,images:[]}});const delayed=await f.store.leaseDueJob();assert.ok(delayed);await f.store.finishJob(delayed,{status:'deferred',reason:'worker_unavailable',retryAt:'2026-11-10T12:15:00Z'});
 assert.equal((await outcomes.publishPrivateOutcome('alice',c.id,second.item.id))?.reason,'delayed');assert.equal((await s.list('alice',{})).items.length,2);
 }finally{await f.close();}
});

test('failed, delayed and risk notices stay separate and typed connection notices need no fake revision',async()=>{
 const f=await createConnectorTestStore(Object.values(model));
 try{const s=new PrivateNotificationStore(f.database,()=>new Date('2026-11-10T12:00:00Z'));for(const reason of ['failed','quota_paused','high_risk','partial'])await s.publish('alice',{connectionId:'c',epoch:1,revisionId:'r',itemId:'i',kind:'coverage',reason,counts:{discovered:1,checked:0,pending:1,unsupported:0},material:reason.padEnd(64,'a')});
 await s.publish('alice',{connectionId:'c',epoch:1,revisionId:null,itemId:null,kind:'connection',reason:'reconnect_required',counts:{discovered:0,checked:0,pending:0,unsupported:0},material:'c'.repeat(64)});
 const rows=(await s.list('alice',{})).items;assert.equal(rows.length,5);assert.equal(rows.find(a=>a.kind==='connection')?.revisionId,null);
 assert.ok(rows.every(a=>!JSON.stringify(a).includes('ownerId')));
 }finally{await f.close();}
});

test('material alert dataset pages equal-time rows and filters all owned records before pagination',async()=>{
 const f=await createConnectorTestStore(Object.values(model));
 try{const s=new PrivateNotificationStore(f.database,()=>new Date('2026-11-10T12:00:00Z'));for(let i=0;i<21;i++)await s.publish('alice',{connectionId:'c',epoch:1,revisionId:`r-${i}`,itemId:`i-${i}`,kind:'coverage',reason:i===20?'source_unavailable':'partial',counts:{discovered:1,checked:0,pending:0,unsupported:1},material:'a'.repeat(64)});
 const first=await s.list('alice',{});assert.equal(first.items.length,20);assert.ok(first.nextCursor);const last=await s.list('alice',{before:first.nextCursor});assert.equal(last.items.length,1);assert.equal(new Set([...first.items,...last.items].map(a=>a.id)).size,21);assert.equal((await s.list('alice',{query:'source_unavailable'})).items.length,1);assert.equal(first.unreadCount,21);
 await s.deleteAccount('alice');assert.equal((await s.list('alice',{})).items.length,0);
 }finally{await f.close();}
});

test('persisted alert HTTP reads complete independently of a never-settling device transport',{timeout:10000},async()=>{
 const f=await createConnectorTestStore(Object.values(model));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),store=new PrivateNotificationStore(f.database,now),main=new MemoryStore({now}),sources=new ConnectorSourceService(f.database,f.store,main,now);let pushCalls=0;
  const outcomes=new PrivateOutcomeService(f.database,store,sources,()=>{pushCalls++;return new Promise(()=>{});},now);
  const connection=await f.store.createConnection('alice',{provider:'gmail',providerAccountId:'read-independent',scope:['inbox']});await f.store.saveGrant(connection,{accessToken:'fixture',scopes:['inbox']});
  const saved=await f.store.saveSelectedRevision(connection,{providerItemId:'unavailable-body',revisionHash:'a'.repeat(64),receivedAt:now().toISOString(),text:'',urls:[],attachments:[],extraction:{coverage:'unavailable',diagnostics:[{reason:'missing_body',count:1}],overflow:{textBytes:0,urls:0,attachments:0}}});
  const existing=await store.publish('alice',{connectionId:connection.id,epoch:connection.epoch,revisionId:saved.revision.id,itemId:saved.item.id,kind:'coverage',reason:'partial',counts:{discovered:0,checked:0,pending:0,unsupported:0},material:'b'.repeat(64)});assert.ok(existing);
  // Execute the production HTTP module with only auth/composition boundaries supplied.
  // The projection service, durable SQL store, Request and Response remain real.
  const dependencies:Record<string,unknown>={'server-only':{},'@/lib/auth0':{getOptionalSession:async()=>({user:{sub:'alice'}})},'./repository':{getConnectorDatabase:()=>f.database},'./store':{ConnectorStoreError},'./account-server':{connectorError:()=>({ok:false,code:'service_unavailable',error:'Unavailable'})},'./notification-store':{PrivateNotificationStore:class extends PrivateNotificationStore{constructor(){super(f.database,now);}}},'./push':{pushConfiguration:()=>null},'./notification-runtime':{privateOutcomeService:()=>outcomes}};
  const source=await readFile('lib/scamwin/connectors/notification-server.ts','utf8'),exports:{privateAlertsRead?:(request:Request)=>Promise<Response>}={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>{if(!(name in dependencies))throw new Error(`Unexpected dependency: ${name}`);return dependencies[name];},Response});
  const pending=exports.privateAlertsRead!(new Request('https://scamwin.example/api/scamwin/alerts',{method:'POST',body:'{}'}));
  const result=await Promise.race([pending,new Promise<null>(resolve=>setTimeout(()=>resolve(null),250))]);assert.ok(result,'Existing alert reads must not wait for projection or device delivery');assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal((await result.json()).items[0].id,existing.id);assert.equal(pushCalls,0);
 }finally{await f.close();}
});
