import {z} from 'zod';
import type {ConnectorStore,SavedConnection} from './contracts';
import type {ConnectorRuntimeStore} from './runtime-store';
import {ConnectorStoreError} from './store';
import {ProviderHttpClient} from './provider-http';
import {connectionEnvelope} from './ui';
const resource=z.object({id:z.string().regex(/^[A-Za-z0-9_=-]{1,180}$/),name:z.string().min(1).max(300)});
export class MailboxResourceService{
 constructor(private deps:{core:ConnectorStore;runtime:ConnectorRuntimeStore;accessToken:(c:SavedConnection,signal:AbortSignal)=>Promise<string>;fetch?:typeof fetch}){}
 private async owned(owner:string,input:unknown){const v=connectionEnvelope.parse(input),c=await this.deps.core.getConnection(owner,v.id);if(!c||c.epoch!==v.epoch||c.status==='disconnected'||!['gmail','outlook'].includes(c.provider))throw new ConnectorStoreError('connection_unavailable');return c;}
 async list(owner:string,input:unknown){
  const c=await this.owned(owner,input),signal=AbortSignal.timeout(10000),token=await this.deps.accessToken(c,signal);
  const values:{scope:string;label:string}[]=[{scope:'inbox',label:'Inbox'}];let partial=false;
  if(c.provider==='gmail'){
   values.push({scope:'all_mail',label:'All mail, including Spam and Trash'});
   const http=new ProviderHttpClient({origin:'https://gmail.googleapis.com',allowedPath:/^\/gmail\/v1\/users\/me\/labels$/,fetch:this.deps.fetch});
   const raw=await http.json<{labels?:unknown[]}>('/gmail/v1/users/me/labels',token,{signal,maxBytes:262144});
   if(!Array.isArray(raw.labels))throw new ConnectorStoreError('invalid_provider_page');partial=raw.labels.length>100;
   for(const value of raw.labels.slice(0,100)){const r=resource.safeParse(value);if(r.success&&r.data.id!=='INBOX')values.push({scope:`label:${r.data.id}`,label:r.data.name});}
  }else{
   const http=new ProviderHttpClient({origin:'https://graph.microsoft.com',allowedPath:/^\/v1\.0\/me\/mailFolders$/,fetch:this.deps.fetch});
   const raw=await http.json<{value?:{id?:unknown;displayName?:unknown}[];'@odata.nextLink'?:unknown}>('/v1.0/me/mailFolders',token,{signal,maxBytes:262144,query:new URLSearchParams({$select:'id,displayName',$top:'100'})});
   if(!Array.isArray(raw.value))throw new ConnectorStoreError('invalid_provider_page');partial=!!raw['@odata.nextLink'];
   for(const value of raw.value.slice(0,100)){const r=resource.safeParse({id:value.id,name:value.displayName});if(r.success)values.push({scope:`folder:${r.data.id}`,label:r.data.name});}
  }
  await this.owned(owner,input);
  const resources=[];for(const value of values)resources.push({handle:await this.deps.runtime.saveHandle(c,'page',{kind:'mailbox_scope',scope:value.scope}),label:value.label,selected:c.scope.includes(value.scope)});
  return {resources,partial,description:c.provider==='outlook'?'Inbox and up to 100 top-level folders. Subfolders are not listed.':'Up to 100 mailbox labels. No message body is read.'};
 }
 async resolve(owner:string,input:unknown,handles:string[]){const c=await this.owned(owner,input);z.array(z.string().uuid()).min(1).max(20).parse(handles);const values=[];for(const handle of handles){const value=z.object({kind:z.literal('mailbox_scope'),scope:z.string()}).strict().parse(await this.deps.runtime.consumeHandle(c,handle,'page'));values.push(value.scope);}return values.includes('all_mail')?['all_mail']:[...new Set(values)];}
}
