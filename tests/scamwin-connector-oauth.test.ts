import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {ConnectorOAuthService,oauthConfiguration,oauthCookieName} from '../lib/scamwin/connectors/oauth';
import type {ProtocolHttp} from '../lib/scamwin/connectors/token-client';
import {PostgresConnectorStore} from '../lib/scamwin/connectors/store';
import {openConnectorSecret,sealConnectorSecret} from '../lib/scamwin/connectors/crypto';
import type {ProtectedOAuthFlow} from '../lib/scamwin/connectors/oauth-contracts';
import {ConnectorCredentialService} from '../lib/scamwin/connectors/credentials';

const now=Date.parse('2026-11-10T12:00:00.000Z'), owner='auth0|owner';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'test',use:'sig',alg:'RS256'};
const env={APP_BASE_URL:'https://scamwin.example',SCAMWIN_CONNECTORS_ENABLED:'true',SCAMWIN_CONNECTOR_GMAIL_ENABLED:'true',SCAMWIN_GMAIL_TEST_USER_PILOT:'true',SCAMWIN_GMAIL_PILOT_SUBJECTS:JSON.stringify([owner,'auth0|other']),SCAMWIN_GOOGLE_CLIENT_ID:'client',SCAMWIN_GOOGLE_CLIENT_SECRET:'secret',SCAMWIN_CONNECTOR_TELEGRAM_ENABLED:'true',SCAMWIN_TELEGRAM_CLIENT_ID:'telegram-client',SCAMWIN_TELEGRAM_CLIENT_SECRET:'secret'};
let fixture:Awaited<ReturnType<typeof createConnectorTestStore>>;
before(async()=>{fixture=await createConnectorTestStore();});after(async()=>fixture.close());beforeEach(async()=>fixture.reset());
function setup(options:{issuer?:string;sub?:string;scope?:string;fail?:boolean;omitRefresh?:boolean;onExchange?:()=>Promise<void>}={}){
 let authorization:URL;let exchanges=0;
 const http:ProtocolHttp={now:()=>now,fetch:async(url,init)=>{
  if(url.includes('jwks')||url.includes('certs'))return Response.json({keys:[jwk]});
  exchanges++; await options.onExchange?.();
  if(options.fail)return Response.json({error:'private_provider_message'},{status:400});
  const telegram=authorization.hostname==='oauth.telegram.org';
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({iss:options.issuer??(telegram?'https://oauth.telegram.org':'https://accounts.google.com'),sub:options.sub??'account-one',id:'123456',aud:authorization.searchParams.get('client_id'),nonce:authorization.searchParams.get('nonce'),iat:now/1000,exp:now/1000+300})).toString('base64url');
  const id_token=`${head}.${body}.${sign('RSA-SHA256',Buffer.from(`${head}.${body}`),pair.privateKey).toString('base64url')}`;
  assert.equal(new URLSearchParams(String(init?.body)).get('grant_type'),'authorization_code');
  return Response.json({access_token:'access-secret',...(options.omitRefresh?{}:{refresh_token:'refresh-secret'}),token_type:'Bearer',expires_in:3600,scope:options.scope??'https://www.googleapis.com/auth/gmail.readonly',id_token});
 }};
 const service=new ConnectorOAuthService(fixture.store,{configuration:oauthConfiguration(env),http,now:()=>now});
 return {service,get exchanges(){return exchanges;},async begin(subject=owner,input:Record<string,unknown>={}){
  const start=await service.begin(subject,{provider:'gmail',consent:true,...input});authorization=new URL(start.authorizationUrl);
  return {...start,query:new URLSearchParams({state:authorization.searchParams.get('state')!,code:'code'})};
 }};
}
test('trusted origin normalizes an optional root slash and refuses paths, HTTP and credentials',()=>{
 assert.equal(oauthConfiguration({...env,APP_BASE_URL:'https://scamwin.example/'}).origin,'https://scamwin.example');
 for(const APP_BASE_URL of ['http://scamwin.example','https://scamwin.example/path','https://user:secret@scamwin.example'])assert.equal(oauthConfiguration({...env,APP_BASE_URL}).origin,null);
});
test('browser start enforces the configured origin and writes only a secure bound cookie while returning only the authorization URL',async()=>{
 const a=setup();const written:{name:string;value:string;options:unknown}[]=[];
 const write=(name:string,value:string,options:unknown)=>{written.push({name,value,options});};
 await assert.rejects(a.service.beginBrowser(owner,{provider:'gmail',consent:true},'https://foreign.example',write),/invalid_origin/);assert.equal(written.length,0);
 const result=await a.service.beginBrowser(owner,{provider:'gmail',consent:true},'https://scamwin.example',write);
 assert.deepEqual(Object.keys(result),['authorizationUrl']);assert.equal(written.length,1);
 assert.deepEqual(written[0].options,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600});assert.equal(written[0].name,oauthCookieName(new URL(result.authorizationUrl).searchParams.get('state')!));assert.ok(!result.authorizationUrl.includes(written[0].value));
});
test('begin keeps a provisional encrypted flow, exposes no fake connected account, and requires consent and pilot eligibility',async()=>{
 const a=setup(); const start=await a.begin();
 assert.equal((await fixture.store.listConnections(owner)).items.length,0);
 const raw=await fixture.database.query('SELECT * FROM connector_oauth_flows');
 assert.equal(raw.rows.length,1);assert.ok(!JSON.stringify(raw.rows).includes(start.browserBindingSecret));assert.ok(!JSON.stringify(raw.rows).includes('code_verifier'));
 assert.match(oauthCookieName(start.query.get('state')!),/^__Host-scamwin-oauth-/);
 await assert.rejects(a.begin(owner,{consent:false}));
 await assert.rejects(a.begin('auth0|not-allowed'),/provider_unavailable/);
 const disabled=new ConnectorOAuthService(fixture.store,{configuration:oauthConfiguration({...env,SCAMWIN_GMAIL_TEST_USER_PILOT:'false'}),http:{fetch:async()=>{throw Error('must not fetch');}},now:()=>now});
 await assert.rejects(disabled.begin(owner,{provider:'gmail',consent:true}),/provider_unavailable/);
});
test('callback rejects wrong browser, owner and provider without exchanging; valid callback is an atomic replay winner',async()=>{
 const a=setup(),start=await a.begin();
 const complete=(subject=owner,provider='gmail',secret:string|undefined=start.browserBindingSecret)=>a.service.complete(subject,provider,start.query,secret);
 await assert.rejects(complete(owner,'gmail','bad'),/invalid_binding/);
 await assert.rejects(complete('auth0|other'),/invalid_flow/);
 await assert.rejects(complete(owner,'telegram'),/invalid_flow/);
 assert.equal(a.exchanges,0);
 const results=await Promise.allSettled([complete(),complete()]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(a.exchanges,1);
 const connection=(await fixture.store.listConnections(owner)).items[0];
 assert.equal(connection.mode,'manual');assert.deepEqual(connection.scope,['inbox']);
 assert.equal((await fixture.store.readGrant(connection))?.accessToken,'access-secret');
 assert.ok(!JSON.stringify(connection).includes('secret'));
 await assert.rejects(complete(),/invalid_flow/);
});
test('denial consumes bound flow; missing read permission and exchange failure never attach an account',async()=>{
 const a=setup(),start=await a.begin();start.query.set('error','access_denied');start.query.delete('code');
 await assert.rejects(a.service.complete(owner,'gmail',start.query,start.browserBindingSecret),/consent_denied/);
 start.query.delete('error');start.query.set('code','code');await assert.rejects(a.service.complete(owner,'gmail',start.query,start.browserBindingSecret),/invalid_flow/);
 for(const options of [{scope:'openid email'},{scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify'},{fail:true}]){const b=setup(options),s=await b.begin();await assert.rejects(b.service.complete(owner,'gmail',s.query,s.browserBindingSecret));}
 assert.equal((await fixture.store.listConnections(owner)).items.length,0);
});
test('Google issuer aliases share uniqueness and reconnect rejects another account, owner and stale epoch',async()=>{
 const a=setup(),start=await a.begin();const c=await a.service.complete(owner,'gmail',start.query,start.browserBindingSecret);
 const other=setup({issuer:'accounts.google.com'}),s=await other.begin('auth0|other');await assert.rejects(other.service.complete('auth0|other','gmail',s.query,s.browserBindingSecret),/provider_account_owned/);
 const wrong=setup({sub:'different'}),w=await wrong.begin(owner,{id:c.id,epoch:c.epoch});await assert.rejects(wrong.service.complete(owner,'gmail',w.query,w.browserBindingSecret),/provider_account_mismatch/);
 const reconnect=setup({issuer:'accounts.google.com'}),r=await reconnect.begin(owner,{id:c.id,epoch:c.epoch});const saved=await reconnect.service.complete(owner,'gmail',r.query,r.browserBindingSecret);assert.equal(saved.id,c.id);assert.equal(saved.epoch,c.epoch+1);
 await assert.rejects(a.begin(owner,{id:c.id,epoch:c.epoch}),/stale_connection/);
});
test('disconnect or epoch change while exchanging cannot restore credentials',async()=>{
 const a=setup(),start=await a.begin();const c=await a.service.complete(owner,'gmail',start.query,start.browserBindingSecret);
 const race=setup({onExchange:async()=>{await fixture.store.revokeConnection(owner,c.id,c.epoch);}}),r=await race.begin(owner,{id:c.id,epoch:c.epoch});
 await assert.rejects(race.service.complete(owner,'gmail',r.query,r.browserBindingSecret),/connection_unavailable/);
 assert.equal((await fixture.store.getConnection(owner,c.id))?.status,'disconnected');assert.equal(await fixture.store.readGrant(c),null);
});
test('reconnect attachment rejects a live refresh and later preserves its winning rotation when code exchange omits refresh_token',async()=>{
 const a=setup(),start=await a.begin(),c=await a.service.complete(owner,'gmail',start.query,start.browserBindingSecret);
 const readScope='https://www.googleapis.com/auth/gmail.readonly';await fixture.store.saveGrant(c,{accessToken:'old',refreshToken:'refresh-old',scopes:[readScope],expiresAt:new Date(now-1).toISOString()});
 let entered!:()=>void,release!:()=>void,calls=0;const enteredPromise=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 const credentials=new ConnectorCredentialService(fixture.store,{configuration:oauthConfiguration(env),now:()=>now,http:{now:()=>now,fetch:async()=>{calls++;entered();await held;return Response.json({access_token:'rotated-access',refresh_token:'winning-rotation',token_type:'Bearer',expires_in:3600,scope:readScope});}}});
 const first=credentials.accessToken(c,new AbortController().signal);await enteredPromise;
 const reconnect=setup({omitRefresh:true}),attempt=await reconnect.begin(owner,{id:c.id,epoch:c.epoch});
 try{
  await assert.rejects(reconnect.service.complete(owner,'gmail',attempt.query,attempt.browserBindingSecret),/refresh_in_progress/);
  const unchanged=(await fixture.store.getConnection(owner,c.id))!;assert.equal(unchanged.epoch,c.epoch);await assert.rejects(credentials.accessToken(unchanged,new AbortController().signal),/refresh_in_progress/);assert.equal(calls,1);
 }finally{release();await first.catch(()=>{});}
 assert.equal(await first,'rotated-access');
 const retry=await reconnect.begin(owner,{id:c.id,epoch:c.epoch}),saved=await reconnect.service.complete(owner,'gmail',retry.query,retry.browserBindingSecret);
 assert.equal(saved.epoch,c.epoch+1);assert.equal((await fixture.store.readGrant(saved))?.refreshToken,'winning-rotation');assert.equal(calls,1);
});
test('Telegram attachment stores expiring numeric identity proof separately and never manufactures a mailbox credential',async()=>{
 const a=setup(),start=await a.begin(owner,{provider:'telegram'});const c=await a.service.complete(owner,'telegram',start.query,start.browserBindingSecret);
 assert.equal(await fixture.store.readGrant(c),null);const identity=await fixture.store.readIdentityProof(c);assert.equal(identity?.provider,'telegram');assert.equal(identity?.provider==='telegram'?identity.telegramUserId:null,'123456');assert.equal(identity?.subject,'account-one');
 assert.match(identity?.proofId??'',/^[A-Za-z0-9_-]{43}$/);
 const changed=await fixture.store.configureConnection(c,{mode:'manual',scope:c.scope,rules:{contains:['fixture']},consent:true,paused:false,automaticDailyLimit:1});assert.equal((await fixture.store.readIdentityProof(changed))?.proofId,identity?.proofId);assert.equal(await fixture.store.readIdentityProof(c),null);
 await fixture.store.revokeConnection(owner,c.id,changed.epoch);const row=(await fixture.database.query('SELECT encrypted_identity,encrypted_grant FROM connector_connections WHERE id=$1',[c.id])).rows[0];assert.deepEqual(row,{encrypted_identity:null,encrypted_grant:null});
});
test('expired state and corrupted protected PKCE never exchange; stale callback epoch is rejected',async()=>{
 const a=setup(),start=await a.begin();const wrong=new URLSearchParams(start.query);wrong.set('state','wrong-state');await assert.rejects(a.service.complete(owner,'gmail',wrong,start.browserBindingSecret),/invalid_flow/);
 fixture.advance(600001);await assert.rejects(a.service.complete(owner,'gmail',start.query,start.browserBindingSecret),/invalid_flow/);assert.equal(a.exchanges,0);
 await fixture.reset();const s=await a.begin();const row=(await fixture.database.query('SELECT * FROM connector_oauth_flows')).rows[0];
 const binding={ownerId:owner,connectionId:`oauth-v2:${row.id}`,epoch:1,purpose:'oauth' as const};const saved=JSON.parse(openConnectorSecret(String(row.encrypted_flow),binding,fixture.keyring)) as ProtectedOAuthFlow;
 saved.flow.pkceVerifier='A'.repeat(43);await fixture.database.query('UPDATE connector_oauth_flows SET encrypted_flow=$1 WHERE id=$2',[sealConnectorSecret(JSON.stringify(saved),binding,fixture.keyring),row.id]);
 await assert.rejects(a.service.complete(owner,'gmail',s.query,s.browserBindingSecret),/invalid_binding/);assert.equal(a.exchanges,0);
 await fixture.reset();const good=await a.begin(),c=await a.service.complete(owner,'gmail',good.query,good.browserBindingSecret),reconnect=await a.begin(owner,{id:c.id,epoch:c.epoch});
 await fixture.store.configureConnection(c,{mode:'manual',scope:['all_mail'],rules:{},consent:true,paused:false,automaticDailyLimit:1});await assert.rejects(a.service.complete(owner,'gmail',reconnect.query,reconnect.browserBindingSecret),/invalid_binding/);
});
test('attachment rollback never leaves a partial connected row when the transaction fails',async()=>{
 const a=setup(),start=await a.begin(),row=(await fixture.database.query('SELECT * FROM connector_oauth_flows')).rows[0];
 const saved=JSON.parse(openConnectorSecret(String(row.encrypted_flow),{ownerId:owner,connectionId:`oauth-v2:${row.id}`,epoch:1,purpose:'oauth'},fixture.keyring)) as ProtectedOAuthFlow;
 const failing=new PostgresConnectorStore({query:fixture.database.query,transaction:run=>fixture.database.transaction(sql=>run({query:(text,params)=>{if(text.startsWith('INSERT INTO connector_activity'))throw Error('synthetic_transaction_failure');return sql.query(text,params);}}))},{keyring:fixture.keyring,now:()=>new Date(now)});
 await assert.rejects(failing.attachOAuthGrant(saved,{provider:'gmail',issuer:'https://accounts.google.com',subject:'account-one',verifiedAt:now,expiresAt:now+300000},{accessToken:'access',scopes:['https://www.googleapis.com/auth/gmail.readonly']}),/synthetic_transaction_failure/);
 assert.equal((await fixture.store.listConnections(owner)).items.length,0);
 // The server callback can still commit after a transaction rollback; it has not consumed this test's flow.
 await a.service.complete(owner,'gmail',start.query,start.browserBindingSecret);assert.equal((await fixture.store.listConnections(owner)).items.length,1);
});

 test('already claimed OAuth callback cannot recreate data after owner erasure',async()=>{
 const {advanceOwnerGeneration}=await import('../lib/scamwin/connectors/privacy-fence');
 const a=setup({onExchange:async()=>{await fixture.database.transaction(sql=>advanceOwnerGeneration(sql,owner));}}),start=await a.begin();
 await assert.rejects(a.service.complete(owner,'gmail',start.query,start.browserBindingSecret),/owner_data_erased/);
 assert.equal((await fixture.store.listConnections(owner)).items.length,0);
 });
