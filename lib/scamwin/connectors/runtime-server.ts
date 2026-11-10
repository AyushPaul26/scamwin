import 'server-only';
import './integration-server';
import {registerIntegratedProviders} from './integration';
import {purgeSupplementalData} from './supplemental-data';
import {ConnectorPrivacyService} from './privacy-service';
import { getScamwinStore } from '../repository';
import { getConnectorDatabase,getConnectorStore,connectorKeyringFromEnvironment } from './repository';
import { ConnectorRuntimeStore } from './runtime-store';
import { ConnectorCredentialService } from './credentials';
import { oauthConfiguration } from './oauth';
import { createMailboxRegistry,mailboxActivationHook,type RegisteredProvider } from './registry';
import type { ProviderId } from './contracts';
import { createConnectorDispatchHandler,type DispatchAction } from './dispatch';
import { connectorTick } from './sync';
import { connectorDrain } from './drain';
import { ConnectorSelectionService } from './selection';
import { ProviderHttpError } from './provider-http';
import { publishConnectorPrivateOutcomes } from './notification-runtime';
type ProviderFactory=(context:ReturnType<typeof connectorRuntimeContext>)=>RegisteredProvider;
const additionalProviders=new Map<ProviderId,ProviderFactory>();
/** Server composition only. Webhook providers can register without introducing a polling loop. */
export function registerConnectorProvider(id:ProviderId,factory:ProviderFactory){additionalProviders.set(id,factory);}
export function connectorRuntimeContext(){
  const connectorStore=getConnectorStore(),runtime=new ConnectorRuntimeStore(getConnectorDatabase(),connectorKeyringFromEnvironment());
  const configuration=oauthConfiguration();
  const meteredFetch:typeof fetch=async(input,init)=>{
    // Reserve the transport's largest permitted response before every request, including aborted requests.
    const allowed=await runtime.reserveUsage({calls:1,bytes:16*1024*1024,computeMs:1000});
    if(!allowed.allowed)throw new ProviderHttpError('runtime_quota_paused');
    init?.signal?.throwIfAborted();return fetch(input,init);
  };
  const credentials=new ConnectorCredentialService(connectorStore,{configuration,http:{fetch:(url,init)=>meteredFetch(url,init)}});
  return {connectorStore,runtime,credentials,configuration,meteredFetch,database:getConnectorDatabase(),keyring:connectorKeyringFromEnvironment()};
}
export function connectorRuntimeServices(){
  const context=connectorRuntimeContext(),automaticEnabled=process.env.SCAMWIN_CONNECTOR_AUTOMATION_ENABLED==='true';
  const registry=createMailboxRegistry({credentials:context.credentials,runtime:context.runtime,fetch:context.meteredFetch,enabledProviders:(['gmail','outlook'] as const).filter(id=>!!context.configuration.providers[id])});
  registerIntegratedProviders(context,registry);
  for(const [id,factory]of additionalProviders)registry.register(id,factory(context));
  const mailboxActivation=mailboxActivationHook({credentials:context.credentials,fetch:context.meteredFetch,automaticEnabled});
  const activation:typeof mailboxActivation=async(c,settings,signal)=>{
    if(!automaticEnabled)throw new ProviderHttpError('activation_required');
    const provider=registry.get(c.provider);
    return provider.activationHook?provider.activationHook(c,settings,signal):mailboxActivation(c,settings,signal);
  };
  return {...context,registry,automaticEnabled,selection:new ConnectorSelectionService({...context,registry,enabled:context.configuration.enabled}),activation};
}
export function connectorDispatch(action:DispatchAction,request:Request){
  let services:ReturnType<typeof connectorRuntimeServices>|undefined;
  const get=()=>services??=connectorRuntimeServices();
  return createConnectorDispatchHandler(action,{
    enabled:process.env.SCAMWIN_CONNECTORS_ENABLED==='true'&&process.env.SCAMWIN_CONNECTOR_RUNTIME_ENABLED==='true',secret:process.env.SCAMWIN_CONNECTOR_DISPATCH_SECRET,
    consume:id=>get().runtime.consumeDelivery(id),
    work:async(signal,deadline)=>{
      await new ConnectorPrivacyService(get().database,get().keyring,getScamwinStore()).cleanup(undefined,deadline-5000);
      if(action==='tick')await purgeSupplementalData(get().database);
      const outcome=action==='tick'?await connectorTick(get(),signal,deadline):await connectorDrain({...get(),mainStore:getScamwinStore()},signal);
      if(!signal.aborted&&Date.now()<deadline-2000)try{await publishConnectorPrivateOutcomes(signal);}catch{/* Private notification failure never changes admitted/source truth. */}
      return outcome;
    },
  })(request);
}
