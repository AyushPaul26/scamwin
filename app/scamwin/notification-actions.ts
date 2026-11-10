'use server';
import {z} from 'zod';
import {notificationAccount,pushService} from '@/lib/scamwin/connectors/notification-server';
import {connectorError} from '@/lib/scamwin/connectors/account-server';
import {pushConfiguration} from '@/lib/scamwin/connectors/push';
import {ConnectorStoreError} from '@/lib/scamwin/connectors/store';
async function result<T>(run:()=>Promise<T>){try{return {ok:true as const,data:await run()};}catch(error){return connectorError(error);}}
export async function setPrivateAlertReadAction(input:unknown){return result(async()=>{const {subject,store}=await notificationAccount();const v=z.object({id:z.string().uuid(),expectedRevision:z.number().int().positive(),read:z.boolean()}).strict().parse(input);if(!await store.setRead(subject,v.id,v.expectedRevision,v.read))throw new ConnectorStoreError('alert_unavailable');return {id:v.id};});}
export async function savePrivateAlertPreferenceAction(input:unknown){return result(async()=>{const {subject,store}=await notificationAccount();const v=z.object({allResults:z.boolean()}).strict().parse(input);return store.setAllResults(subject,v.allResults);});}
export async function registerDevicePushAction(input:unknown){return result(async()=>{const {subject}=await notificationAccount();if(!pushConfiguration())throw new ConnectorStoreError('push_unavailable');return pushService().register(subject,input);});}
export async function revokeDevicePushAction(){return result(async()=>{const {subject}=await notificationAccount();return pushService().revoke(subject);});}
