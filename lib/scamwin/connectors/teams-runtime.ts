import type {ConnectorStore,ConnectionRef,SavedConnection} from './contracts';
import type {ExpandedIdentity} from './expanded-auth';
import type {ConnectorDatabase} from './store';
import type {ConnectorKeyring} from './crypto';
import {ConnectorRuntimeStore} from './runtime-store';
import {TeamsStore} from './teams-store';
import {TeamsAdapter} from './providers/teams';
import {TeamsService} from './teams-service';
export function teamsConfiguration(env:Record<string,string|undefined>=process.env){
 const clientId=env.SCAMWIN_TEAMS_CLIENT_ID,clientSecret=env.SCAMWIN_TEAMS_CLIENT_SECRET,origin=env.APP_BASE_URL;
 if(!clientId||!clientSecret||!origin)return null;let url:URL;try{url=new URL(origin);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;
 const enabled=env.SCAMWIN_CONNECTORS_ENABLED==='true'&&env.SCAMWIN_CONNECTOR_TEAMS_ENABLED==='true';
 return {clientId,clientSecret,origin:url.origin,enabled,automaticEnabled:enabled&&env.SCAMWIN_CONNECTOR_AUTOMATION_ENABLED==='true'&&env.SCAMWIN_TEAMS_AUTOMATION_PILOT_ACCEPTED==='true'};
}
/** Composition is explicit; selected messages enter the accepted Core/runtime pipeline through adapter pull/read hooks. */
export function createTeamsIntegration(deps:{core:ConnectorStore;database:ConnectorDatabase;keyring:ConnectorKeyring;runtime:ConnectorRuntimeStore;accessToken:(c:SavedConnection,signal:AbortSignal)=>Promise<string>;readIdentity:(ref:ConnectionRef)=>Promise<ExpandedIdentity|null>;fetch:typeof fetch;environment?:Record<string,string|undefined>;now?:()=>Date}){
 const config=teamsConfiguration(deps.environment);if(!config)throw new Error('teams_configuration_unavailable');
 const store=new TeamsStore(deps.database,deps.keyring,deps.now),enabled=()=>config.enabled,automaticEnabled=()=>config.automaticEnabled;
 const adapter=new TeamsAdapter({store,accessToken:deps.accessToken,readGrant:c=>deps.core.readGrant(c),enabled,automaticEnabled,notificationUrl:`${config.origin}/api/scamwin/connectors/teams/notifications`,lifecycleUrl:`${config.origin}/api/scamwin/connectors/teams/lifecycle`,fetch:deps.fetch,now:deps.now,recordGap:(c,reason,count)=>deps.core.recordCoverageGap(c,reason,count),deleteItem:async(c,id)=>{await deps.runtime.deleteProviderItem(c,id);}});
 const service=new TeamsService({core:deps.core,store,adapter,enabled,automaticEnabled,readIdentity:deps.readIdentity,savePage:(ref,value)=>deps.runtime.saveHandle(ref,'page',value),consumePage:(ref,handle)=>deps.runtime.consumeHandle(ref,handle,'page'),stageRevision:(ref,id)=>deps.runtime.stageRevision(ref,id)});
 return {adapter,service,store,configuration:config,receive:(value:unknown)=>store.receive(value,config.automaticEnabled,async(ref,id,database)=>{await new ConnectorRuntimeStore(database,deps.keyring,deps.now).deleteProviderItem(ref,id);})};
}
