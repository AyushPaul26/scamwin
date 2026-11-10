import {createHash} from 'node:crypto';
import type {ConnectorGrant} from './contracts';
import {grantSchema} from './contracts';
import type {ExpandedAuthorizationDriver,ExpandedIdentity} from './expanded-auth';
import {verifyProviderIdToken} from './oidc';
import {ConnectorStoreError} from './store';
import {teamsRecord} from './teams-store';

export const TEAMS_SCOPES=['openid','profile','offline_access','https://graph.microsoft.com/Chat.Read'] as const;
const AUTHORIZATION='https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize';
const TOKEN='https://login.microsoftonline.com/organizations/oauth2/v2.0/token';
const fail=(code:string):never=>{throw new ConnectorStoreError(code);};
const bounded=(v:unknown,max=16384):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
export const hasTeamsReadScope=(scopes:readonly string[])=>scopes.some(s=>['chat.read','https://graph.microsoft.com/chat.read'].includes(s.toLowerCase()));
export class TeamsAuthorizationDriver implements ExpandedAuthorizationDriver{
 readonly provider='teams' as const;
 constructor(private readonly configuration:{clientId:string;clientSecret:string},private readonly fetcher:typeof fetch=fetch,private readonly now:()=>number=Date.now){if(!bounded(configuration.clientId,512)||!bounded(configuration.clientSecret))fail('provider_unavailable');}
 private redirect(uri:string){let url:URL;try{url=new URL(uri);}catch{return fail('invalid_origin');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/api/scamwin/connectors/expanded/teams/callback')fail('invalid_origin');return url.toString();}
 authorizationUrl(input:{state:string;redirectUri:string;verifier:string;nonce:string}){
  for(const secret of [input.state,input.verifier,input.nonce])if(!/^[A-Za-z0-9_-]{43,128}$/.test(secret))fail('invalid_flow');
  const url=new URL(AUTHORIZATION);url.search=new URLSearchParams({client_id:this.configuration.clientId,response_type:'code',response_mode:'query',redirect_uri:this.redirect(input.redirectUri),scope:TEAMS_SCOPES.join(' '),state:input.state,nonce:input.nonce,code_challenge:createHash('sha256').update(input.verifier).digest('base64url'),code_challenge_method:'S256'}).toString();return url.toString();
 }
 private async token(fields:URLSearchParams,signal:AbortSignal){
  signal.throwIfAborted();fields.set('client_id',this.configuration.clientId);fields.set('client_secret',this.configuration.clientSecret);
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const work=async()=>{
   const response=await this.fetcher(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:fields.toString(),signal:controller.signal,redirect:'error',cache:'no-store'});
   if(response.redirected||response.url&&response.url!==TOKEN||response.status>=300&&response.status<400)fail('provider_rejected');
   if(!response.ok)fail(response.status===400?'reconnect_required':'provider_rejected');
   const declared=response.headers.get('Content-Length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>65536))return fail('response_too_large');if(!response.body)return fail('malformed_response');reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
   while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>65536)fail('response_too_large');chunks.push(part.value);}
   let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{return fail('malformed_response');}if(!teamsRecord(value)||value.error!==undefined)return fail('provider_rejected');return value;
  };
  try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ConnectorStoreError('provider_timeout'));},10000);controller.signal.addEventListener('abort',()=>reject(new ConnectorStoreError('provider_aborted')),{once:true});})]);}
  catch(error){if(error instanceof ConnectorStoreError)throw error;return fail('provider_unavailable');}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
 }
 private grant(body:Record<string,unknown>,previous?:ConnectorGrant):ConnectorGrant{
  if(!bounded(body.access_token)||typeof body.token_type!=='string'||body.token_type.toLowerCase()!=='bearer'||!Number.isSafeInteger(body.expires_in)||Number(body.expires_in)<=0||Number(body.expires_in)>604800||!bounded(body.scope,4096)||body.refresh_token!==undefined&&!bounded(body.refresh_token))return fail('malformed_response');
  const scopes=[...new Set(body.scope.split(/ +/).filter(Boolean))];if(!hasTeamsReadScope(scopes))return fail('missing_read_scope');
  return grantSchema.parse({accessToken:body.access_token,...(body.refresh_token||previous?.refreshToken?{refreshToken:body.refresh_token??previous?.refreshToken}:{}),scopes,expiresAt:new Date(this.now()+Number(body.expires_in)*1000).toISOString()});
 }
 async exchange(input:{code:string;redirectUri:string;verifier:string;nonce:string;issuedAfter:number;signal:AbortSignal}):Promise<{identity:ExpandedIdentity;grant:ConnectorGrant}>{
  if(!bounded(input.code)||!/^[A-Za-z0-9_-]{43,128}$/.test(input.verifier)||!/^[A-Za-z0-9_-]{43,128}$/.test(input.nonce))return fail('invalid_flow');
  const body=await this.token(new URLSearchParams({grant_type:'authorization_code',code:input.code,redirect_uri:this.redirect(input.redirectUri),code_verifier:input.verifier,scope:TEAMS_SCOPES.join(' ')}),input.signal);
  const grant=this.grant(body);if(!bounded(body.id_token,32768))return fail('invalid_identity');
  // The legacy 'outlook' selector is explicitly the accepted Microsoft issuer/JWKS cryptographic primitive.
  // It receives the TEAMS client audience/nonce; no Outlook scope, grant or identity is inherited or cast.
  const verified=await verifyProviderIdToken({provider:'outlook',idToken:body.id_token,clientId:this.configuration.clientId,nonce:input.nonce,issuedAfter:input.issuedAfter},{fetch:(url,init)=>this.fetcher(url,{...init,signal:AbortSignal.any([input.signal,...(init?.signal?[init.signal]:[])])}),now:this.now});
  input.signal.throwIfAborted();if(!verified.ok)return fail('invalid_identity');
  const match=/^https:\/\/login\.microsoftonline\.com\/([a-f0-9-]{36})\/v2\.0$/.exec(verified.value.issuer),tenantId=match?.[1];
  if(!tenantId||tenantId==='9188040d-6c67-4c5b-b112-36a304b66dad')return fail('teams_work_school_required');
  return {identity:{accountId:`${tenantId}:${verified.value.subject}`,label:'Teams work or school account',metadata:{tenantId,subject:verified.value.subject,grantKind:'delegated',coverage:'selected_chats'}},grant};
 }
 async refresh(grant:ConnectorGrant,signal:AbortSignal){if(!bounded(grant.refreshToken))return fail('reconnect_required');const body=await this.token(new URLSearchParams({grant_type:'refresh_token',refresh_token:grant.refreshToken,scope:TEAMS_SCOPES.join(' ')}),signal);return this.grant(body,grant);}
}
