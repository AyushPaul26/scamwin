import { z } from 'zod';
export const discordContexts = ['server_messages', 'private_messages'] as const;
export const discordSelectionSchema = z.object({ contexts: z.array(z.enum(discordContexts)).min(1, 'Choose where you will select messages.').max(2), consent: z.boolean().refine(Boolean, 'Confirm permission for messages you select.') }).strict();
export const discordContextLabels = { server_messages: 'Messages I select in servers', private_messages: 'Messages I select in private conversations' };
export function discordInstallationUrl(applicationId: string) { if (!/^[1-9][0-9]{16,19}$/.test(applicationId))
    return null; const u = new URL('https://discord.com/oauth2/authorize'); u.search = new URLSearchParams({ client_id: applicationId, scope: 'applications.commands', integration_type: '1' }).toString(); return u.href; }
export const discordCommandConfiguration = { name: 'Check with Scamwin', type: 3, integration_types: [1], contexts: [0, 1, 2] } as const;
