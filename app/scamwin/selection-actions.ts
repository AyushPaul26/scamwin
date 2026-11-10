'use server';
import { connectorAccount,connectorError } from '@/lib/scamwin/connectors/account-server';
import { connectorRuntimeServices } from '@/lib/scamwin/connectors/runtime-server';
import { z } from 'zod';
import { ConnectorStoreError } from '@/lib/scamwin/connectors/store';
async function execute<T>(run:(subject:string)=>Promise<T>){
  try{const {subject}=await connectorAccount();return {ok:true as const,data:await run(subject)};}
  catch(error){return connectorError(error);}
}
export async function listSelectedSourcesAction(input:unknown){return execute(subject=>connectorRuntimeServices().selection.list(subject,input));}
export async function importSelectedSourceAction(input:unknown){return execute(subject=>connectorRuntimeServices().selection.import(subject,input));}
export async function removeConnectedSourceAction(input:unknown){return execute(subject=>connectorRuntimeServices().selection.unavailable(subject,input));}
export async function retryConnectionSyncAction(input:unknown){return execute(async subject=>{
  const v=z.object({id:z.string().min(1).max(200),epoch:z.number().int().positive()}).strict().parse(input),services=connectorRuntimeServices();
  if(!services.configuration.enabled||!services.automaticEnabled)throw new ConnectorStoreError('service_disabled');
  const connection=await services.connectorStore.getConnection(subject,v.id);
  if(!connection||connection.epoch!==v.epoch)throw new ConnectorStoreError('connection_unavailable');
  return services.runtime.retrySync(connection);
});}
