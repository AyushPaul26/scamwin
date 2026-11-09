import { requireScamwinUser, apiFailure } from '@/lib/scamwin/server';
import { scheduleScamwinPublication } from '@/lib/scamwin/schedule-publication';
export const maxDuration = 300;
export async function GET() {
  try {
    const { subject, store } = await requireScamwinUser();
    const submissions = await store.getReviewQueue(subject);
    await scheduleScamwinPublication(store);
    return Response.json({ submissions }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiFailure(error); }
}
