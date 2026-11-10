import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import * as tables from '../lib/db/scamwin-telegram-schema';
import {TelegramBindingStore} from '../lib/scamwin/connectors/telegram-store';
import {TelegramService} from '../lib/scamwin/connectors/telegram-service';
import {TelegramAdapter} from '../lib/scamwin/connectors/providers/telegram';
import {beginOAuthFlow} from '../lib/scamwin/connectors/oauth-protocol';
import {telegramWebhook} from '../lib/scamwin/connectors/telegram-webhook';
import {ConnectorRuntimeStore} from '../lib/scamwin/connectors/runtime-store';

const now=Date.parse('2026-11-10T12:00:00Z'),owner='auth0|telegram-events',token='123456789:abcdefghijklmnopqrstuvxyzABCDE';
let fixture:Awaited<ReturnType<typeof createConnectorTestStore>>;
before(async()=>{fixture=await createConnectorTestStore(Object.values(tables));});after(async()=>fixture.close());beforeEach(async()=>fixture.reset());
async function setup(options:{stageFailure?:boolean}={}){
 let clock=now,stageFailure=options.stageFailure;
 const started=beginOAuthFlow({provider:'telegram',owner,connectionId:randomUUID(),epoch:0,clientId:'client',appOrigin:'https://scamwin.example',now});
 let connection=await fixture.store.attachOAuthGrant({flow:started.flow,resources:['identity'],reconnect:false,consentAt:now},{provider:'telegram',issuer:'https://oauth.telegram.org',subject:'different-sub',telegramUserId:'123456',verifiedAt:now,expiresAt:now+300000},null);
 const bindings=new TelegramBindingStore(fixture.database,fixture.keyring,()=>new Date(clock)),staged:string[]=[],deletions:string[]=[];
 const business={id:'business',user:{id:123456},user_chat_id:123456,date:now/1000,is_enabled:true,rights:{}};
 let enabled=true;
 const service=new TelegramService(fixture.store,bindings,{username:'scamwin_test_bot',enabled:()=>enabled,now:()=>new Date(clock),getBusinessConnection:async()=>business,stageRevision:async(_ref,id)=>{if(stageFailure){stageFailure=false;throw Error('stage failed');}staged.push(id);},deleteItem:async(ref,id,database)=>{deletions.push(id);await new ConnectorRuntimeStore(database,fixture.keyring,()=>new Date(clock)).deleteProviderItem(ref,id);}});
 const link=await service.beginTelegramLink(owner,connection.id,connection.epoch);
 await service.handleUpdate({update_id:1,message:{chat:{id:123456,type:'private'},from:{id:123456},text:`/start ${new URL(link.deepLink).searchParams.get('start')}`}});
 await service.handleUpdate({update_id:2,business_connection:business});
 return {get connection(){return connection;},bindings,service,staged,deletions,advance(ms:number){clock+=ms;fixture.advance(ms);},setEnabled(value:boolean){enabled=value;},async mode(mode:'manual'|'all_new'|'selective',paused=false){const next=await service.configure(owner,connection.id,connection.epoch,{mode,scope:['identity'],rules:mode==='selective'?{contains:['scam']}:{},consent:true,paused,automaticDailyLimit:1});connection=(await fixture.store.getConnection(owner,connection.id))!;assert.equal(connection.epoch,next.epoch);}};
}
const message=(id=3,text='A message from another bot https://example.com')=>({update_id:id,business_message:{business_connection_id:'business',message_id:42,date:now/1000,chat:{id:999,type:'private'},from:{id:888,is_bot:true},text}});
test('webhook authenticates secret before reading body, bounds streaming input and waits for durable persistence',async()=>{
 let read=false,save=false;
 const request={headers:new Headers({'x-telegram-bot-api-secret-token':'wrong'}),get body(){read=true;throw Error('body accessed');}} as unknown as Request;
 assert.equal((await telegramWebhook(request,{secret:'correct-secret-32-characters-long',handle:async()=>{save=true;}})).status,401);assert.equal(read,false);assert.equal(save,false);
 const headers={'x-telegram-bot-api-secret-token':'correct-secret-32-characters-long','content-type':'application/json'};
 assert.equal((await telegramWebhook(new Request('https://scamwin.example',{method:'POST',headers,body:'x'.repeat(524289)}),{secret:headers['x-telegram-bot-api-secret-token'],handle:async()=>{save=true;}})).status,413);
 assert.equal(save,false);
 const result=await telegramWebhook(new Request('https://scamwin.example',{method:'POST',headers,body:'{"update_id":1}'}),{secret:headers['x-telegram-bot-api-secret-token'],handle:async()=>{throw Error('database failed');}});
 assert.equal(result.status,503);
});
test('Manual, paused and gates-off drop bodies, persist a deduplicated content-free unrecoverable gap',async()=>{
 const a=await setup();await a.service.handleUpdate(message());await a.service.handleUpdate(message());
 assert.equal((await fixture.store.listItems(a.connection)).items.length,0);
 let activity=(await fixture.store.listActivity(owner)).items.filter(x=>x.reason==='telegram_history_recovery_unavailable');assert.equal(activity.length,1);
 assert.ok(!JSON.stringify((await fixture.database.query('SELECT * FROM connector_telegram_events')).rows).includes('another bot'));
 await a.mode('all_new',true);await a.service.handleUpdate(message(4));
 await a.mode('all_new');a.setEnabled(false);await a.service.handleUpdate(message(5));
 a.setEnabled(true);assert.equal((await a.service.handleUpdate(message(5))).status,'ignored');
 assert.equal((await fixture.store.listItems(a.connection)).items.length,0);
 activity=(await fixture.store.listActivity(owner)).items.filter(x=>x.reason==='telegram_history_recovery_unavailable');assert.ok(activity.length>=3);
});
test('All imports other-bot private content, dedupes edits, rejects stale bodies and deletes without resurrection',async()=>{
 const a=await setup();await a.mode('all_new');
 await a.service.handleUpdate(message());await a.service.handleUpdate(message());assert.equal((await fixture.store.listItems(a.connection)).items.length,1);assert.equal(new Set(a.staged).size,1);
 const edited=message(5,'Edited scam');const raw=edited.business_message;
 await a.service.handleUpdate({update_id:5,edited_business_message:{...raw,edit_date:now/1000}});
 const item=(await fixture.store.listItems(a.connection)).items[0];assert.equal((await fixture.store.readRevisionContent(a.connection,item.latestRevisionId!))?.text,'Edited scam');
 assert.equal((await a.service.handleUpdate(message(4,'stale original'))).status,'ignored');
 await a.service.handleUpdate({update_id:6,deleted_business_messages:{business_connection_id:'business',chat:{id:999,type:'private'},message_ids:[42]}});assert.deepEqual(a.deletions,['999:42']);
 assert.equal(await a.bindings.readEvent(a.connection,'999:42'),null);
 assert.equal((await fixture.store.getItem(a.connection,item.id))?.state,'deleted');
 assert.equal(await fixture.store.readRevisionContent(a.connection,item.latestRevisionId!),null);
 assert.equal((await a.service.handleUpdate(message(7,'must never revive'))).status,'ignored');
});
test('non-private chats, before-activation messages and unsupported content have explicit coverage',async()=>{
 const a=await setup();await a.mode('all_new');
 const group=message();group.business_message.chat.type='supergroup';assert.equal((await a.service.handleUpdate(group)).status,'gap');
 const old=message(4);old.business_message.date=now/1000-100;assert.equal((await a.service.handleUpdate(old)).status,'gap');
 await a.service.handleUpdate({update_id:5,business_message:{...message().business_message,text:undefined,poll:{question:'private'}}});
 const item=(await fixture.store.listItems(a.connection)).items[0],revision=await fixture.store.getRevision(a.connection,item.latestRevisionId!);
 assert.equal(revision?.manifest.extraction?.coverage,'partial');assert.ok(revision?.manifest.extraction?.diagnostics.some(d=>d.reason==='telegram_unsupported_content'));
});
test('attachments use encrypted long provider IDs, reject forged refs and redact token-bearing transport errors',async()=>{
 const a=await setup();await a.mode('all_new');const fileId='telegram-file-id-'.repeat(100);
 await a.service.handleUpdate({update_id:3,business_message:{...message().business_message,text:undefined,photo:[{file_id:fileId,file_unique_id:'file-unique',file_size:4}]}});
 const calls:string[]=[];const adapter=new TelegramAdapter({bindings:a.bindings,botToken:token,enabled:()=>true,now:()=>new Date(now),fetch:async(url,init)=>{
  calls.push(String(url));assert.equal(init?.redirect,'error');
  return String(url).endsWith('/getFile')?Response.json({ok:true,result:{file_id:fileId,file_size:4,file_path:'photos/file.jpg'}}):new Response(Uint8Array.from([255,216,255,0]));
 }});
 const value=await adapter.readItem(a.connection,{id:'999:42',receivedAt:new Date(now).toISOString()},new AbortController().signal),attachment=value.attachments[0];
 assert.ok(attachment.id.length<200);assert.ok(!JSON.stringify(value).includes(fileId));
 const raw=await fixture.database.query('SELECT * FROM connector_telegram_events');assert.ok(!JSON.stringify(raw.rows).includes(fileId));
 await assert.rejects(adapter.readAttachment(a.connection,{id:'999:43',receivedAt:new Date(now).toISOString()},attachment,{maxBytes:100,deadlineAtMs:now+10000},new AbortController().signal),/attachment_unavailable/);assert.equal(calls.length,0);
 assert.equal((await adapter.readAttachment(a.connection,{id:'999:42',receivedAt:new Date(now).toISOString()},attachment,{maxBytes:100,deadlineAtMs:now+10000},new AbortController().signal)).length,4);assert.equal(calls.length,2);
 const bad=new TelegramAdapter({bindings:a.bindings,botToken:token,enabled:()=>true,now:()=>new Date(now),fetch:async url=>{throw Error(String(url));}});
 await assert.rejects(bad.readAttachment(a.connection,{id:'999:42',receivedAt:new Date(now).toISOString()},attachment,{maxBytes:100,deadlineAtMs:now+10000},new AbortController().signal),error=>error instanceof Error&&!error.message.includes(token));
});
test('pause during file metadata lookup fences the download despite a caller holding an active snapshot',async()=>{
 const a=await setup();await a.mode('all_new');const active=a.connection;
 await a.service.handleUpdate({update_id:3,business_message:{...message().business_message,text:undefined,photo:[{file_id:'saved-file',file_unique_id:'unique',file_size:4}]}});
 let downloads=0;
 const adapter=new TelegramAdapter({bindings:a.bindings,botToken:token,enabled:()=>true,now:()=>new Date(now),fetch:async url=>{
  if(String(url).endsWith('/getFile')){await a.mode('all_new',true);return Response.json({ok:true,result:{file_id:'saved-file',file_size:4,file_path:'photos/a.jpg'}});}
  downloads++;return new Response(Uint8Array.from([255,216,255,0]));
 }});
 const ref={id:'999:42',receivedAt:new Date(now).toISOString()},item=await adapter.readItem(active,ref,new AbortController().signal);
 await assert.rejects(adapter.readAttachment(active,ref,item.attachments[0],{maxBytes:100,deadlineAtMs:now+10000},new AbortController().signal),/source_unavailable/);
 assert.equal(downloads,0);
});
test('webhook replay repairs a post-commit staging failure without duplicate revisions',async()=>{
 const a=await setup({stageFailure:true});await a.mode('all_new');
 await assert.rejects(a.service.handleUpdate(message()),/stage failed/);
 assert.equal((await fixture.store.listItems(a.connection)).items.length,1);
 assert.equal((await a.service.handleUpdate(message())).status,'saved');assert.equal(a.staged.length,1);
 assert.equal((await fixture.database.query('SELECT count(*) AS n FROM connector_revisions')).rows[0].n,1);
});
test('paused deletion erases old source data and resume excludes delayed paused messages',async()=>{
 const a=await setup();await a.mode('all_new');await a.service.handleUpdate(message());const item=(await fixture.store.listItems(a.connection)).items[0];
 await a.mode('all_new',true);
 await a.service.handleUpdate({update_id:4,deleted_business_messages:{business_connection_id:'business',chat:{id:999,type:'private'},message_ids:[42]}});
 assert.equal((await fixture.store.getItem(a.connection,item.id))?.state,'deleted');
 a.advance(10000);await a.mode('all_new');
 const delayed=message(5);delayed.business_message.message_id=43;
 assert.equal((await a.service.handleUpdate(delayed)).status,'gap');
 assert.equal((await fixture.store.listItems(a.connection)).items.length,1);
});
test('linked automatic monitoring cannot be silently reset by generating another bot handoff',async()=>{
 const a=await setup();await a.mode('all_new');
 await assert.rejects(a.service.beginTelegramLink(owner,a.connection.id,a.connection.epoch),/telegram_manual_link_required/);
 assert.equal((await a.service.status(owner,a.connection.id,a.connection.epoch)).state,'automation_connected');
});
test('mutation-rights changes revoke an active binding before more bodies or attachments can be read',async()=>{
 const a=await setup();await a.mode('all_new');const active=a.connection;
 await a.service.handleUpdate({update_id:3,business_message:{...message().business_message,photo:[{file_id:'saved-file',file_unique_id:'unique',file_size:4}]}});
 let requests=0;
 const adapter=new TelegramAdapter({bindings:a.bindings,botToken:token,enabled:()=>true,now:()=>new Date(now),fetch:async()=>{requests++;throw Error('must not fetch');}});
 const ref={id:'999:42',receivedAt:new Date(now).toISOString()},saved=await adapter.readItem(active,ref,new AbortController().signal);
 const changed=await a.service.handleUpdate({update_id:4,business_connection:{id:'business',user:{id:123456},user_chat_id:123456,date:now/1000,is_enabled:true,rights:{can_reply:true}}});
 assert.equal(changed.status,'disabled');
 assert.equal((await fixture.store.getConnection(owner,active.id))?.status,'disconnected');
 assert.equal((await a.service.handleUpdate(message(5,'must not be retained'))).status,'unbound');
 await assert.rejects(adapter.readAttachment(active,ref,saved.attachments[0],{maxBytes:100,deadlineAtMs:now+10000},new AbortController().signal));
 assert.equal(requests,0);assert.equal((await fixture.database.query('SELECT count(*) AS n FROM connector_telegram_events')).rows[0].n,1);
});

test('expired Telegram link fences active monitoring and records relink coverage before acknowledging a message',async()=>{
 const a=await setup();await a.mode('all_new');const previous=a.connection;
 a.advance(90*86400000);
 const event=message(100,'expired-private-body');event.business_message.date=now/1000+90*86400;
 const secret='correct-secret-32-characters-long';
 const deliver=()=>telegramWebhook(new Request('https://scamwin.example',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(event)}),{secret,handle:value=>a.service.handleUpdate(value)});
 assert.equal((await deliver()).status,200);assert.equal((await deliver()).status,200);
 const current=await fixture.store.getConnection(owner,previous.id);
 assert.equal(current?.status,'disconnected');assert.equal(current?.epoch,previous.epoch+1);
 assert.equal((await fixture.store.listActivity(owner)).items.filter(v=>v.reason==='telegram_link_expired_relink_required').length,1);
 assert.equal((await fixture.database.query('SELECT connection_id FROM connector_telegram_links')).rows.length,0);
 assert.ok(!JSON.stringify((await fixture.database.query('SELECT * FROM connector_telegram_events')).rows).includes('expired-private-body'));
 assert.equal(await a.bindings.canRead(previous),false);
 await assert.rejects(a.service.status(owner,previous.id,previous.epoch),/telegram_link_expired_relink_required/);
});

test('quiet Telegram expiry is disclosed and fenced by purge without retaining expired private link metadata',async()=>{
 const a=await setup();await a.mode('all_new');const previous=a.connection;
 a.advance(90*86400000);
 await a.bindings.purge();await a.bindings.purge();
 const current=await fixture.store.getConnection(owner,previous.id);
 assert.equal(current?.status,'disconnected');assert.equal(current?.epoch,previous.epoch+1);
 assert.equal((await fixture.store.listActivity(owner)).items.filter(v=>v.reason==='telegram_link_expired_relink_required').length,1);
 assert.equal((await fixture.database.query('SELECT connection_id FROM connector_telegram_links')).rows.length,0);
});

test('Telegram status at link expiry requires relinking instead of showing identity-only automatic monitoring',async()=>{
 const a=await setup();await a.mode('all_new');const previous=a.connection;
 a.advance(90*86400000);
 await assert.rejects(a.service.status(owner,previous.id,previous.epoch),/telegram_link_expired_relink_required/);
 const current=await fixture.store.getConnection(owner,previous.id);
 assert.equal(current?.status,'disconnected');
});

test('fresh Telegram identity and explicit relink establish a new deadline without an old expiry fencing it',async()=>{
 const a=await setup();await a.mode('all_new');const previous=a.connection;
 a.advance(89*86400000);const freshTime=now+89*86400000;
 const flow=beginOAuthFlow({provider:'telegram',owner,connectionId:previous.id,epoch:previous.epoch,clientId:'client',appOrigin:'https://scamwin.example',now:freshTime}).flow;
 const reconnected=await fixture.store.attachOAuthGrant({flow,resources:['identity'],reconnect:true,consentAt:freshTime},{provider:'telegram',issuer:'https://oauth.telegram.org',subject:'different-sub',telegramUserId:'123456',verifiedAt:freshTime,expiresAt:freshTime+300000},null);
 const handoff=await a.service.beginTelegramLink(owner,reconnected.id,reconnected.epoch);
 await a.service.handleUpdate({update_id:1001,message:{chat:{id:123456,type:'private'},from:{id:123456},text:`/start ${new URL(handoff.deepLink).searchParams.get('start')}`}});
 await a.service.handleUpdate({update_id:1002,business_connection:{id:'business',user:{id:123456},user_chat_id:123456,date:freshTime/1000,is_enabled:true,rights:{}}});
 const configured=await a.service.configure(owner,reconnected.id,reconnected.epoch,{mode:'all_new',scope:['identity'],rules:{},consent:true,paused:false,automaticDailyLimit:1});
 a.advance(86400000);await a.bindings.purge();
 const current=await fixture.store.getConnection(owner,previous.id);assert.ok(current);
 assert.equal(current.status,'active');assert.equal(current.epoch,configured.epoch);
 assert.equal((await a.service.status(owner,current.id,current.epoch)).state,'automation_connected');
 assert.equal(await a.bindings.canRead(current),true);
 assert.equal((await fixture.store.listActivity(owner)).items.filter(v=>v.reason==='telegram_link_expired_relink_required').length,0);
});
