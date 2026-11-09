/**
 * Operator-only, ephemeral account capability check. No application records are written.
 * Run explicitly with the existing server environment, for example:
 * node --env-file=.env.local --import tsx scripts/check-scamwin-live-view.ts
 *
 * Uses the collector's existing approved refund fixture, page, CDP and cleanup path.
 * A successful mint verifies support and the requested watch-only configuration;
 * actual frame/input acceptance still needs the controlled staging viewer check.
 */
import { randomUUID } from 'node:crypto';
import { collectWebsite } from '../lib/scamwin/collector';
import { approvedOrigins, isAllowedOrigin } from '../lib/scamwin/policy';

const fixture = 'https://scamwin.vercel.app/lab/refund-checkpoint';

async function main() {
  const env: Record<string, string | undefined> = { ...process.env, SCAMWIN_LIVE_VIEW_ENABLED: 'true' };
  let configured = false, supported = false, boundedLifetime = false, ended = false;
  let appliedLifetimeMs = 0, connectedCount = 0, unavailableCount = 0;
  let observationCount = 0, captureCount = 0, observed = false;
  let notCheckedCount = 0;
  let failureCode: string | undefined;
  let failurePhase: string | undefined;
  try {
    configured = !!env.BROWSERLESS_TOKEN && env.SCAMWIN_BROWSER_CAPABILITY_VERIFIED === 'true' && isAllowedOrigin(fixture, approvedOrigins(env));
    if (configured) {
      // The collector closes both viewer and browser in finally, including abortion.
      const collection = await collectWebsite(fixture, { checkId: 'live-view-capability', runId: randomUUID() }, {
        env, signal: AbortSignal.timeout(60_000),
        onFailure: event => {
          failureCode = /^(module_missing|provider_auth|provider_capacity|timeout|connection_error|browser_error)$/.test(event.code) ? event.code : 'browser_error';
          failurePhase = /^(load_client|connect_browser|create_context|configure_routes|navigate|read_page|capture)$/.test(event.phase) ? event.phase : 'unknown';
        },
        onLiveViewReady: async view => {
          supported = true;
          appliedLifetimeMs = view.timeoutMs;
          boundedLifetime = Number.isInteger(view.timeoutMs) && view.timeoutMs > 0 && view.timeoutMs <= 60_000;
        },
        onLiveViewConnected: async () => { connectedCount++; },
        onLiveViewEnded: async () => { ended = true; },
        onLiveViewUnavailable: async event => {
          unavailableCount++;
          failureCode = /^live_view_(budget|aborted|timeout|provider_error|invalid_response|unsupported|expired|unavailable)$/.test(event.reasonCode) ? event.reasonCode : 'live_view_unavailable';
        },
      });
      observationCount = collection.observations.length;
      captureCount = collection.captures.length;
      notCheckedCount = collection.observations.filter(item => item.status === 'not_checked').length;
      observed = collection.observations.some(item => item.kind === 'page' && item.status === 'observed');
      if (notCheckedCount) failureCode = 'collection_disabled';
    }
  } catch { unavailableCount++; failureCode = 'collection_unavailable'; }
  // Never print raw exceptions, locators, CDP addresses, provider IDs or credentials.
  console.log(JSON.stringify({ configured, supported, readOnlyRequested: supported, boundedLifetime, appliedLifetimeMs, ended, connectedCount, unavailableCount, observed, observationCount, captureCount, notCheckedCount, ...(failureCode ? { failureCode } : {}), ...(failurePhase ? { failurePhase } : {}) }));
  if (!configured || !supported || !boundedLifetime || !ended || !observed || unavailableCount > 0) process.exitCode = 1;
}

void main();
