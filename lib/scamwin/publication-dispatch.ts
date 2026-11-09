type Environment = Record<string, string | undefined>;
export type PublicationDispatchResult = { ok: true; status: 'dispatched' } | { ok: false; status: 'unconfigured' | 'unavailable' };

/** A publication backend is always selected explicitly; investigation credentials do not select one. */
export function publicationBackend(env: Environment = process.env): 'vercel' | 'trigger' | null {
  if (env.SCAMWIN_PUBLICATION_BACKEND === 'vercel') return 'vercel';
  if (env.SCAMWIN_PUBLICATION_BACKEND === 'trigger' && env.SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY?.trim()) return 'trigger';
  return null;
}

/** Pure HTTP boundary: no database, wallet, relay implementation or browser-supplied payload. */
export async function dispatchVercelPublication(options: { env?: Environment; fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<PublicationDispatchResult> {
  const env = options.env ?? process.env;
  if (publicationBackend(env) !== 'vercel') return { ok: false, status: 'unconfigured' };
  const secret = env.SCAMWIN_PUBLISHER_DISPATCH_SECRET?.trim();
  let base: URL;
  try {
    base = new URL(env.SCAMWIN_PUBLISHER_BASE_URL ?? '');
    if (
      base.protocol !== 'https:' ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/i.test(base.hostname) ||
      base.username || base.password || base.port || base.href !== `${base.origin}/` ||
      !secret || secret.length < 32 || !/^[\x21-\x7e]+$/.test(secret)
    ) return { ok: false, status: 'unconfigured' };
  } catch { return { ok: false, status: 'unconfigured' }; }

  const controller = new AbortController();
  // The overridable deadline is bounded by the production 15-second limit.
  const timeoutMs = Math.max(1, Math.min(15_000, options.timeoutMs ?? 15_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? fetch)(new URL('/api/relay', base), {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` },
      redirect: 'error', cache: 'no-store', signal: controller.signal,
    });
    return response.ok ? { ok: true, status: 'dispatched' } : { ok: false, status: 'unavailable' };
  } catch { return { ok: false, status: 'unavailable' }; }
  finally { clearTimeout(timer); }
}
