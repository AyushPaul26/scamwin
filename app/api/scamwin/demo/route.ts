import { getDemo } from '@/lib/scamwin/demo';
export async function GET(request: Request) { return Response.json(getDemo(new URL(request.url).searchParams.get('scenario') || 'refund'), { headers: { 'Cache-Control': 'no-store' } }); }
