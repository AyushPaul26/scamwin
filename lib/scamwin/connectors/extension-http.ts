import { extensionClientSchema } from './extension-ui';
import type { ExtensionService } from './extension-service';
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
export async function extensionRequest(request: Request, operation: string, service: ExtensionService): Promise<Response> {
    if (request.method !== 'POST' || !['redeem', 'intake', 'revoke', 'gap'].includes(operation))
        return response({ ok: false }, 404);
    const clientId = request.headers.get('x-scamwin-extension') ?? '', origin = request.headers.get('origin');
    if (!extensionClientSchema.safeParse(clientId).success || (origin && origin !== `chrome-extension://${clientId}`))
        return response({ ok: false }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        return response({ ok: false }, 415);
    const limit = operation === 'intake' ? 2 * 1024 * 1024 : 2048;
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    const reader = request.body?.getReader();
    if (!reader)
        return response({ ok: false }, 400);
    const deadline = Date.now() + 10000;
    try {
        while (true) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let part: ReadableStreamReadResult<Uint8Array>;
            try {
                part = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('body_timeout')), Math.max(1, deadline - Date.now())); })]);
            }
            finally {
                clearTimeout(timer);
            }
            if (part.done)
                break;
            bytes += part.value.byteLength;
            if (bytes > limit)
                return response({ ok: false }, 413);
            chunks.push(part.value);
        }
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (operation === 'redeem') {
            if (body.clientId !== clientId)
                return response({ ok: false }, 403);
            return response(await service.redeem(body));
        }
        const auth = request.headers.get('authorization') ?? '';
        if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth))
            return response({ ok: false }, 401);
        const token = auth.slice(7);
        if (operation === 'intake')
            return response(await service.intake(token, clientId, body));
        if (operation === 'gap')
            return response(await service.gap(token, clientId, body));
        if (!body || Array.isArray(body) || Object.keys(body).length)
            return response({ ok: false }, 400);
        await service.revoke(token, clientId);
        return response({ ok: true });
    }
    catch {
        return response({ ok: false, error: 'Extension request was not accepted. Reopen the current page or pair again.' }, 400);
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
