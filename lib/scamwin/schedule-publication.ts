import 'server-only';
import { after } from 'next/server';
import type { ScamwinStore } from './contracts';
import { dispatchScamwinJobs } from './dispatch';
import { dispatchVercelPublication, publicationBackend } from './publication-dispatch';

/** Call only after a persisted review/retraction or a successfully authorized reviewer queue read. */
export async function scheduleScamwinPublication(store: ScamwinStore): Promise<void> {
  const backend = publicationBackend();
  if (!backend) return;
  try {
    after(async () => {
      try {
        if (backend === 'vercel') await dispatchVercelPublication();
        else await dispatchScamwinJobs(store, 'publication');
      } catch { /* The durable job stays pending; never expose transport or credential errors. */ }
    });
  } catch { /* A scheduling failure must not invalidate an already persisted review. */ }
}
