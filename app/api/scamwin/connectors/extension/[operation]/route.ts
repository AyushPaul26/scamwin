import '@/lib/scamwin/connectors/integration-server';
import { extensionService } from '@/lib/scamwin/connectors/extension-server';
import { extensionRequest } from '@/lib/scamwin/connectors/extension-http';
export const maxDuration = 30;
export async function POST(request: Request, context: {
    params: Promise<{
        operation: string;
    }>;
}) { try {
    return await extensionRequest(request, (await context.params).operation, extensionService());
}
catch {
    return Response.json({ ok: false, error: 'Browser extension setup is unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
} }
