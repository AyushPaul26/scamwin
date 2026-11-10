'use server';
import {z} from 'zod';
import {cookies,headers} from 'next/headers';
import {connectorAccount,connectorError} from '@/lib/scamwin/connectors/account-server';
import {beginInput,connectionEnvelope} from '@/lib/scamwin/connectors/ui';
async function result<T>(run:()=>Promise<T>){try{return {ok:true as const,data:await run()};}catch(error){return connectorError(error);}}
export async function beginConnectionAction(input:unknown){return result(async()=>{const {subject,oauth}=await connectorAccount();const requestHeaders=await headers(),cookieStore=await cookies();return oauth.beginBrowser(subject,beginInput.parse(input),requestHeaders.get('origin'),(name,value,options)=>cookieStore.set(name,value,options));});}
export async function saveConnectionModeAction(input:unknown){return result(async()=>{const {subject,service}=await connectorAccount();return service.save(subject,input);});}
export async function pauseConnectionAction(input:unknown){return result(async()=>{const {subject,service}=await connectorAccount();const v=connectionEnvelope.extend({paused:z.boolean()}).strict().parse(input);return service.pause(subject,v.id,v.epoch,v.paused);});}
export async function disconnectConnectionAction(input:unknown){return result(async()=>{const {subject,service}=await connectorAccount();const v=connectionEnvelope.parse(input);return service.disconnect(subject,v.id,v.epoch);});}
export async function markAlertReadAction(input:unknown){return result(async()=>{const {subject,service}=await connectorAccount();const v=z.object({id:z.string().min(1).max(200)}).strict().parse(input);return service.seen(subject,v.id);});}
