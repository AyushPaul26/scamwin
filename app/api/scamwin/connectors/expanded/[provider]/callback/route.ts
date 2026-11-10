import '@/lib/scamwin/connectors/integration-server';
import {cookies} from 'next/headers';
import {getOptionalSession} from '@/lib/auth0';
import {expandedAuthorizationServices} from '@/lib/scamwin/connectors/expanded-server';
import {expandedCookieName,type ExpandedProvider} from '@/lib/scamwin/connectors/expanded-auth';
export async function GET(request:Request,context:{params:Promise<{provider:string}>}){
 try{if(!process.env.APP_BASE_URL||new URL(request.url).origin!==new URL(process.env.APP_BASE_URL).origin)return new Response('Invalid callback',{status:400});}catch{return new Response('Unavailable',{status:503});}
 const {provider}=await context.params;if(!['slack','teams','discord','drive'].includes(provider))return new Response('Unavailable',{status:404});const session=await getOptionalSession();if(!session?.user.sub)return new Response('Sign in to finish connecting.',{status:401,headers:{'Cache-Control':'no-store'}});
 const query=new URL(request.url).searchParams,state=query.get('state')??'',jar=await cookies(),name=expandedCookieName(state);
 try{await expandedAuthorizationServices().service.complete(session.user.sub,provider as ExpandedProvider,query,jar.get(name)?.value);jar.delete(name);return new Response(null,{status:303,headers:{Location:'/account/connections','Cache-Control':'no-store'}});}catch{jar.delete(name);return new Response('Authorization could not be completed. Return to Connected apps and try again.',{status:400,headers:{'Cache-Control':'no-store'}});}
}
