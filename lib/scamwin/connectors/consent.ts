import {z} from 'zod';
import {hasMailboxReadScope,type OAuthProvider,type MailboxProvider} from './oauth-providers';

export function hasReadonlyMailboxGrant(provider:MailboxProvider,scopes:readonly string[]):boolean{
 const identity=['openid','email','profile','offline_access'];
 const allowed=provider==='gmail'?[...identity,'https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/userinfo.profile']:[...identity,'Mail.Read','https://graph.microsoft.com/Mail.Read'];
 const normalize=(value:string)=>provider==='outlook'?value.toLowerCase():value;
 return hasMailboxReadScope(provider,scopes)&&scopes.every(scope=>allowed.map(normalize).includes(normalize(scope)));
}

/** Browser-safe consent input. Ownership and credentials are never accepted here. */
export const authorizationConsentSchema=z.object({provider:z.enum(['gmail','outlook','telegram']),consent:z.boolean().refine(Boolean,'Confirm the permission and processing explanation before continuing.'),id:z.string().min(1).max(200).optional(),epoch:z.number().int().positive().optional()}).strict().refine(v=>Boolean(v.id)===Boolean(v.epoch),'epoch_required');
export const authorizationDisclosure:Record<OAuthProvider,string>={
 gmail:'Connect with read-only Gmail permission. New connections start in Manual with Inbox selected; no history is imported. This does not allow sending, modifying or deleting mail. Gmail is currently available only in an operator-approved test-user pilot.',
 outlook:'Connect with read-only Outlook mail permission. New connections start in Manual with Inbox selected; no history is imported. This does not allow sending, modifying or deleting mail.',
 telegram:'Verify your Telegram identity in this browser. This alone does not allow message monitoring. A separate account-automation installation and explicit processing consent are required. No reply or delete permission is requested.',
};
export function validateResources(provider:string,scope:string[]):boolean{
 if(!scope.length||scope.length>50||new Set(scope).size!==scope.length)return false;
 if(provider==='gmail')return scope.every(v=>v==='inbox'||v==='all_mail'||/^label:[A-Za-z0-9_-]{1,180}$/.test(v));
 if(provider==='outlook')return scope.every(v=>v==='inbox'||v==='all_mail'||/^folder:[A-Za-z0-9_=-]{1,180}$/.test(v));
 return provider==='telegram'&&scope.length===1&&scope[0]==='identity';
}
