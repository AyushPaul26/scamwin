import { assessmentSchema, type CheckRecord, type ScamwinStore } from '../contracts';
import type { runInvestigation } from '../pipeline';
import type { ConnectorStore, JobLease, JobOutcome } from './contracts';
import { admitConnectorTarget } from './admission';
import { deferred, errorCode } from './limits';

export interface RunnerDependencies {
  mainStore: ScamwinStore; connectorStore: ConnectorStore;
  /** Explicit scheduling decision, evaluated before starting the main admission clock. */
  workerReady: boolean; now?: () => Date; signal?: AbortSignal; run?: typeof runInvestigation;
}
export function outcomeForCheck(check: CheckRecord | null, now: Date): JobOutcome {
  if (!check) return { status: 'suppressed', reason: 'main_check_unavailable' };
  if (['completed', 'partial'].includes(check.state)) {
    const parsed = assessmentSchema.safeParse(check.assessment);
    if (!parsed.success) return { status: 'failed', reason: 'assessment_unavailable' };
    return { status: 'completed', childState: check.state === 'partial' || parsed.data.missingChecks.length ? 'partial' : 'completed' };
  }
  if (['failed', 'blocked', 'canceled'].includes(check.state)) return { status: 'failed', reason: check.errorCode === 'deadline_exceeded' && !check.cancelRequestedAt ? 'interrupted_terminal' : 'child_unavailable' };
  return deferred('main_run_pending', now);
}
/** Idempotently honors persisted disconnect cancellation, even with an old epoch lease. */
export async function cancelDisconnectedWork(lease: JobLease, deps: Pick<RunnerDependencies, 'mainStore' | 'connectorStore'>) {
  const current = await deps.connectorStore.getConnection(lease.ref.ownerId, lease.ref.id);
  if (current?.epoch === lease.ref.epoch && current.status === 'active') return false;
  const ids = await deps.connectorStore.listPendingDisconnectCheckIds(lease.ref.ownerId, lease.ref.id);
  if (lease.job.checkId && !ids.includes(lease.job.checkId)) ids.push(lease.job.checkId);
  for (const id of ids) {
    await deps.mainStore.requestCancel(lease.ref.ownerId, id);
    await deps.connectorStore.acknowledgeDisconnectCancellation(lease.ref.ownerId, lease.ref.id, id);
  }
  return true;
}
export async function runConnectorTarget(lease: JobLease, deps: RunnerDependencies): Promise<JobOutcome> {
  const now = deps.now ?? (() => new Date());
  if (await cancelDisconnectedWork(lease, deps)) return { status: 'failed', reason: 'connection_unavailable' };
  let outcome: JobOutcome;
  if (!deps.workerReady || deps.signal?.aborted) outcome = deferred('worker_unavailable', now());
  else {
    // Load before main create: a broken worker import must not consume the 300 second clock.
    const run = deps.run ?? (await import('../pipeline')).runInvestigation;
    const admission = await admitConnectorTarget(lease, deps.mainStore, deps.connectorStore, now());
    if (admission.status !== 'admitted') outcome = admission;
    else {
      lease = { ...lease, job: { ...lease.job, checkId: admission.check.id } };
      if (await cancelDisconnectedWork(lease, deps)) return { status: 'failed', reason: 'connection_unavailable' };
      let check = await deps.mainStore.getCheck(lease.ref.ownerId, admission.check.id);
      if (check?.state === 'queued') {
        await deps.connectorStore.validateJobLease(lease);
        const [outbox] = await deps.mainStore.leaseOutbox(1, ['investigate'], check.id);
        const current = await deps.mainStore.getCheck(lease.ref.ownerId, check.id);
        if (outbox?.aggregateId === check.id && outbox.kind === 'investigate' && current?.state === 'queued' && outbox.generation === current.generation && await deps.mainStore.finishOutbox(outbox.id, outbox.attempts, 'dispatched')) {
          if (await cancelDisconnectedWork(lease, deps)) return { status: 'failed', reason: 'connection_unavailable' };
          const controller = new AbortController();
          const signal = deps.signal ? AbortSignal.any([controller.signal, deps.signal]) : controller.signal;
          const timer = setInterval(() => { void cancelDisconnectedWork(lease, deps).then(stale => { if (stale) controller.abort(); }).catch(() => controller.abort()); }, 1500);
          timer.unref();
          try { await run(current.id, current.generation, deps.mainStore, { signal }); }
          catch { /* The saved main state is authoritative, including a process interrupted mid-run. */ }
          finally { clearInterval(timer); }
        }
      }
      if (await cancelDisconnectedWork(lease, deps)) return { status: 'failed', reason: 'connection_unavailable' };
      check = await deps.mainStore.getCheck(lease.ref.ownerId, admission.check.id);
      outcome = outcomeForCheck(check, now());
    }
  }
  try { await deps.connectorStore.finishJob(lease, outcome); }
  catch (error) { if (!['stale_lease', 'connection_unavailable'].includes(errorCode(error))) throw error; }
  return outcome;
}
