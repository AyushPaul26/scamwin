import type { ProviderAdapter, ProviderId, ProviderItemRef, SavedConnection, ConnectionSettings, ProviderPage, SyncCursor, SyncBudget } from './contracts';
import type { ActivationBaseline } from './oauth-contracts';
import type { AttachmentLoader } from './targets';
import type { ConnectorCredentialService } from './credentials';
import type { ConnectorRuntimeStore } from './runtime-store';
import { ConnectorStoreError } from './store';
import { GmailAdapter } from './providers/gmail';
import { OutlookAdapter } from './providers/outlook';
import { canonicalHash } from './policy';
export interface RegisteredProvider extends ProviderAdapter {
  activationHook?:(current:SavedConnection,settings:ConnectionSettings,signal:AbortSignal)=>Promise<ActivationBaseline>;
  listSelected?:(connection:SavedConnection,pageToken:string|null,signal:AbortSignal)=>Promise<{items:(ProviderItemRef&{subject?:string;from?:string;unavailable?:boolean})[];nextPageToken:string|null}>;
  readAttachment?:AttachmentLoader;
  pullChangesWithReconciliation?:(connection:SavedConnection,cursor:SyncCursor|null,budget:SyncBudget,signal:AbortSignal)=>Promise<{page:ProviderPage;removals:{id:string;folderId:string;kind:'removed_from_folder'}[]}>;
}
export class ConnectorProviderRegistry {
  private readonly providers=new Map<ProviderId,RegisteredProvider>();
  register(id:ProviderId,provider:RegisteredProvider){this.providers.set(id,provider);return this;}
  get(id:ProviderId){const p=this.providers.get(id);if(!p)throw new ConnectorStoreError('provider_unavailable');return p;}
  ids(){return [...this.providers.keys()];}
  pullIds(){return this.ids().filter(id=>this.get(id).capabilities.pull);}
}
export function createMailboxRegistry(deps:{credentials:ConnectorCredentialService;runtime:ConnectorRuntimeStore;fetch?:typeof fetch;now?:()=>Date;enabledProviders?:('gmail'|'outlook')[]}){
  const options={accessToken:deps.credentials.accessToken.bind(deps.credentials),revoke:deps.credentials.revoke.bind(deps.credentials),fetch:deps.fetch,now:deps.now};
  const registry=new ConnectorProviderRegistry();
  if(!deps.enabledProviders||deps.enabledProviders.includes('gmail'))registry.register('gmail',new GmailAdapter(options));
  if(!deps.enabledProviders||deps.enabledProviders.includes('outlook'))registry.register('outlook',new OutlookAdapter({...options,isKnownItem:(c,id)=>deps.runtime.isKnownItem(c,id)}));
  return registry;
}
/** Activation probes authenticate the current epoch but bind provider checkpoints to the epoch committed by configureConnection. */
export function mailboxActivationHook(deps:{credentials:ConnectorCredentialService;fetch?:typeof fetch;now?:()=>Date;automaticEnabled:boolean}){
  return async(current:SavedConnection,settings:ConnectionSettings,signal:AbortSignal):Promise<ActivationBaseline>=>{
    if(!deps.automaticEnabled)throw new ConnectorStoreError('activation_unavailable');
    const scopeChanged=canonicalHash([...current.scope].sort())!==canonicalHash([...settings.scope].sort());
    const capturedAt=(deps.now?.()??new Date()).toISOString();
    const next={...current,...settings,status:'active' as const,epoch:current.epoch+1,scopeVersion:current.scopeVersion+(scopeChanged?1:0),activationAt:capturedAt};
    const options={accessToken:(_c:SavedConnection,s:AbortSignal)=>deps.credentials.accessToken(current,s),revoke:deps.credentials.revoke.bind(deps.credentials),fetch:deps.fetch,now:deps.now};
    if(current.provider==='outlook')return new OutlookAdapter(options).activationBaseline(next,signal);
    if(current.provider==='gmail'){const cursor=await new GmailAdapter(options).activate(next,signal);if(!cursor.cursor)throw new ConnectorStoreError('activation_unavailable');return {cursor:cursor.cursor,capturedAt};}
    throw new ConnectorStoreError('activation_unavailable');
  };
}
