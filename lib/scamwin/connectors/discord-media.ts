import { ConnectorStoreError } from './store';
import { discordCdnUrl } from './discord-interactions';
/** Saved signed selection only. No OAuth header goes to CDN and redirects are forbidden. */
export async function downloadDiscordAttachment(value: string, options: {
    channelId: string;
    attachmentId: string;
    maxBytes: number;
    deadlineAtMs: number;
    signal: AbortSignal;
    fetch?: typeof fetch;
    nowMs?: number;
}) {
    const fail = (code: string): never => { throw new ConnectorStoreError(code); }, now = options.nowMs ?? Date.now(), url = discordCdnUrl(value, options.channelId, options.attachmentId, now);
    if (options.signal.aborted)
        fail('provider_aborted');
    if (!url)
        fail('attachment_unavailable');
    const cap = Math.min(10 * 1024 * 1024, options.maxBytes);
    if (!Number.isSafeInteger(cap) || cap < 1)
        fail('response_too_large');
    const timeout = Math.min(10000, options.deadlineAtMs - Date.now());
    if (timeout <= 0)
        fail('provider_timeout');
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => { };
    const work = async () => { try {
        const response = await (options.fetch ?? fetch)(url!, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([options.signal, controller.signal]) });
        if (!response.ok || response.redirected || (response.url && response.url !== url!.href))
            fail('attachment_unavailable');
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > cap))
            fail('response_too_large');
        reader = response.body?.getReader();
        if (!reader)
            fail('attachment_unavailable');
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (true) {
            const part = await reader!.read();
            if (part.done)
                break;
            bytes += part.value.byteLength;
            if (bytes > cap)
                fail('response_too_large');
            chunks.push(part.value);
        }
        return Buffer.concat(chunks, bytes);
    }
    catch (error) {
        if (error instanceof ConnectorStoreError)
            throw error;
        return fail('attachment_unavailable');
    } };
    try {
        return await Promise.race([work(), new Promise<never>((_, reject) => { abort = () => { controller.abort(); reject(new ConnectorStoreError('provider_aborted')); }; if (options.signal.aborted)
                abort();
            else
                options.signal.addEventListener('abort', abort, { once: true }); timer = setTimeout(() => { controller.abort(); reject(new ConnectorStoreError('provider_timeout')); }, timeout); })]);
    }
    finally {
        clearTimeout(timer);
        options.signal.removeEventListener('abort', abort);
        controller.abort();
        void reader?.cancel().catch(() => { });
    }
}
