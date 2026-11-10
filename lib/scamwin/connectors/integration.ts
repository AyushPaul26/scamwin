import type {ConnectorStore,SavedConnection} from './contracts';
import type {ConnectorDatabase} from './store';
import type {ConnectorKeyring} from './crypto';
import type {ConnectorRuntimeStore} from './runtime-store';
import type {ConnectorProviderRegistry} from './registry';
import {ExpandedAuthorizationService,PostgresExpandedAuthorizationPersistence,type ExpandedAuthorizationDriver} from './expanded-auth';
import {createSlackIntegration,slackAuthorizationDriver,slackConfiguration} from './slack-runtime';
import {createDiscordIntegration,discordAuthorizationDriver,discordConfiguration} from './discord-runtime';
import {createTeamsIntegration,teamsConfiguration} from './teams-runtime';
import {TeamsAuthorizationDriver} from './teams-auth';
import {createDriveIntegration} from './drive-runtime';
import {DriveAuthorizationDriver,driveConfiguration} from './drive-auth';
import {createTelegramIntegration,telegramConfiguration} from './telegram-runtime';
import {createExtensionIntegration,extensionConfiguration} from './extension-runtime';
export interface IntegrationContext {connectorStore:ConnectorStore;database:ConnectorDatabase;keyring:ConnectorKeyring;runtime:ConnectorRuntimeStore;meteredFetch:typeof fetch}
export function createExpandedAuthorization(c:IntegrationContext,env:Record<string,string|undefined>=process.env){
 const drivers:ExpandedAuthorizationDriver[]=[];
 const slack=slackAuthorizationDriver(env,c.meteredFetch),discord=discordAuthorizationDriver(env,c.meteredFetch),teams=teamsConfiguration(env),drive=driveConfiguration(env);
 if(slack)drivers.push(slack);if(discord)drivers.push(discord);
 if(teams?.enabled)drivers.push(new TeamsAuthorizationDriver(teams,c.meteredFetch));
 if(drive?.enabled)drivers.push(new DriveAuthorizationDriver({...drive,fetch:c.meteredFetch}));
 const persistence=new PostgresExpandedAuthorizationPersistence(c.database,{keyring:c.keyring});
 return {persistence,service:new ExpandedAuthorizationService(c.connectorStore,persistence,{origin:env.APP_BASE_URL??'',enabled:env.SCAMWIN_CONNECTORS_ENABLED==='true',drivers})};
}
export function createIntegratedProviders(c:IntegrationContext,env:Record<string,string|undefined>=process.env){
 const authorization=createExpandedAuthorization(c,env);
 const base={core:c.connectorStore,database:c.database,keyring:c.keyring,runtime:c.runtime,fetch:c.meteredFetch,environment:env};
 const expanded={...base,accessToken:authorization.service.accessToken.bind(authorization.service),readIdentity:authorization.persistence.readIdentity.bind(authorization.persistence)};
 return {
  authorization,
  telegram:telegramConfiguration(env)?.enabled?createTelegramIntegration(base):null,
  slack:slackConfiguration(env).enabled?createSlackIntegration({...base,authorization:authorization.service,persistence:authorization.persistence}):null,
  teams:teamsConfiguration(env)?.enabled?createTeamsIntegration(expanded):null,
  discord:discordConfiguration(env).enabled?createDiscordIntegration({...base,persistence:authorization.persistence}):null,
  drive:driveConfiguration(env)?.enabled?createDriveIntegration(expanded):null,
  extension:extensionConfiguration(env).enabled?createExtensionIntegration(base):null,
 };
}
export function registerIntegratedProviders(c:IntegrationContext,registry:ConnectorProviderRegistry,env:Record<string,string|undefined>=process.env){
 const integrations=createIntegratedProviders(c,env);
 for(const id of ['telegram','slack','teams','discord','drive','extension'] as const){const provider=integrations[id];if(provider)registry.register(id,provider.adapter);}
 return integrations;
}
/** Capture local cleanup authority before Core fencing; invoke it only after disconnect.
 * Construct Teams even with gates off: cleanup never refreshes tokens or reads a source. */
export async function prepareIntegratedDisconnect(c:IntegrationContext,connection:SavedConnection,env:Record<string,string|undefined>=process.env){
 if(!['slack','teams','discord','drive'].includes(connection.provider))return async()=>undefined;
 const authorization=createExpandedAuthorization(c,env);
 if(connection.provider==='teams'){
  const teams=createTeamsIntegration({core:c.connectorStore,database:c.database,keyring:c.keyring,runtime:c.runtime,fetch:c.meteredFetch,environment:env,accessToken:authorization.service.accessToken.bind(authorization.service),readIdentity:authorization.persistence.readIdentity.bind(authorization.persistence)});
  const cleanup=await teams.adapter.prepareDisconnect(connection,AbortSignal.timeout(10000));
  return ()=>cleanup(AbortSignal.timeout(10000));
 }
 const cleanup=await authorization.service.prepareDisconnect(connection);
 return ()=>cleanup(AbortSignal.timeout(10000));
}
