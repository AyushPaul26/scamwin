import 'server-only';
import {connectorRuntimeContext} from './runtime-server';
import {createExpandedAuthorization,createIntegratedProviders} from './integration';
import {registerExpandedAuthorizationServices} from './expanded-server';
import {registerSlackServices} from './slack-server';
import {registerDiscordServices} from './discord-server';
import {registerExtensionService} from './extension-server';
import {ConnectorStoreError} from './store';
// Register lazy factories in every consuming bundle; import itself performs no I/O.
registerExpandedAuthorizationServices(()=>createExpandedAuthorization(connectorRuntimeContext()));
registerSlackServices(()=>{const value=createIntegratedProviders(connectorRuntimeContext()).slack;if(!value)throw new ConnectorStoreError('provider_unavailable');return value;});
registerDiscordServices(()=>{const value=createIntegratedProviders(connectorRuntimeContext()).discord;if(!value)throw new ConnectorStoreError('provider_unavailable');return value;});

registerExtensionService(()=>{const value=createIntegratedProviders(connectorRuntimeContext()).extension;if(!value)throw new ConnectorStoreError('provider_unavailable');return value.service;});
