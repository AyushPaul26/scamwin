import {z} from 'zod';
export const teamsConnectionInput=z.object({id:z.string().min(1).max(200),epoch:z.number().int().positive()}).strict();
export const teamsFormSchema=teamsConnectionInput.extend({
 scope:z.array(z.string().uuid()).max(20),mode:z.enum(['manual','selective','all_new']),contains:z.string().max(4019),consent:z.boolean(),paused:z.boolean(),automaticDailyLimit:z.union([z.literal(1),z.literal(2)]),
}).strict().superRefine((value,ctx)=>{
 const phrases=value.contains.split('\n').map(p=>p.trim()).filter(Boolean);
 if(phrases.length>20||phrases.some(p=>p.length>200)||value.mode==='selective'&&!phrases.length)ctx.addIssue({code:'custom',path:['contains'],message:'Enter one to 20 phrases, each up to 200 characters.'});
 if(value.mode!=='manual'&&!value.scope.length)ctx.addIssue({code:'custom',path:['scope'],message:'Choose at least one permitted chat.'});
 if(value.mode!=='manual'&&!value.consent)ctx.addIssue({code:'custom',path:['consent'],message:'Confirm the selected chats and AI processing.'});
});
export type TeamsSettingsValues=z.infer<typeof teamsFormSchema>;
export const teamsMessageInput=teamsConnectionInput.extend({resourceHandle:z.string().uuid({message:'Choose a saved chat.'}),messageLink:z.string().trim().url({message:'Paste the Teams message link.'}).max(4096)}).strict();
export type TeamsMessageValues=z.infer<typeof teamsMessageInput>;
export interface TeamsResourceChoice{handle:string;label:string;selected:boolean}
export interface TeamsSetupStatus{
 epoch:number;mode:TeamsSettingsValues['mode'];paused:boolean;contains:string;automaticDailyLimit:1|2;
 resources:TeamsResourceChoice[];subscriptions:number;enabled:boolean;automaticEnabled:boolean;
}
