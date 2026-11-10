import {slackConfiguration} from './slack-runtime';
import {discordConfiguration} from './discord-runtime';
import {teamsConfiguration} from './teams-runtime';
import {driveConfiguration} from './drive-auth';
import {extensionConfiguration} from './extension-runtime';
import type {ProviderId} from './contracts';
export function expandedProviderReadiness(provider:ProviderId,env:Record<string,string|undefined>=process.env){
 const config=provider==='slack'?slackConfiguration(env):provider==='teams'?teamsConfiguration(env):provider==='discord'?discordConfiguration(env):provider==='drive'?driveConfiguration(env):provider==='extension'?extensionConfiguration(env):null;
 if(!config)return undefined;
 return {status:config.enabled?'ready' as const:'unavailable' as const,automaticAvailable:config.enabled&&config.automaticEnabled,message:config.enabled?(provider==='discord'?'User installation is available. Explicit message commands only; automatic checking is unavailable.':provider==='extension'?'Pair this browser explicitly. Automatic capture requires separately approved website origins.':'Authorization setup is available. Select permitted resources after connecting; this is not proof of coverage.'):'Provider setup is unavailable. Existing manual checks remain available.'};
}
