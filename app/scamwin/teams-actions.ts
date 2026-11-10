'use server';
import {getOptionalSession} from '@/lib/auth0';
import {ConnectorStoreError} from '@/lib/scamwin/connectors/store';
import {connectorError} from '@/lib/scamwin/connectors/account-server';
import {teamsServices} from '@/lib/scamwin/connectors/teams-server';
async function authenticated(){const session=await getOptionalSession();if(!session?.user.sub)throw new ConnectorStoreError('unauthenticated');return {subject:session.user.sub,...teamsServices()};}
async function result<T>(run:()=>Promise<T>){try{return {ok:true as const,data:await run()};}catch(error){
 const code=error instanceof ConnectorStoreError?error.code:'',messages:Record<string,string>={teams_work_school_required:'Connect an eligible Microsoft work or school account. Personal accounts and cross-tenant chats are unavailable.',teams_selection_required:'Choose and save permitted chats before continuing.',teams_automatic_pilot_required:'Automatic Teams checking is unavailable until the controlled subscription and recovery pilot is accepted.',teams_resource_invalid:'This chat is unavailable. Refresh the permitted chat list.',teams_message_link_invalid:'Paste a message link from the saved chat and the connected work or school tenant.'};
 return messages[code]?{ok:false as const,code,error:messages[code]}:connectorError(error);
}}
export async function teamsStatusAction(input:unknown){return result(async()=>{const {subject,service}=await authenticated();return service.status(subject,input);});}
export async function discoverTeamsChatsAction(input:unknown){return result(async()=>{const {subject,service}=await authenticated();return service.discover(subject,input);});}
export async function saveTeamsSettingsAction(input:unknown){return result(async()=>{const {subject,service}=await authenticated();return service.configure(subject,input);});}
export async function importTeamsMessageAction(input:unknown){return result(async()=>{const {subject,service}=await authenticated();return service.importMessage(subject,input);});}
