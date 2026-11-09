import 'server-only';
import { after } from 'next/server';
import type { ScamwinStore } from './contracts';
import { investigationBackend } from './investigation-backend';
import { dispatchScamwinJobs } from './dispatch';
import { runVercelInvestigation } from './vercel-worker';
import { ScamwinStoreError } from './store';

/** Call after persisting admission, only from an authenticated Next request. */
export async function scheduleScamwinInvestigation(store: ScamwinStore) {
  const backend = investigationBackend();
  if (backend === 'vercel') {
    after(async () => { await runVercelInvestigation(store); });
    return;
  }
  if (backend === 'trigger') {
    await dispatchScamwinJobs(store, 'investigate');
    return;
  }
  throw new ScamwinStoreError('worker_unavailable');
}
