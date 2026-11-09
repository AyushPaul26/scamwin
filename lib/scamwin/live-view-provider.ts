import type { CDPSession } from 'playwright';

type EventHandler = (event: unknown) => void;
export type BrowserlessCdp = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
};
export type WatchOnlyLiveView = { liveURL: string; liveURLId: string; timeoutMs: number; targetId: string };
export type WatchOnlyLiveViewOptions = {
  providerOrigin: string; providerToken: string; remainingMs: number;
  signal?: AbortSignal; commandTimeoutMs?: number;
};
export type LiveViewCompleteReason = 'timeout' | 'closed' | 'viewerDisconnected' | 'userDone' | 'userFailed';
export type WatchOnlyLiveViewEvents = {
  onConnected?: () => void | Promise<void>;
  onComplete?: (reason: LiveViewCompleteReason) => void | Promise<void>;
};
/** The single cast for Browserless commands missing from Playwright's CDP schema. */
export function adaptBrowserlessCdp(session: CDPSession): BrowserlessCdp {
  const extensions = session as unknown as BrowserlessCdp;
  return {
    send: (method, params) => extensions.send(method, params),
    on: (event, handler) => { extensions.on(event, handler); },
    off: (event, handler) => { extensions.off(event, handler); },
  };
}

const regionalHosts = new Set(['production-sfo.browserless.io', 'production-lon.browserless.io', 'production-ams.browserless.io']);
const maxLifetimeMs = 60_000, maxCommandMs = 3000, maxCloseMs = 1500;
type ErrorCode = 'live_view_budget' | 'live_view_aborted' | 'live_view_timeout' | 'live_view_provider_error' | 'live_view_invalid_response' | 'live_view_unsupported' | 'live_view_expired';
class LiveViewProviderError extends Error {
  constructor(code: ErrorCode) { super(code); this.name = 'Error'; }
}
function failure(code: ErrorCode) { return new LiveViewProviderError(code); }
function providerFailure(value: unknown) {
  return failure(value === 'Live URLs are not supported.' ? 'live_view_unsupported' : value === 'The browser session has expired.' ? 'live_view_expired' : 'live_view_provider_error');
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value);
}
function approvedProviderOrigin(value: string): string | null {
  try {
    if (typeof value !== 'string' || /[\s\\#]/.test(value)) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && regionalHosts.has(url.hostname) && !url.username && !url.password && !url.port && !url.search && url.pathname === '/' ? url.origin : null;
  } catch { return null; }
}
function decodeViewerPart(value: string): string | null {
  for (let count = 0; count < 16; count++) {
    try { const decoded = decodeURIComponent(value); if (decoded === value) return decoded; value = decoded; } catch { return null; }
  }
  return null;
}

/** Viewer bearer IDs are allowed; provider credentials and arbitrary destinations are not. */
export function isApprovedLiveViewUrl(value: string, providerOrigin: string): boolean {
  try {
    const origin = approvedProviderOrigin(providerOrigin);
    if (!origin || typeof value !== 'string' || value.length > 8192 || /[\s\\#]/.test(value)) return false;
    const url = new URL(value);
    const rawPath = value.match(/^https:\/\/[^/?#]+(\/[^?#]*)/)?.[1];
    const approvedPath = /^(?:\/(?:chromium\/)?live\/(?:[a-zA-Z0-9_-]+|index\.html)?\/?|\/e\/[a-zA-Z0-9_-]{1,256}\/live\/(?:index\.html)?)$/;
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.port || rawPath !== url.pathname || !approvedPath.test(url.pathname)) return false;
    for (const [key, item] of url.searchParams) {
      const decodedKey = decodeViewerPart(key), decodedItem = decodeViewerPart(item);
      if (decodedKey === null || decodedItem === null || /token|secret|password|credential|authorization|api.?key/i.test(decodedKey) || /:\/\//.test(decodedItem)) return false;
    }
    return true;
  } catch { return false; }
}

function containsProviderToken(value: string, token: string): boolean {
  let decoded = value;
  for (let index = 0; index < 4; index++) {
    if (decoded.includes(token)) return true;
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
  }
  return false;
}

/** Bounds waiting without forwarding provider messages, URLs, causes or abort reasons. */
function bounded<T>(operation: () => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(failure('live_view_aborted'));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return Promise.reject(failure('live_view_budget'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: T | Error, failed: boolean) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failed) reject(value); else resolve(value as T);
    };
    const abort = () => finish(failure('live_view_aborted'), true);
    const timer = setTimeout(() => finish(failure('live_view_timeout'), true), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(operation).then(value => finish(value, false), () => finish(failure('live_view_provider_error'), true));
  });
}

const closes = new WeakMap<BrowserlessCdp, Map<string, Promise<void>>>();
/** Call from finally, independently of an already-aborted collection signal. */
export function closeWatchOnlyLiveView(cdp: BrowserlessCdp, liveURLId: string, options: { timeoutMs?: number } = {}): Promise<void> {
  if (!validId(liveURLId)) return Promise.reject(failure('live_view_invalid_response'));
  const previous = closes.get(cdp) ?? new Map<string, Promise<void>>();
  closes.set(cdp, previous);
  const existing = previous.get(liveURLId);
  if (existing) return existing;
  const timeoutMs = options.timeoutMs === undefined ? maxCloseMs : Math.min(maxCloseMs, Math.floor(options.timeoutMs));
  const closing = bounded(() => cdp.send('Browserless.closeLiveURL', { liveURLId }), timeoutMs).then(response => {
    const result = record(response);
    if (result.error != null) throw failure('live_view_provider_error');
    if (result.liveURLId !== liveURLId) throw failure('live_view_invalid_response');
  });
  previous.set(liveURLId, closing);
  return closing;
}

export async function createWatchOnlyLiveView(cdp: BrowserlessCdp, options: WatchOnlyLiveViewOptions): Promise<WatchOnlyLiveView> {
  if (!Number.isFinite(options.remainingMs) || options.remainingMs < 1) throw failure('live_view_budget');
  if (!approvedProviderOrigin(options.providerOrigin) || !options.providerToken) throw failure('live_view_invalid_response');
  const started = Date.now();
  const remaining = () => Math.floor(Math.min(maxLifetimeMs, options.remainingMs) - (Date.now() - started));
  const commandLimit = options.commandTimeoutMs === undefined ? maxCommandMs : Math.min(maxCommandMs, Math.floor(options.commandTimeoutMs));
  const targetResponse = await bounded(() => cdp.send('Target.getTargetInfo'), Math.min(commandLimit, remaining()), options.signal);
  const target = record(record(targetResponse).targetInfo);
  if (!validId(target.targetId) || target.type !== 'page') throw failure('live_view_invalid_response');
  const timeout = remaining();
  if (timeout < 1) throw failure('live_view_budget');
  let abandoned = false;
  const cleanup = async (response: unknown) => {
    const id = record(response).liveURLId;
    if (validId(id)) {
      // Browserless can reuse an ID after a mint; retire only this mint's close cache.
      closes.get(cdp)?.delete(id);
      await closeWatchOnlyLiveView(cdp, id).catch(() => undefined);
    }
  };
  const mint = () => cdp.send('Browserless.liveURL', {
    targetId: target.targetId, interactable: false, resizable: false, mode: 'tab',
    showBrowserInterface: false, type: 'jpeg', quality: 50, captureScale: 1, timeout,
  }).then(response => {
    if (abandoned) void cleanup(response);
    return response;
  });
  let response: unknown;
  try { response = await bounded(mint, Math.min(commandLimit, remaining()), options.signal); }
  catch (error) { abandoned = true; throw error; }
  const result = record(response);
  if (validId(result.liveURLId)) closes.get(cdp)?.delete(result.liveURLId);
  if (result.error != null || !validId(result.liveURLId) || result.targetId !== target.targetId ||
      typeof result.timeout !== 'number' || !Number.isInteger(result.timeout) || result.timeout < 1 || result.timeout > timeout ||
      typeof result.liveURL !== 'string' || !isApprovedLiveViewUrl(result.liveURL, options.providerOrigin) || containsProviderToken(result.liveURL, options.providerToken)) {
    await cleanup(response);
    throw result.error != null ? providerFailure(result.error) : failure('live_view_invalid_response');
  }
  return { liveURL: result.liveURL, liveURLId: result.liveURLId, timeoutMs: result.timeout, targetId: target.targetId };
}

/** Install after mint resolves and before exposing the URL. No untrusted feedback escapes. */
export function subscribeWatchOnlyLiveView(cdp: BrowserlessCdp, view: Pick<WatchOnlyLiveView, 'liveURLId' | 'targetId'>, events: WatchOnlyLiveViewEvents): () => void {
  let active = true;
  const safe = (callback: () => void | Promise<void>) => {
    try { void Promise.resolve(callback()).catch(() => undefined); } catch { /* Event callbacks cannot disrupt collection. */ }
  };
  const connected = (payload: unknown) => {
    if (active && record(payload).liveURLId === view.liveURLId && events.onConnected) safe(events.onConnected);
  };
  const reasons = new Set<unknown>(['timeout', 'closed', 'viewerDisconnected', 'userDone', 'userFailed']);
  const complete = (payload: unknown) => {
    const value = record(payload);
    if (active && value.liveURLId === view.liveURLId && reasons.has(value.reason) && events.onComplete) safe(() => events.onComplete!(value.reason as LiveViewCompleteReason));
  };
  try { cdp.on('Browserless.liveViewerConnected', connected); cdp.on('Browserless.liveComplete', complete); }
  catch {
    active = false;
    try { cdp.off('Browserless.liveViewerConnected', connected); cdp.off('Browserless.liveComplete', complete); } catch { /* Best-effort rollback on a detached session. */ }
    throw failure('live_view_provider_error');
  }
  return () => {
    if (!active) return;
    active = false;
    try { cdp.off('Browserless.liveViewerConnected', connected); } catch { /* Session may already be detached. */ }
    try { cdp.off('Browserless.liveComplete', complete); } catch { /* Session may already be detached. */ }
  };
}
