import 'server-only';
import {connectorRuntimeContext} from './runtime-server';
import {getConnectorDatabase,connectorKeyringFromEnvironment} from './repository';
import {expandedAuthorizationServices} from './expanded-server';
import {createTeamsIntegration} from './teams-runtime';
/** Common authorization is registered by server composition, never from browser-provided identity. */
export function teamsServices(){
 const context=connectorRuntimeContext(),authorization=expandedAuthorizationServices();
 return {...createTeamsIntegration({core:context.connectorStore,database:getConnectorDatabase(),keyring:connectorKeyringFromEnvironment(),runtime:context.runtime,fetch:context.meteredFetch,accessToken:(c,signal)=>authorization.service.accessToken(c,signal),readIdentity:ref=>authorization.persistence.readIdentity(ref)}),authorization:authorization.service};
}
