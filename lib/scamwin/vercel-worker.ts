import type { ScamwinStore } from './contracts';
import type { runInvestigation } from './pipeline';

/** One bounded investigation delivery. Publication is handled by its separate worker. */
export async function runVercelInvestigation(store: ScamwinStore, dependencies: { run?: typeof runInvestigation } = {}): Promise<number> {
  // Prepare the pipeline before taking a 60-second lease. Its execution may take 240 seconds.
  const run = dependencies.run ?? (await import('./pipeline')).runInvestigation;
  const [job] = await store.leaseOutbox(1, ['investigate']);
  if (!job) return 0;
  const current = await store.getInternalCheck(job.aggregateId);
  if (!current || current.generation !== job.generation || current.state !== 'queued') return 0;
  // A stale lease must never start work; acknowledge before the long-running pipeline.
  if (!await store.finishOutbox(job.id, job.attempts, 'dispatched')) return 0;
  try {
    // The pipeline's claim and every subsequent write retain generation/revision fencing.
    await run(job.aggregateId, job.generation, store);
  } catch {
    const latest = await store.getInternalCheck(job.aggregateId);
    if (latest?.generation === job.generation && ['queued', 'validating', 'collecting', 'analyzing'].includes(latest.state)) {
      await store.updateRun(latest.id, job.generation, latest.revision, {
        state: 'failed', errorCode: 'investigation_unavailable',
        availability: 'The investigation stopped before a complete assessment could be saved. Existing observations remain available.',
      });
    }
  }
  return 1;
}
