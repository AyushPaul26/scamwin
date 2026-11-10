import test from 'node:test';
import assert from 'node:assert/strict';
import {TeamsService,teamsMessageLink} from '../lib/scamwin/connectors/teams-service';
import {TeamsStore} from '../lib/scamwin/connectors/teams-store';
import {TeamsAdapter} from '../lib/scamwin/connectors/providers/teams';
import {teamsFormSchema} from '../lib/scamwin/connectors/teams-ui';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import * as tables from '../lib/db/scamwin-teams-schema';

test('Teams setup discovers through saved identity, hides provider IDs and enforces selected scope, ownership and automatic pilot gate',async()=>{
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),store=new TeamsStore(fixture.database,fixture.keyring,()=>new Date('2026-11-10T12:00:00Z'));
  let automatic=false;const adapter=new TeamsAdapter({store,enabled:()=>true,automaticEnabled:()=>automatic,accessToken:async()=> 'server-token',notificationUrl:'https://app.test/api/scamwin/connectors/teams/notifications',lifecycleUrl:'https://app.test/api/scamwin/connectors/teams/lifecycle',now:()=>new Date('2026-11-10T12:00:00Z'),fetch:async(input)=>{const url=String(input);return Response.json(url.includes('/me/chats')?{value:[{id:'secret-chat-id',topic:'Chosen chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}]}:{id:'secret-chat-id'});},recordGap:(ref,reason,n)=>fixture.store.recordCoverageGap(ref,reason,n),deleteItem:async()=>{}});
  const service=new TeamsService({core:fixture.store,store,adapter,enabled:()=>true,automaticEnabled:()=>automatic,readIdentity:async()=>({accountId:'verified',label:'Teams',metadata:{tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',grantKind:'delegated'}}),savePage:async()=> 'page-handle',consumePage:async()=>null});
  const page=await service.discover('owner',{id:c.id,epoch:c.epoch});assert.equal(page.items.length,1);assert.doesNotMatch(JSON.stringify(page),/secret-chat-id|server-token|aaaaaaaa/);
  await assert.rejects(service.discover('intruder',{id:c.id,epoch:c.epoch}));
  const input={id:c.id,epoch:c.epoch,scope:[page.items[0].handle],mode:'all_new',contains:'',consent:true,paused:false,automaticDailyLimit:1};
  await assert.rejects(service.configure('owner',input),/teams_automatic_pilot_required/);
  automatic=true;const saved=await service.configure('owner',input);assert.equal(saved.mode,'all_new');assert.equal(saved.epoch,c.epoch+1);
  assert.equal((await store.resources((await fixture.store.getConnection('owner',c.id))!)).length,1);
  await assert.rejects(service.configure('owner',input),/stale_connection/);
 }finally{await fixture.close();}
});
test('Teams form rejects unknown handles, invalid selective phrases and missing AI consent',()=>{
 const value={id:'connection',epoch:1,scope:['00000000-0000-4000-8000-000000000000'],mode:'manual',contains:'',consent:false,paused:false,automaticDailyLimit:1};
 assert.ok(teamsFormSchema.safeParse(value).success);
 for(const override of [{scope:['raw-chat-id']},{mode:'selective',consent:true},{mode:'all_new',consent:false}])assert.equal(teamsFormSchema.safeParse({...value,...override}).success,false);
});
test('Teams manual import requires explicit selected-chat permalink and never lists recent message bodies',async()=>{
 const tenant='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',link=`https://teams.microsoft.com/l/message/chat/123?tenantId=${tenant}`;
 assert.equal(teamsMessageLink(link,{chatId:'chat',tenantId:tenant}),'123');
 for(const bad of [link.replace('teams.microsoft.com','evil.test'),link.replace('/chat/','/excluded/'),link.replace(tenant,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),link.replace('https:','http:'),`https://teams.microsoft.com/l/message/chat/123`])assert.throws(()=>teamsMessageLink(bad,{chatId:'chat',tenantId:tenant}));
 const fixture=await createConnectorTestStore(Object.values(tables));
 try{
  const now=()=>new Date('2026-11-10T12:00:00Z'),c=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified',scope:['unselected']}),store=new TeamsStore(fixture.database,fixture.keyring,now),r=await store.saveResource(c,{chatId:'chat',label:'Chosen',tenantId:tenant}),next=await store.configure(c,{mode:'manual',scope:[r.handle],rules:{},paused:false,consent:false,automaticDailyLimit:1},undefined);
  await fixture.store.saveGrant(next,{accessToken:'verified-server-grant',scopes:['Chat.Read']});
  const calls:string[]=[],staged:string[]=[];const adapter=new TeamsAdapter({store,enabled:()=>true,automaticEnabled:()=>false,accessToken:async()=> 'token',notificationUrl:'https://app.test/notify',lifecycleUrl:'https://app.test/lifecycle',now,fetch:async(input)=>{calls.push(String(input));return Response.json({id:'123',chatId:'chat',createdDateTime:now().toISOString(),body:{contentType:'text',content:'Explicit selected message'},attachments:[]});},recordGap:async()=>{},deleteItem:async()=>{}});
  const service=new TeamsService({core:fixture.store,store,adapter,enabled:()=>true,automaticEnabled:()=>false,readIdentity:async()=>({accountId:'verified',label:'Teams',metadata:{tenantId:tenant,grantKind:'delegated'}}),savePage:async()=>'',consumePage:async()=>null,stageRevision:async(_ref,id)=>{staged.push(id);}});
  const selected=await service.importMessage('owner',{id:next.id,epoch:next.epoch,resourceHandle:r.handle,messageLink:link});assert.ok(selected.itemId);assert.equal(staged.length,1);assert.deepEqual(calls,['https://graph.microsoft.com/v1.0/chats/chat/messages/123']);assert.equal((await store.events(next,'0',50)).items.length,0);
 }finally{await fixture.close();}
});
