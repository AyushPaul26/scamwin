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
  async headers() {
    // The inspected site runs remotely; only its watch-only provider viewer is framed.
    let viewerOrigin = "'none'";
    try {
      const provider = new URL(process.env.BROWSERLESS_BASE_URL || 'https://production-sfo.browserless.io');
      if (provider.protocol === 'https:' && ['production-sfo.browserless.io', 'production-lon.browserless.io', 'production-ams.browserless.io'].includes(provider.hostname) && !provider.port && !provider.username && !provider.password && !provider.search && !provider.hash && provider.pathname === '/') viewerOrigin = provider.origin;
    } catch { /* Invalid configuration cannot broaden frame permissions. */ }
    return [{ source: '/checks/:id', headers: [{ key: 'Content-Security-Policy', value: `frame-src ${viewerOrigin}; object-src 'none'; base-uri 'self'` }] }];
  },
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
