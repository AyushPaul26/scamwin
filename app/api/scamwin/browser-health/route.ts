import { handleBrowserHealth } from '@/lib/scamwin/collector';

export const maxDuration = 90;

export async function GET(request: Request) {
  return handleBrowserHealth(request);
}
