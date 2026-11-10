import type { ScamwinStore } from '../contracts';
import type { ConnectorStore } from './contracts';
import { cancelDisconnectedWork, outcomeForCheck } from './runner';

export interface RecoverySummary { inspected: number; deferred: number; completed: number; suppressed: number; failed: number; retried: number }
/** One bounded saved-admission reconciliation. The scheduler independently invokes this and drain. */
export async function reconcileConnectorJobs(now: Date, deps: { mainStore: ScamwinStore; connectorStore: ConnectorStore }): Promise<RecoverySummary> {
  const summary: RecoverySummary = { inspected: 0, deferred: 0, completed: 0, suppressed: 0, failed: 0, retried: 0 };
  for (const intent of await deps.connectorStore.listAdmissionIntents()) {
    try {
      const metadata = await deps.mainStore.lookupCheckAdmission(intent.ref.ownerId, intent.admissionKey, intent.admissionDeadlineAt);
      if (metadata.status === 'pending') continue;
      if (metadata.status === 'absent_fenced' || metadata.status === 'terminal_unavailable') {
        await deps.connectorStore.resolveUnavailableAdmission(intent, metadata.status === 'absent_fenced' ? 'admission_deadline_expired' : 'main_check_unavailable', metadata.status === 'terminal_unavailable' ? metadata.checkId : undefined);
        continue;
      }
      // Only the shared main admission mutex plus the immutable deadline can
      // establish absence. Ordinary null reads still leave the intent intact.
      let check = await deps.mainStore.getCheck(intent.ref.ownerId, metadata.checkId);
      if (!check) continue;
      const connection = await deps.connectorStore.getConnection(intent.ref.ownerId, intent.ref.id);
      const revoked = !connection || connection.epoch !== intent.ref.epoch || connection.status !== 'active' || intent.state === 'canceled';
      if (revoked) {
        await deps.connectorStore.recordRecoveredAdmission(intent, check.id, false);
        check = await deps.mainStore.requestCancel(intent.ref.ownerId, check.id);
        if (!check) continue;
      }
      const terminal = ['completed', 'partial', 'blocked', 'failed', 'canceled'].includes(check.state);
      await deps.connectorStore.recordRecoveredAdmission(intent, check.id, terminal);
      if (revoked) await deps.connectorStore.acknowledgeDisconnectCancellation(intent.ref.ownerId, intent.ref.id, check.id);
    } catch { /* Intent remains durable on lookup/cancellation/database failures. */ }
  }
  for (const pending of await deps.connectorStore.listPendingDisconnectCancellations()) {
    try {
      await deps.mainStore.requestCancel(pending.ownerId, pending.checkId);
      await deps.connectorStore.acknowledgeDisconnectCancellation(pending.ownerId, pending.connectionId, pending.checkId);
    } catch { /* Failed cancellations remain durable for the next independent wakeup. */ }
  }
  const lease = await deps.connectorStore.leaseDueJob(300000, true);
  if (!lease) return summary;
  summary.inspected++;
  if (await cancelDisconnectedWork(lease, deps)) return summary;
  const check = await deps.mainStore.getCheck(lease.ref.ownerId, lease.job.checkId!);
  const outcome = outcomeForCheck(check, now);
  await deps.connectorStore.finishJob(lease, outcome);
  summary[outcome.status]++;
  if (outcome.reason === 'interrupted_terminal' && lease.job.generation === 1) {
    const jobs = await deps.connectorStore.listRevisionJobs(lease.ref, lease.job.revisionId);
    if (jobs.some(j => j.targetId === lease.job.targetId && j.generation === 2)) summary.retried++;
  }
  return summary;
}
