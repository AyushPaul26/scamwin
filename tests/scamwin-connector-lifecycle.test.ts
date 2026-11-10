import assert from 'node:assert/strict';
import {test,before,after,beforeEach} from 'node:test';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {ConnectorCredentialService} from '../lib/scamwin/connectors/credentials';
import {oauthConfiguration,ConnectorOAuthService} from '../lib/scamwin/connectors/oauth';
import {PostgresConnectorStore} from '../lib/scamwin/connectors/store';
import {ConnectorAccountService} from '../lib/scamwin/connectors/account-service';
import {hasReadonlyMailboxGrant} from '../lib/scamwin/connectors/consent';
const now=Date.parse('2026-11-10T12:00:00.000Z'),scope='https://www.googleapis.com/auth/gmail.readonly';
let fixture:Awaited<ReturnType<typeof createConnectorTestStore>>;
before(async()=>{fixture=await createConnectorTestStore();});after(async()=>fixture.close());beforeEach(async()=>fixture.reset());
const configuration=oauthConfiguration({APP_BASE_URL:'https://scamwin.example',SCAMWIN_CONNECTORS_ENABLED:'true',SCAMWIN_CONNECTOR_GMAIL_ENABLED:'true',SCAMWIN_GMAIL_PUBLIC_ELIGIBLE:'true',SCAMWIN_GOOGLE_CLIENT_ID:'client',SCAMWIN_GOOGLE_CLIENT_SECRET:'secret'});
async function connection(){const c=await fixture.store.createConnection('owner',{provider:'gmail',providerAccountId:'account',scope:['inbox']});await fixture.store.saveGrant(c,{accessToken:'old',refreshToken:'refresh-old',scopes:[scope],expiresAt:new Date(now-1).toISOString()});return c;}
test('mailbox grant readiness refuses mutation permissions even alongside read permission',()=>{
 assert.equal(hasReadonlyMailboxGrant('gmail',[scope,'https://www.googleapis.com/auth/gmail.modify']),false);
 assert.equal(hasReadonlyMailboxGrant('outlook',['Mail.Read','Mail.Send']),false);
 assert.equal(hasReadonlyMailboxGrant('outlook',['Mail.Read','https://graph.microsoft.com/Mail.ReadWrite']),false);
 assert.equal(hasReadonlyMailboxGrant('outlook',['openid','offline_access','https://graph.microsoft.com/Mail.Read']),true);
 assert.equal(hasReadonlyMailboxGrant('outlook',['mail.read']),true);
});
test('durable refresh across two service instances has one winner and atomically saves token rotation',async()=>{
 const c=await connection();let calls=0;let release!:()=>void;const held=new Promise<void>(r=>release=r);let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
 const http={now:()=>now,fetch:async()=>{calls++;entered();await held;return Response.json({access_token:'new',refresh_token:'rotated',token_type:'Bearer',expires_in:3600,scope});}};
 const a=new ConnectorCredentialService(fixture.store,{configuration,http,now:()=>now});
 const secondStore=new PostgresConnectorStore(fixture.database,{keyring:fixture.keyring,now:()=>new Date(now)}),b=new ConnectorCredentialService(secondStore,{configuration,http,now:()=>now});
 const first=a.accessToken(c,new AbortController().signal);await started;
 await assert.rejects(b.accessToken(c,new AbortController().signal),/refresh_in_progress/);release();assert.equal(await first,'new');
 assert.equal(await b.accessToken(c,new AbortController().signal),'new');assert.equal(calls,1);assert.equal((await fixture.store.readGrant(c))?.refreshToken,'rotated');
});
test('a live refresh blocks an epoch-changing settings save and a second caller; retry preserves the winning rotation',async()=>{
 const c=await connection();let exchanges=0,release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const http={now:()=>now,fetch:async()=>{exchanges++;entered();await held;return Response.json({access_token:'winner-access',refresh_token:'winner-rotation',token_type:'Bearer',expires_in:3600,scope});}};
 const credentials=new ConnectorCredentialService(fixture.store,{configuration,http,now:()=>now});
 const secondStore=new PostgresConnectorStore(fixture.database,{keyring:fixture.keyring,now:()=>new Date(now)}),second=new ConnectorCredentialService(secondStore,{configuration,http,now:()=>now});
 const settings={mode:'manual' as const,scope:['all_mail'],rules:{},consent:true,paused:false,automaticDailyLimit:1 as const};
 const first=credentials.accessToken(c,new AbortController().signal);await started;
 try{
  await assert.rejects(fixture.store.configureConnection(c,settings),/refresh_in_progress/);
  await assert.rejects(fixture.store.reconnectConnection(c.ownerId,c.id,c.epoch,'account',{accessToken:'reconnect-access',scopes:[scope]}),/refresh_in_progress/);
  const paused=await fixture.store.configureConnection(c,{...settings,scope:['inbox'],paused:true,automaticDailyLimit:2});assert.equal(paused.epoch,c.epoch);assert.equal(paused.status,'paused');
  const unchanged=(await fixture.store.getConnection(c.ownerId,c.id))!;assert.equal(unchanged.epoch,c.epoch);assert.deepEqual(unchanged.scope,['inbox']);
  await assert.rejects(second.accessToken(unchanged,new AbortController().signal),/refresh_in_progress/);assert.equal(exchanges,1);
 }finally{release();await first.catch(()=>{});}
 assert.equal(await first,'winner-access');
 const changed=await fixture.store.configureConnection(c,settings);assert.equal(changed.epoch,c.epoch+1);assert.equal((await fixture.store.readGrant(changed))?.refreshToken,'winner-rotation');
 assert.equal(await second.accessToken(changed,new AbortController().signal),'winner-access');assert.equal(exchanges,1);
});
test('omitted refresh token preserves prior token; disconnect during exchange fences the late write',async()=>{
 const c=await connection();const http={now:()=>now,fetch:async()=>Response.json({access_token:'new',token_type:'Bearer',expires_in:3600,scope})};
 const service=new ConnectorCredentialService(fixture.store,{configuration,http,now:()=>now});assert.equal(await service.accessToken(c,new AbortController().signal),'new');assert.equal((await fixture.store.readGrant(c))?.refreshToken,'refresh-old');
 await fixture.store.saveGrant(c,{accessToken:'old',refreshToken:'refresh-old',scopes:[scope],expiresAt:new Date(now-1).toISOString()});
 const racing=new ConnectorCredentialService(fixture.store,{configuration,http:{now:()=>now,fetch:async()=>{await fixture.store.revokeConnection(c.ownerId,c.id,c.epoch);return Response.json({access_token:'late',refresh_token:'late-refresh',token_type:'Bearer',expires_in:3600,scope});}},now:()=>now});
 await assert.rejects(racing.accessToken(c,new AbortController().signal),/stale_refresh/);assert.equal(await fixture.store.readGrant(c),null);
});
test('refresh cannot persist an unexpectedly expanded mutation grant',async()=>{
 const c=await connection();const service=new ConnectorCredentialService(fixture.store,{configuration,http:{now:()=>now,fetch:async()=>Response.json({access_token:'expanded',token_type:'Bearer',expires_in:3600,scope:`${scope} https://www.googleapis.com/auth/gmail.modify`})},now:()=>now});
 await assert.rejects(service.accessToken(c,new AbortController().signal),/missing_read_scope/);assert.equal((await fixture.store.readGrant(c))?.accessToken,'old');
});
test('expired refresh fence cannot overwrite a replacement and changed epoch cannot be restored',async()=>{
 const c=await connection(),first=(await fixture.store.leaseGrantRefresh(c))!;fixture.advance(31000);const next=(await fixture.store.leaseGrantRefresh(c))!;
 await assert.rejects(fixture.store.finishGrantRefresh(first,{accessToken:'stale',scopes:[scope]}),/stale_refresh/);
 fixture.advance(31000); // The replacement lease must also expire before an ordinary epoch change.
 await fixture.store.configureConnection(c,{mode:'manual',scope:['all_mail'],rules:{},consent:true,paused:false,automaticDailyLimit:1});
 await assert.rejects(fixture.store.finishGrantRefresh(next,{accessToken:'stale',scopes:[scope]}),/stale_refresh/);
});
test('remote revoke outage leaves local state disconnected with no reusable grant; Telegram never calls a remote revoke endpoint',async()=>{
 const c=await connection();let calls=0;const service=new ConnectorCredentialService(fixture.store,{configuration,http:{fetch:async()=>{calls++;assert.equal((await fixture.store.getConnection(c.ownerId,c.id))?.status,'disconnected');return new Response('',{status:503});}},now:()=>now});
 const result=await service.disconnect(c);assert.equal(result.connection.status,'disconnected');assert.equal(await fixture.store.readGrant(c),null);assert.equal(calls,1);
 const t=await fixture.store.createConnection('owner',{provider:'telegram',providerAccountId:'tg',scope:['identity']});await service.disconnect(t);assert.equal(calls,1);
});
test('credential ciphertext cannot be moved between connection contexts',async()=>{
 const c=await connection(),other=await fixture.store.createConnection('owner',{provider:'gmail',providerAccountId:'other',scope:['inbox']});
 await fixture.database.query('UPDATE connector_connections SET encrypted_grant=(SELECT encrypted_grant FROM connector_connections WHERE id=$1) WHERE id=$2',[c.id,other.id]);
 await assert.rejects(fixture.store.readGrant(other),/connector_decryption_failed/);
});
test('automatic mode refuses absent activation hooks and resource expansion requires consent without a new OAuth grant',async()=>{
 const c=await connection();await fixture.store.saveGrant(c,{accessToken:'valid',scopes:[scope],expiresAt:new Date(now+3600000).toISOString()});
 const account=new ConnectorAccountService(fixture.store,{enabled:true,cancel:async()=>{},now:()=>new Date(now)});
 const settings={id:c.id,epoch:c.epoch,mode:'all_new',scope:['inbox'],contains:'',consent:true,automaticDailyLimit:1};
 await assert.rejects(account.save(c.ownerId,settings),/activation_unavailable/);
 await assert.rejects(account.save(c.ownerId,{...settings,mode:'manual',scope:['all_mail'],consent:false}),/scope_consent_required/);
 const manual=await account.save(c.ownerId,{...settings,mode:'manual',scope:['all_mail']});assert.deepEqual(manual.scope,['All mail, including Spam and Trash']);assert.deepEqual((await fixture.store.getConnection(c.ownerId,c.id))?.scope,['all_mail']);assert.equal(manual.epoch,c.epoch+1);
 const withHook=new ConnectorAccountService(fixture.store,{enabled:true,cancel:async()=>{},now:()=>new Date(now),activation:async()=>({cursor:'activation-history',capturedAt:new Date(now).toISOString()})});
 const active=await withHook.save(c.ownerId,{...settings,epoch:manual.epoch,scope:['all_mail']});assert.equal(active.mode,'all_new');assert.equal((await fixture.store.readSyncCursor({...c,epoch:active.epoch}))?.cursor,'activation-history');
});
test('automatic save and resume respect provider disablement even with accepted grants and an installed activation hook',async()=>{
 const c=await connection();await fixture.store.saveGrant(c,{accessToken:'valid',scopes:[scope],expiresAt:new Date(now+3600000).toISOString()});
 const oauth=new ConnectorOAuthService(fixture.store,{configuration:oauthConfiguration({}),http:{fetch:async()=>{throw Error('network_forbidden');}}});
 const account=new ConnectorAccountService(fixture.store,{enabled:true,cancel:async()=>{},oauth,now:()=>new Date(now),activation:async()=>({cursor:'baseline',capturedAt:new Date(now).toISOString()})});
 await assert.rejects(account.save(c.ownerId,{id:c.id,epoch:c.epoch,mode:'all_new',scope:['inbox'],contains:'',consent:true,automaticDailyLimit:1}),/provider_unavailable/);
 const paused=await fixture.store.configureConnection(c,{mode:'all_new',scope:c.scope,rules:{},consent:true,paused:true,automaticDailyLimit:1});await assert.rejects(account.pause(c.ownerId,c.id,paused.epoch,false),/provider_unavailable/);
});
test('pause/resume, allowance-only saves and no-op saves retain the epoch, activation cursor and queued backlog',async()=>{
 const initial=await connection();await fixture.store.saveGrant(initial,{accessToken:'valid',scopes:[scope],expiresAt:new Date(now+3600000).toISOString()});
 const options={enabled:true,cancel:async()=>{},now:()=>new Date(now)};
 const activating=new ConnectorAccountService(fixture.store,{...options,activation:async()=>({cursor:'original-baseline',capturedAt:new Date(now).toISOString()})});
 const input={id:initial.id,epoch:initial.epoch,mode:'all_new',scope:['inbox'],contains:'',consent:true,automaticDailyLimit:1};
 const activated=await activating.save(initial.ownerId,input),c=(await fixture.store.getConnection(initial.ownerId,initial.id))!;
 const revision=await fixture.store.saveRevision(c,{providerItemId:'queued-source',revisionHash:'a'.repeat(64),receivedAt:new Date(now).toISOString(),text:'Queued fixture',urls:[],attachments:[]});
 const job=await fixture.store.enqueueTarget(c,{revisionId:revision.revision.id,targetId:'body-0',generation:1,input:{message:'Queued fixture',url:null,images:[]}});
 const lease=(await fixture.store.leaseConnection(c))!;await fixture.store.persistProviderPage(c,lease,{items:[{id:'pending-source',receivedAt:new Date(now).toISOString()}],pageState:null,finalCursor:'saved-checkpoint',complete:true,gaps:[]});await fixture.store.releaseConnectionLease(lease);
 const assertPreserved=async()=>{const current=(await fixture.store.getConnection(c.ownerId,c.id))!;assert.equal(current.epoch,c.epoch);assert.equal(current.activationAt,activated.activationAt);assert.deepEqual(await fixture.store.readSyncCursor(current),{cursor:'saved-checkpoint',pageState:null});assert.deepEqual((await fixture.store.listPendingProviderItems(current)).items.map(v=>v.id),['pending-source']);const jobs=await fixture.store.listRevisionJobs(current,revision.revision.id);assert.equal(jobs.find(v=>v.id===job.id)?.state,'queued');};
 // A hook installed for future changes must not run for preservation-only operations.
 const account=new ConnectorAccountService(fixture.store,{...options,activation:async()=>{throw Error('unexpected_new_activation');}});
 await account.pause(c.ownerId,c.id,c.epoch,true);await assertPreserved();await account.pause(c.ownerId,c.id,c.epoch,false);await assertPreserved();
 await account.save(c.ownerId,{...input,epoch:c.epoch,automaticDailyLimit:2});await assertPreserved();assert.equal((await fixture.store.getConnection(c.ownerId,c.id))?.automaticDailyLimit,2);
 await account.save(c.ownerId,{...input,epoch:c.epoch,automaticDailyLimit:2});await assertPreserved();
 // Resuming an already captured boundary does not require the activation hook to remain installed.
 const withoutHook=new ConnectorAccountService(fixture.store,options);await withoutHook.pause(c.ownerId,c.id,c.epoch,true);await withoutHook.pause(c.ownerId,c.id,c.epoch,false);await assertPreserved();
 // Even a redundant baseline supplied by a trusted caller cannot discard an unchanged boundary.
 await fixture.store.configureConnection(c,{mode:'all_new',scope:c.scope,rules:c.rules,consent:true,paused:false,automaticDailyLimit:2},{cursor:'unwanted-replacement',capturedAt:new Date(now).toISOString()});await assertPreserved();
});
test('genuine activation, resource, mode and selection-rule changes still capture a new baseline',async()=>{
 const initial=await connection();await fixture.store.saveGrant(initial,{accessToken:'valid',scopes:[scope],expiresAt:new Date(now+3600000).toISOString()});
 const account=new ConnectorAccountService(fixture.store,{enabled:true,cancel:async()=>{},now:()=>new Date(now),activation:async(_c,settings)=>({cursor:settings.mode==='selective'?`rule:${settings.rules.contains?.[0]}`:settings.scope.includes('all_mail')?'all-mail-boundary':'inbox-boundary',capturedAt:new Date(now).toISOString()})});
 let c=initial;
 for(const settings of [
  {mode:'all_new',scope:['inbox'],contains:'',cursor:'inbox-boundary'},
  {mode:'all_new',scope:['all_mail'],contains:'',cursor:'all-mail-boundary'},
  {mode:'selective',scope:['all_mail'],contains:'money',cursor:'rule:money'},
  {mode:'selective',scope:['all_mail'],contains:'offer',cursor:'rule:offer'},
 ]){
  const {cursor,...input}=settings;const saved=await account.save(c.ownerId,{id:c.id,epoch:c.epoch,...input,consent:true,automaticDailyLimit:1});assert.equal(saved.epoch,c.epoch+1);c=(await fixture.store.getConnection(c.ownerId,c.id))!;assert.equal((await fixture.store.readSyncCursor(c))?.cursor,cursor);
 }
});
