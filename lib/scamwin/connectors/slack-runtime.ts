import {SlackAuthorizationDriver} from './slack-protocol';
import {SlackStore} from './slack-store';
import {SlackAdapter} from './providers/slack';
import {SlackManualService} from './slack-manual';
import {SlackSetupService} from './slack-setup';
import {SlackWebhookService} from './slack-webhook';
import type {ConnectorStore} from './contracts';
import type {ConnectorDatabase} from './store';
import type {ConnectorKeyring} from './crypto';
import type {ConnectorRuntimeStore} from './runtime-store';
import type {ExpandedAuthorizationService,PostgresExpandedAuthorizationPersistence} from './expanded-auth';
export function slackConfiguration(env:Record<string,string|undefined>=process.env){const enabled=env.SCAMWIN_CONNECTORS_ENABLED==='true'&&env.SCAMWIN_CONNECTOR_SLACK_ENABLED==='true';const clientId=env.SCAMWIN_SLACK_CLIENT_ID,clientSecret=env.SCAMWIN_SLACK_CLIENT_SECRET,appId=env.SCAMWIN_SLACK_APP_ID,signingSecret=env.SCAMWIN_SLACK_SIGNING_SECRET;return {enabled:enabled&&!!clientId&&!!clientSecret&&!!appId&&!!signingSecret,automaticEnabled:enabled&&!!clientId&&!!clientSecret&&!!appId&&!!signingSecret&&env.SCAMWIN_CONNECTOR_AUTOMATION_ENABLED==='true'&&env.SCAMWIN_SLACK_COVERAGE_PILOT_ACCEPTED==='true',clientId,clientSecret,appId,signingSecret};}
/** Root13 composes this alongside the existing runtime; no shared registry mutation at import time. */
export function createSlackIntegration(deps:{core:ConnectorStore;database:ConnectorDatabase;keyring:ConnectorKeyring;runtime:ConnectorRuntimeStore;authorization:ExpandedAuthorizationService;persistence:PostgresExpandedAuthorizationPersistence;fetch?:typeof fetch;environment?:Record<string,string|undefined>;now?:()=>Date}){
 const config=slackConfiguration(deps.environment),store=new SlackStore(deps.database,deps.keyring,deps.core,deps.persistence,deps.now);const adapter=new SlackAdapter({store,core:deps.core,accessToken:(c,s)=>deps.authorization.accessToken(c,s),fetch:deps.fetch,now:deps.now,automaticEnabled:config.automaticEnabled});const setup=new SlackSetupService({core:deps.core,runtime:deps.runtime,store,adapter,enabled:config.enabled});const webhook=new SlackWebhookService({store,core:deps.core,runtime:deps.runtime,appId:config.appId??'',automaticEnabled:config.automaticEnabled});const manual=new SlackManualService({core:deps.core,runtime:deps.runtime,store,adapter,enabled:config.enabled});return {store,adapter,setup,manual,webhook,appId:config.appId??'',signingSecret:config.signingSecret??'',configuration:config};
}
export function slackAuthorizationDriver(environment:Record<string,string|undefined>=process.env,transport:typeof fetch=fetch){const c=slackConfiguration(environment);if(!c.enabled)return null;return new SlackAuthorizationDriver({clientId:c.clientId!,clientSecret:c.clientSecret!,appId:c.appId!,files:environment.SCAMWIN_SLACK_FILES_ENABLED==='true',fetch:transport});}
