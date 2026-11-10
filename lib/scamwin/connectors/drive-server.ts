import 'server-only';
import {connectorRuntimeContext} from './runtime-server';
import {getConnectorDatabase,connectorKeyringFromEnvironment} from './repository';
import {expandedAuthorizationServices} from './expanded-server';
import {createDriveIntegration} from './drive-runtime';
export function driveServices(){const context=connectorRuntimeContext(),authorization=expandedAuthorizationServices();return createDriveIntegration({core:context.connectorStore,database:getConnectorDatabase(),keyring:connectorKeyringFromEnvironment(),runtime:context.runtime,fetch:context.meteredFetch,accessToken:(c,s)=>authorization.service.accessToken(c,s),readIdentity:c=>authorization.persistence.readIdentity(c)});}
