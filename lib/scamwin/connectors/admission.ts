import type { CheckRecord, ScamwinStore } from '../contracts';
import { checkInputSchema } from '../input';
import type { ConnectorStore, JobLease, JobOutcome, NormalizedCheckInput } from './contracts';
import { deferred, errorCode, MAIN_CAPACITY_ERRORS } from './limits';

export function toMainCheckInput(input: NormalizedCheckInput) {
  return checkInputSchema.parse({ url: input.url ?? '', message: input.message, promisedBenefit: input.promisedBenefit ?? '', intendedAction: input.intendedAction ?? '', images: input.images });
}
export type AdmissionOutcome = { status: 'admitted'; check: CheckRecord } | JobOutcome;
/** Call only after the drain has loaded its pipeline and reserved its execution lease. */
export async function admitConnectorTarget(lease: JobLease, mainStore: ScamwinStore, connectorStore: ConnectorStore, now = new Date()): Promise<AdmissionOutcome> {
  const job = await connectorStore.validateJobLease(lease);
  if (job.checkId) {
    const check = await mainStore.getCheck(lease.ref.ownerId, job.checkId);
    return check ? { status: 'admitted', check } : { status: 'suppressed', reason: 'main_check_unavailable' };
  }
  // A read-only lookup can recover committed input even after its connector copy
  // expired. It neither creates work nor treats an ambiguous null as deletion.
  const existing = await mainStore.findCheckBySubmissionKey(lease.ref.ownerId, job.admissionKey);
  if (existing) {
    await connectorStore.recordAdmission(lease, existing.id);
    return { status: 'admitted', check: existing };
  }
  let input: NormalizedCheckInput;
  try { input = await connectorStore.readJobInput(lease); }
  catch (error) { if (errorCode(error) === 'content_expired') return { status: 'suppressed', reason: 'content_expired' }; throw error; }
  const revision = await connectorStore.getRevision(lease.ref, job.revisionId);
  if (!revision) return { status: 'suppressed', reason: 'content_expired' };
  const automatic = revision.selectionReason !== 'user_selected';
  if (automatic) {
    const quota = await connectorStore.reserveAutomaticQuota(lease);
    if (!quota.allowed) return deferred(quota.reason!, now, 15 * 60000);
  }
  let check: CheckRecord;
  // Durable before the cross-database call. Unknown outcomes retain the intent
  // and automatic slot even if the process never returns to record the check ID.
  const intent = await connectorStore.recordAdmissionIntent(lease);
  try { check = await mainStore.createCheck(lease.ref.ownerId, toMainCheckInput(input), job.admissionKey, intent.admissionDeadlineAt); }
  catch (error) {
    const code = errorCode(error);
    if (code === 'submission_expired' || code === 'admission_deadline_expired') return { status: 'suppressed', reason: code };
    if (MAIN_CAPACITY_ERRORS.has(code)) {
      await connectorStore.clearUncommittedAdmissionIntent(lease);
      if (automatic) await connectorStore.releaseAutomaticQuota(lease);
      return deferred(code, now, code.includes('quota') && !code.includes('active') ? 15 * 60000 : 60000);
    }
    // Unknown failures can occur after commit. Keep the reservation and immutable key.
    throw error;
  }
  try { await connectorStore.recordAdmission(lease, check.id); }
  catch (error) {
    const connection = await connectorStore.getConnection(lease.ref.ownerId, lease.ref.id);
    if (!connection || connection.epoch !== lease.ref.epoch || connection.status !== 'active') {
      // An epoch change can cancel a still-unrecorded admission. Save the exact known
      // check ID on that canceled job before attempting cross-database cancellation.
      if (connection?.epoch !== lease.ref.epoch) await connectorStore.recordOrphanedAdmission(lease, check.id);
      await mainStore.requestCancel(lease.ref.ownerId, check.id);
      await connectorStore.acknowledgeDisconnectCancellation(lease.ref.ownerId, lease.ref.id, check.id);
    }
    throw error;
  }
  return { status: 'admitted', check };
}
