import {z} from 'zod';
import { providerItemRefSchema, type ConnectorStore } from './contracts';
import type { ConnectorRuntimeStore } from './runtime-store';
import type { ConnectorProviderRegistry } from './registry';
import {ConnectorStoreError} from './store';
import {saveUnavailableReference} from './sync';
import {errorCode} from './limits';
const envelope=z.object({id:z.string().min(1).max(200),epoch:z.number().int().positive()}).strict();
export interface SelectionPage {items:{handle:string;receivedAt:string;subject?:string;from?:string;unavailable?:boolean}[];nextHandle:string|null;expiresInSeconds:600}
export class ConnectorSelectionService {
  constructor(private readonly deps:{connectorStore:ConnectorStore;runtime:ConnectorRuntimeStore;registry:ConnectorProviderRegistry;enabled:boolean}){}
  private async owned(owner:string,id:string,epoch:number){
    if(!this.deps.enabled)throw new ConnectorStoreError('service_disabled');
    const c=await this.deps.connectorStore.getConnection(owner,id);
    if(!c||c.epoch!==epoch||c.status!=='active')throw new ConnectorStoreError('connection_unavailable');return c;
  }
  async list(owner:string,input:unknown):Promise<SelectionPage>{
    const v=envelope.extend({pageHandle:z.string().uuid().optional()}).parse(input),c=await this.owned(owner,v.id,v.epoch);
    const adapter=this.deps.registry.get(c.provider);if(!adapter.listSelected)throw new ConnectorStoreError('provider_unavailable');
    const pageToken=v.pageHandle?z.string().max(16384).parse(await this.deps.runtime.consumeHandle(c,v.pageHandle,'page')):null;
    const page=await adapter.listSelected(c,pageToken,AbortSignal.timeout(20000));
    await this.owned(owner,v.id,v.epoch);
    if(page.items.length>10)throw new ConnectorStoreError('invalid_provider_page');
    const items=[];
    for(const item of page.items){
      // Strip list-only display metadata before strict ProviderItemRef validation.
      const ref=providerItemRefSchema.parse({id:item.id,receivedAt:item.receivedAt,...(item.version?{version:item.version}:{})});
      const handle=await this.deps.runtime.saveHandle(c,'item',ref);
      items.push({handle,receivedAt:ref.receivedAt,...(item.subject?{subject:item.subject.slice(0,300)}:{}),...(item.from?{from:item.from.slice(0,300)}:{}),...(item.unavailable?{unavailable:true}:{})});
    }
    return {items,nextHandle:page.nextPageToken?await this.deps.runtime.saveHandle(c,'page',page.nextPageToken):null,expiresInSeconds:600};
  }
  async import(owner:string,input:unknown){
    const v=envelope.extend({handle:z.string().uuid()}).parse(input),c=await this.owned(owner,v.id,v.epoch);
    const ref=providerItemRefSchema.parse(await this.deps.runtime.consumeHandle(c,v.handle,'item'));
    if(await this.deps.runtime.isSourceSuppressed(c,ref.id))throw new ConnectorStoreError('source_unavailable');
    const adapter=this.deps.registry.get(c.provider);let saved;
    try{
      const item=await adapter.readItem(c,ref,AbortSignal.timeout(20000));await this.owned(owner,v.id,v.epoch);
      saved=await this.deps.connectorStore.saveSelectedRevision(c,item);
    }catch(error){
      const reason=errorCode(error);if(!['source_unavailable','provider_not_found','response_too_large','provider_denied'].includes(reason))throw error;
      saved=await saveUnavailableReference(c,ref,reason,this.deps,true);
    }
    await this.deps.runtime.stageRevision(c,saved.revision.id);
    return {itemId:saved.item.id,revisionId:saved.revision.id,state:saved.item.state};
  }
  async unavailable(owner:string,input:unknown){
    const v=envelope.extend({itemId:z.string().uuid()}).parse(input),c=await this.owned(owner,v.id,v.epoch);
    await this.deps.runtime.invalidateSource(c,v.itemId,'owner_removed_source');return {itemId:v.itemId,state:'source_unavailable' as const};
  }
}
