import test from 'node:test';
import assert from 'node:assert/strict';
import {TeamsGraphClient,TeamsAdapter,teamsResource,parseTeamsMessage} from '../lib/scamwin/connectors/providers/teams';
import {teamsWebhook} from '../lib/scamwin/connectors/teams-webhook';
import {TeamsStore} from '../lib/scamwin/connectors/teams-store';
import * as tables from '../lib/db/scamwin-teams-schema';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {ConnectorRuntimeStore} from '../lib/scamwin/connectors/runtime-store';

const signal=()=>AbortSignal.timeout(5000);
test('Teams stable chat resource rejects channels, beta and URL resources',()=>{
 assert.equal(teamsResource('19:abc@thread.v2'),'/chats/19%3Aabc%40thread.v2/messages');
 for(const id of ['https://evil.test','../tenant','x/y',''])assert.throws(()=>teamsResource(id));
});
test('Teams bounded validation challenge is endpoint validation only',async()=>{
 let called=0;const deps={enabled:()=>true,handle:async()=>{called++;}};
 const result=await teamsWebhook(new Request('https://app.test/notify?validationToken=hello%2Bworld',{method:'POST'}),deps);
 assert.equal(result.status,200);assert.equal(await result.text(),'hello+world');assert.equal(called,0);
 assert.equal((await teamsWebhook(new Request(`https://app.test/notify?validationToken=${'x'.repeat(2049)}`,{method:'POST'}),deps)).status,400);
});
test('Teams Graph calls use fixed stable origin, bounded JSON and no arbitrary redirects',async()=>{
 const calls:string[]=[];const client=new TeamsGraphClient(async(input,init)=>{calls.push(String(input));assert.equal(init?.redirect,'error');return Response.json({value:[]});});
 await client.get('/v1.0/me/chats','secret',signal());assert.equal(calls[0],'https://graph.microsoft.com/v1.0/me/chats');
 await assert.rejects(client.get('https://evil.test','secret',signal()));
 await assert.rejects(client.get('/beta/chats/x/messages','secret',signal()));
 const limited=new TeamsGraphClient(async()=>new Response('x'.repeat(1025)));
 await assert.rejects(limited.get('/v1.0/me/chats','secret',signal(),undefined,1024),/response_too_large/);
});
test('Teams HTML extraction is inert and hosted files stay unavailable',()=>{
 const result=parseTeamsMessage({id:'1',createdDateTime:'2026-11-10T12:00:00Z',body:{contentType:'html',content:'<script>secret()</script><p>Hello <a href="https://example.test">offer</a><img src="https://evil.test"></p>'},attachments:[{id:'file',name:'Hosted',contentType:'reference',contentUrl:'https://evil.test'}]},'opaque');
 assert.match(result.text,/Hello/);assert.doesNotMatch(result.text,/secret/);assert.deepEqual(result.urls,['https://example.test']);assert.equal(result.attachments[0].supported,false);assert.equal(result.extraction?.coverage,'partial');
});
test('Teams SQL validates every subscription entry, exact tenant/resource/state/epoch before durable acknowledgement',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'tenant:subject',scope:['unselected']});
  const store=new TeamsStore(fixture.database,fixture.keyring,()=>new Date('2026-11-10T12:00:00Z'));
  const resource=await store.saveResource(c,{chatId:'19:abc@thread.v2',label:'Permitted chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const settings={mode:'all_new' as const,scope:[resource.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1 as const};
  const next=await store.configure(c,settings,{cursor:'0',capturedAt:'2026-11-10T12:00:00Z'});
  const selected=(await store.resources(next))[0];
  await store.saveSubscription(next,selected,{id:'subscription-1',clientState:'s'.repeat(43),expiresAt:'2026-11-12T12:00:00Z'});
  const entry={subscriptionId:'subscription-1',clientState:'s'.repeat(43),tenantId:selected.tenantId,resource:'chats/19:abc@thread.v2/messages/123',changeType:'created',resourceData:{id:'123','@odata.type':'#Microsoft.Graph.chatMessage'}};
  await assert.rejects(store.receive({value:[entry,{...entry,clientState:'bad'}]},true),/teams_notification_invalid/);
  assert.equal((await store.events(next,'0',50)).items.length,0,'bad batch must not partially commit');
  await store.receive({value:[entry]},true);
  assert.equal((await store.events(next,'0',50)).items.length,1);
  await store.receive({value:[{...entry,resource:"chats('19:abc@thread.v2')/messages('123')"}]},true);
  assert.equal((await store.events(next,'0',50)).items.length,1,'equivalent retry forms reuse one pending current-state reference');
  for(const bad of [{...entry,tenantId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'},{...entry,resource:'chats/excluded/messages/123'},{...entry,subscriptionId:'unknown'}])await assert.rejects(store.receive({value:[bad]},true));
  const raw=JSON.stringify((await fixture.database.query('SELECT * FROM connector_teams_subscriptions')).rows);
  assert.doesNotMatch(raw,/subscription-1|ssssssss|19:abc/,'private resource and subscription credentials encrypted');
  const manual=await store.configure(next,{...settings,mode:'manual'},undefined);
  await assert.rejects(store.receive({value:[entry]},true));
  assert.equal((await store.events(manual,'0',50)).items.length,0);
 }finally{await fixture.close();}
});
test('Teams webhook awaits durable save and rejects rich/resource data before ack',async()=>{
 let saved=false;const request=()=>new Request('https://app.test/notify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:[{}]})});
 const response=await teamsWebhook(request(),{enabled:()=>true,handle:async()=>{await new Promise(r=>setTimeout(r,5));saved=true;}});
 assert.equal(response.status,202);assert.equal(saved,true);
 assert.equal((await teamsWebhook(request(),{enabled:()=>true,handle:async()=>{throw new Error('database unavailable');}})).status,503);
});
test('Teams lifecycle renewal is a separate subscription lease and respects ten minute cooldown',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),store=new TeamsStore(fixture.database,fixture.keyring,now);
  const c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'tenant:subject',scope:['unselected']});
  const r=await store.saveResource(c,{chatId:'chat',label:'chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const next=await store.configure(c,{mode:'all_new',scope:[r.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()});
  const selected=(await store.resources(next))[0];await store.saveSubscription(next,selected,{id:'sub',clientState:'s'.repeat(43),expiresAt:'2026-11-10T12:30:00Z'});
  await store.receive({value:[{subscriptionId:'sub',clientState:'s'.repeat(43),tenantId:selected.tenantId,lifecycleEvent:'reauthorizationRequired'}]},true);
  const first=await store.claimMaintenance(next);assert.ok(first);assert.equal(first?.kind,'renew');assert.equal(await store.claimMaintenance(next),null);
  await store.finishMaintenance(first!,{expiresAt:'2026-11-12T12:00:00Z'});assert.equal(await store.claimMaintenance(next),null);
 }finally{await fixture.close();}
});
test('Teams queued reference flows through Core without sender filtering, manual listing does not queue history, delete fences first save',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),store=new TeamsStore(fixture.database,fixture.keyring,now),runtime=new ConnectorRuntimeStore(fixture.database,fixture.keyring,now);
  const c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'tenant:subject',scope:['unselected']});
  const r=await store.saveResource(c,{chatId:'chat',label:'selected',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const next=await store.configure(c,{mode:'all_new',scope:[r.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()});
  const selected=(await store.resources(next))[0];await store.saveSubscription(next,selected,{id:'sub',clientState:'s'.repeat(43),expiresAt:'2026-11-12T12:00:00Z'});
  let bodies=0;
  const adapter=new TeamsAdapter({store,enabled:()=>true,automaticEnabled:()=>true,accessToken:async()=> 'server-token',notificationUrl:'https://app.test/notify',lifecycleUrl:'https://app.test/lifecycle',now,fetch:async()=>{bodies++;return Response.json({id:'123',chatId:'chat',createdDateTime:now().toISOString(),body:{contentType:'text',content:'Routine bot message'},from:{application:{id:'bot'}},attachments:[]});},recordGap:(ref,reason,count)=>fixture.store.recordCoverageGap(ref,reason,count),deleteItem:async(ref,id)=>{await runtime.deleteProviderItem(ref,id);}});
  const manual=await store.saveManualReference(next,selected,'old-manual','2026-11-01T12:00:00Z');
  assert.ok(manual.id);assert.equal((await store.events(next,'0',50)).items.length,0,'listing must not silently enqueue old history');
  const entry={subscriptionId:'sub',clientState:'s'.repeat(43),tenantId:selected.tenantId,resource:"chats('chat')/messages('123')",changeType:'created',resourceData:{id:'123','@odata.type':'#Microsoft.Graph.chatMessage'}};
  await store.receive({value:[entry]},true);assert.equal(bodies,0,'notification acknowledgement cannot fetch message body');
  const page=await adapter.pullChanges(next,{cursor:'0',pageState:null},{deadlineAtMs:now().getTime()+50000,maxItemIds:50,maxBodies:10,maxBodyBytes:262144},signal());
  const syncLease=await fixture.store.leaseConnection(next);assert.ok(syncLease);
  await fixture.store.persistProviderPage(next,syncLease,page);await fixture.store.releaseConnectionLease(syncLease);
  const item=await adapter.readItem(next,page.items[0],signal()),saved=await fixture.store.saveRevision(next,item);
  await fixture.store.acknowledgeProviderItem(next,page.items[0]);
  assert.notEqual(saved.item.state,'not_selected','All mode must include routine bot senders');
  await store.receive({value:[{...entry,changeType:'deleted'}]},true);
  await adapter.pullChanges(next,{cursor:page.finalCursor!,pageState:null},{deadlineAtMs:now().getTime()+50000,maxItemIds:50,maxBodies:10,maxBodyBytes:262144},signal());
  assert.equal(await runtime.isSourceSuppressed(next,item.providerItemId),true);
  await assert.rejects(fixture.store.saveRevision(next,item),/source_suppressed/);
  const firstDelete={...entry,resource:"chats('chat')/messages('never-saved')",changeType:'deleted',resourceData:{id:'never-saved','@odata.type':'#Microsoft.Graph.chatMessage'}};
  await store.receive({value:[firstDelete]},true);const deletedPage=await adapter.pullChanges(next,{cursor:page.finalCursor!,pageState:null},{deadlineAtMs:now().getTime()+50000,maxItemIds:50,maxBodies:10,maxBodyBytes:262144},signal());
  const absent=deletedPage.items.find(i=>i.id!==item.providerItemId)!;assert.equal(await runtime.isSourceSuppressed(next,absent.id),true,'authenticated deletion fences an absent first revision');
 }finally{await fixture.close();}
});
test('Teams gates-off delivery drops all references and lifecycle recovery state, recording content-free gap',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),store=new TeamsStore(fixture.database,fixture.keyring,now),c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),r=await store.saveResource(c,{chatId:'chat',label:'chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const next=await store.configure(c,{mode:'all_new',scope:[r.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()}),selected=(await store.resources(next))[0];
  await store.saveSubscription(next,selected,{id:'sub',clientState:'s'.repeat(43),expiresAt:'2026-11-12T12:00:00Z'});
  const entry={subscriptionId:'sub',clientState:'s'.repeat(43),tenantId:selected.tenantId,resource:'chats/chat/messages/private-message',changeType:'created',resourceData:{id:'private-message','@odata.type':'#Microsoft.Graph.chatMessage',body:{content:'must never persist'}}};
  await store.receive({value:[entry]},true);const queued=(await store.events(next,'0',50)).items[0];
  await fixture.store.configureConnection(next,{mode:'all_new',scope:next.scope,rules:{},paused:true,consent:true,automaticDailyLimit:1});
  await store.receive({value:[{...entry,changeType:'deleted'}]},false,async(ref,id,database)=>{await new ConnectorRuntimeStore(database,fixture.keyring,now).deleteProviderItem(ref,id);});
  assert.equal(await new ConnectorRuntimeStore(fixture.database,fixture.keyring,now).isSourceSuppressed(next,queued.id),true,'paused authenticated deletes still fence the source without fetching a body');
  await store.receive({value:[entry,entry]},false);
  assert.equal((await store.events(next,'0',50)).items.length,0);assert.equal(await store.claimMaintenance(next),null);
  assert.equal((await fixture.store.listActivity('owner')).items.some(a=>a.reason==='teams_inactive_delivery_discarded'),true);
  assert.doesNotMatch(JSON.stringify((await fixture.database.query('SELECT * FROM connector_teams_events')).rows),/private-message|must never persist/);
 }finally{await fixture.close();}
});
test('Teams initial subscription creation is durably leased and stops after three failures',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  let time=Date.parse('2026-11-10T12:00:00Z');const now=()=>new Date(time),store=new TeamsStore(fixture.database,fixture.keyring,now),c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),r=await store.saveResource(c,{chatId:'chat',label:'chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const next=await store.configure(c,{mode:'all_new',scope:[r.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()}),selected=(await store.resources(next))[0];
  await store.queueSubscription(next,selected);await store.queueSubscription(next,selected);
  for(let i=0;i<3;i++){const lease=await store.claimMaintenance(next);assert.ok(lease);assert.equal(lease.kind,'create');await store.finishMaintenance(lease,{failed:true});time+=86400000;}
  assert.equal(await store.claimMaintenance(next),null);assert.equal(Number((await fixture.database.query('SELECT count(*) AS n FROM connector_teams_subscriptions')).rows[0].n),1);
 }finally{await fixture.close();}
});
test('Teams owner disconnect capability deletes only saved subscriptions after local epoch fencing',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),store=new TeamsStore(fixture.database,fixture.keyring,now),c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),r=await store.saveResource(c,{chatId:'chat',label:'chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const next=await store.configure(c,{mode:'all_new',scope:[r.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()}),selected=(await store.resources(next))[0];await store.saveSubscription(next,selected,{id:'saved-sub',clientState:'s'.repeat(43),expiresAt:'2026-11-12T12:00:00Z'});
  const calls:string[]=[];const adapter=new TeamsAdapter({store,enabled:()=>true,automaticEnabled:()=>true,accessToken:async()=>{throw new Error('No refresh or provider request may precede local disconnect');},readGrant:async()=>({accessToken:'delete-authority',scopes:['Chat.Read']}),notificationUrl:'https://app.test/notify',lifecycleUrl:'https://app.test/lifecycle',now,fetch:async(input,init)=>{calls.push(String(input));assert.equal(init?.method,'DELETE');assert.equal((await fixture.store.getConnection('owner',c.id))?.status,'disconnected');return new Response(null,{status:204});},recordGap:async()=>{},deleteItem:async()=>{}});
  const afterFence=await adapter.prepareDisconnect(next,signal());assert.equal(calls.length,0);await assert.rejects(afterFence(signal()),/teams_local_fence_required/);assert.equal(calls.length,0);
  await fixture.store.revokeConnection('owner',next.id,next.epoch);await afterFence(signal());assert.deepEqual(calls,['https://graph.microsoft.com/v1.0/subscriptions/saved-sub']);assert.equal((await fixture.database.query('SELECT * FROM connector_teams_subscriptions')).rows.length,0);
 }finally{await fixture.close();}
});
test('Teams Selective uses explicit phrases, and revoked Graph access remains unavailable',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),store=new TeamsStore(fixture.database,fixture.keyring,now),c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),r=await store.saveResource(c,{chatId:'chat',label:'chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const next=await store.configure(c,{mode:'selective',scope:[r.handle],rules:{contains:['chosen phrase']},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()}),selected=(await store.resources(next))[0];await store.saveSubscription(next,selected,{id:'sub',clientState:'s'.repeat(43),expiresAt:'2026-11-12T12:00:00Z'});
  let denied=false;const adapter=new TeamsAdapter({store,enabled:()=>true,automaticEnabled:()=>true,accessToken:async()=> 'token',notificationUrl:'https://app.test/notify',lifecycleUrl:'https://app.test/lifecycle',now,fetch:async(input)=>denied?Response.json({error:'forbidden'},{status:403}):Response.json({id:String(input).split('/').pop(),createdDateTime:now().toISOString(),body:{contentType:'text',content:String(input).endsWith('/match')?'A chosen phrase from a routine sender':'Unmatched routine message'},attachments:[]}),recordGap:async()=>{},deleteItem:async()=>{}});
  for(const id of ['routine','match']){await store.receive({value:[{subscriptionId:'sub',clientState:'s'.repeat(43),tenantId:selected.tenantId,resource:`chats/chat/messages/${id}`,changeType:'created',resourceData:{id,'@odata.type':'#Microsoft.Graph.chatMessage'}}]},true);}
  const refs=(await store.events(next,'0',50)).items;const routine=await fixture.store.saveRevision(next,await adapter.readItem(next,refs[0],signal())),matching=await fixture.store.saveRevision(next,await adapter.readItem(next,refs[1],signal()));assert.equal(routine.item.state,'not_selected');assert.notEqual(matching.item.state,'not_selected');
  denied=true;await assert.rejects(adapter.readItem(next,refs[1],signal()),/provider_denied/);
 }finally{await fixture.close();}
});
test('Teams missed recovery uses matching modified filter/order, omits preboundary history and preserves explicit gaps',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  let time=Date.parse('2026-11-10T12:00:00Z');const now=()=>new Date(time),store=new TeamsStore(fixture.database,fixture.keyring,now),c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),r=await store.saveResource(c,{chatId:'chat',label:'chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const next=await store.configure(c,{mode:'all_new',scope:[r.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()}),selected=(await store.resources(next))[0];await store.saveSubscription(next,selected,{id:'sub',clientState:'s'.repeat(43),expiresAt:'2026-11-12T12:00:00Z'});time+=600000;fixture.advance(600000);
  await store.receive({value:[{subscriptionId:'sub',clientState:'s'.repeat(43),tenantId:selected.tenantId,lifecycleEvent:'missed'}]},true);
  const gaps:string[]=[];const adapter=new TeamsAdapter({store,enabled:()=>true,automaticEnabled:()=>true,accessToken:async()=> 'token',notificationUrl:'https://app.test/notify',lifecycleUrl:'https://app.test/lifecycle',now,fetch:async(input)=>{const url=new URL(String(input));assert.equal(url.searchParams.get('$orderby'),'lastModifiedDateTime desc');assert.equal(url.searchParams.get('$filter'),'lastModifiedDateTime gt 2026-11-10T12:00:00.000Z');assert.equal(url.searchParams.has('$select'),false);return Response.json({value:[{id:'old',createdDateTime:'2026-11-01T00:00:00Z',lastModifiedDateTime:'2026-11-10T12:02:00Z'},{id:'new',createdDateTime:'2026-11-10T12:01:00Z',lastModifiedDateTime:'2026-11-10T12:01:00Z'}],'@odata.nextLink':'https://graph.microsoft.com/more'});},recordGap:async(_ref,reason)=>{gaps.push(reason);},deleteItem:async()=>{}});
  const page=await adapter.pullChanges(next,{cursor:'0',pageState:null},{deadlineAtMs:time+50000,maxItemIds:50,maxBodies:10,maxBodyBytes:262144},signal());assert.equal(page.items.length,1);assert.ok(gaps.includes('teams_missed_notifications'));assert.ok(gaps.includes('teams_recovery_partial'));assert.ok(gaps.includes('teams_recovery_preboundary_omitted'));
 }finally{await fixture.close();}
});

test('Teams expired selected authority records an unavailable gap instead of a successful empty sync at day 90',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  let time=Date.parse('2026-11-10T12:00:00Z');const now=()=>new Date(time),store=new TeamsStore(fixture.database,fixture.keyring,now);
  const c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),r=await store.saveResource(c,{chatId:'chat',label:'Selected chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const next=await store.configure(c,{mode:'all_new',scope:[r.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()});
  const gaps:string[]=[];let providerCalls=0;
  const adapter=new TeamsAdapter({store,enabled:()=>true,automaticEnabled:()=>true,accessToken:async()=>{providerCalls++;return 'token';},notificationUrl:'https://app.test/notify',lifecycleUrl:'https://app.test/lifecycle',now,fetch:async()=>{providerCalls++;throw new Error('Expired resource authority must be reselected before provider I/O');},recordGap:async(ref,reason,count)=>{gaps.push(reason);await fixture.store.recordCoverageGap(ref,reason,count);},deleteItem:async()=>{}});
  // Even without purge the expired selection is unavailable. Purge must preserve that outcome.
  time+=90*86400000;fixture.advance(90*86400000);
  for(const purged of [false,true]){
   if(purged)await store.purge();
   await assert.rejects(adapter.pullChanges(next,{cursor:'0',pageState:null},{deadlineAtMs:time+50000,maxItemIds:50,maxBodies:10,maxBodyBytes:262144},signal()),/source_unavailable/);
  }
  assert.equal(providerCalls,0);assert.deepEqual(gaps,['teams_selection_expired','teams_selection_expired']);
  assert.ok((await fixture.store.listActivity('owner')).items.some(a=>a.reason==='teams_selection_expired'));
 }finally{await fixture.close();}
});

test('Teams unchanged daily maximum preserves recovery boundary while a changed selected scope advances it',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  let time=Date.parse('2026-11-10T12:00:00Z');const now=()=>new Date(time),store=new TeamsStore(fixture.database,fixture.keyring,now);
  const c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),r=await store.saveResource(c,{chatId:'chat',label:'Selected chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const settings={mode:'all_new' as const,scope:[r.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1 as const},initialBoundary=now().toISOString();
  const next=await store.configure(c,settings,{cursor:'0',capturedAt:initialBoundary});
  time+=86400000;fixture.advance(86400000);
  const dailyOnly=await store.configure(next,{...settings,automaticDailyLimit:2},{cursor:'0',capturedAt:now().toISOString()});
  assert.equal(dailyOnly.epoch,next.epoch);assert.equal((await store.resources(dailyOnly))[0].recoveryAfter,initialBoundary);
  const added=await store.saveResource(dailyOnly,{chatId:'second-chat',label:'Additional chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const changed=await store.configure(dailyOnly,{...settings,scope:[r.handle,added.handle],automaticDailyLimit:2},{cursor:'0',capturedAt:now().toISOString()});
  assert.equal(changed.epoch,dailyOnly.epoch+1);
  assert.ok((await store.resources(changed)).every(resource=>resource.recoveryAfter===now().toISOString()));
 }finally{await fixture.close();}
});

test('Teams retained Manual references do not exhaust pending capacity and repeated explicit selection reuses its reference',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),store=new TeamsStore(fixture.database,fixture.keyring,now),c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),r=await store.saveResource(c,{chatId:'chat',label:'Chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const selected=await store.configure(c,{mode:'all_new',scope:[r.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()}),resource=(await store.resources(selected))[0];
  const manual=await store.saveManualReference(selected,resource,'selected-message',now().toISOString());
  // Retained historical delivery metadata is not a pending queue. Seed its lifetime ceiling directly.
  await fixture.database.query('INSERT INTO connector_teams_events(connection_id,owner_id,epoch,item_key,automatic,encrypted_value,received_at,expires_at) SELECT connection_id,owner_id,epoch,item_key,0,encrypted_value,received_at,expires_at FROM connector_teams_events CROSS JOIN generate_series(1,4999) WHERE sequence=(SELECT min(sequence) FROM connector_teams_events)');
  const again=await store.saveManualReference(selected,resource,'selected-message',now().toISOString());
  assert.equal(again.id,manual.id);assert.equal(Number((await fixture.database.query('SELECT count(*) AS n FROM connector_teams_events')).rows[0].n),5000,'repeat selection retains its durable reference instead of appending queue work');
  await store.saveSubscription(selected,resource,{id:'sub',clientState:'s'.repeat(43),expiresAt:'2026-11-12T12:00:00Z'});
  await store.receive({value:[{subscriptionId:'sub',clientState:'s'.repeat(43),tenantId:resource.tenantId,resource:'chats/chat/messages/new',changeType:'created',resourceData:{id:'new','@odata.type':'#Microsoft.Graph.chatMessage'}}]},true);
  assert.equal((await store.events(selected,'0',50)).items.length,1,'historical Manual selections cannot block automatic intake');
 }finally{await fixture.close();}
});

test('Teams pending capacity follows durable cursor acknowledgement and preserves reference metadata for queued reads',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),store=new TeamsStore(fixture.database,fixture.keyring,now),c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),r=await store.saveResource(c,{chatId:'chat',label:'Chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const selected=await store.configure(c,{mode:'selective',scope:[r.handle],rules:{contains:['chosen']},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()}),resource=(await store.resources(selected))[0];
  await store.saveSubscription(selected,resource,{id:'sub',clientState:'s'.repeat(43),expiresAt:'2026-11-12T12:00:00Z'});
  const entry=(id:string)=>({subscriptionId:'sub',clientState:'s'.repeat(43),tenantId:resource.tenantId,resource:`chats/chat/messages/${id}`,changeType:'created',resourceData:{id,'@odata.type':'#Microsoft.Graph.chatMessage'}});
  await store.receive({value:[entry('first')]},true);
  await fixture.database.query('INSERT INTO connector_teams_events(connection_id,owner_id,epoch,item_key,automatic,encrypted_value,received_at,expires_at) SELECT connection_id,owner_id,epoch,item_key,1,encrypted_value,received_at,expires_at FROM connector_teams_events CROSS JOIN generate_series(1,999) WHERE sequence=(SELECT min(sequence) FROM connector_teams_events)');
  await assert.rejects(store.receive({value:[entry('overflow')]},true),/queue_capacity/);
  assert.ok((await fixture.store.listActivity('owner')).items.some(a=>a.reason==='teams_event_backlog_capacity'),'overflow warning must survive the rejected acknowledgement');
  const page=await store.events(selected,'0',50),lease=await fixture.store.leaseConnection(selected);assert.ok(lease);
  await fixture.store.persistProviderPage(selected,lease,{items:page.items,pageState:page.cursor,complete:false,gaps:[]});
  await assert.rejects(store.receive({value:[entry('overflow')]},true),/queue_capacity/,'durably copied but unprocessed Core references still consume pending capacity');
  const first=page.items[0];
  await fixture.store.saveRevision(selected,{providerItemId:first.id,revisionHash:'a'.repeat(64),receivedAt:first.receivedAt,text:'Routine nonmatching message',urls:[],attachments:[]});
  await fixture.store.acknowledgeProviderItem(selected,first);
  await store.receive({value:[entry('overflow')]},true);
  assert.equal(Number((await fixture.database.query('SELECT count(*) AS n FROM connector_teams_events WHERE automatic=2')).rows[0].n),50,'checkpointed event metadata is retained without consuming event pending capacity');
  assert.equal((await store.reference(selected,first)).messageId,'first','queued source reads retain the authenticated reference after acknowledgement');
  assert.equal((await store.events(selected,page.cursor,50)).items.length,50);
 }finally{await fixture.close();}
});
