import type { ScamwinStore } from './contracts';
/** Durable outbox plus globally idempotent Trigger dispatch. Never executes a scan in Vercel. */
export async function dispatchScamwinJobs(store: ScamwinStore, scope: 'all'|'investigate'|'publication' = 'all') {
  if (!process.env.TRIGGER_SECRET_KEY && !process.env.SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY) return { dispatched: 0, failed: 0 };
  const { tasks, idempotencyKeys } = await import('@trigger.dev/sdk');
  const kinds = scope === 'investigate' ? ['investigate' as const] : scope === 'publication' ? ['publish_warning' as const,'retract_warning' as const] : undefined;
  const jobs = await store.leaseOutbox(2, kinds); let dispatched = 0, failed = 0;
  for (const job of jobs) {
    try {
      const idempotencyKey = await idempotencyKeys.create(job.idempotencyKey, { scope: 'global' });
      const taskId = job.kind === 'investigate' ? 'scamwin-investigate' : job.kind === 'retract_warning' ? 'scamwin-retract-warning' : 'scamwin-publish-warning';
      const accessToken = job.kind === 'investigate' ? process.env.TRIGGER_SECRET_KEY : process.env.SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY;
      if (!accessToken) throw new Error('The appropriate online task project is not configured.');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([tasks.trigger(taskId, { id: job.aggregateId, generation: job.generation }, { idempotencyKey, idempotencyKeyTTL: '7d' }, { clientConfig: { accessToken }, retry: { maxAttempts: 1 } }), new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Dispatch deadline')),12000);})]); }
      finally { if(timer)clearTimeout(timer); }
      await store.finishOutbox(job.id, job.attempts, 'dispatched'); dispatched++;
    } catch {
      await store.finishOutbox(job.id, job.attempts, 'failed'); failed++;
      if (job.kind === 'investigate') { const c = await store.getInternalCheck(job.aggregateId); if (c?.state === 'queued') await store.updateRun(c.id, c.generation, c.revision, { state: 'failed', errorCode: 'quota_paused', availability: 'The online worker could not accept this check. The free worker allowance may be unavailable or exhausted. Try a new check after the allowance resets or the worker is configured.' }); }
    }
  }
  return { dispatched, failed };
}
