import 'server-only';
import { getOptionalSession } from '@/lib/auth0';
import { getScamwinStore } from './repository';
import { ScamwinStoreError } from './store';
export async function requireScamwinUser() {
  const session = await getOptionalSession();
  if (!session?.user.sub) throw new ScamwinStoreError('unauthenticated');
  return { subject: session.user.sub, user: session.user, store: getScamwinStore() };
}
export function publicError(error: unknown) {
  const code = error instanceof ScamwinStoreError ? error.code : 'service_unavailable';
  if (code === 'global_active_quota') return { error: 'Two checks are already running. Try again when a check finishes.', code };
  const messages: Record<string, string> = { unauthenticated: 'Sign in to use your private checks.', forbidden: 'This action requires a reviewer or administrator account.', not_found: 'This check is unavailable or does not belong to your account.', database_unavailable: 'Private storage is not configured.', active_check: 'Wait for your current check to finish, or cancel it first.', global_daily_quota: 'Today’s free check allowance is used. Try again after midnight UTC.', global_monthly_quota: 'This month’s free check allowance is used. Saved results remain available.', owner_daily_quota: 'You have used your three checks for today. Try again after midnight UTC.', worker_unavailable: 'The online investigation worker is not configured.', review_conflict: 'This submission changed or expired. Reload the review queue.', invalid_evidence: 'Choose observed evidence from this check.', followup_quota: 'The free follow-up allowance is used. Your saved evidence remains available.', followup_duplicate: 'This follow-up was already submitted. Refresh the conversation.', publication_conflict: 'The publication changed. Refresh before trying again.' };
  if (code === 'ai_unavailable') return { error: 'AI follow-up is unavailable or its free allowance is exhausted. Your saved evidence remains available; no new website check was started.', code };
  if (code === 'operations_paused') return { error: 'New checks are temporarily paused by the operator. Saved checks remain available.', code };
  if (code === 'submission_conflict') return { error: 'This submission key was already used for different input. Refresh the form before starting a new check.', code };
  return { error: messages[code] || 'This action could not be completed. Check your input and try again.', code };
}
export function apiFailure(error: unknown) {
  const value = publicError(error);
  return Response.json(value, { status: value.code === 'unauthenticated' ? 401 : value.code === 'forbidden' ? 403 : value.code === 'not_found' ? 404 : 503, headers: { 'Cache-Control': 'no-store' } });
}
