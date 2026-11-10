'use server';
import './integration-server';
import {cookies,headers} from 'next/headers';
import {getOptionalSession} from '@/lib/auth0';
import {expandedAuthorizationServices} from './expanded-server';
export async function beginExpandedAuthorization(input:unknown){try{const session=await getOptionalSession();if(!session?.user.sub)return {ok:false as const,error:'Sign in to connect an app.'};const jar=await cookies(),h=await headers();const result=await expandedAuthorizationServices().service.beginBrowser(session.user.sub,input,h.get('origin'),(name,value,options)=>jar.set(name,value,options));return {ok:true as const,...result};}catch{return {ok:false as const,error:'Authorization is unavailable. Manual checks remain available.'};}}
