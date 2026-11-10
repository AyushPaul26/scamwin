/** Public error codes contain no provider URL, response body, token, or source ID. */
export type ProviderHttpCode = 'runtime_quota_paused' | 'invalid_provider_path' | 'invalid_cursor' | 'invalid_scope' | 'provider_timeout' | 'provider_aborted' | 'provider_network' | 'provider_backoff' | 'reconnect_required' | 'provider_denied' | 'provider_not_found' | 'provider_rejected' | 'response_too_large' | 'malformed_response' | 'source_unavailable' | 'attachment_unavailable' | 'checkpoint_changed' | 'activation_required' | 'cursor_expired';
export class ProviderHttpError extends Error {
  constructor(readonly code: ProviderHttpCode, readonly retryAfterMs?: number) { super(code); this.name = 'ProviderHttpError'; }
}
export interface ProviderHttpOptions {
  origin: string;
  /** Trusted, anchored, provider-owned API path matcher; callers never supply a URL. */
  allowedPath: RegExp;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  /** Trusted provider configuration only. No arbitrary header names or values. */
  prefer?: readonly ('immutable_ids' | 'outlook_html' | 'page_size_50')[];
  /** Receives only a bounded error code, never messages, URLs, credentials or response objects. */
  classifyError?: (status: number, safeCode: string) => 'cursor_expired' | undefined;
}
export interface ProviderJsonOptions { signal: AbortSignal; maxBytes: number; query?: URLSearchParams; deadlineAtMs?: number; /** Only after validating an exact provider-returned resource URL. */ rawQuery?: string }

const PREFER = { immutable_ids: 'IdType="ImmutableId"', outlook_html: 'outlook.body-content-type="html"', page_size_50: 'odata.maxpagesize=50' } as const;

/** GET-only bounded JSON transport. Token acquisition/revocation belongs to the grant service. */
export class ProviderHttpClient {
  constructor(private readonly options: ProviderHttpOptions) {
    const origin = new URL(options.origin);
    if (origin.protocol !== 'https:' || origin.origin !== options.origin || origin.username || origin.password) throw new ProviderHttpError('invalid_provider_path');
    if (options.prefer?.some(value => !Object.hasOwn(PREFER, value))) throw new ProviderHttpError('invalid_provider_path');
  }
  async json<T = unknown>(path: string, token: string, options: ProviderJsonOptions): Promise<T> {
    this.options.allowedPath.lastIndex = 0;
    if (!path.startsWith('/') || path.startsWith('//') || /[?#\\\x00-\x20]/.test(path) || path.split('/').some(p => p === '.' || p === '..') || !this.options.allowedPath.test(path)) throw new ProviderHttpError('invalid_provider_path');
    const url = new URL(path, this.options.origin);
    if (url.origin !== this.options.origin || url.pathname !== path) throw new ProviderHttpError('invalid_provider_path');
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 16 * 1024 * 1024) throw new ProviderHttpError('response_too_large');
    if (options.rawQuery !== undefined && (options.query !== undefined || typeof options.rawQuery !== 'string' || options.rawQuery.length > 16000 || /[#\x00-\x20\x7f]/.test(options.rawQuery) || options.rawQuery.startsWith('?'))) throw new ProviderHttpError('invalid_cursor');
    const now = this.options.now ?? (() => new Date());
    const duration = Math.min(this.options.timeoutMs ?? 15000, options.deadlineAtMs === undefined ? Infinity : options.deadlineAtMs - now().getTime());
    if (options.signal.aborted) throw new ProviderHttpError('provider_aborted');
    if (duration <= 0) throw new ProviderHttpError('provider_timeout');
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, duration);
    const interrupted = () => new ProviderHttpError(timedOut ? 'provider_timeout' : 'provider_aborted');
    const wait = async <R>(pending: Promise<R>): Promise<R> => {
      if (controller.signal.aborted) throw interrupted();
      let onAbort!: () => void;
      const stopped = new Promise<never>((_, reject) => { onAbort = () => reject(interrupted()); controller.signal.addEventListener('abort', onAbort, { once: true }); });
      try { return await Promise.race([pending, stopped]); } finally { controller.signal.removeEventListener('abort', onAbort); }
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: Response | undefined;
    let consumed = false;
    try {
      url.search = options.rawQuery ?? options.query?.toString() ?? '';
      const prefer = this.options.prefer?.map(value => PREFER[value]).join(', ');
      response = await wait((this.options.fetch ?? fetch)(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, redirect: 'error', cache: 'no-store', signal: controller.signal }));
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new ProviderHttpError('provider_rejected');
      if (response.status === 429 || response.status === 503) {
        const value = response.headers.get('Retry-After');
        const delay = value && /^\d+$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - now().getTime() : 60000;
        throw new ProviderHttpError('provider_backoff', Number.isFinite(delay) ? Math.max(1000, Math.min(delay, 86400000)) : 60000);
      }
      if (response.status === 401) throw new ProviderHttpError('reconnect_required');
      if (response.status === 403) throw new ProviderHttpError('provider_denied');
      if (response.status === 404 || response.status === 410) throw new ProviderHttpError('provider_not_found');
      if (!response.ok) {
        // Opt-in classification is deliberately limited to small HTTP 400 JSON errors.
        // Gmail's default rejection path does not consume error bodies.
        if (response.status === 400 && this.options.classifyError && response.body) {
          reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
          while (true) {
            const chunk = await wait(reader.read()); if (chunk.done) break;
            bytes += chunk.value.byteLength; if (bytes > 8192) throw new ProviderHttpError('provider_rejected'); chunks.push(chunk.value);
          }
          consumed = true;
          let safeCode: unknown;
          try { safeCode = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))?.error?.code; } catch { /* Unrecognized errors stay rejected. */ }
          if (typeof safeCode === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,99}$/.test(safeCode)) {
            const classified = this.options.classifyError(response.status, safeCode);
            if (classified === 'cursor_expired') throw new ProviderHttpError(classified);
          }
        }
        throw new ProviderHttpError('provider_rejected');
      }
      const declared = response.headers.get('Content-Length');
      if (declared && /^\d+$/.test(declared) && Number(declared) > options.maxBytes) throw new ProviderHttpError('response_too_large');
      if (!response.body) throw new ProviderHttpError('malformed_response');
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let total = 0;
      while (true) {
        const chunk = await wait(reader.read()); if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > options.maxBytes) throw new ProviderHttpError('response_too_large');
        chunks.push(chunk.value);
      }
      consumed = true;
      try { return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as T; } catch { throw new ProviderHttpError('malformed_response'); }
    } catch (error) {
      if (error instanceof ProviderHttpError) throw error;
      if (controller.signal.aborted) throw interrupted();
      throw new ProviderHttpError('provider_network');
    } finally {
      clearTimeout(timer); options.signal.removeEventListener('abort', abort);
      if (!consumed) { controller.abort(); void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {}); }
      reader?.releaseLock();
    }
  }
}
