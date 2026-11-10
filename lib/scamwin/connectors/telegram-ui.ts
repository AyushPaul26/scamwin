import {z} from 'zod';
export const telegramConnectionInput=z.object({id:z.string().min(1).max(200),epoch:z.number().int().positive()}).strict();
export const telegramFormSchema=telegramConnectionInput.extend({mode:z.enum(['manual','selective','all_new']),contains:z.string().max(4000),consent:z.boolean(),paused:z.boolean(),automaticDailyLimit:z.union([z.literal(1),z.literal(2)])}).strict().superRefine((v,ctx)=>{
 if(v.mode!=='manual'&&!v.consent)ctx.addIssue({code:'custom',path:['consent'],message:'Confirm the selected private-chat scope and AI processing.'});
 const phrases=v.contains.split('\n').map(s=>s.trim()).filter(Boolean);
 if(v.mode==='selective'&&(!phrases.length||phrases.length>20||phrases.some(p=>p.length>200)))ctx.addIssue({code:'custom',path:['contains'],message:'Use 1–20 matching phrases, each up to 200 characters.'});
});
export const telegramSetupLabels={identity_only:'Identity verified; link the service bot next',awaiting_automation:'Bot linked; select it in Telegram Chat Automation',automation_connected:'Chat Automation connected',automation_disabled:'Chat Automation disabled'};
