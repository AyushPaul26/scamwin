import type { ProviderAdapter, ProviderItem, ProviderItemRef, ProviderPage, RevocationResult, SavedConnection, SyncBudget, SyncCursor } from '../contracts';
import type { ActivationBaseline } from '../oauth-contracts';
import { ProviderHttpClient, ProviderHttpError } from '../provider-http';
import { OUTLOOK_RASTER, outlookAttachmentRef, outlookDigest as digest, outlookRecord as record, parseOutlookMessage } from './outlook-message';

const ORIGIN = 'https://graph.microsoft.com';
const ROOT = '/v1.0/me';
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const RETENTION_MS = 30 * 86400000;
const METADATA = 'id,receivedDateTime,lastModifiedDateTime,changeKey,parentFolderId';
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || !/^[A-Za-z0-9_+/=-]+$/.test(value)) throw new ProviderHttpError('invalid_cursor'); return value;
}
function selectedScope(connection: SavedConnection): string[] {
  const selected = connection.scope.length ? connection.scope : ['inbox'];
  if (selected.length > 20) throw new ProviderHttpError('invalid_scope');
  try { return [...new Set(selected.map(value => value === 'inbox' ? value : value.startsWith('folder:') ? id(value.slice(7)) : (() => { throw new Error(); })()))]; }
  catch { throw new ProviderHttpError('invalid_scope'); }
}
const binding = (c: SavedConnection) => digest({ id: c.id, ownerId: c.ownerId, epoch: c.epoch, scopeVersion: c.scopeVersion, scope: selectedScope(c) });
const deltaPath = (folderId: string) => `${ROOT}/mailFolders/${encodeURIComponent(folderId)}/messages/delta`;
const messagesPath = (folderId: string) => `${ROOT}/mailFolders/${encodeURIComponent(folderId)}/messages`;
/** URL validation precedes grant access. Only the same exact resource may carry opaque queries. */
function trustedLink(value: unknown, path: string): { path: string; rawQuery: string } {
  if (typeof value !== 'string' || value.length > 16000 || /[\x00-\x20\x7f\\]/.test(value)) throw new ProviderHttpError('invalid_cursor');
  let url: URL; try { url = new URL(value); } catch { throw new ProviderHttpError('invalid_cursor'); }
  if (url.origin !== ORIGIN || url.pathname !== path || url.username || url.password || url.hash || url.href !== value || !url.search) throw new ProviderHttpError('invalid_cursor');
  return { path, rawQuery: value.slice(value.indexOf('?') + 1) };
}
interface DeltaState { v: 1; bind: string; boundary: string; observedAt: string; folders: { id: string; link: string | null }[]; index: number; recovering: boolean; offset: number; fingerprint?: string }
function encode(value: unknown): string { const encoded = JSON.stringify(value); if (encoded.length > 16384) throw new ProviderHttpError('invalid_cursor'); return encoded; }
function decode(value: string | null | undefined, c: SavedConnection): DeltaState {
  if (!value || value.length > 16384) throw new ProviderHttpError('activation_required');
  let state: unknown; try { state = JSON.parse(value); } catch { throw new ProviderHttpError('invalid_cursor'); }
  if (!record(state) || state.v !== 1 || state.bind !== binding(c) || !Array.isArray(state.folders) || !state.folders.length || state.folders.length > 20 || !Number.isSafeInteger(state.index) || Number(state.index) < 0 || Number(state.index) >= state.folders.length || typeof state.boundary !== 'string' || !Number.isFinite(Date.parse(state.boundary)) || typeof state.observedAt !== 'string' || !Number.isFinite(Date.parse(state.observedAt)) || typeof state.recovering !== 'boolean' || !Number.isSafeInteger(state.offset) || Number(state.offset) < 0 || Number(state.offset) > 50 || state.fingerprint !== undefined && (typeof state.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(state.fingerprint))) throw new ProviderHttpError('invalid_cursor');
  for (const folder of state.folders) { if (!record(folder)) throw new ProviderHttpError('invalid_cursor'); const folderId = id(folder.id); if (folder.link !== null) trustedLink(folder.link, deltaPath(folderId)); }
  return state as unknown as DeltaState;
}
export interface OutlookAdapterOptions {
  /** Trusted grant service must enforce the supplied owner, connection and epoch. */
  accessToken(connection: SavedConnection, signal: AbortSignal): Promise<string>;
  revoke(connection: SavedConnection, signal: AbortSignal): Promise<RevocationResult>;
  /** Required at integration for revisions of previously selected/older imported items. */
  isKnownItem?: (connection: SavedConnection, immutableId: string) => Promise<boolean>;
  fetch?: typeof fetch; now?: () => Date; timeoutMs?: number;
}
export interface OutlookRemoval { id: string; folderId: string; kind: 'removed_from_folder' }
export interface OutlookDeltaOutcome { page: ProviderPage; removals: OutlookRemoval[] }
export interface OutlookSelectedPage { items: (ProviderItemRef & { subject?: string; from?: string })[]; nextPageToken: string | null }
type Attachment = ProviderItem['attachments'][number];

/** Stateless, polling-only delegated Mail.Read adapter. Persistence and epoch fencing belong to the caller. */
export class OutlookAdapter implements ProviderAdapter {
  readonly capabilities = { pull: true, history: false, selectedItem: true, push: false, edits: true, attachments: true };
  readonly mailboxCapabilities = { accountTypes: ['personal', 'work_school'] as const, cloud: 'global' as const, selectedFolders: true, recursiveFolders: false, hiddenFolders: false, newFolderDetection: false, wholeMailbox: false, arrivalRule: 'received_time_not_move_or_import_time' as const };
  private readonly http: ProviderHttpClient;
  private readonly now: () => Date;
  constructor(private readonly options: OutlookAdapterOptions) {
    this.now = options.now ?? (() => new Date());
    this.http = new ProviderHttpClient({ origin: ORIGIN, allowedPath: /^\/v1\.0\/me\/(?:mailFolders\/[A-Za-z0-9_%=-]+(?:\/messages(?:\/delta)?)?|messages\/[A-Za-z0-9_%=-]+(?:\/attachments(?:\/[A-Za-z0-9_%=-]+)?)?)$/, prefer: ['immutable_ids', 'outlook_html', 'page_size_50'], classifyError: (status, code) => status === 400 && code === 'syncStateNotFound' ? 'cursor_expired' : undefined, fetch: options.fetch, now: this.now, timeoutMs: options.timeoutMs });
  }
  private valid(c: SavedConnection, signal: AbortSignal) { if (c.provider !== 'outlook' || c.status !== 'active') throw new ProviderHttpError('source_unavailable'); if (signal.aborted) throw new ProviderHttpError('provider_aborted'); selectedScope(c); }
  private async get(c: SavedConnection, path: string, signal: AbortSignal, options: { query?: URLSearchParams; rawQuery?: string; maxBytes?: number; deadlineAtMs?: number } = {}) {
    this.valid(c, signal); if (options.deadlineAtMs !== undefined && options.deadlineAtMs <= this.now().getTime()) throw new ProviderHttpError('provider_timeout');
    let token: string;
    try { token = await this.options.accessToken(c, signal); }
    catch (error) { if (signal.aborted) throw new ProviderHttpError('provider_aborted'); const code = error instanceof Error || record(error) ? (error as { code?: unknown }).code : undefined; if (code === 'invalid_grant' || code === 'reconnect_required') throw new ProviderHttpError('reconnect_required'); throw new ProviderHttpError('provider_network'); }
    const value = await this.http.json(path, token, { ...options, signal, maxBytes: options.maxBytes ?? MAX_RESPONSE });
    if (!record(value)) throw new ProviderHttpError('malformed_response'); return value;
  }
  private async folders(c: SavedConnection, signal: AbortSignal, deadlineAtMs?: number) {
    this.valid(c, signal); const result: string[] = [];
    for (const folder of selectedScope(c)) {
      if (folder !== 'inbox') { result.push(folder); continue; }
      const value = await this.get(c, `${ROOT}/mailFolders/inbox`, signal, { query: new URLSearchParams({ $select: 'id' }), maxBytes: 16384, deadlineAtMs }); result.push(id(value.id));
    }
    return [...new Set(result)];
  }
  /** Captures a boundary before bootstrap metadata is traversed; performs no historical body reads. */
  async activationBaseline(c: SavedConnection, signal: AbortSignal): Promise<ActivationBaseline> {
    this.valid(c, signal); const capturedAt = this.now().toISOString(); const folders = await this.folders(c, signal);
    return { capturedAt, cursor: encode({ v: 1, bind: binding(c), boundary: capturedAt, observedAt: capturedAt, folders: folders.map(id => ({ id, link: null })), index: 0, recovering: false, offset: 0 } satisfies DeltaState) };
  }
  async activate(c: SavedConnection, signal: AbortSignal): Promise<SyncCursor> { const baseline = await this.activationBaseline(c, signal); return { cursor: baseline.cursor, pageState: null }; }
  async revoke(c: SavedConnection, signal: AbortSignal) { if (c.provider !== 'outlook') throw new ProviderHttpError('source_unavailable'); if (signal.aborted) throw new ProviderHttpError('provider_aborted'); return this.options.revoke(c, signal); }
  async pullChanges(c: SavedConnection, cursor: SyncCursor | null, budget: SyncBudget, signal: AbortSignal): Promise<ProviderPage> { return (await this.pullChangesWithReconciliation(c, cursor, budget, signal)).page; }
  async pullChangesWithReconciliation(c: SavedConnection, cursor: SyncCursor | null, budget: SyncBudget, signal: AbortSignal): Promise<OutlookDeltaOutcome> {
    this.valid(c, signal); const base = decode(cursor?.cursor, c); const state = cursor?.pageState ? decode(cursor.pageState, c) : base;
    if (base.boundary !== state.boundary || digest(base.folders.map(f => f.id)) !== digest(state.folders.map(f => f.id))) throw new ProviderHttpError('invalid_cursor');
    if (c.mode === 'manual') return { page: { items: [], complete: true, finalCursor: cursor!.cursor!, pageState: null, gaps: [] }, removals: [] };
    if (!c.activationAt || !Number.isFinite(Date.parse(c.activationAt))) throw new ProviderHttpError('activation_required');
    if (budget.deadlineAtMs <= this.now().getTime()) throw new ProviderHttpError('provider_timeout');
    // A copied binding does not authenticate cursor-controlled folder arrays.
    const selectedFolders = digest(await this.folders(c, signal, budget.deadlineAtMs));
    if ([base, state].some(checkpoint => digest(checkpoint.folders.map(folder => folder.id)) !== selectedFolders)) throw new ProviderHttpError('invalid_cursor');
    const folder = state.folders[state.index], path = deltaPath(folder.id); let response: Record<string, unknown>;
    try {
      const request = folder.link ? trustedLink(folder.link, path) : { path, query: new URLSearchParams({ $select: METADATA, $top: '50' }) };
      response = await this.get(c, request.path, signal, { ...request, deadlineAtMs: budget.deadlineAtMs });
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || !folder.link || !['provider_not_found', 'cursor_expired'].includes(error.code)) throw error;
      folder.link = null; state.recovering = true; state.offset = 0; delete state.fingerprint; state.observedAt = this.now().toISOString();
      return { page: { items: [], complete: false, pageState: encode(state), gaps: [{ reason: 'delta_expired', count: 1 }, { reason: 'rebootstrap_received_date_not_creation_proof', count: 1 }] }, removals: [] };
    }
    if (!Array.isArray(response.value) || response.value.length > 50) throw new ProviderHttpError('malformed_response');
    const next = response['@odata.nextLink'], final = response['@odata.deltaLink'];
    if ((next === undefined) === (final === undefined)) throw new ProviderHttpError('malformed_response');
    const link = next ?? final; trustedLink(link, path); if (next === folder.link) throw new ProviderHttpError('invalid_cursor');
    const fingerprint = digest(response); if (state.fingerprint && state.fingerprint !== fingerprint || state.offset > response.value.length) throw new ProviderHttpError('checkpoint_changed');
    const observedAt = state.offset ? state.observedAt : this.now().toISOString(); state.observedAt = observedAt;
    const items: ProviderItemRef[] = [], removals: OutlookRemoval[] = [], gaps: ProviderPage['gaps'] = [];
    const addGap = (reason: string) => { const prior = gaps.find(g => g.reason === reason); if (prior) prior.count++; else gaps.push({ reason, count: 1 }); };
    if (state.recovering) addGap('rebootstrap_received_date_not_creation_proof');
    const limit = Math.min(50, Math.max(1, budget.maxItemIds)); const end = Math.min(response.value.length, state.offset + limit);
    const events = new Map<string, Record<string, unknown>>();
    for (const raw of response.value.slice(state.offset, end)) { if (!record(raw)) throw new ProviderHttpError('malformed_response'); events.set(id(raw.id), raw); }
    for (const [immutableId, raw] of events) {
      if (raw['@removed'] !== undefined) { if (!record(raw['@removed'])) throw new ProviderHttpError('malformed_response'); removals.push({ id: immutableId, folderId: folder.id, kind: 'removed_from_folder' }); addGap('folder_removal_requires_reconciliation'); continue; }
      if (typeof raw.parentFolderId !== 'string' || raw.parentFolderId !== folder.id) { addGap('scope_metadata_unavailable'); continue; }
      const known = await this.options.isKnownItem?.(c, immutableId) ?? false;
      const received = typeof raw.receivedDateTime === 'string' ? Date.parse(raw.receivedDateTime) : NaN;
      if (!known && (!Number.isFinite(received) || received < Math.max(Date.parse(state.boundary), this.now().getTime() - RETENTION_MS))) { if (!Number.isFinite(received)) addGap('received_date_unavailable'); continue; }
      if (typeof raw.changeKey !== 'string' || raw.changeKey.length > 500) { addGap('revision_metadata_unavailable'); continue; }
      items.push({ id: immutableId, version: raw.changeKey, receivedAt: observedAt });
    }
    if (end < response.value.length) { state.offset = end; state.fingerprint = fingerprint; return { page: { items, complete: false, pageState: encode(state), gaps }, removals }; }
    state.offset = 0; delete state.fingerprint; folder.link = link as string;
    if (next !== undefined) return { page: { items, complete: false, pageState: encode(state), gaps }, removals };
    state.index++;
    if (state.index < state.folders.length) return { page: { items, complete: false, pageState: encode(state), gaps }, removals };
    state.index = 0; state.recovering = false;
    return { page: { items, complete: true, pageState: null, finalCursor: encode(state), gaps }, removals };
  }
  private async authorizedMessage(c: SavedConnection, messageId: string, signal: AbortSignal, fields: string, deadlineAtMs?: number) {
    const folders = await this.folders(c, signal, deadlineAtMs);
    const raw = await this.get(c, `${ROOT}/messages/${encodeURIComponent(messageId)}`, signal, { query: new URLSearchParams({ $select: fields }), deadlineAtMs });
    if (raw.id !== messageId || !folders.includes(String(raw.parentFolderId))) throw new ProviderHttpError('source_unavailable'); return raw;
  }
  private async attachments(c: SavedConnection, messageId: string, signal: AbortSignal, deadlineAtMs?: number) {
    const path = `${ROOT}/messages/${encodeURIComponent(messageId)}/attachments`;
    const raw = await this.get(c, path, signal, { query: new URLSearchParams({ $select: 'id,name,contentType,size,isInline', $top: '20' }), maxBytes: 65536, deadlineAtMs });
    if (!Array.isArray(raw.value) || raw.value.length > 100) throw new ProviderHttpError('malformed_response');
    if (raw['@odata.nextLink'] !== undefined) trustedLink(raw['@odata.nextLink'], path);
    const diagnostics: { reason: string; count: number }[] = [];
    if (raw.value.length > 20) diagnostics.push({ reason: 'attachment_limit', count: raw.value.length - 20 });
    if (raw['@odata.nextLink']) diagnostics.push({ reason: 'attachment_page_limit', count: 1 });
    const entries = raw.value.slice(0, 20).map(entry => {
      if (!record(entry)) throw new ProviderHttpError('malformed_response'); const providerId = id(entry.id); const mediaType = typeof entry.contentType === 'string' ? entry.contentType.toLowerCase().slice(0, 150) : 'application/octet-stream';
      const size = typeof entry.size === 'number' && Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : undefined;
      const attachment: Attachment = { id: outlookAttachmentRef(messageId, providerId), name: typeof entry.name === 'string' ? entry.name.slice(0, 200) : 'attachment', mediaType, supported: entry['@odata.type'] === '#microsoft.graph.fileAttachment' && OUTLOOK_RASTER.has(mediaType) && size !== undefined && size > 0 && size <= MAX_IMAGE, ...(size === undefined ? {} : { byteLength: size }) };
      return { providerId, attachment };
    });
    return { entries, diagnostics };
  }
  async readItem(c: SavedConnection, reference: ProviderItemRef, signal: AbortSignal): Promise<ProviderItem> {
    const messageId = id(reference.id);
    try {
      await this.authorizedMessage(c, messageId, signal, 'id,parentFolderId');
      const raw = await this.authorizedMessage(c, messageId, signal, `${METADATA},subject,from,sender,body,hasAttachments,internetMessageId`);
      const { inlineAttachments, ...parsed } = parseOutlookMessage(raw, []);
      let attachments: Attachment[] = []; let diagnostics: { reason: string; count: number }[] = [];
      // Graph's hasAttachments excludes inline-only images referenced by cid:.
      if (raw.hasAttachments === true || inlineAttachments) {
        try { const result = await this.attachments(c, messageId, signal); attachments = result.entries.map(e => e.attachment); diagnostics = result.diagnostics; }
        catch (error) { if (!(error instanceof ProviderHttpError) || !['provider_not_found', 'provider_denied', 'response_too_large'].includes(error.code)) throw error; diagnostics.push({ reason: 'attachments_unavailable', count: 1 }); }
        if (!attachments.length && !diagnostics.length) diagnostics.push({ reason: inlineAttachments ? 'inline_attachments_unavailable' : 'attachment_metadata_unavailable', count: 1 });
      }
      if (attachments.length) diagnostics.push({ reason: 'attachment_not_analyzed', count: attachments.length });
      parsed.extraction.diagnostics.push(...diagnostics);
      parsed.extraction.overflow.attachments = diagnostics.find(d => d.reason === 'attachment_limit')?.count ?? 0;
      if (diagnostics.length && parsed.extraction.coverage === 'complete') parsed.extraction.coverage = 'partial';
      return { providerItemId: messageId, revisionHash: digest({ ...parsed, attachments }), receivedAt: reference.receivedAt, ...parsed, attachments };
    } catch (error) { if (error instanceof ProviderHttpError && ['provider_not_found', 'provider_denied', 'response_too_large'].includes(error.code)) throw new ProviderHttpError('source_unavailable'); throw error; }
  }
  async readAttachment(c: SavedConnection, reference: ProviderItemRef, attachment: Attachment, budget: { maxBytes: number; deadlineAtMs: number }, signal: AbortSignal): Promise<Uint8Array> {
    const maximum = Math.min(MAX_IMAGE, budget.maxBytes), messageId = id(reference.id);
    if (!attachment.supported || !OUTLOOK_RASTER.has(attachment.mediaType) || !Number.isSafeInteger(maximum) || maximum <= 0 || (attachment.byteLength ?? 0) > maximum) throw new ProviderHttpError('attachment_unavailable');
    try {
      await this.authorizedMessage(c, messageId, signal, 'id,parentFolderId', budget.deadlineAtMs);
      const { entries } = await this.attachments(c, messageId, signal, budget.deadlineAtMs);
      const entry = entries.find(e => e.attachment.id === attachment.id && e.attachment.supported && e.attachment.mediaType === attachment.mediaType && (e.attachment.byteLength ?? Infinity) <= maximum);
      if (!entry) throw new ProviderHttpError('attachment_unavailable');
      const raw = await this.get(c, `${ROOT}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(entry.providerId)}`, signal, { query: new URLSearchParams({ $select: 'id,contentType,size,contentBytes' }), maxBytes: Math.min(16 * 1024 * 1024, Math.ceil(maximum / 3) * 4 + 4096), deadlineAtMs: budget.deadlineAtMs });
      if (raw.id !== entry.providerId || raw['@odata.type'] !== '#microsoft.graph.fileAttachment' || raw.contentType !== attachment.mediaType || typeof raw.contentBytes !== 'string' || raw.contentBytes.length > Math.ceil(maximum / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.contentBytes)) throw new ProviderHttpError('attachment_unavailable');
      const bytes = Buffer.from(raw.contentBytes, 'base64');
      if (!bytes.length || bytes.length > maximum || bytes.toString('base64') !== raw.contentBytes || raw.size !== bytes.length) throw new ProviderHttpError('attachment_unavailable');
      await this.authorizedMessage(c, messageId, signal, 'id,parentFolderId', budget.deadlineAtMs);
      return bytes;
    } catch (error) { if (error instanceof ProviderHttpError && ['source_unavailable', 'provider_not_found', 'provider_denied', 'response_too_large'].includes(error.code)) throw new ProviderHttpError('attachment_unavailable'); throw error; }
  }
  async listSelected(c: SavedConnection, pageToken: string | null, signal: AbortSignal): Promise<OutlookSelectedPage> {
    this.valid(c, signal); let state: { bind: string; folders: string[]; index: number; link: string | null };
    if (pageToken) {
      let value: unknown; try { if (pageToken.length > 16384) throw new Error(); value = JSON.parse(pageToken); } catch { throw new ProviderHttpError('invalid_cursor'); }
      if (!record(value) || value.bind !== binding(c) || !Array.isArray(value.folders) || value.folders.length < 1 || value.folders.length > 20 || !Number.isSafeInteger(value.index) || Number(value.index) < 0 || Number(value.index) >= value.folders.length || value.link !== null && typeof value.link !== 'string') throw new ProviderHttpError('invalid_cursor');
      value.folders.forEach(id); state = value as unknown as typeof state;
      if (digest(state.folders) !== digest(await this.folders(c, signal))) throw new ProviderHttpError('invalid_cursor');
    } else state = { bind: binding(c), folders: await this.folders(c, signal), index: 0, link: null };
    const path = messagesPath(state.folders[state.index]); const request = state.link ? trustedLink(state.link, path) : { path, query: new URLSearchParams({ $select: `${METADATA},subject,from`, $top: '10' }) };
    const raw = await this.get(c, path, signal, { ...request, maxBytes: 65536 });
    if (!Array.isArray(raw.value) || raw.value.length > 10) throw new ProviderHttpError('malformed_response');
    const items = raw.value.map(value => { if (!record(value) || value.parentFolderId !== state.folders[state.index]) throw new ProviderHttpError('source_unavailable'); return { id: id(value.id), receivedAt: this.now().toISOString(), ...(typeof value.changeKey === 'string' && value.changeKey.length <= 500 ? { version: value.changeKey } : {}), ...(typeof value.subject === 'string' ? { subject: value.subject.slice(0, 200) } : {}), ...(record(value.from) && record(value.from.emailAddress) && typeof value.from.emailAddress.address === 'string' ? { from: value.from.emailAddress.address.slice(0, 200) } : {}) }; });
    const next = raw['@odata.nextLink']; if (next !== undefined) { trustedLink(next, path); if (next === state.link) throw new ProviderHttpError('invalid_cursor'); state.link = next as string; } else { state.index++; state.link = null; }
    return { items, nextPageToken: state.index < state.folders.length ? encode(state) : null };
  }
}
export const createOutlookAdapter = (options: OutlookAdapterOptions) => new OutlookAdapter(options);
