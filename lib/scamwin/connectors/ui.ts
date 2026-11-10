import { z } from 'zod';
import { connectionModes, idSchema, type SavedConnection, type ProviderId, type BoundedPage, type Alert, type Activity } from './contracts';

export const accountLinks = [{href:'/account',label:'Overview'},{href:'/account/connections',label:'Connected apps'},{href:'/account/alerts',label:'Private alerts'},{href:'/account/activity',label:'Activity'},{href:'/account/privacy',label:'Privacy'}] as const;
export const providerLabels: Record<ProviderId,string> = {gmail:'Gmail',outlook:'Outlook',telegram:'Telegram',slack:'Slack',teams:'Microsoft Teams',discord:'Discord',drive:'Google Drive',extension:'Browser extension'};
export const modeLabels = {manual:'Manual',selective:'Selective automatic',all_new:'All new items'};
export type GrantReadiness = 'accepted'|'partial_grant'|'grant_missing'|'grant_expired'|'disconnected'|'identity_verified'|'identity_expired';
export type ConnectionCard = Omit<SavedConnection,'ownerId'> & { readiness:GrantReadiness; revision:string; cancellationPending:boolean;sync?:{lastSyncAt:string|null;reason:string;retryRequired:boolean}|null };
export type ProviderReadiness = {provider:ProviderId; status:'unavailable'|'ready'; message:string;automaticAvailable?:boolean};
export type ConnectionPage = BoundedPage<ConnectionCard> & {enabled:boolean; providers:ProviderReadiness[]};
export type AlertPage = BoundedPage<Alert>;
export type ActivityPage = BoundedPage<Activity>;
export function connectionCard(c:SavedConnection,readiness:GrantReadiness,cancellationPending=false):ConnectionCard {
  return {id:c.id,provider:c.provider,epoch:c.epoch,scopeVersion:c.scopeVersion,mode:c.mode,status:c.status,scope:c.scope.map(scope=>scope==='inbox'?'Inbox':scope==='all_mail'?'All mail, including Spam and Trash':scope==='unselected'?'No resources selected':c.provider==='gmail'?'Saved Gmail label':c.provider==='outlook'?'Saved Outlook folder':c.provider==='telegram'?'Linked Telegram scope':c.provider==='extension'?'Approved browser scope':'Selected app resource'),rules:c.rules,automaticDailyLimit:c.automaticDailyLimit,activationAt:c.activationAt,createdAt:c.createdAt,updatedAt:c.updatedAt,revision:c.updatedAt,readiness,cancellationPending};
}
export const listInput = z.object({before:z.string().min(1).max(600).optional(),query:z.string().trim().max(200).default(''),filter:z.string().max(40).default('all')}).strict();
export const connectionSettingsInput=z.object({id:idSchema,epoch:z.number().int().positive(),mode:z.enum(connectionModes),scope:z.array(idSchema).min(1).max(50),contains:z.string().max(4000),consent:z.boolean(),automaticDailyLimit:z.union([z.literal(1),z.literal(2)])}).strict().superRefine((v,ctx)=>{
 if(v.mode!=='manual'&&!v.consent) ctx.addIssue({code:'custom',path:['consent'],message:'Confirm the scope and AI processing before enabling automatic checks.'});
 if(v.mode==='selective'&&!v.contains.trim()) ctx.addIssue({code:'custom',path:['contains'],message:'Add at least one matching phrase.'});
 if(v.contains.split('\n').filter(s=>s.trim()).some(s=>s.trim().length>200)||v.contains.split('\n').filter(s=>s.trim()).length>20) ctx.addIssue({code:'custom',path:['contains'],message:'Use at most 20 phrases, each up to 200 characters.'});
});
export const connectionEnvelope=z.object({id:idSchema,epoch:z.number().int().positive()}).strict();
export {authorizationConsentSchema as beginInput} from './consent';
export function connectorStateLabel(state:string) {const labels:Record<string,string>={accepted:'Read access accepted',identity_verified:'Identity verified; monitoring requires separate setup',identity_expired:'Identity proof expired; reconnect to continue setup',partial_grant:'Read permission incomplete',grant_missing:'Read permission missing',grant_expired:'Read permission expired',quota_paused:'Quota paused',queued:'Queued',unsupported:'Unsupported item',pending_sync:'Waiting for sync',not_selected:'Not selected',result_ready:'Result ready'};return labels[state]||state.replaceAll('_',' ');}
