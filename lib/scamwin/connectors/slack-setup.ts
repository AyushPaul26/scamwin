import type {ConnectorStore} from './contracts';
import type {ConnectorRuntimeStore} from './runtime-store';
import {ConnectorStoreError} from './store';
import {z} from 'zod';
import type {SlackAdapter} from './providers/slack';
import type {SlackStore} from './slack-store';
const selection=z.object({id:z.string().uuid(),epoch:z.number().int().positive(),handles:z.array(z.string().uuid()).min(1).max(50),consent:z.literal(true)}).strict();
/** Opaque resource handles are scoped to owner and connection; provider IDs never leave this service. */
export class SlackSetupService {
 constructor(private readonly deps:{core:ConnectorStore;runtime:ConnectorRuntimeStore;store:SlackStore;adapter:SlackAdapter;enabled:boolean}){}
 private async owned(owner:string,id:string,epoch:number){if(!this.deps.enabled)throw new ConnectorStoreError('provider_unavailable');const c=await this.deps.core.getConnection(owner,id);if(!c||c.provider!=='slack'||c.epoch!==epoch||c.status!=='active')throw new ConnectorStoreError('connection_unavailable');return c;}
 async discover(owner:string,input:unknown){const v=z.object({id:z.string().uuid(),epoch:z.number().int().positive(),page:z.string().uuid().nullable().optional()}).strict().parse(input),c=await this.owned(owner,v.id,v.epoch);const cursor=v.page?z.string().max(10000).parse(await this.deps.runtime.consumeHandle(c,v.page,'page')):null;const result=await this.deps.adapter.discover(c,cursor,AbortSignal.timeout(10000));return {resources:result.resources,nextPage:result.nextCursor?await this.deps.runtime.saveHandle(c,'page',result.nextCursor):null};}
 async select(owner:string,input:unknown){const v=selection.parse(input),c=await this.owned(owner,v.id,v.epoch);for(const h of v.handles)await this.deps.store.resource(c,h);const saved=await this.deps.core.configureConnection(c,{mode:'manual',scope:[...new Set(v.handles)],rules:{},consent:true,paused:false,automaticDailyLimit:c.automaticDailyLimit});await this.deps.store.bindInstallation(saved);return {id:saved.id,epoch:saved.epoch,mode:'manual' as const};}
}
