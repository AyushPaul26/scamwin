import * as Sentry from '@sentry/nextjs';
import { privacyOptions } from './lib/sentry-options';
Sentry.init({ ...privacyOptions, dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN, environment: process.env.OPENMODS_ENV ?? 'development', tracesSampleRate: process.env.OPENMODS_ENV === 'production' ? 0.1 : 1 });
