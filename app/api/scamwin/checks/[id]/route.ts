import { requireScamwinUser, apiFailure } from '@/lib/scamwin/server';
import { ScamwinStoreError } from '@/lib/scamwin/store';
import { investigationBackend } from '@/lib/scamwin/investigation-backend';
import { scheduleScamwinInvestigation } from '@/lib/scamwin/schedule-investigation';
import { getSanitizedLiveViewStatus } from '@/lib/scamwin/live-view-server';
import { deriveOfficialVerification } from '@/lib/scamwin/official-verification-view';
import { officialCatalog } from '@/lib/scamwin/official-source-catalog';
import { withReviewedAlternatives } from '@/lib/scamwin/alternatives';
export const maxDuration = 300;
export async function GET(_request: Request, context: {params: Promise<{id:string}>}) {
  try { const {subject,store}=await requireScamwinUser(); const {id}=await context.params; const check=await store.getCheck(subject,id); if(!check) throw new ScamwinStoreError('not_found');
    if (check.state === 'queued' && investigationBackend()) await scheduleScamwinInvestigation(store);
    const [observations,artifacts,messages]=await Promise.all([store.listObservations(subject,id),store.listArtifacts(subject,id),store.listMessages(subject,id)]);
    const warningSubmissions=['completed','partial'].includes(check.state)?(await store.listWarnings(subject)).filter(w=>w.checkId===id).map(w=>({id:w.id,status:w.status,createdAt:w.createdAt,reviewReason:w.reviewReason})):[];
    const liveView = await getSanitizedLiveViewStatus({ check, store });
    const now = new Date();
    const savedVerification = process.env.SCAMWIN_OFFICIAL_VERIFICATION_ENABLED === 'true' ? deriveOfficialVerification(check, observations, officialCatalog, now) : undefined;
    const officialVerification = savedVerification ? withReviewedAlternatives({ check, observations, verification: savedVerification }, officialCatalog, now, process.env) : undefined;
    return Response.json({check:{...check,input:{...check.input,images:check.input.images.map(image=>({...image,dataUrl:''}))}},observations,artifacts:artifacts.map(a=>({...a,dataUrl:'',url:`/api/scamwin/artifacts/${a.id}` })),messages,relatedCases:check.relatedCases||[],warningSubmissions,...(liveView ? { liveView } : {}),...(officialVerification ? { officialVerification } : {})},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return apiFailure(error); }
}
