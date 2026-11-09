/** Both backends require explicit selection; missing or invalid selection fails closed. */
export function investigationBackend(env: Record<string, string | undefined> = process.env): 'vercel' | 'trigger' | null {
  const backend = env.SCAMWIN_INVESTIGATION_BACKEND;
  if (backend === 'vercel') return 'vercel';
  if (backend !== 'trigger') return null;
  return env.TRIGGER_SECRET_KEY?.trim() ? 'trigger' : null;
}
