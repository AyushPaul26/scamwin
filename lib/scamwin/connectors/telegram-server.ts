import 'server-only';
import {connectorRuntimeContext} from './runtime-server';
import {getConnectorDatabase,connectorKeyringFromEnvironment} from './repository';
import {createTelegramIntegration} from './telegram-runtime';

export function telegramServices(){
 const context=connectorRuntimeContext();
 return createTelegramIntegration({core:context.connectorStore,database:getConnectorDatabase(),keyring:connectorKeyringFromEnvironment(),runtime:context.runtime,fetch:context.meteredFetch});
}
