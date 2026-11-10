import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createInsertSchema } from 'drizzle-zod';
import { connectorExtensionPairs, connectorExtensionGrants } from '../../db/scamwin-extension-schema';
import { PostgresConnectorStore, ConnectorStoreError, type ConnectorDatabase } from './store';
import { ConnectorRuntimeStore } from './runtime-store';
import type { ConnectorKeyring } from './crypto';
import type { SavedConnection, ProviderItem } from './contracts';
import { extensionApprovalSchema, extensionClientSchema, extensionSecretSchema, extensionPublicUrl } from './extension-ui';
import { readOwnerGeneration, assertOwnerGeneration } from './privacy-fence';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const pairInsert = createInsertSchema(connectorExtensionPairs), grantInsert = createInsertSchema(connectorExtensionGrants);
const captureSchema = z.object({ deliveryId: z.string().uuid(), mode: z.enum(['manual', 'automatic']), url: z.string().max(4096).refine(extensionPublicUrl), capturedAt: z.string().datetime(), text: z.string().min(1).max(262144), urls: z.array(z.string().max(4096).refine(extensionPublicUrl)).max(200), truncated: z.boolean() }).strict();
const DAY = 86400000;
function fail(reason: string): never { throw new ConnectorStoreError(reason); }
export class ExtensionService {
    private readonly now: () => Date;
    constructor(private readonly deps: {
        database: ConnectorDatabase;
        keyring: ConnectorKeyring;
        now?: () => Date;
        appOrigin: string;
        automaticEnabled: boolean;
    }) { this.now = deps.now ?? (() => new Date()); }
    private at(ms = 0) { return new Date(this.now().getTime() + ms).toISOString(); }
    private core(database = this.deps.database) { return new PostgresConnectorStore(database, { keyring: this.deps.keyring, now: this.now }); }
    /** Only an authenticated web action calls this. Merely opening a URL has no effect. */
    async approve(ownerId: string, input: unknown) {
        const generation = await readOwnerGeneration(this.deps.database, ownerId);
        const v = extensionApprovalSchema.parse(input);
        if (v.mode !== 'manual' && !this.deps.automaticEnabled)
            fail('automation_unavailable');
        if (v.origins.some(o => new URL(o).hostname.replace(/\.$/, '') === new URL(this.deps.appOrigin).hostname))
            fail('app_origin_excluded');
        const [clientId, challenge] = v.ticket.split('.');
        const code = randomBytes(32).toString('base64url');
        return this.deps.database.transaction(async (sql) => {
            const db: ConnectorDatabase = { query: sql.query.bind(sql), transaction: fn => fn(sql) }, core = this.core(db);
            await assertOwnerGeneration(sql, ownerId, generation);
            await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`extension-pair:${ownerId}`]);
            const pending = await sql.query('SELECT count(*) AS n FROM connector_extension_pairs WHERE owner_id=$1 AND expires_at>$2', [ownerId, this.at()]);
            if (Number(pending.rows[0].n) >= 5)
                fail('pairing_limit');
            let c = await core.createConnection(ownerId, { provider: 'extension', providerAccountId: randomUUID(), scope: ['manual:public', ...v.origins] });
            if (v.mode !== 'manual')
                c = await core.configureConnection(c, { mode: v.mode, scope: c.scope, rules: v.mode === 'selective' ? { contains: v.contains } : {}, consent: true, paused: false, automaticDailyLimit: v.automaticDailyLimit }, { cursor: 'visible-pages-only', capturedAt: this.at() });
            const row = pairInsert.parse({ codeHash: hash(code), connectionId: c.id, ownerId, epoch: c.epoch, clientId, challenge, expiresAt: this.at(300000) });
            await sql.query('INSERT INTO connector_extension_pairs(code_hash,connection_id,owner_id,epoch,client_id,challenge,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [row.codeHash, row.connectionId, row.ownerId, row.epoch, row.clientId, row.challenge, row.expiresAt]);
            return { code, connectionId: c.id, epoch: c.epoch, expiresAt: row.expiresAt };
        });
    }
    async redeem(input: unknown) {
        const v = z.object({ clientId: extensionClientSchema, verifier: extensionSecretSchema, code: extensionSecretSchema }).strict().parse(input);
        const challenge = createHash('sha256').update(v.verifier).digest('base64url');
        return this.deps.database.transaction(async (sql) => {
            const p = (await sql.query('SELECT * FROM connector_extension_pairs WHERE code_hash=$1 AND client_id=$2 AND challenge=$3 AND expires_at>$4', [hash(v.code), v.clientId, challenge, this.at()])).rows[0];
            if (!p)
                fail('pairing_unavailable');
            const locked = (await sql.query("SELECT id FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider='extension' AND status='active' FOR UPDATE", [p.connection_id, p.owner_id, p.epoch])).rows[0];
            if (!locked)
                fail('pairing_unavailable');
            const db: ConnectorDatabase = { query: sql.query.bind(sql), transaction: fn => fn(sql) }, core = this.core(db);
            const c = await core.getConnection(String(p.owner_id), String(p.connection_id));
            if (!c || c.epoch !== p.epoch || c.status !== 'active')
                fail('pairing_unavailable');
            const token = randomBytes(32).toString('base64url'), row = grantInsert.parse({ tokenHash: hash(token), connectionId: c.id, ownerId: c.ownerId, epoch: c.epoch, clientId: v.clientId, expiresAt: this.at(30 * DAY) });
            const consumed = await sql.query('DELETE FROM connector_extension_pairs WHERE code_hash=$1 AND client_id=$2 AND challenge=$3 AND expires_at>$4 RETURNING code_hash', [hash(v.code), v.clientId, challenge, this.at()]);
            if (!consumed.rows.length)
                fail('pairing_unavailable');
            await sql.query('INSERT INTO connector_extension_grants(token_hash,connection_id,owner_id,epoch,client_id,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [row.tokenHash, row.connectionId, row.ownerId, row.epoch, row.clientId, row.expiresAt]);
            // Core readiness stores only the grant digest, never the bearer secret.
            await core.saveGrant(c, { accessToken: row.tokenHash, expiresAt: row.expiresAt, scopes: c.scope });
            return { token, connectionId: c.id, epoch: c.epoch, mode: c.mode, origins: c.scope.filter(s => s !== 'manual:public'), expiresAt: row.expiresAt };
        });
    }
    private async authorize(db: ConnectorDatabase, token: string, clientId: string): Promise<SavedConnection> { extensionSecretSchema.parse(token); extensionClientSchema.parse(clientId); const r = (await db.query("SELECT g.owner_id,g.connection_id,g.epoch FROM connector_extension_grants g JOIN connector_connections c ON c.id=g.connection_id AND c.owner_id=g.owner_id AND c.epoch=g.epoch WHERE g.token_hash=$1 AND g.client_id=$2 AND g.expires_at>$3 AND c.provider='extension' AND c.status='active' FOR UPDATE OF c", [hash(token), clientId, this.at()])).rows[0]; if (!r)
        fail('extension_grant_unavailable'); const c = await this.core(db).getConnection(String(r.owner_id), String(r.connection_id)); if (!c)
        fail('extension_grant_unavailable'); return c; }
    async intake(token: string, clientId: string, input: unknown) {
        const v = captureSchema.parse(input), origin = new URL(v.url).origin;
        if (new URL(v.url).hostname.replace(/\.$/, '') === new URL(this.deps.appOrigin).hostname)
            fail('app_origin_excluded');
        if (Buffer.byteLength(v.text) > 262144)
            fail('capture_limit');
        const age = this.now().getTime() - Date.parse(v.capturedAt);
        if (age < -10000 || age > 60000)
            fail('capture_expired');
        return this.deps.database.transaction(async (sql) => {
            const db: ConnectorDatabase = { query: sql.query.bind(sql), transaction: fn => fn(sql) }, c = await this.authorize(db, token, clientId), core = this.core(db);
            if (v.mode === 'automatic' && (!this.deps.automaticEnabled || c.mode === 'manual' || !c.scope.includes(origin)))
                fail('automatic_scope_required');
            const eventId = hash(`${c.id}:${c.epoch}:${v.deliveryId}`), event = await sql.query('INSERT INTO connector_extension_events(id,connection_id,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [eventId, c.id, this.at(90 * DAY)]);
            if (!event.rows.length)
                return { duplicate: true };
            // Current, foreground page snapshots only; capture time is never an historical import cursor.
            const item: ProviderItem = { providerItemId: hash(v.url), deliveryId: v.deliveryId, revisionHash: hash(JSON.stringify([v.text, v.urls, v.truncated])), receivedAt: this.at(), text: v.text, urls: [...new Set([v.url, ...v.urls])].slice(0, 200), attachments: [], extraction: { coverage: 'partial', diagnostics: [{ reason: 'visible_top_frame_only', count: 1 }, ...(v.truncated ? [{ reason: 'capture_truncated', count: 1 }] : [])], overflow: { textBytes: 0, urls: 0, attachments: 0 } } };
            const saved = v.mode === 'manual' ? await core.saveSelectedRevision(c, item) : await core.saveRevision(c, item);
            await new ConnectorRuntimeStore(db, this.deps.keyring, this.now).stageRevision(c, saved.revision.id);
            return { duplicate: false, queued: v.mode === 'manual' || saved.item.state !== 'not_selected' };
        });
    }
    async revoke(token: string, clientId: string) { extensionSecretSchema.parse(token); extensionClientSchema.parse(clientId); return this.deps.database.transaction(async (sql) => { const row = (await sql.query('SELECT g.owner_id,g.connection_id,g.epoch FROM connector_extension_grants g JOIN connector_connections c ON c.id=g.connection_id AND c.owner_id=g.owner_id WHERE g.token_hash=$1 AND g.client_id=$2 FOR UPDATE OF c', [hash(token), clientId])).rows[0]; if (!row)
        return { alreadyRevoked: true }; const db: ConnectorDatabase = { query: sql.query.bind(sql), transaction: fn => fn(sql) }, core = this.core(db), c = await core.getConnection(String(row.owner_id), String(row.connection_id)); await sql.query('DELETE FROM connector_extension_grants WHERE token_hash=$1 AND client_id=$2', [hash(token), clientId]); if (c && c.epoch === row.epoch && c.status !== 'disconnected')
        await core.revokeConnection(c.ownerId, c.id, c.epoch); return { ok: true }; }); }
    async gap(token: string, clientId: string, input: unknown) { const v = z.object({ reason: z.enum(['permission_removed', 'capture_unavailable', 'delivery_failed']) }).strict().parse(input); return this.deps.database.transaction(async (sql) => { const db: ConnectorDatabase = { query: sql.query.bind(sql), transaction: fn => fn(sql) }, c = await this.authorize(db, token, clientId); await this.core(db).recordCoverageGap(c, v.reason, 1); return { ok: true }; }); }
    async purge() { await this.deps.database.query('DELETE FROM connector_extension_pairs WHERE expires_at<=$1', [this.at()]); await this.deps.database.query('DELETE FROM connector_extension_grants WHERE expires_at<=$1', [this.at()]); await this.deps.database.query('DELETE FROM connector_extension_events WHERE expires_at<=$1', [this.at()]); }
}
