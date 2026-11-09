import { requireScamwinUser, apiFailure } from '@/lib/scamwin/server';
import { ScamwinStoreError } from '@/lib/scamwin/store';
export async function GET(_request: Request, context: {params: Promise<{id:string}>}) {
  try { const {subject,store}=await requireScamwinUser(); const artifact=await store.getArtifact(subject,(await context.params).id); if(!artifact) throw new ScamwinStoreError('not_found');
    const bytes=Buffer.from(artifact.dataUrl.split(',')[1],'base64');
    return new Response(bytes,{headers:{'Content-Type':artifact.mediaType,'Content-Length':String(bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}});
  } catch(error){return apiFailure(error);}
}
