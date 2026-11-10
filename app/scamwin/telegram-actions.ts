'use server';
import {getOptionalSession} from '@/lib/auth0';
import {ConnectorStoreError} from '@/lib/scamwin/connectors/store';
import {connectorError} from '@/lib/scamwin/connectors/account-server';
import {telegramServices} from '@/lib/scamwin/connectors/telegram-server';
import {telegramConnectionInput,telegramFormSchema} from '@/lib/scamwin/connectors/telegram-ui';

async function authenticated(){const session=await getOptionalSession();if(!session?.user.sub)throw new ConnectorStoreError('unauthenticated');return {subject:session.user.sub,...telegramServices()};}
async function result<T>(run:()=>Promise<T>){
 try{return {ok:true as const,data:await run()};}catch(error){
  const code=error instanceof ConnectorStoreError?error.code:'';
  const messages:Record<string,string>={telegram_link_expired_relink_required:'Your Telegram bot link expired. Reconnect Telegram and link the service bot again.',telegram_identity_required:'Reconnect to verify your Telegram identity in this browser, then link the bot.',telegram_manual_link_required:'Save Manual mode before starting another bot link.',telegram_automation_required:'Select this bot in Telegram Chat Automation with only your chosen private chats, then refresh status.',telegram_mutation_rights:'Remove reply, delete, mark-as-read, profile and payment permissions in Telegram before continuing.'};
  return messages[code]?{ok:false as const,code,error:messages[code]}:connectorError(error);
 }
}
export async function beginTelegramLinkAction(input:unknown){return result(async()=>{const {subject,service}=await authenticated(),v=telegramConnectionInput.parse(input);return service.beginTelegramLink(subject,v.id,v.epoch);});}
export async function telegramStatusAction(input:unknown){return result(async()=>{const {subject,service}=await authenticated(),v=telegramConnectionInput.parse(input);return service.status(subject,v.id,v.epoch);});}
export async function saveTelegramSettingsAction(input:unknown){return result(async()=>{
 const {subject,service}=await authenticated(),v=telegramFormSchema.parse(input);
 return service.configure(subject,v.id,v.epoch,{mode:v.mode,scope:['identity'],rules:v.mode==='selective'?{contains:v.contains.split('\n').map(p=>p.trim()).filter(Boolean)}:{},consent:v.consent,paused:v.paused,automaticDailyLimit:v.automaticDailyLimit});
});}
