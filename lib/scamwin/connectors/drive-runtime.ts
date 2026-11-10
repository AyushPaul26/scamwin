import type {ConnectorStore,ConnectionRef,SavedConnection} from './contracts';
import type {ExpandedIdentity} from './expanded-auth';
import type {ConnectorDatabase} from './store';
import type {ConnectorKeyring} from './crypto';
import {ConnectorRuntimeStore} from './runtime-store';
import {DriveStore} from './drive-store';
import {DriveAdapter} from './providers/drive';
import {DriveService} from './drive-service';
import {driveConfiguration} from './drive-auth';
export function createDriveIntegration(deps:{core:ConnectorStore;database:ConnectorDatabase;keyring:ConnectorKeyring;runtime:ConnectorRuntimeStore;accessToken:(c:SavedConnection,s:AbortSignal)=>Promise<string>;readIdentity:(c:ConnectionRef)=>Promise<ExpandedIdentity|null>;fetch:typeof fetch;environment?:Record<string,string|undefined>;now?:()=>Date}){const configuration=driveConfiguration(deps.environment);if(!configuration)throw new Error('drive_configuration_unavailable');const store=new DriveStore(deps.database,deps.keyring,deps.now),enabled=()=>configuration.enabled,automaticEnabled=()=>configuration.automaticEnabled;const adapter=new DriveAdapter({store,accessToken:deps.accessToken,enabled,automaticEnabled,fetch:deps.fetch,now:deps.now,deleteItem:async(c,id)=>{await deps.runtime.deleteProviderItem(c,id);}});const service=new DriveService({core:deps.core,store,adapter,enabled,automaticEnabled,readIdentity:deps.readIdentity,stageRevision:(c,id)=>deps.runtime.stageRevision(c,id)});return {configuration,store,adapter,service};}
