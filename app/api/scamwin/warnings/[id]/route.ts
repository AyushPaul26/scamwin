import { getScamwinStore } from '@/lib/scamwin/repository';
import { lookupRegistry } from '@/lib/scamwin/registry';
export async function GET(_request: Request, context: {params: Promise<{id:string}>}) {
  try { const warning=process.env.DATABASE_URL?await getScamwinStore().getWarning((await context.params).id):null; if(!warning)return Response.json({error:'Warning not found.'},{status:404});
    const registry=await lookupRegistry(warning.hostname);
    return Response.json({warning,registry},{headers:{'Cache-Control':'no-store'}});
  } catch{return Response.json({error:'The warning is unavailable.'},{status:503});}
}
