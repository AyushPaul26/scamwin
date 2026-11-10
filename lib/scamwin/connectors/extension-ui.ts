import { z } from 'zod';
import { isPublicInputUrl } from '../input';
export const EXTENSION_APP_ORIGIN = 'https://scamwin.vercel.app';
export const extensionClientSchema = z.string().regex(/^[a-p]{32}$/);
export const extensionSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export function extensionPublicUrl(value: string) { return isPublicInputUrl(value) && !/(^|\.)(home|lan|localdomain|example|arpa)$/.test(new URL(value).hostname); }
export const extensionOriginSchema = z.string().max(200).refine(v => extensionPublicUrl(v) && new URL(v).origin === v, 'Enter an exact public origin, such as https://example.com.');
export const extensionApprovalSchema = z.object({ ticket: z.string().regex(/^[a-p]{32}\.[A-Za-z0-9_-]{43}$/, 'Paste the pairing ticket from your extension.'), mode: z.enum(['manual', 'selective', 'all_new']), origins: z.array(extensionOriginSchema).max(20), contains: z.array(z.string().trim().min(1).max(200)).max(20), consent: z.literal(true), automaticDailyLimit: z.union([z.literal(1), z.literal(2)]) }).strict().superRefine((v, c) => { if (v.mode !== 'manual' && !v.origins.length)
    c.addIssue({ code: 'custom', path: ['origins'], message: 'Choose at least one exact site for automation.' }); if (v.mode === 'selective' && !v.contains.length)
    c.addIssue({ code: 'custom', path: ['contains'], message: 'Add a phrase for selective checks.' }); });
export type ExtensionApproval = z.infer<typeof extensionApprovalSchema>;
