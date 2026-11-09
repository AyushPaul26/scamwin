import { schedules, schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import { getScamwinStore } from '../../lib/scamwin/repository-core';
import { dispatchScamwinJobs } from '../../lib/scamwin/dispatch';
import { relayWarning, relayRetraction } from '../../lib/scamwin/publication';
const schema = z.object({ id: z.string().min(1).max(120), generation: z.number().int().positive() }).strict();
export const publishWarning = schemaTask({ id: 'scamwin-publish-warning', schema, queue: { name: 'scamwin-publisher', concurrencyLimit: 1 }, maxDuration: 120, retry: { maxAttempts: 1 }, run: async ({ id }) => relayWarning(id) });
export const retractWarning = schemaTask({ id: 'scamwin-retract-warning', schema, queue: { name: 'scamwin-publisher', concurrencyLimit: 1 }, maxDuration: 120, retry: { maxAttempts: 1 }, run: async ({ id }) => relayRetraction(id) });
export const reconcile = schedules.task({ id: 'scamwin-daily-publication-reconciliation', cron: '15 3 * * *', queue: { name: 'scamwin-publisher', concurrencyLimit: 1 }, maxDuration: 300, retry: { maxAttempts: 1 }, run: async () => {
  const store=getScamwinStore(); let processed=0;
  for(const item of await store.listPendingPublications(10)){if(item.kind==='retract_warning')await relayRetraction(item.warningId);else await relayWarning(item.warningId);processed++;}
  await dispatchScamwinJobs(store,'publication'); return {processed};
} });
