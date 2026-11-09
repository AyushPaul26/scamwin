import { requireScamwinUser, apiFailure } from '@/lib/scamwin/server';
import { ScamwinStoreError } from '@/lib/scamwin/store';
export async function GET(){try{const {subject,store}=await requireScamwinUser();if(!await store.hasRole(subject,'admin'))throw new ScamwinStoreError('forbidden');return Response.json({state:await store.getOperationalState()},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return apiFailure(error);}}
