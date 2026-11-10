import {z} from 'zod';
export const driveConnectionInput=z.object({id:z.string().min(1).max(200),epoch:z.number().int().positive()}).strict();
export const driveFormSchema=driveConnectionInput.extend({scope:z.array(z.string().uuid()).max(50),mode:z.enum(['manual','selective','all_new']),contains:z.string().max(4019),consent:z.boolean(),paused:z.boolean(),automaticDailyLimit:z.union([z.literal(1),z.literal(2)])}).superRefine((v,ctx)=>{if(v.mode!=='manual'&&!v.scope.length)ctx.addIssue({code:'custom',path:['scope'],message:'Choose at least one opened file.'});if(v.mode!=='manual'&&!v.consent)ctx.addIssue({code:'custom',path:['consent'],message:'Confirm your selection and AI processing.'});const phrases=v.contains.split('\n').map(v=>v.trim()).filter(Boolean);if(v.mode==='selective'&&(!phrases.length||phrases.length>20||phrases.some(p=>p.length>200)))ctx.addIssue({code:'custom',path:['contains'],message:'Enter 1–20 phrases, at most 200 characters each.'});});
export const driveImportInput=driveConnectionInput.extend({resourceHandle:z.string().uuid()});
export type DriveImportValues=z.infer<typeof driveImportInput>;
export type DriveSettings=z.infer<typeof driveFormSchema>;
export type DriveChoice={handle:string;label:string;mimeType:string;selected:boolean};
export type DriveSetupStatus={epoch:number;mode:DriveSettings['mode'];paused:boolean;contains:string;automaticDailyLimit:1|2;resources:DriveChoice[];enabled:boolean;automaticEnabled:boolean};
