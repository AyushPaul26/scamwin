import * as Sentry from '@sentry/node';
import { tasks } from '@trigger.dev/sdk';
import { privacyOptions } from '../../lib/sentry-options';
Sentry.init({
  dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN,
  environment: process.env.OPENMODS_ENV ?? 'development', release: process.env.SENTRY_RELEASE,
  defaultIntegrations: false, enableOpenTelemetrySetup: false, ...privacyOptions,
});
async function flush() { try { await Sentry.flush(2000); } catch { /* best effort */ } }
tasks.onComplete(flush);
tasks.onWait(flush);
tasks.onFailure(async () => { Sentry.captureException(new Error('OpenMods worker failed')); await flush(); });
