import 'server-only';
import {getScamwinStore} from '../repository';
import {getConnectorDatabase,getConnectorStore,connectorKeyringFromEnvironment} from './repository';
import {PrivateNotificationStore} from './notification-store';
import {PrivateOutcomeService} from './notification-service';
import {ConnectorSourceService} from './source-service';
import {PushSubscriptionService,pushConfiguration} from './push';
export function pushService(){return new PushSubscriptionService(getConnectorDatabase(),connectorKeyringFromEnvironment());}
export function privateOutcomeService(){const db=getConnectorDatabase();return new PrivateOutcomeService(db,new PrivateNotificationStore(db),new ConnectorSourceService(db,getConnectorStore(),getScamwinStore()),pushConfiguration()?(owner,signal)=>pushService().deliver(owner,signal):undefined);}
/** Scheduler hook independent of account-server composition to avoid a runtime import cycle. */
export async function publishConnectorPrivateOutcomes(signal?:AbortSignal){if(signal?.aborted)return;const store=new PrivateNotificationStore(getConnectorDatabase());await store.purgeExpired();await privateOutcomeService().refresh(undefined,signal);}
