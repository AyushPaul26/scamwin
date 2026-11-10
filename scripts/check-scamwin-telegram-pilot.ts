import {telegramConfiguration} from '../lib/scamwin/connectors/telegram-runtime';

// Readiness only. Does not load env files, use accounts, send Bot API calls or change the shared webhook.
const config=telegramConfiguration();
if(process.argv.slice(2).length)throw new Error('Readiness only: live bot/account configuration requires a separately authorized operator stage.');
process.stdout.write(JSON.stringify({mode:'readiness_only',credentialsConfigured:!!config,providerEnabled:config?.enabled??false,automaticEnabled:config?.automaticEnabled??false,livePilot:'not_run',requiredObservations:[
 'Two authorized private-chat accounts: verify same-browser OIDC numeric ID, forwarded nonce rejection, connection-before-link, reconnect and wrong-account failures.',
 'Manual: send a controlled message; verify no source body retained and one content-free unavailable-recovery gap.',
 'All new items: send routine text, another-bot text, raster image and unsupported media; verify source persistence before acknowledgement and accurate partial coverage.',
 'Edit, delete, pause/resume, disconnect/reconnect: verify stale delivery cannot restore content or old-epoch checks.',
 'Verify selected-private-chat exclusions and absence of unauthorized group/channel and personal inbox history claims.',
 'Confirm Secretary/Chat Automation setup with minimal empty rights, no reply/delete/mark-as-read/profile/payment rights, non-Premium eligibility and current opt-in bot-to-bot behavior.',
 'Verify Login client Allowed URLs, PKCE/browser/state/nonce, ID equality and exact provider callback separately from Bot API token/webhook setup.',
],allowedUpdates:['message','business_connection','business_message','edited_business_message','deleted_business_messages'],operatorSetup:'Configure the shared service webhook only in an explicitly authorized setup stage. Never remove the global webhook to disconnect one owner.'},null,2)+'\n');
