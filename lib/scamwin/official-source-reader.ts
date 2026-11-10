import { lookup } from 'node:dns/promises';
import { request, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { createHash } from 'node:crypto';
import { isPublicAddress } from './origin-probe';
import { officialSourceSchema, type OfficialDocument, type OfficialReader, type OfficialReadBudget, type OfficialSource } from './official-verification-contracts';
import { buildOfficialReadUrl, isWithinOfficialSource } from './official-source-policy';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_RUN_BYTES = 512 * 1024;
const REQUEST_MILLISECONDS = 8_000;
const STAGE_MILLISECONDS = 20_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

class ReadFailure extends Error {
  constructor(readonly status: 'unavailable' | 'blocked', readonly reasonCode: string) {
    super(reasonCode);
  }
}

type Dependencies = { resolve: typeof lookup; request: typeof request; now: () => number };
type Hop = { kind: 'redirect'; location: string } | { kind: 'document'; status: 'ok' | 'not_found'; body: string; contentType: string; digest: string };

function checkDeadline(signal: AbortSignal, budget: OfficialReadBudget, now: () => number, requestDeadline: number): void {
  signal.throwIfAborted();
  if (now() >= Math.min(budget.deadlineAtMs, requestDeadline)) throw new ReadFailure('unavailable', 'deadline_exceeded');
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    void pending.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}

function checkContentEncoding(response: IncomingMessage): void {
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && (typeof encoding !== 'string' || encoding.trim().toLowerCase() !== 'identity')) throw new ReadFailure('unavailable', 'unsupported_encoding');
}

function contentTypeFor(response: IncomingMessage, source: OfficialSource): string {
  const contentType = response.headers['content-type'];
  if (typeof contentType !== 'string' || contentType.length > 200) throw new ReadFailure('unavailable', 'unsupported_content_type');
  const [mediaType, ...parameters] = contentType.toLowerCase().split(';').map(value => value.trim());
  const allowed = source.kind === 'greenhouse_job' ? ['application/json'] : ['text/html', 'application/xhtml+xml'];
  const unsupportedCharset = parameters.some(parameter => {
    if (!/^charset\b/.test(parameter)) return false;
    const match = /^charset\s*=\s*(?:"([^"]*)"|([^"\s]+))$/.exec(parameter);
    return !match || !['utf-8', 'utf8', 'us-ascii'].includes(match[1] ?? match[2]);
  });
  if (!allowed.includes(mediaType) || unsupportedCharset) throw new ReadFailure('unavailable', 'unsupported_content_type');
  if (/attachment/i.test(response.headers['content-disposition'] ?? '')) throw new ReadFailure('unavailable', 'unsupported_body');
  return contentType;
}

/** Worker-only transport. Callers select a validated catalogue source, never a raw fetch URL. */
export function createOfficialReader(deps: Dependencies): OfficialReader {
  async function readHop(url: URL, source: OfficialSource, externalSignal: AbortSignal, budget: OfficialReadBudget): Promise<Hop> {
    const requestDeadline = Math.min(budget.deadlineAtMs, deps.now() + REQUEST_MILLISECONDS);
    checkDeadline(externalSignal, budget, deps.now, requestDeadline);
    if (budget.requestsRemaining <= 0) throw new ReadFailure('unavailable', 'request_budget_exhausted');
    budget.requestsRemaining--;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new ReadFailure('unavailable', 'deadline_exceeded')), Math.max(0, requestDeadline - deps.now()));
    const signal = AbortSignal.any([externalSignal, deadline.signal]);
    try {
      const records = await abortable(deps.resolve(url.hostname, { all: true, verbatim: true }), signal);
      checkDeadline(signal, budget, deps.now, requestDeadline);
      if (!Array.isArray(records) || !records.length || records.some(record => !record || ![4, 6].includes(record.family) || isIP(record.address) !== record.family || !isPublicAddress(record.address))) throw new ReadFailure('blocked', 'non_public_dns');
      const selected = records[0];
      return await new Promise<Hop>((resolve, reject) => {
        let settled = false;
        let outgoing: ClientRequest | undefined;
        let incoming: IncomingMessage | undefined;
        const destroy = () => { incoming?.destroy(); outgoing?.destroy(); outgoing?.socket?.destroy(); };
        const finish = (error: unknown, value?: Hop) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          destroy();
          if (error) reject(error); else resolve(value!);
        };
        const abort = () => finish(signal.reason);
        const ensureActive = () => {
          try { checkDeadline(signal, budget, deps.now, requestDeadline); return true; }
          catch (error) { finish(error); return false; }
        };
        signal.addEventListener('abort', abort, { once: true });
        const configuration: RequestOptions = {
          protocol: 'https:',
          hostname: selected.address,
          family: selected.family,
          port: 443,
          method: 'GET',
          path: url.pathname,
          // An IP-literal connection avoids a second lookup. TLS still verifies the catalogue hostname.
          servername: url.hostname,
          rejectUnauthorized: true,
          checkServerIdentity: (_hostname, certificate) => checkServerIdentity(url.hostname, certificate),
          agent: false,
          headers: { Host: url.hostname, Accept: source.kind === 'greenhouse_job' ? 'application/json' : 'text/html, application/xhtml+xml', 'Accept-Encoding': 'identity' },
        };
        try {
          outgoing = deps.request(configuration, response => {
            incoming = response;
            if (!ensureActive()) return;
            try { checkContentEncoding(response); }
            catch (error) { finish(error); return; }
            const status = response.statusCode ?? 0;
            if (REDIRECTS.has(status)) {
              const location = response.headers.location;
              if (!location || location.length > 4096) { finish(new ReadFailure('blocked', 'invalid_redirect')); return; }
              // Do not drain redirect bodies, reuse connections, or accept Set-Cookie state.
              finish(null, { kind: 'redirect', location });
              return;
            }
            if (status !== 200 && status !== 404) { finish(new ReadFailure('unavailable', 'http_unavailable')); return; }
            let contentType: string;
            try { contentType = contentTypeFor(response, source); }
            catch (error) { finish(error); return; }
            const lengthHeader = response.headers['content-length'];
            const expectedLength = lengthHeader === undefined ? null : /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : NaN;
            if (expectedLength !== null && (!Number.isSafeInteger(expectedLength) || expectedLength > MAX_BODY_BYTES || expectedLength > budget.bytesRemaining)) { finish(new ReadFailure('unavailable', 'body_limit_exceeded')); return; }
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on('data', (chunk: Buffer) => {
              if (settled || !ensureActive()) return;
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              bytes += buffer.length;
              const exceedsRun = buffer.length > budget.bytesRemaining;
              budget.bytesRemaining = Math.max(0, budget.bytesRemaining - buffer.length);
              if (bytes > MAX_BODY_BYTES || exceedsRun) { finish(new ReadFailure('unavailable', 'body_limit_exceeded')); return; }
              chunks.push(buffer);
            });
            response.once('end', () => {
              if (settled || !ensureActive()) return;
              if (!response.complete || response.aborted || (expectedLength !== null && bytes !== expectedLength)) { finish(new ReadFailure('unavailable', 'incomplete_body')); return; }
              if (status === 200 && bytes === 0) { finish(new ReadFailure('unavailable', 'unsupported_body')); return; }
              const raw = Buffer.concat(chunks, bytes);
              let body: string;
              try { body = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
              catch { finish(new ReadFailure('unavailable', 'unsupported_body')); return; }
              finish(null, { kind: 'document', status: status === 404 ? 'not_found' : 'ok', body, contentType, digest: createHash('sha256').update(raw).digest('hex') });
            });
            response.once('aborted', () => finish(new ReadFailure('unavailable', 'incomplete_body')));
            response.once('error', () => finish(new ReadFailure('unavailable', 'incomplete_body')));
            response.once('close', () => { if (!settled) finish(new ReadFailure('unavailable', 'incomplete_body')); });
          });
          outgoing.once('error', () => finish(new ReadFailure('unavailable', 'transport_error')));
          outgoing.once('close', () => { if (!settled) finish(new ReadFailure('unavailable', 'incomplete_response')); });
          if (signal.aborted) abort(); else outgoing.end();
        } catch (error) { finish(error); }
      });
    } finally { clearTimeout(timer); }
  }

  return async (source, reference, { signal, budget }) => {
    signal.throwIfAborted();
    const parsed = officialSourceSchema.safeParse(source);
    const readUrl = parsed.success ? buildOfficialReadUrl(parsed.data, reference) : null;
    let finalReadUrl = readUrl ?? '';
    const outcome = (status: OfficialDocument['status'], reasonCode: string | null, document?: Extract<Hop, { kind: 'document' }>): OfficialDocument => ({
      sourceId: source.id,
      readUrl: readUrl ?? '',
      finalReadUrl,
      fetchedAt: new Date(deps.now()).toISOString(),
      status,
      reasonCode,
      contentType: document?.contentType ?? null,
      body: document?.body ?? null,
      digest: document?.digest ?? null,
    });
    if (!parsed.success || !readUrl || !isWithinOfficialSource(readUrl, parsed.data, 'read')) return outcome('blocked', 'invalid_source_scope');
    if (![budget.deadlineAtMs, budget.documentsRemaining, budget.requestsRemaining, budget.bytesRemaining].every(Number.isFinite) || ![budget.documentsRemaining, budget.requestsRemaining, budget.bytesRemaining].every(Number.isInteger)) return outcome('unavailable', 'invalid_budget');
    budget.deadlineAtMs = Math.min(budget.deadlineAtMs, deps.now() + STAGE_MILLISECONDS);
    budget.documentsRemaining = Math.min(2, budget.documentsRemaining);
    budget.requestsRemaining = Math.min(4, budget.requestsRemaining);
    budget.bytesRemaining = Math.min(MAX_RUN_BYTES, budget.bytesRemaining);
    if (budget.documentsRemaining <= 0 || budget.bytesRemaining <= 0 || deps.now() >= budget.deadlineAtMs) return outcome('unavailable', 'stage_budget_exhausted');
    budget.documentsRemaining--;
    try {
      for (let redirects = 0; ; redirects++) {
        signal.throwIfAborted();
        if (!isWithinOfficialSource(finalReadUrl, parsed.data, 'read')) throw new ReadFailure('blocked', 'redirect_outside_scope');
        const current = new URL(finalReadUrl);
        const hop = await readHop(current, parsed.data, signal, budget);
        if (hop.kind === 'document') return outcome(hop.status, null, hop);
        if (redirects >= 1) throw new ReadFailure('blocked', 'redirect_limit_exceeded');
        // Validate raw Location before URL normalization can erase traversal or private query data.
        if (/[\s\\?#]/.test(hop.location) || /%(?:2e|2f|5c|25|00)/i.test(hop.location) || hop.location.split('/').some(segment => segment === '.' || segment === '..')) throw new ReadFailure('blocked', 'redirect_outside_scope');
        const next = new URL(hop.location, current).href;
        if (!isWithinOfficialSource(next, parsed.data, 'read')) throw new ReadFailure('blocked', 'redirect_outside_scope');
        finalReadUrl = next;
      }
    } catch (error) {
      signal.throwIfAborted();
      return error instanceof ReadFailure ? outcome(error.status, error.reasonCode) : outcome('unavailable', 'transport_error');
    }
  };
}

export const readOfficialSource: OfficialReader = createOfficialReader({ resolve: lookup, request, now: Date.now });
