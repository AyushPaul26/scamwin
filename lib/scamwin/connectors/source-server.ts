import 'server-only';
import {z} from 'zod';
import {getOptionalSession} from '@/lib/auth0';
import {getScamwinStore} from '../repository';
import {getConnectorDatabase,getConnectorStore} from './repository';
import {ConnectorStoreError} from './store';
import {connectorError} from './account-server';
import {ConnectorSourceService} from './source-service';
const input=z.object({id:z.string().min(1).max(200),itemId:z.string().min(1).max(200).optional(),query:z.string().max(200).optional(),filter:z.string().max(40).optional(),before:z.string().max(600).optional()}).strict();
export async function sourceRead(request:Request){
 try{const session=await getOptionalSession();if(!session?.user.sub)throw new ConnectorStoreError('unauthenticated');const text=await request.text();if(text.length>2048)throw new ConnectorStoreError('invalid_input');const {id,itemId,...p}=input.parse(JSON.parse(text));const service=new ConnectorSourceService(getConnectorDatabase(),getConnectorStore(),getScamwinStore(),undefined,process.env.SCAMWIN_CONNECTORS_ENABLED==='true');return Response.json(itemId?await service.detail(session.user.sub,id,itemId):await service.list(session.user.sub,id,p),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){const value=connectorError(error);return Response.json(value,{status:value.code==='unauthenticated'?401:value.code==='invalid_input'?400:503,headers:{'Cache-Control':'private, no-store'}});}
}
