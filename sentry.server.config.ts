import * as Sentry from '@sentry/nextjs';
import { privacyOptions } from './lib/sentry-options';
Sentry.init({ ...privacyOptions, dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN, environment: process.env.OPENMODS_ENV ?? 'development', release: process.env.SENTRY_RELEASE ?? process.env.RENDER_GIT_COMMIT, tracesSampleRate: process.env.OPENMODS_ENV === 'production' ? 0.1 : 1, includeLocalVariables: false });
