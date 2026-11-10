import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {TeamsAuthorizationDriver,TEAMS_SCOPES} from '../lib/scamwin/connectors/teams-auth';
const now=Date.parse('2026-11-10T12:00:00Z'),tenant='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const input={code:'authorization-code',redirectUri:'https://app.test/api/scamwin/connectors/expanded/teams/callback',verifier:'v'.repeat(43),nonce:'n'.repeat(43),issuedAfter:now-1000,signal:AbortSignal.timeout(5000)};
function setup(options:{tenant?:string;aud?:string;nonce?:string;scope?:string}={}){
 const calls:{url:string;init?:RequestInit}[]=[];
 const driver=new TeamsAuthorizationDriver({clientId:'teams-client',clientSecret:'teams-secret'},async(url,init)=>{
  calls.push({url:String(url),init});
  if(String(url).includes('discovery'))return Response.json({keys:[{...pair.publicKey.export({format:'jwk'}),kid:'key',issuer:'https://login.microsoftonline.com/{tenantid}/v2.0',alg:'RS256',use:'sig'}]});
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'key'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:`https://login.microsoftonline.com/${options.tenant??tenant}/v2.0`,tid:options.tenant??tenant,sub:'verified-subject',aud:options.aud??'teams-client',nonce:options.nonce??input.nonce,iat:now/1000,exp:now/1000+3600})).toString('base64url');
  return Response.json({token_type:'Bearer',access_token:'access',refresh_token:'rotated',expires_in:3600,scope:options.scope??'openid profile offline_access https://graph.microsoft.com/Chat.Read',id_token:`${header}.${body}.${sign('RSA-SHA256',Buffer.from(`${header}.${body}`),pair.privateKey).toString('base64url')}`});
 },()=>now);
 return {driver,calls};
}
test('Teams authorization requests only delegated selected-chat identity scopes at organizations endpoint',()=>{
 const {driver}=setup();const url=new URL(driver.authorizationUrl({state:'s'.repeat(43),redirectUri:input.redirectUri,verifier:input.verifier,nonce:input.nonce}));
 assert.equal(url.origin,'https://login.microsoftonline.com');assert.equal(url.pathname,'/organizations/oauth2/v2.0/authorize');assert.equal(url.searchParams.get('scope'),TEAMS_SCOPES.join(' '));assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.doesNotMatch(url.toString(),/ChannelMessage|Mail.Read|\.default/);
});
test('Teams exchanges at organizations, uses Teams audience and saves verified tenant identity with actual scopes',async()=>{
 const {driver,calls}=setup();const result=await driver.exchange(input);assert.equal(result.identity.accountId,`${tenant}:verified-subject`);assert.equal(result.identity.metadata.tenantId,tenant);assert.ok(result.grant.scopes.includes('https://graph.microsoft.com/Chat.Read'));
 assert.equal(calls[0].url,'https://login.microsoftonline.com/organizations/oauth2/v2.0/token');const form=new URLSearchParams(String(calls[0].init?.body));assert.equal(form.get('code_verifier'),input.verifier);assert.equal(form.get('client_id'),'teams-client');assert.equal(calls[0].init?.redirect,'error');
});
test('Teams rejects consumer tenants, wrong audience/nonce and incomplete grants',async()=>{
 for(const options of [{tenant:'9188040d-6c67-4c5b-b112-36a304b66dad'},{aud:'outlook-client'},{nonce:'wrong'},{scope:'openid profile'}])await assert.rejects(setup(options).driver.exchange(input));
});
test('Teams refresh rotates pair separately from subscription renewal and preserves missing refresh token only',async()=>{
 const {driver,calls}=setup();const result=await driver.refresh({accessToken:'old',refreshToken:'refresh',scopes:['Chat.Read'],expiresAt:new Date(now-1000).toISOString()},input.signal);assert.equal(result.refreshToken,'rotated');assert.equal(new URLSearchParams(String(calls[0].init?.body)).get('grant_type'),'refresh_token');assert.ok(!calls.some(c=>c.url.includes('subscriptions')));
});
