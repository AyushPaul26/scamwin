import type {ConnectorStore} from './contracts';
import type {ConnectorDatabase} from './store';
import type {ConnectorKeyring} from './crypto';
import {ConnectorRuntimeStore} from './runtime-store';
import {TelegramBindingStore} from './telegram-store';
import {TelegramService} from './telegram-service';
import {TelegramAdapter,TelegramBotClient} from './providers/telegram';

export function telegramConfiguration(env:Record<string,string|undefined>=process.env){
 const botToken=env.SCAMWIN_TELEGRAM_BOT_TOKEN,username=env.SCAMWIN_TELEGRAM_BOT_USERNAME,secret=env.SCAMWIN_TELEGRAM_WEBHOOK_SECRET;
 if(!botToken||!/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(botToken)||!username||!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)||!secret||!/^[A-Za-z0-9_-]{32,256}$/.test(secret))return null;
 return {botToken,username,secret,enabled:env.SCAMWIN_CONNECTORS_ENABLED==='true'&&env.SCAMWIN_CONNECTOR_TELEGRAM_ENABLED==='true',automaticEnabled:env.SCAMWIN_CONNECTOR_AUTOMATION_ENABLED==='true'&&env.SCAMWIN_CONNECTOR_RUNTIME_ENABLED==='true'};
}
/** Server composition factory. Runtime supplies its metered fetch; no global registration side effects. */
export function createTelegramIntegration(deps:{core:ConnectorStore;database:ConnectorDatabase;keyring:ConnectorKeyring;runtime:ConnectorRuntimeStore;fetch:typeof fetch;environment?:Record<string,string|undefined>;now?:()=>Date}){
 const config=telegramConfiguration(deps.environment);if(!config)throw new Error('telegram_configuration_unavailable');
 const bindings=new TelegramBindingStore(deps.database,deps.keyring,deps.now),client=new TelegramBotClient(config.botToken,deps.fetch);
 const enabled=()=>config.enabled,automaticEnabled=()=>config.enabled&&config.automaticEnabled;
 const adapter=new TelegramAdapter({bindings,botToken:config.botToken,enabled:automaticEnabled,fetch:deps.fetch,now:deps.now});
 const service=new TelegramService(deps.core,bindings,{username:config.username,enabled,automaticEnabled,now:deps.now,
  getBusinessConnection:(id,signal)=>client.method('getBusinessConnection',{business_connection_id:id},signal),
  stageRevision:(ref,revision)=>deps.runtime.stageRevision(ref,revision),
  deleteItem:async(ref,id,database)=>{await new ConnectorRuntimeStore(database,deps.keyring,deps.now).deleteProviderItem(ref,id);},
 });
 return {adapter,service,bindings};
}
