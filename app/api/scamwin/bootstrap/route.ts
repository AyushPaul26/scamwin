import { getOptionalSession } from '@/lib/auth0';
import { scamwinReadiness } from '@/lib/scamwin/readiness';
import { getScamwinStore } from '@/lib/scamwin/repository';
export async function GET() {
  const session = await getOptionalSession(); let role: 'user'|'reviewer'|'admin' = 'user';
  if (session?.user.sub && process.env.DATABASE_URL) { try { const store = getScamwinStore(); role = await store.hasRole(session.user.sub,'admin') ? 'admin' : await store.hasRole(session.user.sub,'reviewer') ? 'reviewer' : 'user'; } catch { /* No role is granted by a failed lookup. */ } }
  return Response.json({ ...scamwinReadiness(), user: session?.user.sub ? { sub: session.user.sub, name: session.user.name, email: session.user.email, picture: session.user.picture } : null, role, loginHref: '/auth/login?returnTo=/check' }, { headers: { 'Cache-Control':'private, no-store' } });
}
