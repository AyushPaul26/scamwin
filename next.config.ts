import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

if (process.env.SCAMWIN_PUBLISHER_PRIVATE_KEY) {
  throw new Error('Publisher signing credentials belong only in the dedicated publisher project. Remove them from the main website environment.');
}

const nextConfig: NextConfig = {
  // Browser checks use a separate build directory and leave the user's dev server running.
  distDir: process.env.OPENMODS_NEXT_DIST_DIR || ".next",
  // Daytona loads Node multipart/stream modules with runtime require().
  serverExternalPackages: ["@daytona/sdk"],
  // Playwright loads this manifest dynamically; the hosted trace omitted it.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/playwright-core/browsers.json"],
  },
  devIndicators: false,
  env: { NEXT_PUBLIC_SENTRY_RELEASE: process.env.SENTRY_RELEASE ?? process.env.RENDER_GIT_COMMIT ?? '', NEXT_PUBLIC_OPENMODS_ENV: process.env.OPENMODS_ENV ?? 'development' },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withSentryConfig(nextConfig, { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, authToken: process.env.SENTRY_AUTH_TOKEN, silent: true, sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN } });
