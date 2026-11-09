import { schedules } from '@trigger.dev/sdk';
import { getScamwinStore } from '../../lib/scamwin/repository-core';
import { dispatchScamwinJobs } from '../../lib/scamwin/dispatch';
export const maintenance = schedules.task({ id: 'scamwin-daily-maintenance', cron: '0 3 * * *', maxDuration: 300, retry: { maxAttempts: 1 }, run: async () => {
  const store = getScamwinStore(); const purged = await store.purgeExpired();
  const dispatch = await dispatchScamwinJobs(store,'investigate'); return { purged, dispatch };
} });
