import {readOwnerGeneration,assertOwnerGeneration} from './privacy-fence';
// Server-only authorization boundary. Drivers are constructed by trusted server composition.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {ownerSchema,grantSchema,type ConnectorGrant,type ConnectorStore,type ConnectionRef,type RevocationResult} from './contracts';
import {PostgresConnectorStore,ConnectorStoreError,type ConnectorDatabase} from './store';
import {openConnectorSecret,sealConnectorSecret,privateIdentifier,type ConnectorKeyring} from './crypto';
export type ExpandedProvider='slack'|'teams'|'discord'|'drive';
export interface ExpandedIdentity {accountId:string;label:string;metadata:Record<string,string>}
export interface ExpandedAuthorizationDriver {
 readonly provider:ExpandedProvider;
 authorizationUrl(input:{state:string;redirectUri:string;verifier:string;nonce:string}):string;
 exchange(input:{code:string;redirectUri:string;verifier:string;nonce:string;issuedAfter:number;signal:AbortSignal}):Promise<{identity:ExpandedIdentity;grant:ConnectorGrant}>;
 refresh(grant:ConnectorGrant,signal:AbortSignal):Promise<ConnectorGrant>;
 /** Optional fixed provider revocation. Never implement shared Slack workspace revocation here. */
 revoke?(grant:ConnectorGrant,signal:AbortSignal):Promise<RevocationResult>;
}
const providerSchema=z.enum(['slack','teams','discord','drive']);
const inputSchema=z.object({provider:providerSchema,reconnect:z.object({id:z.string().min(1).max(200),epoch:z.number().int().positive()}).strict().optional()}).strict();
const identitySchema=z.object({accountId:z.string().min(1).max(1000),label:z.string().min(1).max(200),metadata:z.record(z.string().max(80),z.string().max(2000)).refine(v=>Object.keys(v).length<=30)}).strict();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
function fail(code:string):never{throw new ConnectorStoreError(code);}
interface Flow {ownerGeneration?:number;owner:string;provider:ExpandedProvider;redirectUri:string;verifier:string;nonce:string;cookieHash:string;createdAt:number;expiresAt:number;reconnect?:{id:string;epoch:number}}
export const expandedCookieOptions={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/',maxAge:600};
export const expandedCookieName=(state:string)=>`__Host-scamwin-expanded-${hash(state).slice(0,32)}`;
export function expandedCallbackUri(origin:string,provider:ExpandedProvider){const u=new URL(origin);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')fail('invalid_origin');return `${u.origin}/api/scamwin/connectors/expanded/${provider}/callback`;}
export class PostgresExpandedAuthorizationPersistence {
 constructor(private readonly db:ConnectorDatabase,private readonly options:{keyring:ConnectorKeyring;now?:()=>Date}){}
 private now(){return (this.options.now?.()??new Date()).getTime();}
 private binding(owner:string,id:string,epoch=1){return {ownerId:owner,connectionId:id,epoch,purpose:'oauth' as const};}
 async save(state:string,flow:Flow){flow={...flow,ownerGeneration:await readOwnerGeneration(this.db,flow.owner)};const id=`expanded:${hash(state)}`;await this.db.transaction(async sql=>{await assertOwnerGeneration(sql,flow.owner,flow.ownerGeneration!);await sql.query('INSERT INTO connector_oauth_flows (id,owner_id,provider,connection_id,expected_epoch,encrypted_flow,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,flow.owner,flow.provider,flow.reconnect?.id??null,flow.reconnect?.epoch??null,sealConnectorSecret(JSON.stringify(flow),this.binding(flow.owner,id),this.options.keyring),new Date(flow.expiresAt).toISOString()]);});}
 async claim(owner:string,provider:ExpandedProvider,state:string,cookie:string){
  if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!cookie||cookie.length>200)fail('invalid_flow');const id=`expanded:${hash(state)}`;
  return this.db.transaction(async db=>{const row=(await db.query('SELECT * FROM connector_oauth_flows WHERE id=$1 AND owner_id=$2 AND provider=$3 AND expires_at>$4 FOR UPDATE',[id,owner,provider,new Date(this.now()).toISOString()])).rows[0];if(!row)fail('invalid_flow');
   const flow=JSON.parse(openConnectorSecret(String(row.encrypted_flow),this.binding(owner,id),this.options.keyring)) as Flow;
   if(!timingSafeEqual(Buffer.from(hash(cookie)),Buffer.from(flow.cookieHash))||flow.owner!==owner||flow.provider!==provider||flow.createdAt>this.now()||flow.expiresAt<=this.now()||flow.expiresAt-flow.createdAt>600000)fail('invalid_flow');
   if(flow.reconnect){const c=(await db.query('SELECT epoch,provider FROM connector_connections WHERE id=$1 AND owner_id=$2',[flow.reconnect.id,owner])).rows[0];if(!c||c.epoch!==flow.reconnect.epoch||c.provider!==provider)fail('stale_connection');}
   await db.query('DELETE FROM connector_oauth_flows WHERE id=$1',[id]);return flow;
  });
 }
 async attach(flow:Flow,identity:ExpandedIdentity,grant:ConnectorGrant){identitySchema.parse(identity);grantSchema.parse(grant);if(flow.expiresAt<=this.now())fail('expired_flow');
  return this.db.transaction(async sql=>{await assertOwnerGeneration(sql,flow.owner,flow.ownerGeneration??0);const scoped:ConnectorDatabase={query:sql.query.bind(sql),transaction:fn=>fn(sql)};const core=new PostgresConnectorStore(scoped,this.options);
   const account=JSON.stringify([flow.provider,identity.accountId]);let connection;
   if(flow.reconnect){const locked=(await sql.query('SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider=$4 FOR UPDATE',[flow.reconnect.id,flow.owner,flow.reconnect.epoch,flow.provider])).rows[0];if(!locked)fail('stale_connection');const ref={id:flow.reconnect.id,ownerId:flow.owner,epoch:flow.reconnect.epoch,provider:flow.provider};const previous=await core.readGrant(ref);const attached={...grant,refreshToken:grant.refreshToken??previous?.refreshToken};connection=await core.reconnectConnection(flow.owner,flow.reconnect.id,flow.reconnect.epoch,account,attached);}
   else {connection=await core.createConnection(flow.owner,{provider:flow.provider,providerAccountId:account,scope:['unselected']});if(await core.readGrant(connection))fail('reconnect_required');if(connection.status==='disconnected')fail('reconnect_required');await core.saveGrant(connection,grant);}
   const binding={ownerId:connection.ownerId,connectionId:`${connection.id}:identity`,epoch:connection.epoch,purpose:'grant' as const};
   await sql.query('UPDATE connector_connections SET encrypted_identity=$1 WHERE id=$2',[sealConnectorSecret(JSON.stringify(identity),binding,this.options.keyring),connection.id]);
   if(flow.provider==='slack'){
    const slackId=z.string().regex(/^[A-Z][A-Z0-9]{1,79}$/),teamId=slackId.parse(identity.metadata.teamId),appId=slackId.parse(identity.metadata.appId);
    const routeKey=(value:string)=>privateIdentifier(value,{ownerId:'slack',connectionId:'slack-installation',epoch:1,purpose:'identifier'},this.options.keyring);
    // Commit routing with the grant, identity and owner-generation fence, before discovery is possible.
    await sql.query('INSERT INTO connector_slack_installations(connection_id,owner_id,team_key,app_key,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(connection_id) DO UPDATE SET team_key=excluded.team_key,app_key=excluded.app_key,expires_at=excluded.expires_at',[connection.id,connection.ownerId,routeKey(teamId),routeKey(appId),new Date(this.now()+90*86400000).toISOString()]);
   }
   return connection;
  });
 }
 async readIdentity(ref:ConnectionRef):Promise<ExpandedIdentity|null>{const row=(await this.db.query("SELECT encrypted_identity FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider=$4 AND status<>'disconnected'",[ref.id,ref.ownerId,ref.epoch,ref.provider])).rows[0];return row?.encrypted_identity?identitySchema.parse(JSON.parse(openConnectorSecret(String(row.encrypted_identity),{ownerId:ref.ownerId,connectionId:`${ref.id}:identity`,epoch:ref.epoch,purpose:'grant'},this.options.keyring))):null;}
}
export class ExpandedAuthorizationService {
 private readonly drivers:Map<ExpandedProvider,ExpandedAuthorizationDriver>;
 constructor(private readonly core:ConnectorStore,private readonly persistence:PostgresExpandedAuthorizationPersistence,private readonly options:{origin:string;enabled:boolean;drivers:ExpandedAuthorizationDriver[];now?:()=>number}){this.drivers=new Map(options.drivers.map(d=>[d.provider,d]));}
 private now(){return this.options.now?.()??Date.now();}
 private driver(provider:ExpandedProvider){if(!this.options.enabled)fail('service_disabled');return this.drivers.get(provider)??fail('provider_unavailable');}
 async begin(owner:string,input:unknown){ownerSchema.parse(owner);const v=inputSchema.parse(input),driver=this.driver(v.provider);if(v.reconnect){const c=await this.core.getConnection(owner,v.reconnect.id);if(!c||c.provider!==v.provider||c.epoch!==v.reconnect.epoch)fail('stale_connection');}
  const state=secret(),browserBindingSecret=secret(),flow:Flow={owner,provider:v.provider,redirectUri:expandedCallbackUri(this.options.origin,v.provider),verifier:secret(),nonce:secret(),cookieHash:hash(browserBindingSecret),createdAt:this.now(),expiresAt:this.now()+600000,reconnect:v.reconnect};
  const authorizationUrl=driver.authorizationUrl({state,redirectUri:flow.redirectUri,verifier:flow.verifier,nonce:flow.nonce});await this.persistence.save(state,flow);return {authorizationUrl,browserBindingSecret,cookieName:expandedCookieName(state)};
 }
 async beginBrowser(owner:string,input:unknown,origin:string|null,setCookie:(name:string,value:string,options:typeof expandedCookieOptions)=>void){if(origin!==this.options.origin)fail('invalid_origin');const r=await this.begin(owner,input);setCookie(r.cookieName,r.browserBindingSecret,expandedCookieOptions);return {authorizationUrl:r.authorizationUrl};}
 async complete(owner:string,provider:ExpandedProvider,query:URLSearchParams,cookie?:string){ownerSchema.parse(owner);providerSchema.parse(provider);const driver=this.driver(provider);if(query.getAll('state').length!==1||query.getAll('code').length>1||query.getAll('error').length>1)fail('invalid_flow');const flow=await this.persistence.claim(owner,provider,query.get('state')??'',cookie??'');if(query.has('error'))fail('consent_denied');const code=query.get('code');if(!code||code.length>16384||flow.redirectUri!==expandedCallbackUri(this.options.origin,provider))fail('invalid_flow');
  const result=await driver.exchange({code,redirectUri:flow.redirectUri,verifier:flow.verifier,nonce:flow.nonce,issuedAfter:flow.createdAt,signal:AbortSignal.timeout(10000)});this.driver(provider);return this.persistence.attach(flow,result.identity,result.grant);
 }
 /** Capture a bounded credential locally. Root must fence/erase locally before invoking returned cleanup. */
 async prepareDisconnect(ref:ConnectionRef){const provider=providerSchema.parse(ref.provider),driver=this.drivers.get(provider);const current=await this.core.getConnection(ref.ownerId,ref.id);if(!current||current.epoch!==ref.epoch||current.provider!==provider)fail('connection_unavailable');const grant=await this.core.readGrant(ref);return async(signal:AbortSignal):Promise<RevocationResult>=>{const fenced=await this.core.getConnection(ref.ownerId,ref.id);if(!fenced||fenced.status!=='disconnected'||fenced.epoch<=ref.epoch)fail('local_disconnect_required');if(!grant||!driver?.revoke||provider==='slack')return {status:'unavailable',reason:provider==='slack'?'slack_workspace_installation_removal_required':'provider_account_removal_required'};try{return await driver.revoke(grant,AbortSignal.any([signal,AbortSignal.timeout(10000)]));}catch{return {status:'unavailable',reason:'remote_revocation_unavailable'};}};}
 async accessToken(ref:ConnectionRef,signal:AbortSignal){signal.throwIfAborted();const driver=this.driver(providerSchema.parse(ref.provider)),existing=await this.core.readGrant(ref);if(!existing)fail('grant_missing');if(!existing.expiresAt||Date.parse(existing.expiresAt)>this.now()+30000)return existing.accessToken;
  const lease=await this.core.leaseGrantRefresh(ref);if(!lease)fail('refresh_in_progress');try{if(!lease.grant.expiresAt||Date.parse(lease.grant.expiresAt)>this.now()+30000)return lease.grant.accessToken;if(!lease.grant.refreshToken)fail('reconnect_required');const grant=grantSchema.parse(await driver.refresh(lease.grant,AbortSignal.any([signal,AbortSignal.timeout(10000)])));signal.throwIfAborted();await this.core.finishGrantRefresh(lease,grant);return grant.accessToken;}finally{await this.core.releaseGrantRefresh(lease);}
 }
}
