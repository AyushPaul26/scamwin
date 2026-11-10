import type { ConnectorStore, SavedConnection, ProviderItem, ProviderPage } from '../contracts';
import type { AttachmentLoader } from '../targets';
import type { DiscordStore } from '../discord-store';
import type { DiscordAuthorizationDriver } from '../discord-protocol';
import { ConnectorStoreError } from '../store';
import { downloadDiscordAttachment } from '../discord-media';
export class DiscordAdapter {
    readonly capabilities = { pull: false, history: false, selectedItem: true, push: false, edits: false, attachments: true };
    constructor(private readonly deps: {
        store: DiscordStore;
        core: ConnectorStore;
        driver: DiscordAuthorizationDriver;
        fetch?: typeof fetch;
        now?: () => Date;
    }) { }
    async activationHook(): Promise<never> { throw new ConnectorStoreError('discord_manual_only'); }
    async pullChanges(): Promise<ProviderPage> { throw new ConnectorStoreError('discord_manual_only'); }
    async readItem(): Promise<ProviderItem> { throw new ConnectorStoreError('discord_select_message_action'); }
    readonly readAttachment: AttachmentLoader = async (c, source, attachment, budget, signal) => { const parts = attachment.id.split(':'); if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1]))
        throw new ConnectorStoreError('attachment_unavailable'); const media = await this.deps.store.media(c, source.id, parts[1]), file = media.attachments.find(a => a.id === parts[0]); if (!file || !attachment.supported || file.mediaType !== attachment.mediaType || file.byteLength !== attachment.byteLength)
        throw new ConnectorStoreError('attachment_unavailable'); return downloadDiscordAttachment(file.url, { channelId: media.channelId, attachmentId: file.id, maxBytes: budget.maxBytes, deadlineAtMs: budget.deadlineAtMs, signal, fetch: this.deps.fetch, nowMs: this.deps.now?.().getTime() }); };
    async revoke(c: SavedConnection, signal: AbortSignal) { const grant = await this.deps.core.readGrant(c); return grant ? this.deps.driver.revoke(grant, signal) : { status: 'already_revoked' as const }; }
}
