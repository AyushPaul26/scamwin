import { z } from 'zod';
import { canonicalHash } from './policy';
import { ConnectorStoreError } from './store';
import { discordSnowflake, verifyDiscordRequest } from './discord-protocol';
import { discordCommandConfiguration } from './discord-ui';
import type { DiscordStore, DiscordMediaReference } from './discord-store';
import type { ProviderItem } from './contracts';
const user = z.object({ id: discordSnowflake });
const messageSchema = z.object({ id: discordSnowflake, channel_id: discordSnowflake, content: z.string().max(4 * 1024 * 1024).optional(), timestamp: z.string().datetime({ offset: true }), edited_timestamp: z.string().datetime({ offset: true }).nullable().optional(), attachments: z.array(z.object({ id: discordSnowflake, filename: z.string().max(1024), content_type: z.string().max(150).optional(), size: z.number().int().nonnegative(), url: z.string().max(4096) })).max(1000).optional(), embeds: z.array(z.unknown()).max(1000).optional(), sticker_items: z.array(z.unknown()).max(1000).optional(), message_reference: z.unknown().optional() });
const interactionSchema = z.object({ id: discordSnowflake, application_id: discordSnowflake, type: z.literal(2), context: z.union([z.literal(0), z.literal(1), z.literal(2)]), guild_id: discordSnowflake.optional(), channel_id: discordSnowflake, user: user.optional(), member: z.object({ user }).optional(), authorizing_integration_owners: z.record(z.string(), discordSnowflake), data: z.object({ type: z.literal(3), name: z.literal(discordCommandConfiguration.name), target_id: discordSnowflake, resolved: z.object({ messages: z.record(z.string(), messageSchema) }) }) });
const fail = (code: string): never => { throw new ConnectorStoreError(code); };
export function discordCdnUrl(value: string, channelId: string, attachmentId: string, nowMs = Date.now()): URL | null { try {
    const u = new URL(value);
    if (u.origin !== 'https://cdn.discordapp.com' || u.username || u.password || u.hash || u.port || /%2f|%5c|\.\./i.test(u.pathname) || !u.pathname.startsWith(`/attachments/${channelId}/${attachmentId}/`) || u.pathname.split('/').length !== 5 || !u.pathname.split('/')[4])
        return null;
    const names = [...u.searchParams.keys()];
    if (names.length !== new Set(names).size || names.some(n => !['ex', 'is', 'hm'].includes(n)))
        return null;
    if (names.length && (!/^[a-fA-F0-9]{1,16}$/.test(u.searchParams.get('ex') ?? '') || !/^[a-fA-F0-9]{1,16}$/.test(u.searchParams.get('is') ?? '') || !/^[a-fA-F0-9]{64}$/.test(u.searchParams.get('hm') ?? '')))
        return null;
    if (u.searchParams.has('ex') && parseInt(u.searchParams.get('ex')!, 16) * 1000 <= nowMs)
        return null;
    return u;
}
catch {
    return null;
} }
/** Only the explicitly selected resolved message is extracted; no REST history or callback file fetch. */
export class DiscordInteractionService {
    constructor(private readonly deps: {
        store: DiscordStore;
        applicationId: string;
        enabled: boolean;
        now?: () => Date;
    }) { }
    async handle(value: unknown) {
        if (!this.deps.enabled)
            fail('provider_unavailable');
        const v = interactionSchema.parse(value);
        if (v.application_id !== this.deps.applicationId)
            fail('discord_application_mismatch');
        const actor = v.context === 0 ? v.member?.user.id : v.user?.id;
        if (!actor || v.user && v.member && v.user.id !== v.member.user.id || v.authorizing_integration_owners['1'] !== actor)
            fail('discord_actor_mismatch');
        if (v.context === 0 && !v.guild_id || v.context !== 0 && v.guild_id)
            fail('discord_context_mismatch');
        const c = await this.deps.store.linked(actor!, this.deps.applicationId);
        const scope = v.context === 0 ? 'discord:server_messages' : 'discord:private_messages';
        if (!c.scope.includes(scope))
            fail('invalid_scope');
        const entries = Object.entries(v.data.resolved.messages);
        if (entries.length !== 1 || entries[0][0] !== v.data.target_id)
            fail('discord_target_mismatch');
        const m = entries[0][1];
        if (m.id !== v.data.target_id || m.channel_id !== v.channel_id)
            fail('discord_target_mismatch');
        const now = (this.deps.now?.() ?? new Date()).getTime();
        const bytes = Buffer.from(m.content ?? '');
        let textEnd = Math.min(bytes.length, 256 * 1024);
        if (textEnd < bytes.length) while (textEnd > 0 && (bytes[textEnd] & 0xc0) === 0x80) textEnd--;
        const text = new TextDecoder().decode(bytes.subarray(0, textEnd));
        const rawUrls = [...new Set(text.match(/https?:\/\/[^\s<>]+/g) ?? [])];
        const urls = rawUrls.filter(url => url.length <= 4096).slice(0, 200), files = m.attachments ?? [];
        const revisionHash = canonicalHash({ content: m.content ?? '', created: m.timestamp, edited: m.edited_timestamp ?? null, attachments: files.map(f => ({ id: f.id, name: f.filename, size: f.size, type: f.content_type ?? '', path: f.url.split('?')[0] })), embeds: JSON.stringify(m.embeds ?? []), stickers: JSON.stringify(m.sticker_items ?? []), messageReference: JSON.stringify(m.message_reference ?? null) });
        const media: DiscordMediaReference = { channelId: v.channel_id, messageId: m.id, createdAt: new Date(m.timestamp).toISOString(), editedAt: m.edited_timestamp ? new Date(m.edited_timestamp).toISOString() : null, attachments: [] };
        let missing = 0;
        const attachments = files.slice(0, 20).map(f => { const supported = ['image/png', 'image/jpeg', 'image/webp'].includes(f.content_type ?? '') && f.size > 0 && f.size <= 10 * 1024 * 1024 && !!discordCdnUrl(f.url, v.channel_id, f.id, now); if (supported)
            media.attachments.push({ id: f.id, url: f.url, mediaType: f.content_type!, byteLength: f.size });
        else
            missing++; return { id: `${f.id}:${revisionHash}`, name: f.filename.slice(0, 200), mediaType: f.content_type ?? 'application/octet-stream', byteLength: f.size, supported }; });
        const gaps = [...(bytes.length > 256 * 1024 ? [{ reason: 'discord_text_truncated', count: 1 }] : []), ...(rawUrls.length > urls.length ? [{ reason: 'discord_urls_not_checked', count: rawUrls.length - urls.length }] : []), ...(files.length > 20 ? [{ reason: 'discord_attachments_not_checked', count: files.length - 20 }] : []), ...(missing ? [{ reason: 'discord_attachment_unavailable', count: missing }] : []), ...((m.embeds?.length ?? 0) > 0 ? [{ reason: 'discord_embeds_not_checked', count: m.embeds!.length }] : []), ...((m.sticker_items?.length ?? 0) > 0 ? [{ reason: 'discord_stickers_not_checked', count: m.sticker_items!.length }] : []), ...(m.message_reference ? [{ reason: 'discord_reply_context_not_checked', count: 1 }] : [])];
        const item: ProviderItem = { providerItemId: this.deps.store.itemId(v.channel_id, m.id), revisionHash, receivedAt: new Date(now).toISOString(), text, urls, attachments, extraction: { coverage: gaps.length ? 'partial' : 'complete', diagnostics: gaps, overflow: { textBytes: Math.max(0, bytes.length - Buffer.byteLength(text)), urls: Math.max(0, rawUrls.length - urls.length), attachments: Math.max(0, files.length - 20) } } };
        await this.deps.store.accept(c, v.id, item, media);
        return { type: 4, data: { flags: 64, content: 'Selected message saved for a private check. See Connected apps for its status.', allowed_mentions: { parse: [] } } };
    }
}
/** No body parsing, PING response, owner lookup or admission precedes Ed25519 verification. */
export async function discordInteractions(request: Request, deps: {
    enabled: boolean;
    publicKey: string;
    applicationId: string;
    handle: (value: unknown) => Promise<unknown>;
    now?: () => number;
}): Promise<Response> {
    const headers = { 'Cache-Control': 'no-store' }, respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (!deps.enabled || !/^[a-fA-F0-9]{64}$/.test(deps.publicKey))
        return respond({ ok: false }, 503);
    const started = Date.now(), deadline = started + 2700, stamp = request.headers.get('x-signature-timestamp'), sig = request.headers.get('x-signature-ed25519');
    if (!stamp || !sig)
        return respond({ ok: false }, 401);
    const length = request.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > 1024 * 1024))
        return respond({ ok: false }, 413);
    let raw: Buffer;
    try {
        const reader = request.body?.getReader();
        if (!reader)
            return respond({ ok: false }, 400);
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
            while (true) {
                if (Date.now() > deadline)
                    return respond({ ok: false }, 503);
                let readTimer: ReturnType<typeof setTimeout> | undefined;
                let part: ReadableStreamReadResult<Uint8Array>;
                try {
                    part = await Promise.race([reader.read(), new Promise<never>((_, reject) => { readTimer = setTimeout(() => reject(new ConnectorStoreError('discord_ack_timeout')), Math.max(1, deadline - Date.now())); })]);
                }
                finally {
                    clearTimeout(readTimer);
                }
                if (part.done)
                    break;
                bytes += part.value.byteLength;
                if (bytes > 1024 * 1024)
                    return respond({ ok: false }, 413);
                chunks.push(part.value);
            }
            raw = Buffer.concat(chunks);
        }
        finally {
            await reader.cancel().catch(() => { });
            reader.releaseLock();
        }
    }
    catch (error) {
        return respond({ ok: false }, error instanceof ConnectorStoreError && error.code === 'discord_ack_timeout' ? 503 : 400);
    }
    if (!verifyDiscordRequest(raw, stamp, sig, deps.publicKey, deps.now?.() ?? Date.now()))
        return respond({ ok: false }, 401);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
        return respond({ ok: false }, 415);
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    }
    catch {
        return respond({ ok: false }, 400);
    }
    if (!value || Array.isArray(value) || typeof value !== 'object')
        return respond({ ok: false }, 400);
    const v = value as Record<string, unknown>;
    if (v.type === 1) {
        if (v.application_id !== undefined && v.application_id !== deps.applicationId)
            return respond({ ok: false }, 400);
        return respond({ type: 1 });
    }
    if (v.application_id !== deps.applicationId)
        return respond({ ok: false }, 400);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return respond(await Promise.race([deps.handle(value), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ConnectorStoreError('discord_ack_timeout')), Math.max(1, deadline - Date.now())); })]));
    }
    catch (error) {
        const malformed = error instanceof z.ZodError || error instanceof ConnectorStoreError && ['discord_application_mismatch', 'discord_actor_mismatch', 'discord_context_mismatch', 'discord_target_mismatch', 'invalid_scope'].includes(error.code);
        return respond({ ok: false }, malformed ? 400 : 503);
    }
    finally {
        clearTimeout(timer);
    }
}
