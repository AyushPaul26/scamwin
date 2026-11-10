import { timingSafeEqual } from 'node:crypto';
import { getScamwinStore } from '@/lib/scamwin/repository';
import { purgeConfiguredConnectorRetention } from '@/lib/scamwin/connectors/retention';

export const maxDuration = 300;

/** A daily physical purge; owner reads independently enforce record expiry. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const [main,connectors]=await Promise.allSettled([
    Promise.resolve().then(()=>getScamwinStore().purgeExpired()),
    Promise.resolve().then(()=>purgeConfiguredConnectorRetention()),
  ]);
  const failed=main.status==='rejected'||connectors.status==='rejected';
  return Response.json({
    ...(main.status==='fulfilled'?main.value:{}),
    connectorRetention:connectors.status==='fulfilled'?connectors.value:{status:'unavailable'},
    ...(failed?{error:'Maintenance unavailable',mainRetention:main.status==='fulfilled'?'purged':'unavailable'}:{}),
  },{status:failed?503:200,headers:{'Cache-Control':'no-store'}});
}
