'use server';
import '@/lib/scamwin/connectors/integration-server';
import { getOptionalSession } from '@/lib/auth0';
import { extensionService } from './extension-server';
export async function approveExtensionPairing(input: unknown) { try {
    const session = await getOptionalSession();
    if (!session?.user.sub)
        return { ok: false as const, error: 'Sign in to pair your browser.' };
    return { ok: true as const, ...await extensionService().approve(session.user.sub, input) };
}
catch {
    return { ok: false as const, error: 'Pairing could not be approved. Check the ticket, selected sites and consent, then try again.' };
} }
