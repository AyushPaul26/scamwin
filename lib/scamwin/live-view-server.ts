import type { CheckRecord, ScamwinStore } from './contracts';
import type { LiveViewRecord, LiveViewResponse, SanitizedLiveViewStatus } from './live-view-contracts';
import { openLiveViewLocator } from './live-view-crypto';
import { isApprovedLiveViewUrl } from './live-view-provider';

type ReadStore = Pick<ScamwinStore, 'getCheck' | 'getLiveView'>;
type Environment = Record<string, string | undefined>;
type Options = { subject: string | null | undefined; checkId: string; expectedRunId: string | null; expectedGeneration: string | number | null; store: ReadStore; env?: Environment; now?: () => Date };
const headers = { 'Cache-Control': 'private, no-store' };
const response = (value: LiveViewResponse) => Response.json(value, { headers });
function failure(status: number, code: string) {
  const messages: Record<string, string> = {
    unauthenticated: 'Sign in to view this private investigation.', invalid_identity: 'Reload the check to reconnect to its current investigation.',
    not_found: 'This check is unavailable or does not belong to your account.', stale_run: 'This investigation has changed. Reload the check.',
    service_unavailable: 'Live viewing is unavailable. Saved evidence remains available.',
  };
  return Response.json({ error: messages[code], code }, { status, headers });
}
const identity = (check: CheckRecord) => ({ runId: check.runId, generation: check.generation });
function state(check: CheckRecord, value: Exclude<LiveViewResponse['state'], 'ready' | 'live'>, reasonCode?: string): LiveViewResponse {
  return { state: value, ...identity(check), ...(reasonCode ? { reasonCode } : {}) };
}
function browserGate(check: CheckRecord, now: Date): LiveViewResponse | null {
  if (!Number.isFinite(Date.parse(check.expiresAt)) || Date.parse(check.expiresAt) <= now.getTime()
      || !Number.isFinite(Date.parse(check.createdAt)) || Date.parse(check.createdAt) + 300_000 <= now.getTime()) return state(check, 'expired', 'expired');
  if (check.cancelRequestedAt || ['cancel_requested', 'canceled', 'completed', 'partial', 'failed', 'blocked', 'analyzing'].includes(check.state)) return state(check, 'ended', 'collection_ended');
  if (!check.input.url) return state(check, 'unavailable', 'no_destination');
  const browser = check.stages.find(stage => stage.id === 'browser');
  if (['queued', 'validating'].includes(check.state) || browser?.status === 'pending') return state(check, 'starting');
  if (browser?.status === 'completed' || browser?.status === 'canceled' || browser?.status === 'skipped') return state(check, 'ended', 'collection_ended');
  if (check.state !== 'collecting' || browser?.status !== 'running') return state(check, 'unavailable', 'browser_unavailable');
  return null;
}
function recordMatches(row: LiveViewRecord, check: CheckRecord) {
  return row.scope.ownerId === check.ownerId && row.scope.checkId === check.id && row.scope.runId === check.runId && row.scope.generation === check.generation;
}
function recordGate(row: LiveViewRecord, check: CheckRecord, now: Date): LiveViewResponse | null {
  if (!recordMatches(row, check)) return state(check, 'unavailable', 'session_unavailable');
  const expiry = Date.parse(row.expiresAt), created = Date.parse(row.createdAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return state(check, 'expired', 'expired');
  if (!Number.isFinite(created) || created > now.getTime() || expiry > created + 60_000 || expiry > Date.parse(check.createdAt) + 300_000) return state(check, 'unavailable', 'session_unavailable');
  if (row.status === 'ended') return state(check, 'ended', 'session_ended');
  if (row.status === 'unavailable' || !row.encryptedLocator || !['ready', 'connected'].includes(row.status)) return state(check, 'unavailable', 'session_unavailable');
  return null;
}
function containsCredential(value: string, env: Environment) {
  // Recheck the configured provider token even if it appears under a harmless query key or in an encoded path.
  const token = env.BROWSERLESS_TOKEN;
  if (!token) return false;
  let decoded = value;
  for (let index = 0; index < 5; index++) {
    if (decoded.includes(token)) return true;
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
  }
  return false;
}

/** Side-effect-free capability delivery: this helper never mints, schedules or updates a session. */
export async function getOwnedLiveViewResponse(options: Options): Promise<Response> {
  const { subject, checkId, expectedRunId, expectedGeneration, store } = options;
  const env = options.env ?? process.env, now = options.now ?? (() => new Date());
  if (!subject) return failure(401, 'unauthenticated');
  const generationText = String(expectedGeneration ?? '');
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(checkId) || !expectedRunId || !/^[A-Za-z0-9_-]{1,120}$/.test(expectedRunId)
      || !/^[1-9]\d{0,9}$/.test(generationText) || !Number.isSafeInteger(Number(generationText))) return failure(400, 'invalid_identity');
  const generation = Number(generationText);
  try {
    const check = await store.getCheck(subject, checkId);
    if (!check || check.id !== checkId || check.ownerId !== subject) return failure(404, 'not_found');
    if (check.runId !== expectedRunId || check.generation !== generation) return failure(409, 'stale_run');
    if (env.SCAMWIN_LIVE_VIEW_ENABLED !== 'true') return response(state(check, 'unavailable', 'feature_disabled'));
    const gated = browserGate(check, now());
    if (gated) return response(gated);
    const row = await store.getLiveView(subject, checkId, { runId: expectedRunId, generation });
    if (!row) return response(state(check, 'starting'));
    const rowGated = recordGate(row, check, now());
    if (rowGated) return response(rowGated);
    let viewerUrl: string;
    try { viewerUrl = openLiveViewLocator(row.encryptedLocator!, row, env); }
    catch { return response(state(check, 'unavailable', 'session_unavailable')); }
    if (!isApprovedLiveViewUrl(viewerUrl, env.BROWSERLESS_BASE_URL || 'https://production-sfo.browserless.io') || containsCredential(viewerUrl, env)) return response(state(check, 'unavailable', 'session_unavailable'));
    // Cancellation/deletion or a newer generation may win while storage is awaited.
    const current = await store.getCheck(subject, checkId);
    if (!current || current.ownerId !== subject) return failure(404, 'not_found');
    if (current.runId !== expectedRunId || current.generation !== generation) return failure(409, 'stale_run');
    const finalGate = browserGate(current, now()) || recordGate(row, current, now());
    if (finalGate) return response(finalGate);
    return response({ state: row.status === 'connected' ? 'live' : 'ready', sessionId: row.sessionId, ...identity(current), viewerUrl, issuedAt: now().toISOString(), expiresAt: row.expiresAt });
  } catch { return failure(503, 'service_unavailable'); }
}

/** A fixed metadata projection for generic check payloads; it never opens ciphertext. */
export async function getSanitizedLiveViewStatus(options: { check: CheckRecord; store: ReadStore; env?: Environment; now?: () => Date }): Promise<SanitizedLiveViewStatus | undefined> {
  const { check, store } = options, env = options.env ?? process.env, now = options.now ?? (() => new Date());
  if (env.SCAMWIN_LIVE_VIEW_ENABLED !== 'true') return undefined;
  const gated = browserGate(check, now());
  if (gated) return gated;
  try {
    const row = await store.getLiveView(check.ownerId, check.id, identity(check));
    if (!row) return { state: 'starting', ...identity(check) };
    const rowGated = recordGate(row, check, now());
    if (rowGated) return rowGated;
    return { state: row.status === 'connected' ? 'live' : 'ready', ...identity(check), sessionId: row.sessionId, createdAt: row.createdAt, expiresAt: row.expiresAt, ...(row.connectedAt ? { connectedAt: row.connectedAt } : {}) };
  } catch { return { state: 'unavailable', ...identity(check), reasonCode: 'session_unavailable' }; }
}
