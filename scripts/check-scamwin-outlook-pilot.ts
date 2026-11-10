import { OutlookAdapter } from '../lib/scamwin/connectors/providers/outlook';
import { ProviderHttpError } from '../lib/scamwin/connectors/provider-http';
import type { SavedConnection, SyncCursor } from '../lib/scamwin/connectors/contracts';

/** Synthetic readiness only: never reads env, opens a real account, mutates grants or writes a DB. */
async function main() {
  if (process.argv.slice(2).length) throw new Error(process.argv.includes('--live') ? 'live_pilot_not_authorized' : 'unknown_pilot_option');
  const started = Date.now(), clock = new Date(started), activationAt = clock.toISOString();
  let roundsComplete = 0, bodies = 0, multiLink = 0, historicalImports = 0, gaps = 0;
  for (const accountFixture of ['personal', 'work_school']) {
    const c: SavedConnection = { id: `fixture-${accountFixture}`, ownerId: 'fixture-owner', epoch: 1, provider: 'outlook', status: 'active', mode: 'all_new', scope: ['folder:fixture-inbox'], scopeVersion: 1, rules: {}, activationAt, automaticDailyLimit: 1, createdAt: activationAt, updatedAt: activationAt };
    const path = '/v1.0/me/mailFolders/fixture-inbox/messages/delta';
    const adapter = new OutlookAdapter({ now: () => clock, accessToken: async ref => { if (ref.ownerId !== c.ownerId || ref.epoch !== c.epoch) throw new Error('fixture_owner_mismatch'); return 'fixture'; }, revoke: async () => ({ status: 'unavailable', reason: 'fixture_never_revokes' }), isKnownItem: async () => false, fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== 'https://graph.microsoft.com' || init?.method !== 'GET' || init.redirect !== 'error') throw new Error('fixture_request_rejected');
      const metadata = (id: string, old = false) => ({ id, parentFolderId: 'fixture-inbox', changeKey: 'v1', receivedDateTime: old ? '2020-01-01T00:00:00Z' : activationAt });
      if (url.pathname === path) return Response.json(url.searchParams.has('$skiptoken') ? { value: [metadata('routine'), metadata('multi')], '@odata.deltaLink': url.origin + path + '?$deltatoken=end' } : { value: [metadata('old', true)], '@odata.nextLink': url.origin + path + '?$skiptoken=next%20page' });
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      return Response.json({ ...metadata(id), subject: 'Synthetic controlled notice', hasAttachments: false, body: { contentType: 'text', content: id === 'multi' ? 'Synthetic offer https://example.com/a https://example.org/b' : 'Synthetic routine notice' } });
    } });
    let cursor: SyncCursor = await adapter.activate(c, new AbortController().signal);
    const signal = AbortSignal.timeout(10000), budget = { deadlineAtMs: started + 10000, maxItemIds: 50 as const, maxBodies: 10 as const, maxBodyBytes: 262144 as const };
    for (let i = 0; i < 3; i++) {
      const page = await adapter.pullChanges(c, cursor, budget, signal); gaps += page.gaps.length;
      for (const ref of page.items) { if (ref.id === 'old') historicalImports++; const item = await adapter.readItem(c, ref, signal); bodies++; if (item.urls.length > 1) multiLink++; }
      cursor = { cursor: page.finalCursor ?? cursor.cursor, pageState: page.pageState };
      if (page.complete) { roundsComplete++; break; }
    }
  }
  // Aggregate only: no provider identifiers, tokens, cursors, message text or source destinations.
  console.log(JSON.stringify({ mode: 'fixture_readiness', liveConnectionVerified: false, roundsComplete, bodies, multiLink, historicalImports, gaps, elapsedMs: Date.now() - started, liveGatesPending: ['real_personal_consent', 'real_work_school_consent_and_tenant_policy', 'oidc_linkage_and_refresh_rotation', 'large_mailbox_bootstrap', 'folder_moves_and_delta_expiry', 'registry_removal_reconciliation', 'selected_item_owner_actions', 'production_polling_and_coverage_copy'] }));
  if (roundsComplete !== 2 || bodies !== 4 || multiLink !== 2 || historicalImports) process.exitCode = 1;
}
main().catch(error => { const code = error instanceof ProviderHttpError ? error.code : error instanceof Error && /^[a-z_]{1,100}$/.test(error.message) ? error.message : 'pilot_failed'; console.error(JSON.stringify({ code })); process.exitCode = 1; });
