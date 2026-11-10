// Server-only credential boundary. Never serialize this service's return values into UI/job DTOs.
import type {ConnectionRef,ConnectorGrant,ConnectorStore,RevocationResult} from './contracts';
import type {OAuthPersistence} from './oauth-contracts';
import type {OAuthConfiguration} from './oauth';
import {ConnectorStoreError} from './store';
import {hasReadonlyMailboxGrant} from './consent';
import {refreshMailboxToken,revokeMailboxToken,type ProtocolHttp} from './token-client';

export class ConnectorCredentialService{
 constructor(private readonly store:ConnectorStore&OAuthPersistence,private readonly options:{configuration:OAuthConfiguration;http:ProtocolHttp;now?:()=>number}){}
 private now(){return this.options.now?.()??Date.now();}
 private transport(signal:AbortSignal):ProtocolHttp{return {...this.options.http,fetch:(url,init)=>this.options.http.fetch(url,{...init,signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])})};}
 async accessToken(ref:ConnectionRef,signal:AbortSignal):Promise<string>{
  signal.throwIfAborted();if(ref.provider!=='gmail'&&ref.provider!=='outlook')throw new ConnectorStoreError('mailbox_credential_unavailable');
  if(!this.options.configuration.enabled)throw new ConnectorStoreError('service_disabled');
  const client=this.options.configuration.providers[ref.provider];if(!client||(client.pilotSubjects&&!client.pilotSubjects.includes(ref.ownerId)))throw new ConnectorStoreError('provider_unavailable');
  const existing=await this.store.readGrant(ref);if(!existing)throw new ConnectorStoreError('grant_missing');
  if(!hasReadonlyMailboxGrant(ref.provider,existing.scopes))throw new ConnectorStoreError('missing_read_scope');
  if(existing.expiresAt&&Date.parse(existing.expiresAt)>this.now()+30000)return existing.accessToken;
  const lease=await this.store.leaseGrantRefresh(ref);if(!lease)throw new ConnectorStoreError('refresh_in_progress');
  try{
   // Another worker may have completed after our first read but before this durable lease.
   if(lease.grant.expiresAt&&Date.parse(lease.grant.expiresAt)>this.now()+30000)return lease.grant.accessToken;
   if(!lease.grant.refreshToken)throw new ConnectorStoreError('reconnect_required');
   const result=await refreshMailboxToken({provider:ref.provider,clientId:client.clientId,clientSecret:client.clientSecret,refreshToken:lease.grant.refreshToken,scopes:lease.grant.scopes},this.transport(signal));
   signal.throwIfAborted();if(!result.ok)throw new ConnectorStoreError(result.reason);
   if(!hasReadonlyMailboxGrant(ref.provider,result.value.scopes))throw new ConnectorStoreError('missing_read_scope');
   const grant:ConnectorGrant={accessToken:result.value.accessToken,refreshToken:result.value.refreshToken??lease.grant.refreshToken,scopes:result.value.scopes,expiresAt:new Date(result.value.expiresAt).toISOString()};
   await this.store.finishGrantRefresh(lease,grant);return grant.accessToken;
  }finally{await this.store.releaseGrantRefresh(lease);}
 }
 identityProof(ref:ConnectionRef){return this.store.readIdentityProof(ref);}
 async disconnect(ref:ConnectionRef,signal=new AbortController().signal){
  // Keep only the bounded in-flight revocation token; local invalidation never waits for a provider.
  let grant:ConnectorGrant|null=null;try{grant=await this.store.readGrant(ref);}catch{}
  const result=await this.store.revokeConnection(ref.ownerId,ref.id,ref.epoch);
  let remote:RevocationResult={status:'unavailable',reason:'provider_account_removal_required'};
  if(ref.provider==='gmail'&&grant&&!signal.aborted){try{const revoked=await revokeMailboxToken({provider:'gmail',token:grant.refreshToken??grant.accessToken},this.transport(signal));remote=revoked.ok?{status:'revoked'}:{status:'unavailable',reason:'remote_revocation_unavailable'};}catch{remote={status:'unavailable',reason:'remote_revocation_unavailable'};}}
  return {...result,remote};
 }
 async revoke(ref:ConnectionRef,signal:AbortSignal):Promise<RevocationResult>{return (await this.disconnect(ref,signal)).remote;}
}
