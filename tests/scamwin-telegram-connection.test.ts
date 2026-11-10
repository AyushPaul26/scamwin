import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import * as tables from '../lib/db/scamwin-telegram-schema';
import {TelegramBindingStore} from '../lib/scamwin/connectors/telegram-store';
import {TelegramService} from '../lib/scamwin/connectors/telegram-service';
import {beginOAuthFlow} from '../lib/scamwin/connectors/oauth-protocol';
import type {ConnectorDatabase} from '../lib/scamwin/connectors/store';

let fixture:Awaited<ReturnType<typeof createConnectorTestStore>>;
const now=Date.parse('2026-11-10T12:00:00Z'),owner='auth0|telegram-owner';
before(async()=>{fixture=await createConnectorTestStore(Object.values(tables));});
after(async()=>fixture.close());beforeEach(async()=>fixture.reset());
async function setup(options:{failFirstRevalidation?:boolean;failFirstBinding?:boolean}={}){
 const started=beginOAuthFlow({provider:'telegram',owner,connectionId:randomUUID(),epoch:0,clientId:'client',appOrigin:'https://scamwin.example',now});
 const saved={flow:started.flow,resources:['identity'],reconnect:false,consentAt:now};
 const connection=await fixture.store.attachOAuthGrant(saved,{provider:'telegram',issuer:'https://oauth.telegram.org',subject:'oidc-sub-not-the-id',telegramUserId:'123456',verifiedAt:now,expiresAt:now+300000},null);
 let failBinding=options.failFirstBinding;
 const database:ConnectorDatabase={query:fixture.database.query.bind(fixture.database),transaction:fn=>fixture.database.transaction(db=>fn({query:async(sql,params)=>{
  if(failBinding&&sql.startsWith('UPDATE connector_telegram_links SET business_key=')){failBinding=false;throw Error('binding_write_failed');}
  return db.query(sql,params);
 }}))};
 const bindings=new TelegramBindingStore(database,fixture.keyring,()=>new Date(now));
 const business={id:'business-connection',user:{id:123456},user_chat_id:123456,date:now/1000,is_enabled:true,rights:{}};
 let calls=0;
 const service=new TelegramService(fixture.store,bindings,{username:'scamwin_test_bot',enabled:()=>true,now:()=>new Date(now),getBusinessConnection:async()=>{calls++;if(options.failFirstRevalidation&&calls===1)throw Error('provider_timeout');return business;},stageRevision:async()=>{},deleteItem:async()=>{}});
 return {connection,bindings,service,business,get calls(){return calls;}};
}
const start=(token:string,user=123456,update=1)=>({update_id:update,message:{message_id:update,date:now/1000,chat:{id:user,type:'private'},from:{id:user},text:`/start ${token}`}});
test('OIDC numeric identity binds one-time start; forwarded nonce cannot redefine owner',async()=>{
 const a=await setup(),link=await a.service.beginTelegramLink(owner,a.connection.id,a.connection.epoch);
 const token=new URL(link.deepLink).searchParams.get('start')!;
 await assert.rejects(a.service.handleUpdate(start(token,999)),/telegram_identity_mismatch/);
 assert.equal((await a.service.handleUpdate(start(token))).status,'linked');
 await assert.rejects(a.service.handleUpdate(start(token,123456,2)),/telegram_link_unavailable/);
 assert.equal((await a.service.status(owner,a.connection.id,a.connection.epoch)).state,'awaiting_automation');
});
test('connection-before-link retains encrypted metadata only and revalidates fixed API before binding',async()=>{
 const a=await setup();
 assert.equal((await a.service.handleUpdate({update_id:1,business_connection:a.business})).status,'unbound');
 assert.equal(a.calls,0);
 const link=await a.service.beginTelegramLink(owner,a.connection.id,a.connection.epoch);
 assert.equal((await a.service.handleUpdate(start(new URL(link.deepLink).searchParams.get('start')!,123456,2))).status,'linked');
 assert.equal(a.calls,1);
 assert.equal((await a.service.status(owner,a.connection.id,a.connection.epoch)).state,'automation_connected');
 const raw=await fixture.database.query('SELECT * FROM connector_telegram_pending_connections');
 assert.ok(!JSON.stringify(raw.rows).includes('business-connection'));
});
test('stale epoch, group start and mutation rights never bind; disable cannot be revived by late enable',async()=>{
 const a=await setup(),link=await a.service.beginTelegramLink(owner,a.connection.id,a.connection.epoch),token=new URL(link.deepLink).searchParams.get('start')!;
 const group=start(token);group.message.chat.type='group';await assert.rejects(a.service.handleUpdate(group),/telegram_link_unavailable/);
 await a.service.handleUpdate(start(token));
 await assert.rejects(a.service.handleUpdate({update_id:2,business_connection:{...a.business,rights:{can_reply:true}}}),/telegram_mutation_rights/);
 await a.service.handleUpdate({update_id:3,business_connection:a.business});
 await a.service.handleUpdate({update_id:4,business_connection:{...a.business,is_enabled:false}});
 await a.service.handleUpdate({update_id:2,business_connection:a.business});
 assert.equal((await fixture.store.getConnection(owner,a.connection.id))?.status,'disconnected');
 await assert.rejects(a.service.beginTelegramLink(owner,a.connection.id,a.connection.epoch),/connection_unavailable/);
});
test('expired nonce and wrong website owner fail without linking; unmatched business owners retain no source bodies',async()=>{
 const a=await setup();
 await assert.rejects(a.service.beginTelegramLink('auth0|other',a.connection.id,a.connection.epoch),/connection_unavailable/);
 const link=await a.service.beginTelegramLink(owner,a.connection.id,a.connection.epoch),token=new URL(link.deepLink).searchParams.get('start')!;
 const expired=new TelegramBindingStore(fixture.database,fixture.keyring,()=>new Date(now+600001));
 await assert.rejects(expired.consumeStart(token,123456,1),/telegram_link_unavailable/);
 await a.service.handleUpdate({update_id:1,business_connection:{...a.business,user:{id:999}}});
 assert.equal((await fixture.store.listItems(a.connection)).items.length,0);
 assert.equal((await a.service.status(owner,a.connection.id,a.connection.epoch)).state,'identity_only');
});
test('fresh OIDC reconnect invalidates the old bot epoch until a new matching one-time handoff',async()=>{
 const a=await setup(),first=await a.service.beginTelegramLink(owner,a.connection.id,a.connection.epoch);
 await a.service.handleUpdate(start(new URL(first.deepLink).searchParams.get('start')!));await a.service.handleUpdate({update_id:2,business_connection:a.business});
 const flow=beginOAuthFlow({provider:'telegram',owner,connectionId:a.connection.id,epoch:a.connection.epoch,clientId:'client',appOrigin:'https://scamwin.example',now}).flow;
 const reconnected=await fixture.store.attachOAuthGrant({flow,resources:['identity'],reconnect:true,consentAt:now},{provider:'telegram',issuer:'https://oauth.telegram.org',subject:'oidc-sub-not-the-id',telegramUserId:'123456',verifiedAt:now,expiresAt:now+300000},null);
 assert.equal(reconnected.epoch,a.connection.epoch+1);assert.equal(reconnected.mode,'manual');
 assert.equal((await a.service.handleUpdate({update_id:3,business_message:{business_connection_id:a.business.id,text:'old-epoch body'}})).status,'unbound');
 assert.equal((await a.service.status(owner,reconnected.id,reconnected.epoch)).state,'identity_only');
 const fresh=await a.service.beginTelegramLink(owner,reconnected.id,reconnected.epoch);
 await a.service.handleUpdate(start(new URL(fresh.deepLink).searchParams.get('start')!,123456,4));
 await a.service.handleUpdate({update_id:5,business_connection:a.business});
 assert.equal((await a.service.status(owner,reconnected.id,reconnected.epoch)).state,'automation_connected');
 assert.equal((await fixture.store.listItems(reconnected)).items.length,0);
});
test('connection-before-link resumes the same claimed delivery after provider failure without accepting another sender',async()=>{
 const a=await setup({failFirstRevalidation:true});
 await a.service.handleUpdate({update_id:1,business_connection:a.business});
 const handoff=await a.service.beginTelegramLink(owner,a.connection.id,a.connection.epoch),nonce=new URL(handoff.deepLink).searchParams.get('start')!;
 await assert.rejects(a.service.handleUpdate(start(nonce,123456,2)),/provider_timeout/);
 await assert.rejects(a.service.handleUpdate(start(nonce,999,2)),/telegram_identity_mismatch/);
 await assert.rejects(a.service.handleUpdate(start(nonce,123456,3)),/telegram_link_unavailable/);
 assert.equal((await a.service.handleUpdate(start(nonce,123456,2))).status,'linked');
 assert.equal((await a.service.status(owner,a.connection.id,a.connection.epoch)).state,'automation_connected');
 assert.equal(a.calls,2);
 assert.equal((await a.service.handleUpdate(start(nonce,123456,2))).status,'linked');assert.equal(a.calls,2,'Completed redelivery is idempotent');
});
test('claimed start remains resumable when the revalidated business binding write fails',async()=>{
 const a=await setup({failFirstBinding:true});await a.service.handleUpdate({update_id:1,business_connection:a.business});
 const handoff=await a.service.beginTelegramLink(owner,a.connection.id,a.connection.epoch),nonce=new URL(handoff.deepLink).searchParams.get('start')!;
 await assert.rejects(a.service.handleUpdate(start(nonce,123456,2)),/binding_write_failed/);
 assert.equal((await a.service.status(owner,a.connection.id,a.connection.epoch)).state,'awaiting_automation');
 assert.equal((await a.service.handleUpdate(start(nonce,123456,2))).status,'linked');
 assert.equal((await a.service.status(owner,a.connection.id,a.connection.epoch)).state,'automation_connected');
});
