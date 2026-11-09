import { createHmac } from 'node:crypto';
import type { Observation, RelatedCase, ScamwinStore } from './contracts';
import { normalizeTarget } from './policy';
export type PrivateIndicator = { kind: 'hostname'|'recipient'|'endpoint'; fingerprint: string };
export function derivePrivateIndicators(ownerId:string,url:string,observations:Observation[],secret:string):PrivateIndicator[] {
  if(secret.length<32) throw new Error('Private correlation requires a separate HMAC secret.');
  const indicators:PrivateIndicator[]=[];
  const add=(kind:PrivateIndicator['kind'],value:string)=>{const fingerprint=createHmac('sha256',secret).update(JSON.stringify(['scamwin-indicator-v1',ownerId,kind,value])).digest('hex');if(!indicators.some(i=>i.kind===kind&&i.fingerprint===fingerprint))indicators.push({kind,fingerprint});};
  if(url) add('hostname',normalizeTarget(url).hostname);
  for(const o of observations.filter(o=>o.status==='observed'&&o.sourceKind==='live_page')) {
    if(o.kind==='payment_action'&&o.data.direction==='outgoing'&&typeof o.data.recipient==='string')add('recipient',o.data.recipient);
    if(o.kind==='form_destinations'&&Array.isArray(o.data.destinations))for(const target of o.data.destinations){if(typeof target!=='string')continue;try{add('endpoint',normalizeTarget(target).url);}catch{/* Unsupported destinations are not correlated. */}}
  }
  return indicators.slice(0,20);
}
export async function findRelatedCases(ownerId:string,checkId:string,url:string,observations:Observation[],store:ScamwinStore,env:Record<string,string|undefined>=process.env):Promise<{status:'available'|'unavailable';relatedCases:RelatedCase[];message:string}> {
  if((env.SCAMWIN_INDICATOR_HMAC_SECRET?.length??0)<32)return{status:'unavailable',relatedCases:[],message:'Private indicator correlation is not configured. No match or absence of matches was inferred.'};
  const indicators=derivePrivateIndicators(ownerId,url,observations,env.SCAMWIN_INDICATOR_HMAC_SECRET!);
  await store.saveIndicators(ownerId,checkId,indicators);
  const matches=await store.findRelatedCases(ownerId,checkId,indicators);
  const relatedCases=matches.slice(0,10).map(match=>({checkId:match.checkId,reason:`Exact ${match.kind==='hostname'?'selected hostname':match.kind==='recipient'?'observed payment recipient':'observed form endpoint'} match in your private history. This association alone does not establish common ownership or fraud.`,evidenceIds:observations.filter(o=>match.kind==='hostname'?o.kind==='url_validation':match.kind==='recipient'?o.kind==='payment_action'&&o.sourceKind==='live_page':o.kind==='form_destinations'&&o.sourceKind==='live_page').map(o=>o.id)}));
  return{status:'available',relatedCases,message:relatedCases.length?'Exact private indicator matches were found.':'No exact private indicator matches were found.'};
}
