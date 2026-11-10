import 'server-only';
import type {ExpandedAuthorizationService,PostgresExpandedAuthorizationPersistence} from './expanded-auth';
import {ConnectorStoreError} from './store';
export interface ExpandedAuthorizationServices {service:ExpandedAuthorizationService;persistence:PostgresExpandedAuthorizationPersistence}
let factory:(()=>ExpandedAuthorizationServices)|undefined;
/** Root composition supplies trusted drivers and the isolated connector DB. */
export function registerExpandedAuthorizationServices(value:()=>ExpandedAuthorizationServices){factory=value;}
export function expandedAuthorizationServices(){if(!factory)throw new ConnectorStoreError('provider_unavailable');return factory();}
