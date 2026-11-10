import 'server-only';
import {getOptionalSession} from '@/lib/auth0';
import {getConnectorDatabase} from './repository';
import {ConnectorStoreError} from './store';
import {connectorError} from './account-server';
import {PrivateNotificationStore} from './notification-store';
import {pushConfiguration} from './push';
export {pushService} from './notification-runtime';
export async function notificationAccount(){const session=await getOptionalSession();if(!session?.user.sub)throw new ConnectorStoreError('unauthenticated');return {subject:session.user.sub,store:new PrivateNotificationStore(getConnectorDatabase())};}
/** Persisted reads never project sources or send push; the scheduler owns that work. */
export async function privateAlertsRead(request:Request){try{const {subject,store}=await notificationAccount();const text=await request.text();if(text.length>2048)throw new ConnectorStoreError('invalid_input');const input=JSON.parse(text);return Response.json(await store.list(subject,input),{headers:{'Cache-Control':'private, no-store'}});}catch(error){const value=connectorError(error);return Response.json(value,{status:value.code==='unauthenticated'?401:value.code==='invalid_input'?400:503,headers:{'Cache-Control':'private, no-store'}});}}
export async function privatePushConfigurationRead(){try{await notificationAccount();return Response.json({publicKey:pushConfiguration()?.publicKey??null},{headers:{'Cache-Control':'private, no-store'}});}catch(error){const value=connectorError(error);return Response.json(value,{status:value.code==='unauthenticated'?401:503,headers:{'Cache-Control':'private, no-store'}});}}
