import type { JobOutcome } from './contracts';
export const CONNECTOR_ADMISSION_WINDOW_MS = 30000;
export const CONNECTOR_EXECUTION_MS = 300000;
export const CONNECTOR_WAIT_MS = 60000;
export const MAIN_CAPACITY_ERRORS = new Set(['global_daily_quota', 'global_monthly_quota', 'owner_daily_quota', 'active_check', 'global_active_quota', 'investigation_paused', 'artifact_storage_cap']);
export function deferred(reason: string, now: Date, waitMs = CONNECTOR_WAIT_MS): JobOutcome {
  return { status: 'deferred', reason, retryAt: new Date(now.getTime() + waitMs).toISOString() };
}
export function errorCode(error: unknown): string { return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'worker_unavailable'; }
