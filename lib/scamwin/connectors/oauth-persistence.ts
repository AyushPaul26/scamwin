import {readOwnerGeneration,assertOwnerGeneration} from './privacy-fence';
import {randomUUID,createHash} from 'node:crypto';
import {connectorInsertSchemas} from '../../db/scamwin-connector-schema';
import {grantSchema,refSchema,ownerSchema,type ConnectionRef,type ConnectorGrant,type SavedConnection} from './contracts';
import {ConnectorStoreError,type ConnectorDatabase,type ConnectorSql} from './store';
import {openConnectorSecret,sealConnectorSecret,privateIdentifier,type ConnectorKeyring,type SecretBinding} from './crypto';
import {validateOAuthCallback,type OAuthCallbackInput} from './oauth-protocol';
import {hasReadonlyMailboxGrant} from './consent';
import type {VerifiedProviderIdentity} from './oidc';
import type {OAuthPersistence,ProtectedOAuthFlow,RefreshLease,ProviderIdentityProof} from './oauth-contracts';
import {validateResources} from './consent';

type Row={id:string;owner_id:string;provider:ConnectionRef['provider'];epoch:number;account_key:string;status:SavedConnection['status'];mode:SavedConnection['mode'];scope:string[];scope_version:number;rules:SavedConnection['rules'];activation_at:string|null;automatic_daily_limit:1|2;created_at:string;updated_at:string;encrypted_grant:string|null;encrypted_identity:string|null;refresh_lock_token:string|null;refresh_fence:number;refresh_until:string|null};
function fail(code:string):never{throw new ConnectorStoreError(code);}
const iso=(v:unknown)=>v instanceof Date?v.toISOString():String(v);
/** Call with the connection row locked. Ordinary epoch changes must retain the refresh winner. */
export function assertGrantRefreshIdle(refreshUntil:string|Date|null,nowMs:number){
 if(refreshUntil&&Date.parse(iso(refreshUntil))>nowMs)fail('refresh_in_progress');
}
function safeRow(c:Row):SavedConnection{return {id:c.id,ownerId:c.owner_id,provider:c.provider,epoch:c.epoch,mode:c.mode,status:c.status,scope:c.scope,scopeVersion:c.scope_version,rules:c.rules,activationAt:c.activation_at?iso(c.activation_at):null,automaticDailyLimit:c.automatic_daily_limit,createdAt:iso(c.created_at),updatedAt:iso(c.updated_at)};}
/** Only verified OIDC output reaches this function. Gmail issuer aliases intentionally collapse. */
export function providerIdentityKey(identity:VerifiedProviderIdentity){return identity.provider==='gmail'?JSON.stringify(['gmail',identity.subject]):identity.provider==='telegram'?JSON.stringify(['telegram',identity.telegramUserId]):JSON.stringify(['outlook',identity.issuer,identity.subject]);}
export class PostgresOAuthPersistence implements OAuthPersistence{
 constructor(private readonly db:ConnectorDatabase,private readonly options:{keyring:ConnectorKeyring;now?:()=>Date}){}
 private now(){return (this.options.now?.()??new Date()).valueOf();}
 private bind(ref:ConnectionRef,purpose:SecretBinding['purpose'],suffix=''):SecretBinding{return {ownerId:ref.ownerId,connectionId:suffix?`${ref.id}:${suffix}`:ref.id,epoch:ref.epoch,purpose};}
 private seal(value:unknown,ref:ConnectionRef,purpose:SecretBinding['purpose'],suffix=''){return sealConnectorSecret(JSON.stringify(value),this.bind(ref,purpose,suffix),this.options.keyring);}
 private open<T>(value:string,ref:ConnectionRef,purpose:SecretBinding['purpose'],suffix=''):T{return JSON.parse(openConnectorSecret(value,this.bind(ref,purpose,suffix),this.options.keyring)) as T;}
 private async row(db:ConnectorSql,ref:ConnectionRef,lock=false){refSchema.parse(ref);return (await db.query(`SELECT * FROM connector_connections WHERE id=$1 AND owner_id=$2 AND provider=$3 AND epoch=$4 AND status<>'disconnected' ${lock?'FOR UPDATE':''}`,[ref.id,ref.ownerId,ref.provider,ref.epoch])).rows[0] as Row|undefined;}
 async saveProtectedOAuthFlow(saved:ProtectedOAuthFlow){
  const {flow}=saved;ownerSchema.parse(flow.owner);if(flow.consumedAt!==null||flow.createdAt>this.now()||flow.expiresAt<=this.now()||flow.expiresAt-flow.createdAt>600000||!validateResources(flow.provider,saved.resources))fail('invalid_flow');
  const ref:ConnectionRef={id:'oauth-v2',ownerId:flow.owner,epoch:1,provider:flow.provider};
  saved={...saved,ownerGeneration:await readOwnerGeneration(this.db,flow.owner)};
  await this.db.transaction(async db=>{
   await assertOwnerGeneration(db,flow.owner,saved.ownerGeneration!);
   if(saved.reconnect){const c=(await db.query('SELECT epoch,provider FROM connector_connections WHERE id=$1 AND owner_id=$2 FOR UPDATE',[flow.connectionId,flow.owner])).rows[0];if(!c||c.epoch!==flow.epoch||c.provider!==flow.provider)fail('connection_unavailable');}
   const value=connectorInsertSchemas.oauth.parse({id:flow.stateHash,ownerId:flow.owner,provider:flow.provider,connectionId:saved.reconnect?flow.connectionId:null,expectedEpoch:saved.reconnect?flow.epoch:null,encryptedFlow:this.seal(saved,ref,'oauth',flow.stateHash),expiresAt:new Date(flow.expiresAt).toISOString()});
   await db.query('INSERT INTO connector_oauth_flows (id,owner_id,provider,connection_id,expected_epoch,encrypted_flow,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[value.id,value.ownerId,value.provider,value.connectionId,value.expectedEpoch,value.encryptedFlow,value.expiresAt]);
  });
 }
 async claimProtectedOAuthFlow(input:OAuthCallbackInput){
  if(!input.owner)return null;ownerSchema.parse(input.owner);const state=input.query.get('state');if(!state||state.length>128)return null;
  const hash=createHash('sha256').update(state).digest('base64url'),ref:ConnectionRef={id:'oauth-v2',ownerId:input.owner,epoch:1,provider:input.provider};
  return this.db.transaction(async db=>{
   const row=(await db.query('SELECT * FROM connector_oauth_flows WHERE id=$1 AND owner_id=$2 AND provider=$3 AND expires_at>$4 FOR UPDATE',[hash,input.owner,input.provider,new Date(this.now()).toISOString()])).rows[0];if(!row)return null;
   const saved=this.open<ProtectedOAuthFlow>(String(row.encrypted_flow),ref,'oauth',hash);let epoch=0;
   if(saved.reconnect){const current=(await db.query('SELECT epoch,provider FROM connector_connections WHERE id=$1 AND owner_id=$2',[saved.flow.connectionId,input.owner])).rows[0];if(!current||current.provider!==input.provider)return null;epoch=Number(current.epoch);}
   const result=validateOAuthCallback(saved.flow,{...input,currentEpoch:epoch},this.now());
   if(!result.ok&&!['consent_denied','provider_rejected'].includes(result.reason))fail(result.reason);
   const deleted=await db.query('DELETE FROM connector_oauth_flows WHERE id=$1 RETURNING id',[hash]);if(!deleted.rows.length)return null;
   return result.ok?{saved,code:result.value.code}:{saved,denied:result.reason};
  });
 }
 async attachOAuthGrant(saved:ProtectedOAuthFlow,identity:VerifiedProviderIdentity,grant:ConnectorGrant|null){
  const {flow}=saved;
  if(identity.provider!==flow.provider||identity.expiresAt<=this.now()||identity.verifiedAt>this.now()||flow.expiresAt<=this.now()||!validateResources(flow.provider,saved.resources))fail('invalid_identity');
  if(identity.provider==='telegram'){if(grant!==null||!/^\d+$/.test(identity.telegramUserId))fail('invalid_identity');}
  else if(!grant||!hasReadonlyMailboxGrant(identity.provider,grant.scopes))fail('missing_read_scope');
  if(grant)grantSchema.parse(grant);
  const accountRef:ConnectionRef={id:`account:${identity.provider}`,ownerId:'provider-account',epoch:1,provider:identity.provider};
  const accountKey=privateIdentifier(providerIdentityKey(identity),this.bind(accountRef,'identifier'),this.options.keyring);
  return this.db.transaction(async db=>{
   await assertOwnerGeneration(db,flow.owner,saved.ownerGeneration??0);
   let old:Row|undefined;
   if(saved.reconnect){old=(await db.query('SELECT * FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider=$4 FOR UPDATE',[flow.connectionId,flow.owner,flow.epoch,flow.provider])).rows[0] as Row|undefined;if(!old)fail('connection_unavailable');if(old.account_key!==accountKey)fail('provider_account_mismatch');}
   if(old)assertGrantRefreshIdle(old.refresh_until,this.now());
   const ref:ConnectionRef={id:flow.connectionId,ownerId:flow.owner,provider:flow.provider,epoch:old?old.epoch+1:1};
   // A reconnect may omit refresh_token; retain the previously authorized token for this exact identity.
   let attached=grant;
   if(grant&&!grant.refreshToken&&old?.encrypted_grant){const previous=grantSchema.parse(this.open(old.encrypted_grant,{...ref,epoch:old.epoch},'grant'));attached={...grant,refreshToken:previous.refreshToken};}
   const encryptedGrant=attached?this.seal(attached,ref,'grant'):null,encryptedIdentity=this.seal({...identity,proofId:flow.stateHash},ref,'grant','identity'),now=new Date(this.now()).toISOString();
   if(old){
    await db.query("UPDATE connector_connections SET epoch=$1,mode='manual',status='active',activation_at=NULL,encrypted_grant=$2,encrypted_identity=$3,encrypted_cursor=NULL,encrypted_page=NULL,cursor_expires_at=NULL,sync_token=NULL,sync_until=NULL,sync_fence=sync_fence+1,refresh_lock_token=NULL,refresh_until=NULL,refresh_fence=refresh_fence+1,updated_at=$4 WHERE id=$5",[ref.epoch,encryptedGrant,encryptedIdentity,now,ref.id]);
    await db.query("UPDATE connector_jobs SET state='canceled',reason='reconnected',lease_token=NULL,lease_until=NULL WHERE connection_id=$1 AND owner_id=$2 AND state IN ('queued','leased')",[ref.id,ref.ownerId]);
    await db.query('DELETE FROM connector_pending_items WHERE connection_id=$1',[ref.id]);
   }else{
    // Validation and encryption precede insertion; identity uniqueness and secret attachment commit together.
    const value=connectorInsertSchemas.connection.parse({id:ref.id,ownerId:ref.ownerId,provider:ref.provider,accountKey,epoch:1,mode:'manual',status:'active',scope:saved.resources,scopeVersion:1,rules:{},automaticDailyLimit:1,encryptedGrant,encryptedIdentity,createdAt:now,updatedAt:now});
    const result=await db.query("INSERT INTO connector_connections (id,owner_id,provider,account_key,epoch,mode,status,scope,scope_version,rules,automatic_daily_limit,encrypted_grant,encrypted_identity,created_at,updated_at) VALUES ($1,$2,$3,$4,1,'manual','active',$5::jsonb,1,'{}'::jsonb,1,$6,$7,$8,$8) ON CONFLICT(provider,account_key) DO NOTHING RETURNING id",[value.id,value.ownerId,value.provider,value.accountKey,JSON.stringify(value.scope),value.encryptedGrant,value.encryptedIdentity,now]);
    if(!result.rows.length){const existing=(await db.query('SELECT owner_id FROM connector_connections WHERE provider=$1 AND account_key=$2',[ref.provider,accountKey])).rows[0];fail(existing?.owner_id===flow.owner?'reconnect_required':'provider_account_owned');}
   }
   for(const reason of old?['reconnected_manual','reconnect_coverage_gap']:['connected_manual'])await db.query('INSERT INTO connector_activity (id,owner_id,connection_id,epoch,kind,reason,count,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8)',[randomUUID(),ref.ownerId,ref.id,ref.epoch,reason==='reconnect_coverage_gap'?'gap':'connection',reason,now,new Date(this.now()+90*86400000).toISOString()]);
   return safeRow((await db.query('SELECT * FROM connector_connections WHERE id=$1',[ref.id])).rows[0] as Row);
  });
 }
 async readIdentityProof(ref:ConnectionRef){const c=await this.row(this.db,ref);if(!c?.encrypted_identity)return null;const value=this.open<ProviderIdentityProof>(c.encrypted_identity,ref,'grant','identity');return value.expiresAt>this.now()?value:null;}
 async leaseGrantRefresh(ref:ConnectionRef):Promise<RefreshLease|null>{
  return this.db.transaction(async db=>{const c=await this.row(db,ref,true);if(!c?.encrypted_grant)fail('grant_missing');if(c.refresh_until&&Date.parse(iso(c.refresh_until))>this.now())return null;
   const token=randomUUID(),fence=c.refresh_fence+1,expiresAt=new Date(this.now()+30000).toISOString();
   await db.query('UPDATE connector_connections SET refresh_lock_token=$1,refresh_fence=$2,refresh_until=$3 WHERE id=$4',[token,fence,expiresAt,ref.id]);
   return {ref:refSchema.parse(ref),token,fence,expiresAt,grant:grantSchema.parse(this.open(c.encrypted_grant,ref,'grant'))};
  });
 }
 async finishGrantRefresh(lease:RefreshLease,grant:ConnectorGrant){
  const value=grantSchema.parse(grant);await this.db.transaction(async db=>{const c=await this.row(db,lease.ref,true);if(!c||c.refresh_lock_token!==lease.token||c.refresh_fence!==lease.fence||!c.refresh_until||Date.parse(iso(c.refresh_until))<=this.now())fail('stale_refresh');
   await db.query('UPDATE connector_connections SET encrypted_grant=$1,refresh_lock_token=NULL,refresh_until=NULL WHERE id=$2',[this.seal(value,lease.ref,'grant'),lease.ref.id]);
  });
 }
 async releaseGrantRefresh(lease:RefreshLease){await this.db.query('UPDATE connector_connections SET refresh_lock_token=NULL,refresh_until=NULL WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND refresh_lock_token=$4 AND refresh_fence=$5',[lease.ref.id,lease.ref.ownerId,lease.ref.epoch,lease.token,lease.fence]);}
}
