import 'server-only';
import {getOptionalSession} from '@/lib/auth0';
import {getScamwinStore} from '../repository';
import {getConnectorDatabase,getConnectorStore} from './repository';
import {ConnectorStoreError} from './store';
import {connectorError} from './account-server';
import {ConnectorActivityService} from './activity-service';
export async function activityRead(request:Request){try{const session=await getOptionalSession();if(!session?.user.sub)throw new ConnectorStoreError('unauthenticated');const text=await request.text();if(text.length>2048)throw new ConnectorStoreError('invalid_input');const value=await new ConnectorActivityService(getConnectorDatabase(),getConnectorStore(),getScamwinStore()).list(session.user.sub,JSON.parse(text));return Response.json(value,{headers:{'Cache-Control':'private, no-store'}});}catch(error){const value=connectorError(error);return Response.json(value,{status:value.code==='unauthenticated'?401:503,headers:{'Cache-Control':'private, no-store'}});}}
