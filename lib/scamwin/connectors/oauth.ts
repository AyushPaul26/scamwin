// Server-only service; only the bounded authorization URL leaves the action boundary.
import {createHash,randomUUID} from 'node:crypto';
import type {ConnectorStore} from './contracts';
import {ConnectorStoreError} from './store';
import {authorizationConsentSchema} from './consent';
import {beginOAuthFlow} from './oauth-protocol';
import {oauthCallbackUri,type OAuthProvider} from './oauth-providers';
import {exchangeAuthorizationCode,type ProtocolHttp} from './token-client';
import {verifyProviderIdToken} from './oidc';
import type {OAuthPersistence} from './oauth-contracts';

export interface OAuthConfiguration {origin:string|null;enabled:boolean;providers:Partial<Record<OAuthProvider,{clientId:string;clientSecret:string;pilotSubjects:string[]|null}>>}
export function oauthConfiguration(env:Record<string,string|undefined>=process.env):OAuthConfiguration{
 let origin:string|null=null;try{if(env.APP_BASE_URL){oauthCallbackUri(env.APP_BASE_URL,'gmail');origin=new URL(env.APP_BASE_URL).origin;}}catch{}
 const providers:OAuthConfiguration['providers']={};
 for(const provider of ['gmail','outlook','telegram'] as const){
  const prefix=provider==='gmail'?'SCAMWIN_GOOGLE':provider==='outlook'?'SCAMWIN_MICROSOFT':'SCAMWIN_TELEGRAM',clientId=env[`${prefix}_CLIENT_ID`],clientSecret=env[`${prefix}_CLIENT_SECRET`];
  if(env[`SCAMWIN_CONNECTOR_${provider.toUpperCase()}_ENABLED`]!=='true'||!clientId||!clientSecret||clientId.length>512||clientSecret.length>16384)continue;
  if(provider!=='telegram'&&env[`${prefix}_REDIRECT_URI`]&&env[`${prefix}_REDIRECT_URI`]!==`${origin}/api/scamwin/connections/${provider}/callback`)continue;
  let pilotSubjects:string[]|null=null;
  if(provider==='gmail'){
   if(env.SCAMWIN_GMAIL_PUBLIC_ELIGIBLE!=='true'){
    if(env.SCAMWIN_GMAIL_TEST_USER_PILOT!=='true')continue;
    try{const list:unknown=JSON.parse(env.SCAMWIN_GMAIL_PILOT_SUBJECTS??'');if(!Array.isArray(list)||!list.length||list.length>100||!list.every(v=>typeof v==='string'&&v.length>0&&v.length<=300))continue;pilotSubjects=list;}catch{continue;}
   }
  }
  providers[provider]={clientId,clientSecret,pilotSubjects};
 }
 return {origin,enabled:env.SCAMWIN_CONNECTORS_ENABLED==='true',providers};
}
export function oauthCookieName(state:string){return `__Host-scamwin-oauth-${createHash('sha256').update(state).digest('hex').slice(0,32)}`;}
export const oauthCookieOptions={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/',maxAge:600};
export class ConnectorOAuthService{
 constructor(private readonly store:ConnectorStore&OAuthPersistence,private readonly options:{configuration:OAuthConfiguration;http:ProtocolHttp;now?:()=>number}){}
 private now(){return this.options.now?.()??Date.now();}
 private config(subject:string,provider:string){const c=this.options.configuration,p=c.providers[provider as OAuthProvider];if(!c.enabled||!c.origin||!p||(p.pilotSubjects&&!p.pilotSubjects.includes(subject)))throw new ConnectorStoreError('provider_unavailable');return {...p,origin:c.origin};}
 readiness(subject:string,provider:string){try{const p=this.config(subject,provider);return {status:'ready' as const,message:p.pilotSubjects?'Operator-approved test-user pilot. Real provider authorization is still required.':provider==='telegram'?'Identity verification available. Account monitoring requires separate installation and consent.':'Authorization setup available. Accepted permission does not prove sync is working.'};}catch{return {status:'unavailable' as const,message:'Provider authorization is unavailable. Manual checks remain available.'};}}
 async beginBrowser(subject:string,input:unknown,origin:string|null,setCookie:(name:string,value:string,options:typeof oauthCookieOptions)=>void){
  if(!this.options.configuration.origin||origin!==this.options.configuration.origin)throw new ConnectorStoreError('invalid_origin');
  const started=await this.begin(subject,input);setCookie(started.cookieName,started.browserBindingSecret,oauthCookieOptions);
  return {authorizationUrl:started.authorizationUrl};
 }
 async begin(subject:string,input:unknown){
  const v=authorizationConsentSchema.parse(input),config=this.config(subject,v.provider);let epoch=0;
  if(v.id){const current=await this.store.getConnection(subject,v.id);if(!current||current.provider!==v.provider)throw new ConnectorStoreError('connection_unavailable');if(current.epoch!==v.epoch)throw new ConnectorStoreError('stale_connection');epoch=current.epoch;}
  const start=beginOAuthFlow({provider:v.provider,owner:subject,connectionId:v.id??randomUUID(),epoch,clientId:config.clientId,appOrigin:config.origin,now:this.now(),requestRefreshConsent:v.provider==='gmail'});
  await this.store.saveProtectedOAuthFlow({flow:start.flow,resources:[v.provider==='telegram'?'identity':'inbox'],reconnect:!!v.id,consentAt:this.now()});
  return {authorizationUrl:start.authorizationUrl,browserBindingSecret:start.browserBindingSecret,cookieName:oauthCookieName(new URL(start.authorizationUrl).searchParams.get('state')!)};
 }
 async complete(subject:string,provider:string,query:URLSearchParams,browserBindingSecret?:string){
  const config=this.config(subject,provider);
  if(!['gmail','outlook','telegram'].includes(provider))throw new ConnectorStoreError('invalid_flow');
  const claimed=await this.store.claimProtectedOAuthFlow({provider:provider as OAuthProvider,owner:subject,currentEpoch:0,browserBindingSecret,query});
  if(!claimed)throw new ConnectorStoreError('invalid_flow');if(claimed.denied)throw new ConnectorStoreError(claimed.denied);
  const {flow}=claimed.saved;
  if(flow.clientId!==config.clientId||flow.redirectUri!==oauthCallbackUri(config.origin,flow.provider))throw new ConnectorStoreError('invalid_configuration');
  const tokens=await exchangeAuthorizationCode({flow,code:claimed.code!,clientSecret:config.clientSecret},this.options.http);
  if(!tokens.ok)throw new ConnectorStoreError(tokens.reason);
  const identity=await verifyProviderIdToken({provider:flow.provider,idToken:tokens.value.idToken,clientId:flow.clientId,nonce:flow.nonce,issuedAfter:flow.createdAt},this.options.http);
  if(!identity.ok)throw new ConnectorStoreError(identity.reason);
  this.config(subject,provider);
  const grant=tokens.value.kind==='mailbox_tokens'?{accessToken:tokens.value.accessToken,refreshToken:tokens.value.refreshToken,scopes:tokens.value.scopes,expiresAt:new Date(tokens.value.expiresAt).toISOString()}:null;
  return this.store.attachOAuthGrant(claimed.saved,identity.value,grant);
 }
}
