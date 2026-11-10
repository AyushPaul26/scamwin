'use server';
import './integration-server';
import { getOptionalSession } from '@/lib/auth0';
import { discordServices } from './discord-server';
export async function selectDiscordMessageContexts(input: unknown) { try {
    const session = await getOptionalSession();
    if (!session?.user.sub)
        return { ok: false as const, error: 'Sign in to choose Discord message actions.' };
    return { ok: true as const, ...await discordServices().setup.select(session.user.sub, input) };
}
catch {
    return { ok: false as const, error: 'Discord selection could not be saved. Reload the connection or reconnect Discord and try again.' };
} }
