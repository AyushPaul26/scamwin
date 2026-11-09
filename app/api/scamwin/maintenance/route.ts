import { timingSafeEqual } from 'node:crypto';
import { getScamwinStore } from '@/lib/scamwin/repository';

export const maxDuration = 300;

/** A daily physical purge; owner reads independently enforce record expiry. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    return Response.json(await getScamwinStore().purgeExpired(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Maintenance unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
