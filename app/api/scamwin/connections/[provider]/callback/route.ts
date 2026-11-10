import {cookies} from 'next/headers';
import {connectorAccount} from '@/lib/scamwin/connectors/account-server';
import {oauthConfiguration,oauthCookieName,oauthCookieOptions} from '@/lib/scamwin/connectors/oauth';
import {ConnectorStoreError} from '@/lib/scamwin/connectors/store';

/** Fixed destination; no provider error, code, identity, or credential is reflected. */
export async function GET(request:Request,context:{params:Promise<{provider:string}>}){
 const configuration=oauthConfiguration();if(!configuration.origin)return new Response('Authorization unavailable',{status:503,headers:{'Cache-Control':'private, no-store'}});
 let status='unavailable';
 const cookieStore=await cookies();let cookieName:string|undefined;
 try{
  const {provider}=await context.params,url=new URL(request.url);
  if(!['gmail','outlook','telegram'].includes(provider)||url.origin!==configuration.origin||url.pathname!==`/api/scamwin/connections/${provider}/callback`||url.search.length>20000)throw new ConnectorStoreError('invalid_callback');
  const state=url.searchParams.get('state');if(!state||state.length>128)throw new ConnectorStoreError('invalid_callback');cookieName=oauthCookieName(state);
  const {subject,oauth}=await connectorAccount();await oauth.complete(subject,provider,url.searchParams,cookieStore.get(cookieName)?.value);status='connected';
 }catch(error){if(error instanceof ConnectorStoreError&&error.code==='consent_denied')status='denied';}
 if(cookieName)cookieStore.set(cookieName,'',{...oauthCookieOptions,maxAge:0});
 return new Response(null,{status:303,headers:{Location:`${configuration.origin}/account/connections?authorization=${status}`,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
}
