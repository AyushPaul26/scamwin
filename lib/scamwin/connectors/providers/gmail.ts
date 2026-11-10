import { createHash } from 'node:crypto';
import type { ProviderAdapter, ProviderItem, ProviderItemRef, ProviderPage, RevocationResult, SavedConnection, SyncBudget, SyncCursor } from '../contracts';
import { ProviderHttpClient, ProviderHttpError } from '../provider-http';
import { parseGmailMessage, type GmailParsedMessage, type GmailRawMessage, type GmailRawPart } from './gmail-message';

const ROOT = '/gmail/v1/users/me';
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const RETENTION_MS = 30 * 86400000;
const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const attachmentReference = (partId: string, attachmentId?: string) => `gmail-${digest({ partId, attachmentId: attachmentId ?? null })}`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function historyId(value: unknown): string { if (typeof value !== 'string' || !/^\d{1,100}$/.test(value)) throw new ProviderHttpError('invalid_cursor'); return value; }
function opaque(value: unknown, max = 200): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length > max || value === '.' || value === '..') throw new ProviderHttpError('invalid_cursor'); return value; }
function token(value: unknown): string | null { return value === undefined || value === null ? null : opaque(value, 2048); }
const structureFields = (depth: number): string => `partId,mimeType,body(attachmentId,size)${depth ? `,parts(${structureFields(depth - 1)})` : ''}`;
const ATTACHMENT_FIELDS = `id,labelIds,payload(${structureFields(16)})`;
/** Scope is an app filter, not an OAuth grant. Multiple labels use OR. */
function scope(connection: SavedConnection) {
  const values = connection.scope.length ? connection.scope : ['inbox'];
  if (values.length > 20) throw new ProviderHttpError('invalid_scope');
  if (values.length === 1 && values[0] === 'all_mail') return { labels: [] as string[], includeSpamTrash: true };
  const labels = values.map(v => v === 'inbox' ? 'INBOX' : v.startsWith('label:') ? opaque(v.slice(6)) : (() => { throw new ProviderHttpError('invalid_scope'); })());
  return { labels: [...new Set(labels)], includeSpamTrash: labels.includes('SPAM') || labels.includes('TRASH') };
}
function inScope(labels: unknown, selected: string[]): boolean { return !selected.length || Array.isArray(labels) && selected.some(label => labels.includes(label)); }
interface Checkpoint {
  v: 1; kind: 'history' | 'recovery'; base: string; scope: string; page: string | null; offset: number; fingerprint?: string;
  observedAt: string; recoveryCursor?: string; after?: number; before?: number;
}
function encode(state: Checkpoint): string { return JSON.stringify(state); }
function checkpoint(value: string | null, base: string, scopeHash: string): Checkpoint | null {
  if (value === null) return null;
  if (value.length > 16384) throw new ProviderHttpError('invalid_cursor');
  let state: unknown; try { state = JSON.parse(value); } catch { throw new ProviderHttpError('invalid_cursor'); }
  if (!record(state) || state.v !== 1 || !['history', 'recovery'].includes(String(state.kind)) || state.base !== base || state.scope !== scopeHash || !Number.isSafeInteger(state.offset) || Number(state.offset) < 0 || Number(state.offset) > 100000 || typeof state.observedAt !== 'string' || !Number.isFinite(Date.parse(state.observedAt)) || (state.fingerprint !== undefined && (typeof state.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(state.fingerprint)))) throw new ProviderHttpError('invalid_cursor');
  token(state.page);
  if (state.kind === 'recovery' && (typeof state.recoveryCursor !== 'string' || !/^\d{1,100}$/.test(state.recoveryCursor) || !Number.isSafeInteger(state.after) || !Number.isSafeInteger(state.before) || Number(state.after) < 0 || Number(state.before) <= Number(state.after))) throw new ProviderHttpError('invalid_cursor');
  return state as unknown as Checkpoint;
}
export interface GmailAdapterOptions {
  accessToken(connection: SavedConnection, signal: AbortSignal): Promise<string>;
  revoke(connection: SavedConnection, signal: AbortSignal): Promise<RevocationResult>;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}
export interface GmailSelectedPage { items: (ProviderItemRef & { subject?: string; from?: string; unavailable?: boolean })[]; nextPageToken: string | null }
type Attachment = ProviderItem['attachments'][number];
function extractionFor(parsed: GmailParsedMessage): NonNullable<ProviderItem['extraction']> {
  return { coverage: parsed.coverage, diagnostics: parsed.diagnostics.map(d => ({ reason: d.code, count: d.count })), overflow: { textBytes: 0, urls: Math.max(0, parsed.stats.linksDiscovered - parsed.links.length), attachments: Math.max(0, parsed.stats.attachmentsDiscovered - parsed.attachments.length) } };
}

/** No persistence: callers must fence grant access, durable writes and cursor advancement by owner/epoch. */
export class GmailAdapter implements ProviderAdapter {
  readonly capabilities = { pull: true, history: false, selectedItem: true, push: false, edits: false, attachments: true };
  private readonly http: ProviderHttpClient;
  private readonly now: () => Date;
  constructor(private readonly options: GmailAdapterOptions) {
    this.now = options.now ?? (() => new Date());
    this.http = new ProviderHttpClient({ origin: 'https://gmail.googleapis.com', allowedPath: /^\/gmail\/v1\/users\/me\/(?:profile|history|messages(?:\/[A-Za-z0-9_%=-]+(?:\/attachments\/[A-Za-z0-9_%=-]+)?)?)$/, fetch: options.fetch, timeoutMs: options.timeoutMs, now: this.now });
  }
  private valid(connection: SavedConnection, signal: AbortSignal) { if (connection.provider !== 'gmail' || connection.status !== 'active') throw new ProviderHttpError('source_unavailable'); if (signal.aborted) throw new ProviderHttpError('provider_aborted'); scope(connection); }
  private async get(connection: SavedConnection, path: string, query: URLSearchParams, signal: AbortSignal, maxBytes = MAX_RESPONSE, deadlineAtMs?: number): Promise<Record<string, unknown>> {
    this.valid(connection, signal);
    if (deadlineAtMs !== undefined && deadlineAtMs <= this.now().getTime()) throw new ProviderHttpError('provider_timeout');
    let accessToken: string;
    try { accessToken = await this.options.accessToken(connection, signal); }
    catch (error) {
      const code = record(error) ? error.code : undefined;
      if (signal.aborted) throw new ProviderHttpError('provider_aborted');
      if (code === 'reconnect_required' || code === 'invalid_grant') throw new ProviderHttpError('reconnect_required');
      throw new ProviderHttpError('provider_network');
    }
    const body = await this.http.json(path, accessToken, { signal, maxBytes, query, deadlineAtMs });
    if (!record(body)) throw new ProviderHttpError('malformed_response'); return body;
  }
  private async authorizeSource(connection: SavedConnection, id: string, signal: AbortSignal, deadlineAtMs?: number) {
    const metadata = await this.get(connection, `${ROOT}/messages/${encodeURIComponent(id)}`, new URLSearchParams({ format: 'metadata', fields: 'id,labelIds' }), signal, 65536, deadlineAtMs);
    if (metadata.id !== id || !inScope(metadata.labelIds, scope(connection).labels)) throw new ProviderHttpError('source_unavailable');
  }
  async activate(connection: SavedConnection, signal: AbortSignal): Promise<SyncCursor> {
    const profile = await this.get(connection, `${ROOT}/profile`, new URLSearchParams({ fields: 'historyId' }), signal, 16384);
    return { cursor: historyId(profile.historyId), pageState: null };
  }
  async revoke(connection: SavedConnection, signal: AbortSignal) { return this.options.revoke(connection, signal); }
  async pullChanges(connection: SavedConnection, cursor: SyncCursor | null, budget: SyncBudget, signal: AbortSignal): Promise<ProviderPage> {
    this.valid(connection, signal);
    const base = historyId(cursor?.cursor);
    if (connection.mode === 'manual') return { items: [], complete: true, finalCursor: base, pageState: null, gaps: [] };
    if (!connection.activationAt || !Number.isFinite(Date.parse(connection.activationAt))) throw new ProviderHttpError('activation_required');
    const filter = scope(connection), scopeHash = digest(filter);
    let state = checkpoint(cursor?.pageState ?? null, base, scopeHash) ?? { v: 1 as const, kind: 'history' as const, base, scope: scopeHash, page: null, offset: 0, observedAt: this.now().toISOString() };
    let response: Record<string, unknown>;
    try {
      const query = new URLSearchParams({ maxResults: '50' });
      if (state.page) query.set('pageToken', state.page);
      if (state.kind === 'history') { query.set('startHistoryId', base); query.set('historyTypes', 'messageAdded'); }
      else { query.set('q', `after:${state.after} before:${state.before}`); query.set('includeSpamTrash', String(filter.includeSpamTrash)); }
      response = await this.get(connection, `${ROOT}/${state.kind === 'history' ? 'history' : 'messages'}`, query, signal, MAX_RESPONSE, budget.deadlineAtMs);
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || error.code !== 'provider_not_found' || state.kind !== 'history') throw error;
      const activation = Date.parse(connection.activationAt);
      const fresh = await this.get(connection, `${ROOT}/profile`, new URLSearchParams({ fields: 'historyId' }), signal, 16384, budget.deadlineAtMs);
      // Overlap the replacement cursor: arrivals during profile/token work must remain in the recovery window.
      const current = this.now().getTime();
      state = { v: 1, kind: 'recovery', base, scope: scopeHash, page: null, offset: 0, observedAt: new Date(current).toISOString(), recoveryCursor: historyId(fresh.historyId), after: Math.floor(Math.max(activation, current - RETENTION_MS) / 1000), before: Math.floor(current / 1000) + 1 };
      return { items: [], complete: false, pageState: encode(state), gaps: [{ reason: 'history_expired', count: 1 }, { reason: 'recovery_date_not_creation_proof', count: 1 }, ...(activation < current - RETENTION_MS ? [{ reason: 'recovery_retention_limited', count: 1 }] : [])] };
    }
    const next = token(response.nextPageToken);
    if (next && next === state.page) throw new ProviderHttpError('invalid_cursor');
    const ids: string[] = [], seen = new Set<string>(); let unknownScopeCount = 0;
    const add = (id: unknown) => { const value = opaque(id); if (!seen.has(value)) { seen.add(value); ids.push(value); } };
    if (state.kind === 'history') {
      if (response.history !== undefined && !Array.isArray(response.history)) throw new ProviderHttpError('malformed_response');
      for (const event of (response.history ?? []) as unknown[]) {
        if (!record(event) || event.messagesAdded !== undefined && !Array.isArray(event.messagesAdded)) throw new ProviderHttpError('malformed_response');
        for (const added of (event.messagesAdded ?? []) as unknown[]) {
          if (!record(added) || !record(added.message)) throw new ProviderHttpError('malformed_response');
          if (filter.labels.length && !Array.isArray(added.message.labelIds)) unknownScopeCount++;
          if (inScope(added.message.labelIds, filter.labels)) add(added.message.id);
        }
      }
    } else {
      if (response.messages !== undefined && !Array.isArray(response.messages)) throw new ProviderHttpError('malformed_response');
      for (const message of (response.messages ?? []) as unknown[]) { if (!record(message)) throw new ProviderHttpError('malformed_response'); add(message.id); }
    }
    const fingerprint = digest({ ids, next });
    if (state.fingerprint && state.fingerprint !== fingerprint || state.offset > ids.length) throw new ProviderHttpError('checkpoint_changed');
    // A replay reuses the persisted observation instant; it never trusts message Date for admission.
    const selected = ids.slice(state.offset, state.offset + Math.min(50, budget.maxItemIds));
    const items = selected.map(id => ({ id, receivedAt: state.observedAt }));
    const offset = state.offset + selected.length;
    const gaps = [...(state.kind === 'recovery' ? [{ reason: 'recovery_date_not_creation_proof', count: 1 }] : []), ...(unknownScopeCount ? [{ reason: 'scope_metadata_unavailable', count: unknownScopeCount }] : [])];
    if (offset < ids.length) return { items, complete: false, pageState: encode({ ...state, offset, fingerprint }), gaps };
    if (next) return { items, complete: false, pageState: encode({ ...state, page: next, offset: 0, fingerprint: undefined }), gaps };
    return { items, complete: true, finalCursor: state.kind === 'recovery' ? state.recoveryCursor! : historyId(response.historyId), pageState: null, gaps };
  }
  async listSelected(connection: SavedConnection, pageToken: string | null, signal: AbortSignal): Promise<GmailSelectedPage> {
    const filter = scope(connection), page = token(pageToken);
    const query = new URLSearchParams({ maxResults: '10', includeSpamTrash: String(filter.includeSpamTrash) });
    if (page) query.set('pageToken', page);
    // Narrow single-label lists, then recheck current metadata for every scope to handle label moves.
    if (filter.labels.length === 1) query.set('labelIds', filter.labels[0]);
    const response = await this.get(connection, `${ROOT}/messages`, query, signal, 65536);
    if (response.messages !== undefined && !Array.isArray(response.messages)) throw new ProviderHttpError('malformed_response');
    const entries = (response.messages ?? []) as unknown[];
    if (entries.length > 10) throw new ProviderHttpError('malformed_response');
    const items: GmailSelectedPage['items'] = [];
    for (const entry of entries) {
      if (!record(entry)) throw new ProviderHttpError('malformed_response'); const id = opaque(entry.id);
      try {
        const metadata = await this.get(connection, `${ROOT}/messages/${encodeURIComponent(id)}`, new URLSearchParams({ format: 'metadata', metadataHeaders: 'Subject', fields: 'id,internalDate,labelIds,payload/headers' }), signal, 65536);
        if (metadata.id !== id) throw new ProviderHttpError('malformed_response');
        if (!inScope(metadata.labelIds, filter.labels)) continue;
        const parsed = parseGmailMessage(metadata as GmailRawMessage);
        items.push({ id, receivedAt: this.now().toISOString(), ...(parsed.untrustedContext.subject ? { subject: parsed.untrustedContext.subject } : {}) });
      } catch (error) {
        if (!(error instanceof ProviderHttpError) || !['provider_not_found', 'provider_denied'].includes(error.code)) throw error;
        items.push({ id, receivedAt: this.now().toISOString(), unavailable: true });
      }
    }
    return { items, nextPageToken: token(response.nextPageToken) };
  }
  async readItem(connection: SavedConnection, reference: ProviderItemRef, signal: AbortSignal): Promise<ProviderItem> {
    const id = opaque(reference.id);
    try {
      await this.authorizeSource(connection, id, signal);
      const raw = await this.get(connection, `${ROOT}/messages/${encodeURIComponent(id)}`, new URLSearchParams({ format: 'full' }), signal);
      if (raw.id !== id || !inScope(raw.labelIds, scope(connection).labels)) throw new ProviderHttpError('source_unavailable');
      const parsed = parseGmailMessage(raw as GmailRawMessage);
      const extraction = extractionFor(parsed);
      const context = [...Object.entries(parsed.untrustedContext).map(([key, value]) => `${key}: ${value}`), ...(parsed.source.internalDateMs ? [`providerInternalDateMs: ${parsed.source.internalDateMs}`] : [])].join('\n');
      // The store persists extraction.unavailable as source_unavailable, never as checked empty content.
      const text = parsed.coverage === 'unavailable' ? '' : `${context ? `[Untrusted message claims]\n${context}\n\n` : ''}${parsed.bodyText}`;
      const attachments = parsed.attachments.map(a => ({ id: attachmentReference(a.partId, a.attachmentId), name: (a.filename ?? 'attachment').slice(0, 200), mediaType: a.mediaType, supported: a.handling === 'preparable_image' && RASTER.has(a.mediaType) && !!a.attachmentId && /^[A-Za-z0-9_-]+={0,2}$/.test(a.attachmentId), ...(a.declaredBytes === undefined ? {} : { byteLength: a.declaredBytes }) }));
      const urls = parsed.links.map(link => link.url);
      return { providerItemId: id, revisionHash: digest({ text, urls, attachments, extraction }), receivedAt: reference.receivedAt, text, urls, attachments, extraction };
    } catch (error) {
      if (error instanceof ProviderHttpError && ['provider_not_found', 'provider_denied', 'response_too_large'].includes(error.code)) throw new ProviderHttpError('source_unavailable'); throw error;
    }
  }
  async readAttachment(connection: SavedConnection, reference: ProviderItemRef, attachment: Attachment, budget: { maxBytes: number; deadlineAtMs: number }, signal: AbortSignal): Promise<Uint8Array> {
    const id = opaque(reference.id), localReference = opaque(attachment.id);
    const maximum = Math.min(MAX_IMAGE, budget.maxBytes);
    if (!attachment.supported || !RASTER.has(attachment.mediaType) || !Number.isSafeInteger(maximum) || maximum <= 0 || (attachment.byteLength ?? 0) > maximum) throw new ProviderHttpError('attachment_unavailable');
    try {
      await this.authorizeSource(connection, id, signal, budget.deadlineAtMs);
      // Only source-authenticated MIME structure can authorize this attachment ID.
      const message = await this.get(connection, `${ROOT}/messages/${encodeURIComponent(id)}`, new URLSearchParams({ format: 'full', fields: ATTACHMENT_FIELDS }), signal, MAX_RESPONSE, budget.deadlineAtMs);
      if (message.id !== id || !inScope(message.labelIds, scope(connection).labels)) throw new ProviderHttpError('attachment_unavailable');
      const stack: { part: GmailRawPart; depth: number; path: string }[] = [{ part: message.payload as GmailRawPart, depth: 0, path: '0' }]; let visited = 0, attachmentId: string | undefined;
      while (stack.length && visited++ < 200) {
        const { part, depth, path } = stack.pop()!;
        if (!part || depth > 16) continue;
        const partId = typeof part.partId === 'string' && part.partId.length <= 512 ? part.partId : path;
        if (part.body?.attachmentId && attachmentReference(partId, part.body.attachmentId) === localReference && part.mimeType?.toLowerCase() === attachment.mediaType && (part.body.size ?? 0) <= maximum) { attachmentId = opaque(part.body.attachmentId, 512); break; }
        if (Array.isArray(part.parts)) for (let index = Math.min(200, part.parts.length) - 1; index >= 0; index--) stack.push({ part: part.parts[index], depth: depth + 1, path: `${path}.${index}` });
      }
      if (!attachmentId) throw new ProviderHttpError('attachment_unavailable');
      const response = await this.get(connection, `${ROOT}/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`, new URLSearchParams(), signal, Math.min(16 * 1024 * 1024, Math.ceil(maximum / 3) * 4 + 4096), budget.deadlineAtMs);
      const data = response.data;
      if (typeof data !== 'string' || data.length > Math.ceil(maximum / 3) * 4 || !/^[A-Za-z0-9_-]*={0,2}$/.test(data) || data.length % 4 === 1) throw new ProviderHttpError('attachment_unavailable');
      const bytes = Buffer.from(data, 'base64url');
      if (!bytes.length || bytes.length > maximum || bytes.toString('base64url') !== data.replace(/=+$/, '') || typeof response.size === 'number' && response.size !== bytes.length) throw new ProviderHttpError('attachment_unavailable');
      return bytes;
    } catch (error) {
      if (error instanceof ProviderHttpError && ['source_unavailable', 'provider_not_found', 'provider_denied', 'response_too_large'].includes(error.code)) throw new ProviderHttpError('attachment_unavailable'); throw error;
    }
  }
}
export const createGmailAdapter = (options: GmailAdapterOptions) => new GmailAdapter(options);
