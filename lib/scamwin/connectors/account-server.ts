import 'server-only';
import {z} from 'zod';
import {getOptionalSession} from '@/lib/auth0';
import {getScamwinStore} from '../repository';
import {getConnectorStore} from './repository';
import {ConnectorStoreError} from './store';
import {ConnectorAccountService,type ProviderActivationHook} from './account-service';
import {ConnectorOAuthService,oauthConfiguration} from './oauth';
import {ConnectorCredentialService} from './credentials';
import {prepareIntegratedDisconnect} from './integration';
import {eraseSupplementalConnection} from './supplemental-data';
import {connectorRuntimeServices,connectorRuntimeContext} from './runtime-server';

let activation:ProviderActivationHook|undefined;
/** Installed only by a server adapter composition root after its activation baseline is implemented. */
export function installConnectorActivationHook(hook:ProviderActivationHook){activation=hook;}

export async function connectorAccount(){
 const session=await getOptionalSession();if(!session?.user.sub)throw new ConnectorStoreError('unauthenticated');
 const store=getConnectorStore(),configuration=oauthConfiguration(),http={fetch:(url:string,init?:RequestInit)=>fetch(url,init)};
 const oauth=new ConnectorOAuthService(store,{configuration,http}),credentials=new ConnectorCredentialService(store,{configuration,http});
 const service=new ConnectorAccountService(store,{enabled:configuration.enabled,automaticEnabled:process.env.SCAMWIN_CONNECTOR_AUTOMATION_ENABLED==='true',cleanupDisconnect:(owner,id)=>eraseSupplementalConnection(connectorRuntimeContext().database,owner,id),prepareDisconnect:c=>prepareIntegratedDisconnect(connectorRuntimeContext(),c),syncReadiness:c=>connectorRuntimeContext().runtime.readiness(c),oauth,credentials,activation:activation??((connection,settings,signal)=>connectorRuntimeServices().activation(connection,settings,signal)),cancel:async(owner,id)=>{await getScamwinStore().requestCancel(owner,id);}});
 return {subject:session.user.sub,service,oauth,credentials,configuration};
}
export function connectorError(error:unknown){
 const code=error instanceof ConnectorStoreError?error.code:error instanceof z.ZodError?'invalid_input':'service_unavailable';
 const messages:Record<string,string>={connector_database_unavailable:'Connected-app storage is not configured. Saved connection status cannot be loaded; manual checks remain available.',connector_key_unavailable:'Connected-app storage is unavailable. Saved connection status cannot be loaded; manual checks remain available.',owner_data_erased:'Connected data was erased while this operation was running. Start a new operation.',provider_specific_setup_required:'Use the setup controls for this app below.',invalid_cursor:'This page cursor is invalid. Return to the first page.',disconnect_cancellation_pending:'Disconnected locally. Stopping one or more admitted checks is pending; retry cancellation from the connection card.',unauthenticated:'Sign in to manage your connected apps.',service_disabled:'Connected apps are paused by the operator. Saved records and disconnect remain available.',stale_connection:'This connection changed. Reload before saving.',connection_unavailable:'This connection is unavailable or does not belong to your account.',partial_grant:'Read permission is incomplete. Reconnect when authorization is available.',scope_authorization_required:'Additional scope needs fresh provider authorization.',invalid_input:'Check your selections and processing consent.',alert_unavailable:'This alert expired or is unavailable.',provider_unavailable:'Provider authorization is not available yet. No account was connected.'};
 const lifecycle:Record<string,string>={activation_unavailable:'Automatic checking is unavailable until this provider can capture a new coverage boundary. Your connection remains unchanged.',scope_consent_required:'Confirm the expanded app resources and processing choice before saving.',reconnect_required:'Reconnect this same provider account to renew read access.',provider_account_owned:'This provider account is already linked to another account.',provider_account_mismatch:'Reconnect using the same provider account. Start a separate connection for a different account.',invalid_origin:'Authorization must start from this website.',refresh_in_progress:'Read access is being renewed. Try again shortly.'};
 return {ok:false as const,code,error:messages[code]||lifecycle[code]||'Connected apps are temporarily unavailable. Try again.'};
}
export async function connectorRead(request:Request,kind:'connections'|'alerts'|'activity'){
 try{
  const {subject,service}=await connectorAccount();
  const text=await request.text();if(text.length>2048)throw new z.ZodError([]);
  let input:unknown;try{input=JSON.parse(text);}catch{throw new z.ZodError([]);}
  return Response.json(await service[kind](subject,input),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){const value=connectorError(error);return Response.json(value,{status:value.code==='unauthenticated'?401:value.code==='invalid_input'?400:503,headers:{'Cache-Control':'private, no-store'}});}
}
