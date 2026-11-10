'use server';
import {connectorAccount,connectorError} from '@/lib/scamwin/connectors/account-server';
import {connectorRuntimeContext} from '@/lib/scamwin/connectors/runtime-server';
import {MailboxResourceService} from '@/lib/scamwin/connectors/mailbox-resources';
import {ConnectorPrivacyService} from '@/lib/scamwin/connectors/privacy-service';
import {getScamwinStore} from '@/lib/scamwin/repository';
import {connectionSettingsInput} from '@/lib/scamwin/connectors/ui';
import {createIntegratedProviders} from '@/lib/scamwin/connectors/integration';
import {ConnectorStoreError} from '@/lib/scamwin/connectors/store';
import {z} from 'zod';
import {getOptionalSession} from '@/lib/auth0';
async function result<T>(work:()=>Promise<T>){try{return {ok:true as const,data:await work()};}catch(error){return connectorError(error);}}
function mailbox(){const c=connectorRuntimeContext();return new MailboxResourceService({core:c.connectorStore,runtime:c.runtime,accessToken:c.credentials.accessToken.bind(c.credentials),fetch:c.meteredFetch});}
export async function listMailboxResourcesAction(input:unknown){return result(async()=>{const {subject,configuration}=await connectorAccount();if(!configuration.enabled)throw new ConnectorStoreError('service_disabled');return mailbox().list(subject,input);});}
export async function saveMailboxModeAction(input:unknown){return result(async()=>{const {subject,service}=await connectorAccount();const v=connectionSettingsInput.parse(input),scope=await mailbox().resolve(subject,{id:v.id,epoch:v.epoch},v.scope);return service.save(subject,{...v,scope});});}
export async function eraseConnectedDataAction(input:unknown){return result(async()=>{z.object({confirmation:z.literal('ERASE CONNECTED DATA')}).strict().parse(input);const {subject}=await connectorAccount(),c=connectorRuntimeContext();return new ConnectorPrivacyService(c.database,c.keyring,getScamwinStore()).erase(subject);});}
export async function saveSlackModeAction(input:unknown){return result(async()=>{const {subject,service}=await connectorAccount(),v=connectionSettingsInput.parse(input),context=connectorRuntimeContext(),c=await context.connectorStore.getConnection(subject,v.id),slack=createIntegratedProviders(context).slack;if(!c||c.epoch!==v.epoch||c.provider!=='slack'||!slack||c.status==='disconnected')throw new ConnectorStoreError('connection_unavailable');
 const settings={mode:v.mode,scope:c.scope,rules:v.mode==='selective'?{contains:v.contains.split('\n').map(s=>s.trim()).filter(Boolean)}:{},consent:v.consent,paused:c.status==='paused',automaticDailyLimit:v.automaticDailyLimit};
 const baseline=v.mode==='manual'?undefined:await slack.adapter.activationHook(c,settings,AbortSignal.timeout(10000));
 const saved=await context.connectorStore.configureConnection(c,settings,baseline);await slack.store.bindInstallation(saved);return service.card(saved);
});}
export async function currentConnectorSubjectAction(){return result(async()=>{const session=await getOptionalSession();if(!session?.user.sub)throw new ConnectorStoreError('unauthenticated');return {subject:session.user.sub};});}
export async function retryConnectedErasureAction(){return result(async()=>{const {subject}=await connectorAccount(),c=connectorRuntimeContext();return new ConnectorPrivacyService(c.database,c.keyring,getScamwinStore()).cleanup(subject);});}
