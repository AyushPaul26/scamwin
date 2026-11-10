import { GmailAdapter } from '../lib/scamwin/connectors/providers/gmail';
import { ProviderHttpError } from '../lib/scamwin/connectors/provider-http';
import type { SavedConnection, SyncCursor } from '../lib/scamwin/connectors/contracts';

/** Default is a synthetic readiness run. No dotenv, DB, grant mutation or provider send calls. */
async function main() {
  const args = new Set(process.argv.slice(2));
  const live = args.has('--live');
  if (live && !args.has('--authorized-test-user')) throw new Error('explicit_test_user_authorization_required');
  if ([...args].some(a => !['--live', '--authorized-test-user'].includes(a))) throw new Error('unknown_pilot_option');
  const env = process.env;
  if (live && (!env.SCAMWIN_GMAIL_PILOT_ACCESS_TOKEN || !/^\d{1,100}$/.test(env.SCAMWIN_GMAIL_PILOT_HISTORY_ID ?? '') || !Number.isFinite(Date.parse(env.SCAMWIN_GMAIL_PILOT_ACTIVATION_AT ?? '')))) throw new Error('authorized_test_user_token_and_recorded_activation_required');
  const started = Date.now(), activationAt = live ? env.SCAMWIN_GMAIL_PILOT_ACTIVATION_AT! : new Date(started - 60000).toISOString();
  const connection: SavedConnection = { id: 'pilot', ownerId: 'explicit-test-user', epoch: 1, provider: 'gmail', status: 'active', mode: 'all_new', scope: ['inbox'], scopeVersion: 1, rules: {}, activationAt, automaticDailyLimit: 1, createdAt: activationAt, updatedAt: activationAt };
  const fixtures: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/history')) return Response.json({ historyId: '200', history: [{ messagesAdded: ['controlled1', 'controlled2'].map(id => ({ message: { id, labelIds: ['INBOX'] } })) }] });
    const id = url.pathname.split('/').at(-1)!;
    return Response.json({ id, labelIds: ['INBOX'], internalDate: String(started), payload: { mimeType: 'text/plain', body: { data: Buffer.from(id === 'controlled1' ? 'Controlled routine email' : 'Controlled multi-link email https://example.com/a https://example.org/b').toString('base64url') } } });
  };
  const adapter = new GmailAdapter({ accessToken: async () => live ? env.SCAMWIN_GMAIL_PILOT_ACCESS_TOKEN! : 'fixture', revoke: async () => ({ status: 'unavailable', reason: 'pilot_never_revokes' }), fetch: live ? fetch : fixtures });
  let cursor: SyncCursor = { cursor: live ? env.SCAMWIN_GMAIL_PILOT_HISTORY_ID! : '100', pageState: null };
  const signal = AbortSignal.timeout(50000), budget = { deadlineAtMs: started + 50000, maxItemIds: 50 as const, maxBodies: 10 as const, maxBodyBytes: 262144 as const };
  const seen = new Set<string>(); let bodies = 0, multiLink = 0, gapCount = 0, complete = false;
  for (let i = 0; i < 10 && !complete; i++) {
    const page = await adapter.pullChanges(connection, cursor, budget, signal);
    gapCount += page.gaps.length;
    for (const ref of page.items) {
      if (seen.has(ref.id)) continue; seen.add(ref.id);
      if (bodies >= 10) continue;
      const item = await adapter.readItem(connection, ref, signal); bodies++; if (item.urls.length > 1) multiLink++;
    }
    complete = page.complete; cursor = { cursor: page.finalCursor ?? cursor.cursor, pageState: page.pageState };
  }
  // Aggregate evidence only. IDs, cursors, message contents and credentials are never printed.
  console.log(JSON.stringify({ mode: live ? 'authorized_test_user_read' : 'fixture_readiness', uniqueItems: seen.size, bodies, multiLink, gaps: gapCount, roundComplete: complete, elapsedMs: Date.now() - started, liveGatesPending: ['real_web_pkce_wrong_verifier', 'identity_and_scope_binding', 'refresh_and_testing_expiry', 'activation_race', 'history_over_50', 'expired_history_reconciliation', 'restricted_scope_eligibility_and_budget'] }));
  if (!complete || bodies < 2 || multiLink < 1) process.exitCode = 1;
}
main().catch(error => {
  const code = error instanceof ProviderHttpError ? error.code : error instanceof Error && /^[a-z_]{1,100}$/.test(error.message) ? error.message : 'pilot_failed';
  console.error(JSON.stringify({ code })); process.exitCode = 1;
});
