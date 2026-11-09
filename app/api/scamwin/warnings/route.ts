import { getScamwinStore } from '@/lib/scamwin/repository';
import { registryAvailability } from '@/lib/scamwin/registry';
export async function GET(request: Request) {
  try { const warnings=process.env.DATABASE_URL?await getScamwinStore().getPublicWarnings(new URL(request.url).searchParams.get('q')||''):[];
    return Response.json({warnings,registry:registryAvailability()},{headers:{'Cache-Control':'no-store'}});
  } catch {return Response.json({warnings:[],registry:{status:'unavailable',chainId:84532,message:'The warning list is unavailable. No absence of warnings was inferred.'}},{status:503});}
}
