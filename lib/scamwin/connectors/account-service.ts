import {expandedProviderReadiness} from './provider-readiness';
import {hasTeamsReadScope} from './teams-auth';
import {slackHasClass} from './slack-protocol';
// Server service: never return readGrant values to an action or a read API.
import type {ConnectorStore, SavedConnection,ConnectionSettings} from './contracts';
import type {ActivationBaseline} from './oauth-contracts';
import type {ConnectorOAuthService} from './oauth';
import type {ConnectorCredentialService} from './credentials';
import {hasReadonlyMailboxGrant} from './consent';
import {validateResources} from './consent';
import {canonicalHash} from './policy';
import {ConnectorStoreError} from './store';
import {connectionCard,connectionSettingsInput,listInput,providerLabels,type GrantReadiness,type ConnectionPage} from './ui';

export type ProviderActivationHook=(connection:SavedConnection,settings:ConnectionSettings,signal:AbortSignal)=>Promise<ActivationBaseline>;
export class ConnectorAccountService {
 constructor(private readonly store:ConnectorStore, private readonly options:{enabled:boolean;automaticEnabled?:boolean;prepareDisconnect?:(c:SavedConnection)=>Promise<()=>Promise<unknown>>;cleanupDisconnect?:(owner:string,id:string)=>Promise<void>;syncReadiness?:(c:SavedConnection)=>Promise<{lastSyncAt:string|null;reason:string;retryRequired:boolean}|null>;cancel:(owner:string,id:string)=>Promise<void>;now?:()=>Date;oauth?:ConnectorOAuthService;credentials?:ConnectorCredentialService;activation?:ProviderActivationHook}){}
 private async owned(owner:string,id:string,epoch:number){const c=await this.store.getConnection(owner,id);if(!c)throw new ConnectorStoreError('connection_unavailable');if(c.epoch!==epoch)throw new ConnectorStoreError('stale_connection');return c;}
 private async readiness(c:SavedConnection):Promise<GrantReadiness>{
  if(c.status==='disconnected')return 'disconnected';
  if(c.provider==='telegram')return await this.store.readIdentityProof(c)?'identity_verified':'identity_expired';
  const grant=await this.store.readGrant(c); if(!grant)return 'grant_missing';
  if(grant.expiresAt&&Date.parse(grant.expiresAt)<=(this.options.now?.()??new Date()).valueOf())return 'grant_expired';
  if(c.provider==='gmail'||c.provider==='outlook')return hasReadonlyMailboxGrant(c.provider,grant.scopes)?'accepted':'partial_grant';
  if(c.provider==='teams')return hasTeamsReadScope(grant.scopes)?'accepted':'partial_grant';
  if(c.provider==='slack')return slackHasClass(grant.scopes,'public')?'accepted':'partial_grant';
  if(c.provider==='extension')return grant.scopes.length?'accepted':'partial_grant';
  // Discord commands are installed separately; its identity token grants identify only.
  const required:Partial<Record<SavedConnection['provider'],string[]>>={drive:['https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/drive.install'],discord:['identify']};
  const scopes=required[c.provider];
  // Adapters for the other providers establish their accepted capability in Task 4.
  return scopes&&scopes.every(s=>grant.scopes.includes(s))?'accepted':'partial_grant';
 }
 async card(c:SavedConnection){return {...connectionCard(c,await this.readiness(c),(await this.store.listPendingDisconnectCheckIds(c.ownerId,c.id)).length>0),sync:await this.options.syncReadiness?.(c)??null};}
 async connections(owner:string,input:unknown):Promise<ConnectionPage>{const p=listInput.parse(input);const page=await this.store.listConnections(owner,{...p,limit:20});return {...page,items:await Promise.all(page.items.map(c=>this.card(c))),enabled:this.options.enabled,providers:Object.keys(providerLabels).map(provider=>({provider:provider as SavedConnection['provider'],automaticAvailable:process.env.SCAMWIN_CONNECTOR_AUTOMATION_ENABLED==='true',...(expandedProviderReadiness(provider as SavedConnection['provider'])??this.options.oauth?.readiness(owner,provider)??{status:'unavailable' as const,message:'Provider authorization is not available yet. Manual checks remain available.'})}))};}
 async alerts(owner:string,input:unknown){return this.store.listAlerts(owner,{...listInput.parse(input),limit:20});}
 async activity(owner:string,input:unknown){return this.store.listActivity(owner,{...listInput.parse(input),limit:20});}
 async save(owner:string,input:unknown){
  const v=connectionSettingsInput.parse(input);const c=await this.owned(owner,v.id,v.epoch);
  if(!this.options.enabled)throw new ConnectorStoreError('service_disabled');
  if(!['gmail','outlook'].includes(c.provider))throw new ConnectorStoreError('provider_specific_setup_required');
  if(c.status==='disconnected')throw new ConnectorStoreError('connection_unavailable');
  if(v.mode!=='manual'&&this.options.automaticEnabled===false)throw new ConnectorStoreError('activation_unavailable');
  if(v.mode!=='manual'&&this.options.oauth&&this.options.oauth.readiness(owner,c.provider).status!=='ready')throw new ConnectorStoreError('provider_unavailable');
  if(v.mode!=='manual'&&await this.readiness(c)!=='accepted')throw new ConnectorStoreError('partial_grant');
  if(!validateResources(c.provider,v.scope))throw new ConnectorStoreError('invalid_input');
  if(v.scope.some(s=>!c.scope.includes(s))&&!v.consent)throw new ConnectorStoreError('scope_consent_required');
  const settings:ConnectionSettings={mode:v.mode,scope:v.scope,rules:v.mode==='selective'?{contains:v.contains.split('\n').map(s=>s.trim()).filter(Boolean)}:{},consent:v.consent,paused:c.status==='paused',automaticDailyLimit:v.automaticDailyLimit};
  let baseline:ActivationBaseline|undefined;
  const boundaryChanged=c.mode!==settings.mode||canonicalHash([...c.scope].sort())!==canonicalHash([...settings.scope].sort())||canonicalHash(c.rules)!==canonicalHash(settings.rules)||!c.activationAt;
  if(v.mode!=='manual'&&boundaryChanged){if(!this.options.activation)throw new ConnectorStoreError('activation_unavailable');baseline=await this.options.activation(c,settings,AbortSignal.timeout(10000));}
  const saved=await this.store.configureConnection(c,settings,baseline);
  return this.card(saved);
 }
 async pause(owner:string,id:string,epoch:number,paused:boolean){
  const c=await this.owned(owner,id,epoch);if(!paused&&!this.options.enabled)throw new ConnectorStoreError('service_disabled');
  const settings:ConnectionSettings={mode:c.mode,scope:c.scope,rules:c.rules,consent:true,paused,automaticDailyLimit:c.automaticDailyLimit};let baseline:ActivationBaseline|undefined;
  if(!paused&&c.mode!=='manual'){
   const providerReadiness=expandedProviderReadiness(c.provider)??this.options.oauth?.readiness(owner,c.provider);if(providerReadiness&&providerReadiness.status!=='ready')throw new ConnectorStoreError('provider_unavailable');
   // Resume preserves the existing boundary and queued work. Adapters reconcile or disclose paused gaps.
   if(!c.activationAt){if(!this.options.activation)throw new ConnectorStoreError('activation_unavailable');baseline=await this.options.activation(c,settings,AbortSignal.timeout(10000));}
  }
  return this.card(await this.store.configureConnection(c,settings,baseline));
 }
 async disconnect(owner:string,id:string,epoch:number){
  // Local epoch invalidation commits before touching the main database. Pending job
  // reasons are durable cancellation intent; successful callbacks are individually acknowledged.
  const c=await this.store.getConnection(owner,id);if(!c)throw new ConnectorStoreError('connection_unavailable');
  let remote:(()=>Promise<unknown>)|undefined;try{remote=await this.options.prepareDisconnect?.(c);}catch{/* Local disconnect must remain available during provider setup outages. */}
  const result=this.options.credentials?await this.options.credentials.disconnect({...c,epoch}):await this.store.revokeConnection(owner,id,epoch);
  await this.options.cleanupDisconnect?.(owner,id);
  if(remote)try{await remote();}catch{/* Provider-side permission removal remains available in the provider account. */}
  const outcomes=await Promise.allSettled(result.cancelCheckIds.map(async checkId=>{await this.options.cancel(owner,checkId);await this.store.acknowledgeDisconnectCancellation(owner,id,checkId);}));
  if(outcomes.some(v=>v.status==='rejected'))throw new ConnectorStoreError('disconnect_cancellation_pending');
  return this.card(result.connection);
 }
 async seen(owner:string,id:string){if(!await this.store.markAlertSeen(owner,id))throw new ConnectorStoreError('alert_unavailable');return {id};}
}
