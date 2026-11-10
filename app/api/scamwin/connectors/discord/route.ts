import '@/lib/scamwin/connectors/integration-server';
import { discordServices } from '@/lib/scamwin/connectors/discord-server';
import { discordInteractions } from '@/lib/scamwin/connectors/discord-interactions';
export const maxDuration = 5;
export async function POST(request: Request) { try {
    const services = discordServices();
    return discordInteractions(request, { enabled: true, publicKey: services.publicKey, applicationId: services.applicationId, handle: value => services.interactions.handle(value) });
}
catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
} }
