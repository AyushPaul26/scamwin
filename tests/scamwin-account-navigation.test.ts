import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { accountLinks, connectionCard, connectorStateLabel, connectionSettingsInput } from '../lib/scamwin/connectors/ui';
import { ConnectorAccountService } from '../lib/scamwin/connectors/account-service';
import { createConnectorTestStore } from './utils/scamwin-connector-test-db';

test('account routes retain checks and provide canonical private destinations', () => {
  assert.deepEqual(accountLinks.map(l => l.href), ['/account', '/account/connections', '/account/alerts', '/account/activity', '/account/privacy']);
  assert.notEqual(connectorStateLabel('quota_paused'), connectorStateLabel('queued'));
  assert.notEqual(connectorStateLabel('unsupported'), connectorStateLabel('partial_grant'));
});
test('safe cards omit owner and grant material; settings require explicit processing consent', async () => {
  const {store, close} = await createConnectorTestStore();
  try {
    const c = await store.createConnection('alice', {provider:'gmail', providerAccountId:'private-account', scope:['inbox']});
    const card = connectionCard(c, 'partial_grant');
    assert.equal(card.mode, 'manual'); assert.equal(card.epoch, 1);
    for (const key of ['ownerId', 'encryptedGrant', 'accessToken', 'refreshToken', 'cursor', 'body']) assert.ok(!(key in card));
    assert.equal(connectionSettingsInput.safeParse({id:c.id, epoch:1, mode:'all_new', scope:['inbox'], contains:'', consent:false, automaticDailyLimit:1}).success, false);
  } finally {await close();}
});
test('a Discord identity grant is accepted independently of its separate message-command installation', async () => {
  const {store, close} = await createConnectorTestStore();
  try {
    const c = await store.createConnection('alice', {provider: 'discord', providerAccountId: 'discord-user', scope: ['unselected']});
    const service = new ConnectorAccountService(store, {enabled: true, cancel: async () => {}});
    await store.saveGrant(c, {accessToken: 'synthetic-only', scopes: ['identify']});
    assert.equal((await service.card(c)).readiness, 'accepted');
    await store.saveGrant(c, {accessToken: 'synthetic-only', scopes: ['email']});
    assert.equal((await service.card(c)).readiness, 'partial_grant');
  } finally {await close();}
});
test('21-record paging and filtering are applied to full owned SQL dataset', async () => {
  const {store, close} = await createConnectorTestStore();
  try {
    for(let i=0;i<21;i++) await store.createConnection('alice', {provider:i===20?'outlook':'gmail', providerAccountId:`synthetic-${i}`,scope:['inbox']});
    await store.createConnection('bob', {provider:'outlook',providerAccountId:'other-owner',scope:['inbox']});
    const first=await store.listConnections('alice',{limit:20}); assert.equal(first.items.length,20); assert.ok(first.nextCursor);
    assert.equal((await store.listConnections('alice',{limit:20,before:first.nextCursor!})).items.length,1);
    const matching=await store.listConnections('alice',{limit:20,query:'outlook'}); assert.equal(matching.items.length,1); assert.equal(matching.items[0].ownerId,'alice');
  } finally {await close();}
});
test('feature off preserves owner reads/disconnect and cancellation; stale/foreign mutations fail', async () => {
  const {store, close}=await createConnectorTestStore(); const canceled:string[]=[];
  try {
    const c=await store.createConnection('alice',{provider:'gmail',providerAccountId:'synthetic',scope:['inbox']});
    const service=new ConnectorAccountService(store,{enabled:false,cancel:async(_owner,id)=>{canceled.push(id);}, now:()=>new Date('2026-11-10T12:00:00Z')});
    assert.equal((await service.connections('alice',{})).items.length,1);
    await assert.rejects(service.save('alice',{id:c.id,epoch:1,mode:'all_new',scope:['inbox'],contains:'',consent:true,automaticDailyLimit:1}),/service_disabled/);
    await assert.rejects(service.disconnect('bob',c.id,1),/connection_unavailable/);
    await assert.rejects(service.disconnect('alice',c.id,2),/stale_connection/);
    assert.equal((await service.disconnect('alice',c.id,1)).status,'disconnected');
    assert.deepEqual(canceled,[]);
  } finally {await close();}
});
test('shared controls preserve default deletion copy and use per-instance search IDs',async()=>{
 const core=await readFile(new URL('../components/scamwin/core.tsx',import.meta.url),'utf8');
 assert.match(core,/useId\(/); assert.match(core,/cancelLabel = "Keep check"/); assert.match(core,/busyLabel = "Deleting…"/);
});
test('readiness requires accepted unexpired read permission and disconnect routes admitted cancellation',async()=>{
 const {store,close}=await createConnectorTestStore();const canceled:string[]=[];
 try{
  const service=new ConnectorAccountService(store,{enabled:true,now:()=>new Date('2026-11-10T12:00:00Z'),activation:async()=>({cursor:'synthetic-activation',capturedAt:'2026-11-10T12:00:00.000Z'}),cancel:async(owner,id)=>{assert.equal(owner,'alice');canceled.push(id);}});
  let c=await store.createConnection('alice',{provider:'gmail',providerAccountId:'synthetic-grant-fixture',scope:['inbox']});
  assert.equal((await service.card(c)).readiness,'grant_missing');
  await store.saveGrant(c,{accessToken:'synthetic-only',scopes:['openid']});assert.equal((await service.card(c)).readiness,'partial_grant');
  await assert.rejects(service.save('alice',{id:c.id,epoch:c.epoch,mode:'all_new',scope:['inbox'],contains:'',consent:true,automaticDailyLimit:1}),/partial_grant/);
  await store.saveGrant(c,{accessToken:'synthetic-only',scopes:['https://www.googleapis.com/auth/gmail.readonly'],expiresAt:'2026-11-09T12:00:00Z'});assert.equal((await service.card(c)).readiness,'grant_expired');
  await store.saveGrant(c,{accessToken:'synthetic-only',scopes:['https://www.googleapis.com/auth/gmail.readonly']});assert.equal((await service.card(c)).readiness,'accepted');
  await assert.rejects(service.save('alice',{id:c.id,epoch:c.epoch,mode:'all_new',scope:['all-mail'],contains:'',consent:true,automaticDailyLimit:1}),/invalid_input/);
  const changed=await service.save('alice',{id:c.id,epoch:c.epoch,mode:'all_new',scope:['inbox'],contains:'',consent:true,automaticDailyLimit:1});assert.equal(changed.epoch,2);
  c=(await store.getConnection('alice',c.id))!;
  const saved=await store.saveRevision(c,{providerItemId:'synthetic-mail',revisionHash:'c'.repeat(64),receivedAt:'2026-11-10T12:00:00Z',text:'Synthetic fixture body',urls:[],attachments:[]});
  await store.enqueueTarget(c,{revisionId:saved.revision.id,targetId:'body-0',generation:1,input:{message:'Synthetic fixture body',url:null,images:[]}});
  const lease=await store.leaseDueJob();assert.ok(lease);await store.recordAdmission(lease,'synthetic-main-check');
  await service.disconnect('alice',c.id,c.epoch);assert.deepEqual(canceled,['synthetic-main-check']);assert.equal(await store.readGrant(c),null);
 }finally{await close();}
});
test('private alerts and activity search filter across SQL records and preserve epoch',async()=>{
 const {store,close}=await createConnectorTestStore();
 try{
  let c=await store.createConnection('alice',{provider:'outlook',providerAccountId:'synthetic-alert-fixture',scope:['inbox']});
  c=await store.configureConnection(c,{mode:'all_new',scope:c.scope,rules:{},consent:true,paused:false,automaticDailyLimit:1});
  for(let i=0;i<21;i++){
   const revision=await store.saveRevision(c,{providerItemId:`synthetic-${i}`,revisionHash:'d'.repeat(64),receivedAt:'2026-11-10T12:00:00Z',text:'Synthetic only',urls:[],attachments:[]});
   await store.saveAlert(c,{revisionId:revision.revision.id,kind:'coverage',reason:i===20?'unsupported':'partial',counts:revision.revision.manifest.counts});
  }
  const first=await store.listAlerts('alice',{limit:20});assert.equal(first.items.length,20);assert.ok(first.nextCursor);
  const last=await store.listAlerts('alice',{limit:20,before:first.nextCursor!});assert.equal(last.items.length,1);
  const match=await store.listAlerts('alice',{query:'unsupported',filter:'unread'});assert.equal(match.items.length,1);assert.equal(match.items[0].epoch,c.epoch);
  assert.equal((await store.listAlerts('bob',{query:'unsupported'})).items.length,0);
  await store.markAlertSeen('alice',match.items[0].id);assert.equal((await store.listAlerts('alice',{query:'unsupported',filter:'unread'})).items.length,0);assert.equal((await store.listAlerts('alice',{filter:'read'})).items.length,1);
  const activity=await store.listActivity('alice',{query:'mode_saved',filter:'connection'});assert.equal(activity.items.length,1);assert.equal(activity.items[0].epoch,c.epoch);assert.equal((await store.listActivity('bob',{})).items.length,0);
 }finally{await close();}
});
test('disconnect durably retries failed admitted cancellations after partial success and refreshed epoch',async()=>{
 const {store,close}=await createConnectorTestStore();const calls:string[]=[];let fail=true;
 try{
  let c=await store.createConnection('alice',{provider:'gmail',providerAccountId:'synthetic-retry',scope:['inbox']});
  c=await store.configureConnection(c,{mode:'all_new',scope:c.scope,rules:{},consent:true,paused:false,automaticDailyLimit:1});
  for(let i=0;i<2;i++){
   const revision=await store.saveRevision(c,{providerItemId:`synthetic-retry-${i}`,revisionHash:'e'.repeat(64),receivedAt:'2026-11-10T12:00:00Z',text:'Synthetic',urls:[],attachments:[]});
   await store.enqueueTarget(c,{revisionId:revision.revision.id,targetId:'body-0',generation:1,input:{message:'Synthetic',url:null,images:[]}});
   const lease=await store.leaseDueJob();assert.ok(lease);await store.recordAdmission(lease,`synthetic-main-${i}`);
   // Simulate a crashed worker whose admitted main check is still running.
   await store.finishJob(lease,{status:'deferred',reason:'main_check_active',retryAt:'2026-11-11T12:00:00Z'});
   if(i===0){
    // The first main check became terminal; occupancy recovery committed before
    // its deferred connector projection. A later start is now legal for this
    // owner, while disconnect still requests both saved IDs idempotently.
    const intent=(await store.listAdmissionIntents()).find(value=>value.jobId===lease.job.id);assert.ok(intent);
    await store.recordRecoveredAdmission(intent,`synthetic-main-${i}`,true);
   }
  }
  const service=new ConnectorAccountService(store,{enabled:false,cancel:async(owner,id)=>{assert.equal(owner,'alice');calls.push(id);if(fail&&id==='synthetic-main-1')throw new Error('synthetic outage');}});
  await assert.rejects(service.disconnect('alice',c.id,c.epoch));
  const revoked=(await store.getConnection('alice',c.id))!;assert.equal(revoked.status,'disconnected');assert.equal(revoked.epoch,c.epoch+1);
  assert.equal((await service.card(revoked)).cancellationPending,true);
  await assert.rejects(service.disconnect('bob',c.id,revoked.epoch),/connection_unavailable/);
  // A fresh service instance proves pending intent came from durable storage.
  const restarted=new ConnectorAccountService(store,{enabled:false,cancel:async(_owner,id)=>{calls.push(id);if(fail)throw new Error('synthetic outage');}});
  await assert.rejects(restarted.disconnect('alice',c.id,c.epoch));
  fail=false;const done=await restarted.disconnect('alice',c.id,revoked.epoch);
  assert.equal(done.cancellationPending,false);assert.equal(done.epoch,revoked.epoch);
  assert.equal(calls.filter(id=>id==='synthetic-main-0').length,1);assert.equal(calls.filter(id=>id==='synthetic-main-1').length,3);
  await restarted.disconnect('alice',c.id,c.epoch);assert.equal(calls.length,4);
 }finally{await close();}
});
test('account datasets page newest timestamp then stable ID across equal-time boundary',async()=>{
 const {store,database,close,advance}=await createConnectorTestStore();
 try{
  const connections: {id:string;createdAt:string}[]=[],alerts:{id:string;createdAt:string}[]=[];
  for(let i=0;i<21;i++){
   if(i>1)advance(1000);
   let c=await store.createConnection('alice',{provider:'gmail',providerAccountId:`synthetic-order-${i}`,scope:['inbox']});connections.push(c);
   c=await store.configureConnection(c,{mode:'all_new',scope:c.scope,rules:{},consent:true,paused:false,automaticDailyLimit:1});
   const r=await store.saveRevision(c,{providerItemId:`synthetic-order-${i}`,revisionHash:'f'.repeat(64),receivedAt:c.activationAt!,text:'Synthetic',urls:[],attachments:[]});
   alerts.push(await store.saveAlert(c,{revisionId:r.revision.id,kind:'coverage',reason:'unsupported',counts:r.revision.manifest.counts}));
  }
  advance(1000);await store.createConnection('bob',{provider:'gmail',providerAccountId:'synthetic-other',scope:['inbox']});
  const sorted=(items:{id:string;createdAt:string}[])=>[...items].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).map(v=>v.id);
  const activity=(await database.query('SELECT id,created_at FROM connector_activity WHERE owner_id=$1',['alice'])).rows.map(v=>({id:String(v.id),createdAt:new Date(String(v.created_at)).toISOString()}));
  for(const [kind,expected] of [['listConnections',sorted(connections)],['listAlerts',sorted(alerts)],['listActivity',sorted(activity)]] as const){
   const first=await store[kind]('alice',{limit:20,query:kind==='listConnections'?'gmail':'',filter:kind==='listAlerts'?'unread':'all'});
   assert.deepEqual(first.items.map(v=>v.id),expected.slice(0,20));assert.ok(first.nextCursor);
   const last=await store[kind]('alice',{limit:20,before:first.nextCursor!,query:kind==='listConnections'?'gmail':'',filter:kind==='listAlerts'?'unread':'all'});
   assert.deepEqual(last.items.map(v=>v.id),expected.slice(20));
  }
 }finally{await close();}
});
