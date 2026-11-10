import assert from 'node:assert/strict';
import test from 'node:test';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import * as model from '../lib/db/scamwin-notification-schema';
import {PushSubscriptionService,validatedSubscription,genericPushPayload,pushConfiguration} from '../lib/scamwin/connectors/push';
import {generateRequestDetails,generateVAPIDKeys} from 'web-push';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createECDH} from 'node:crypto';
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-token',expirationTime:null,keys:{p256dh:createECDH('prime256v1').generateKeys().toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}};
test('push permits only known public service origins, fixed paths and ports',()=>{
 assert.equal(validatedSubscription.parse(subscription).endpoint,subscription.endpoint);
 assert.equal(validatedSubscription.safeParse({...subscription,keys:{...subscription.keys,p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url')}}).success,false,'Invalid curve point cannot be registered');
 for(const endpoint of ['http://fcm.googleapis.com/fcm/send/x','https://127.0.0.1/fcm/send/x','https://fcm.googleapis.com.evil.test/fcm/send/x','https://fcm.googleapis.com:8443/fcm/send/x','https://fcm.googleapis.com/other','https://fcm.googleapis.com/fcm/send/x?url=http://localhost','https://user@fcm.googleapis.com/fcm/send/x'])assert.equal(validatedSubscription.safeParse({...subscription,endpoint}).success,false,endpoint);
 assert.deepEqual(JSON.parse(genericPushPayload),{title:'Scamwin',body:'You have a private account update. Sign in to read it.',url:'/account/alerts'});
 assert.equal(pushConfiguration({}),null);assert.equal(pushConfiguration({SCAMWIN_WEB_PUSH_PUBLIC_KEY:'B'.repeat(87),SCAMWIN_WEB_PUSH_PRIVATE_KEY:'a'.repeat(43),SCAMWIN_WEB_PUSH_SUBJECT:'mailto:operator@example.com'}),null,'Device push stays default off even when keys exist');
});
test('maintained library encrypts the generic payload and service worker ignores private payload destinations without caching',async()=>{
 const keys=generateVAPIDKeys();const request=generateRequestDetails(subscription,genericPushPayload,{vapidDetails:{...keys,subject:'mailto:operator@example.com'},TTL:300});assert.equal(request.endpoint,subscription.endpoint);assert.ok(!String(request.body).includes('private account update'));assert.ok(request.headers.Authorization||request.headers.authorization);
 const handlers:Record<string,(event:unknown)=>void>={},shown:unknown[]=[],opened:string[]=[];const worker=await readFile('public/scamwin-notifications.js','utf8');
 vm.runInNewContext(worker,{URL,self:{location:{origin:'https://scamwin.example'},addEventListener:(name:string,handler:(event:unknown)=>void)=>{handlers[name]=handler;},registration:{showNotification:(...args:unknown[])=>{shown.push(args);return Promise.resolve();}},clients:{matchAll:async()=>[],openWindow:async(url:string)=>{opened.push(url);}}}});
 assert.deepEqual(Object.keys(handlers).sort(),['notificationclick','push']);let promise=Promise.resolve();handlers.push({data:{json:()=>({title:'Private subject',url:'https://provider.invalid/private'})},waitUntil:(p:Promise<void>)=>{promise=p;}});await promise;assert.ok(!JSON.stringify(shown).includes('Private subject'));handlers.notificationclick({notification:{close(){},data:{url:'https://provider.invalid/private'}},waitUntil:(p:Promise<void>)=>{promise=p;}});await promise;assert.deepEqual(opened,['https://scamwin.example/account/alerts']);
});
test('durable subscriptions are encrypted, owner fenced, and 404/410 cleanup cannot remove a newer generation',async()=>{
 const f=await createConnectorTestStore(Object.values(model));
 try{
 let calls=0;const service=new PushSubscriptionService(f.database,f.keyring,()=>new Date('2026-11-10T12:00:00Z'),async()=>{calls++;await service.register('alice',subscription);throw {statusCode:410};});
 await service.register('alice',subscription);const raw=(await f.database.query('SELECT encrypted_subscription FROM connector_push_subscriptions')).rows[0];assert.ok(!String(raw.encrypted_subscription).includes('synthetic-token'));
 await assert.rejects(service.register('mallory',subscription),/subscription_owned/);
 await service.deliver('alice');assert.equal(calls,1);assert.equal((await f.database.query('SELECT * FROM connector_push_subscriptions')).rows.length,1);
 const gone=new PushSubscriptionService(f.database,f.keyring,()=>new Date('2026-11-10T12:00:00Z'),async()=>{throw {statusCode:404};});await gone.deliver('alice');assert.equal((await f.database.query('SELECT * FROM connector_push_subscriptions')).rows.length,0);
 await gone.register('alice',subscription);await gone.revoke('alice');await gone.deliver('alice');assert.equal((await f.database.query('SELECT * FROM connector_push_subscriptions')).rows.length,0);
 }finally{await f.close();}
});

 test('in-flight device registration cannot recreate subscriptions after erasure',async()=>{
 const {advanceOwnerGeneration}=await import('../lib/scamwin/connectors/privacy-fence');
 const f=await createConnectorTestStore(Object.values(model));try{let intercept=true;
 const database:typeof f.database={query:f.database.query.bind(f.database),transaction:async fn=>{if(intercept){intercept=false;await f.database.transaction(sql=>advanceOwnerGeneration(sql,'alice'));}return f.database.transaction(fn);}};
 const service=new PushSubscriptionService(database,f.keyring);
 await assert.rejects(service.register('alice',subscription),/owner_data_erased/);
 assert.equal((await f.database.query('SELECT * FROM connector_push_subscriptions')).rows.length,0);
 }finally{await f.close();}
 });
