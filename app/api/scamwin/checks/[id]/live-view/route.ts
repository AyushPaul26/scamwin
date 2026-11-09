import { requireScamwinUser, apiFailure } from '@/lib/scamwin/server';
import { getOwnedLiveViewResponse } from '@/lib/scamwin/live-view-server';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { subject, store } = await requireScamwinUser();
    const { id } = await context.params;
    return await getOwnedLiveViewResponse({
      subject, checkId: id, store,
      expectedRunId: request.headers.get('X-Scamwin-Run-Id'),
      expectedGeneration: request.headers.get('X-Scamwin-Generation'),
    });
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
