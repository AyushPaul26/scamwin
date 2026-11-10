import {getOptionalSession} from '@/lib/auth0';
/** Owner-only setup aid for the explicit Gmail pilot allowlist. Never accepts an owner from a URL. */
export async function GET(){const session=await getOptionalSession();return Response.json(session?.user.sub?{subject:session.user.sub}:{error:'Sign in to view your account identifier.'},{status:session?.user.sub?200:401,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});}
