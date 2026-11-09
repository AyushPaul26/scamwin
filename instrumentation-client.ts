import * as Sentry from '@sentry/nextjs';
import { privacyOptions } from './lib/sentry-options';
Sentry.init({ ...privacyOptions, release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined, environment: process.env.NEXT_PUBLIC_OPENMODS_ENV, dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 });
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
