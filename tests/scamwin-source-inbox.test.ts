import assert from 'node:assert/strict';
import test from 'node:test';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {ConnectorSourceService} from '../lib/scamwin/connectors/source-service';
import type {ScamwinStore} from '../lib/scamwin/contracts';

test('source inbox filters the full owned dataset, uses stable received-time pages and never lists bodies',async()=>{
 const f=await createConnectorTestStore();
 try{
  const c=await f.store.createConnection('alice',{provider:'gmail',providerAccountId:'synthetic-mailbox',scope:['inbox']});
  await f.store.saveGrant(c,{accessToken:'synthetic',scopes:['inbox']});
  for(let i=0;i<21;i++)await f.store.saveSelectedRevision(c,{providerItemId:`private-${i}`,revisionHash:'a'.repeat(64),receivedAt:'2026-11-10T12:00:00Z',text:`private-body-${i}`,urls:[],attachments:[]});
  const service=new ConnectorSourceService(f.database,f.store,{} as ScamwinStore,()=>new Date('2026-11-10T12:00:00Z'));
  const first=await service.list('alice',c.id,{});assert.equal(first.items.length,20);assert.ok(first.nextCursor);
  const second=await service.list('alice',c.id,{before:first.nextCursor});assert.equal(second.items.length,1);
  assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,21);
  assert.ok(!JSON.stringify(first).includes('private-body'));assert.ok(!JSON.stringify(first).includes('private-0'));
  await assert.rejects(service.list('mallory',c.id,{}),/connection_unavailable/);
  assert.equal((await service.list('alice',c.id,{filter:'failed'})).items.length,0);
 }finally{await f.close();}
});

test('source detail keeps expired/deleted child links unavailable and strips provider references',async()=>{
 const f=await createConnectorTestStore();
 try{
  const c=await f.store.createConnection('alice',{provider:'gmail',providerAccountId:'synthetic-detail',scope:['inbox']});
  await f.store.saveGrant(c,{accessToken:'synthetic',scopes:['inbox']});
  const saved=await f.store.saveSelectedRevision(c,{providerItemId:'never-browser-provider-id',revisionHash:'b'.repeat(64),receivedAt:'2026-11-10T12:00:00Z',text:'Private selected evidence',urls:['https://example.com/'],attachments:[]});
  await f.store.enqueueTarget(c,{revisionId:saved.revision.id,targetId:'body-0',generation:1,input:{message:'Private selected evidence',url:null,images:[]}});
  const lease=await f.store.leaseDueJob();assert.ok(lease);await f.store.recordAdmission(lease,'deleted-check');
  const main={getCheck:async()=>null,listObservations:async()=>[]} as unknown as ScamwinStore;
  const service=new ConnectorSourceService(f.database,f.store,main,()=>new Date('2026-11-10T12:00:00Z'));
  const detail=await service.detail('alice',c.id,saved.item.id);assert.equal(detail.risk,'inconclusive');assert.equal(detail.coverage,'partial');
  assert.equal(detail.targets[0].checkHref,null);assert.equal(detail.targets[0].reason,'main_check_unavailable');
  assert.equal(detail.context?.text,'Private selected evidence');assert.ok(!JSON.stringify(detail).includes('never-browser-provider-id'));
  f.advance(31*86400000);
  const expired=new ConnectorSourceService(f.database,f.store,main,()=>new Date('2026-12-11T12:00:00Z'));
  assert.equal((await expired.detail('alice',c.id,saved.item.id)).context,null);
  await assert.rejects(service.detail('mallory',c.id,saved.item.id),/connection_unavailable/);
 }finally{await f.close();}
});
