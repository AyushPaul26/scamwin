import type { ScamwinStore } from './contracts';
import type { OfficialCatalog } from './official-verification-contracts';
import { resolveOfficialStep } from './official-verification-view';

type ReadStore = Pick<ScamwinStore, 'getCheck' | 'listObservations'>;
type Environment = Record<string, string | undefined>;
type Dependencies = {
  authenticate: () => Promise<{ subject: string; store: ReadStore }>;
  apiFailure: (error: unknown) => Response;
  catalog: OfficialCatalog;
  env: Environment;
  now: () => Date;
};
type Context = { params: Promise<{ id: string; stepId: string }> };
const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
function failure(status: 401 | 404 | 503) {
  const code = status === 401 ? 'unauthenticated' : status === 404 ? 'not_found' : 'service_unavailable';
  const error = status === 401 ? 'Sign in to use your private checks.' : status === 404
    ? 'This check is unavailable or does not belong to your account.' : 'This action could not be completed. Check your input and try again.';
  return Response.json({ error, code }, { status, headers: privateHeaders });
}
function configuredOrigin(value: string | undefined): string | null {
  if (!value || value.trim() !== value || /[\\?#]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    return url.origin;
  } catch { return null; }
}
function unavailableResponse(checkId: string, env: Environment): Response {
  const origin = configuredOrigin(env.APP_BASE_URL);
  if (!origin) return failure(503);
  // Neither the request origin nor query parameters participate in this destination.
  return new Response(null, { status: 303, headers: { ...privateHeaders, Location: `${origin}/checks/${encodeURIComponent(checkId)}?officialStep=unavailable` } });
}

/** The route's complete read-only handler, with real authentication and storage supplied by the caller. */
export function createOfficialNextStepHandler(deps: Dependencies) {
  return async function GET(_request: Request, context: Context): Promise<Response> {
    try {
      const { subject, store } = await deps.authenticate();
      if (!subject) return failure(401);
      const { id, stepId } = await context.params;
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return failure(404);
      const check = await store.getCheck(subject, id);
      if (!check || check.id !== id || check.ownerId !== subject) return failure(404);
      if (deps.env.SCAMWIN_OFFICIAL_VERIFICATION_ENABLED !== 'true' || !/^[A-Za-z0-9_-]{1,120}$/.test(stepId)) return unavailableResponse(id, deps.env);
      const observations = await store.listObservations(subject, id);
      // A cancellation, deletion or newer run can win while evidence is being loaded.
      const current = await store.getCheck(subject, id);
      if (!current || current.id !== id || current.ownerId !== subject) return failure(404);
      if (current.runId !== check.runId || current.generation !== check.generation) return unavailableResponse(id, deps.env);
      const resolved = resolveOfficialStep(current, observations, stepId, deps.catalog, deps.now());
      if (resolved.status !== 'ready' || deps.env.SCAMWIN_OFFICIAL_VERIFICATION_ENABLED !== 'true') return unavailableResponse(id, deps.env);
      return new Response(null, { status: 303, headers: { ...privateHeaders, Location: resolved.url } });
    } catch (error) {
      const response = deps.apiFailure(error);
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
      return new Response(response.body, { status: response.status, headers });
    }
  };
}
