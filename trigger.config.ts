import { sentryEsbuildPlugin } from "@sentry/bundler-plugins/esbuild";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_yyokorioekbldyziwkwb",
  runtime: "node-24",
  dirs: ["./src/trigger"],
  maxDuration: 60,
  build: { extensions: process.env.SENTRY_AUTH_TOKEN ? [esbuildPlugin(sentryEsbuildPlugin({ org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, authToken: process.env.SENTRY_AUTH_TOKEN, release: { name: process.env.SENTRY_RELEASE } }), { placement: "last", target: "deploy" })] : [] },
});
