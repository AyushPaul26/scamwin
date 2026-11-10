import type { ConnectionRef, ConnectorStore, ProviderItem, SavedConnection } from './contracts';
import { PostgresConnectorStore, ConnectorStoreError, type ConnectorDatabase } from './store';
import { ConnectorRuntimeStore } from './runtime-store';
import { privateIdentifier, sealConnectorSecret, openConnectorSecret, type ConnectorKeyring } from './crypto';
import type { PostgresExpandedAuthorizationPersistence } from './expanded-auth';
import { discordSnowflake } from './discord-protocol';
export interface DiscordMediaReference {
    channelId: string;
    messageId: string;
    createdAt: string;
    editedAt: string | null;
    attachments: {
        id: string;
        url: string;
        mediaType: string;
        byteLength: number;
    }[];
}
const DAY = 86400000;
export class DiscordStore {
    constructor(readonly database: ConnectorDatabase, private readonly keyring: ConnectorKeyring, private readonly core: ConnectorStore, private readonly auth: PostgresExpandedAuthorizationPersistence, private readonly now: () => Date = () => new Date()) { }
    private at(offset = 0) { return new Date(this.now().getTime() + offset).toISOString(); }
    private key(value: string) { return privateIdentifier(value, { ownerId: 'discord', connectionId: 'discord', epoch: 1, purpose: 'identifier' }, this.keyring); }
    private binding(ref: ConnectionRef, id: string) { return { ownerId: ref.ownerId, connectionId: `${ref.id}:discord:${id}`, epoch: ref.epoch, purpose: 'content' as const }; }
    async current(ref: ConnectionRef) { const c = await this.core.getConnection(ref.ownerId, ref.id); if (!c || c.epoch !== ref.epoch || c.provider !== 'discord' || c.status !== 'active' || c.mode !== 'manual')
        throw new ConnectorStoreError('connection_unavailable'); return c; }
    async identity(ref: ConnectionRef, applicationId: string) { await this.current(ref); const identity = await this.auth.readIdentity(ref); if (!identity || identity.metadata.applicationId !== applicationId || !discordSnowflake.safeParse(identity.accountId).success)
        throw new ConnectorStoreError('discord_identity_required'); const grant = await this.core.readGrant(ref); if (!grant?.scopes.includes('identify'))
        throw new ConnectorStoreError('reconnect_required'); return identity; }
    async bind(ref: ConnectionRef, applicationId: string) { const identity = await this.identity(ref, applicationId); await this.database.query('INSERT INTO connector_discord_links(connection_id,owner_id,actor_key,application_key,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(connection_id) DO UPDATE SET actor_key=excluded.actor_key,application_key=excluded.application_key,expires_at=excluded.expires_at', [ref.id, ref.ownerId, this.key(identity.accountId), this.key(applicationId), this.at(90 * DAY)]); }
    async linked(actor: string, applicationId: string): Promise<SavedConnection> { const rows = (await this.database.query("SELECT c.id,c.owner_id FROM connector_discord_links l JOIN connector_connections c ON c.id=l.connection_id WHERE l.actor_key=$1 AND l.application_key=$2 AND l.expires_at>$3 AND c.provider='discord' AND c.status='active' AND c.mode='manual' LIMIT 2", [this.key(actor), this.key(applicationId), this.at()])).rows; if (rows.length !== 1)
        throw new ConnectorStoreError('discord_link_required'); const c = await this.core.getConnection(String(rows[0].owner_id), String(rows[0].id)); if (!c)
        throw new ConnectorStoreError('discord_link_required'); const identity = await this.identity(c, applicationId); if (identity.accountId !== actor)
        throw new ConnectorStoreError('discord_identity_required'); return c; }
    itemId(channelId: string, messageId: string) { return this.key(JSON.stringify(['message', channelId, messageId])); }
    /** Dedupe, selected source and preparation commit together, before an acknowledgement can succeed. */
    async accept(ref: SavedConnection, eventId: string, item: ProviderItem, media: DiscordMediaReference) { return this.database.transaction(async (sql) => { const locked = (await sql.query("SELECT id,scope FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider='discord' AND status='active' AND mode='manual' FOR UPDATE", [ref.id, ref.ownerId, ref.epoch])).rows[0]; if (!locked || JSON.stringify(locked.scope) !== JSON.stringify(ref.scope))
        throw new ConnectorStoreError('connection_unavailable'); const id = this.key(JSON.stringify(['event', eventId])); const event = await sql.query('INSERT INTO connector_discord_events(id,connection_id,epoch,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id', [id, ref.id, ref.epoch, this.at(90 * DAY)]); if (!event.rows.length)
        return { duplicate: true }; const database: ConnectorDatabase = { query: sql.query.bind(sql), transaction: fn => fn(sql) }; const core = new PostgresConnectorStore(database, { keyring: this.keyring, now: this.now }), runtime = new ConnectorRuntimeStore(database, this.keyring, this.now); const saved = await core.saveSelectedRevision(ref, item); {
        const mediaId = this.key(JSON.stringify([ref.id, ref.epoch, item.providerItemId, item.revisionHash]));
        await sql.query('INSERT INTO connector_discord_media(id,connection_id,owner_id,epoch,encrypted_reference,expires_at,revision_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [mediaId, ref.id, ref.ownerId, ref.epoch, sealConnectorSecret(JSON.stringify(media), this.binding(ref, mediaId), this.keyring), new Date(Date.parse(item.receivedAt) + 7 * DAY).toISOString(), saved.revision.id]);
    } await runtime.stageRevision(ref, saved.revision.id); return { duplicate: false }; }); }
    async media(ref: ConnectionRef, itemId: string, revisionHash: string): Promise<DiscordMediaReference> { await this.current(ref); const id = this.key(JSON.stringify([ref.id, ref.epoch, itemId, revisionHash])); const row = (await this.database.query("SELECT m.encrypted_reference FROM connector_discord_media m JOIN connector_revisions r ON r.id=m.revision_id JOIN connector_items i ON i.id=r.item_id WHERE m.id=$1 AND m.connection_id=$2 AND m.owner_id=$3 AND m.epoch=$4 AND m.expires_at>$5 AND r.content_expires_at>$5 AND r.encrypted_content IS NOT NULL AND i.state NOT IN ('deleted','expired','source_unavailable')", [id, ref.id, ref.ownerId, ref.epoch, this.at()])).rows[0]; if (!row)
        throw new ConnectorStoreError('attachment_unavailable'); return JSON.parse(openConnectorSecret(String(row.encrypted_reference), this.binding(ref, id), this.keyring)) as DiscordMediaReference; }
    async purge() { await this.database.query('DELETE FROM connector_discord_media WHERE expires_at<=$1', [this.at()]); await this.database.query('DELETE FROM connector_discord_events WHERE expires_at<=$1', [this.at()]); await this.database.query('DELETE FROM connector_discord_links WHERE expires_at<=$1', [this.at()]); }
}
