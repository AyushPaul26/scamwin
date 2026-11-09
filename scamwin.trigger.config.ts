import { defineConfig } from '@trigger.dev/sdk';
if (!process.env.TRIGGER_PROJECT_REF) throw new Error('Set TRIGGER_PROJECT_REF for your own Scamwin Trigger project.');
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF,
  runtime: 'node-24',
  dirs: ['./src/scamwin-trigger'],
  // Install the remote browser client as a package instead of bundling its optional browser internals.
  build: { external: ['playwright'] },
  maxDuration: 300,
  retries: { enabledInDev: false, default: { maxAttempts: 1, minTimeoutInMs: 1000, maxTimeoutInMs: 1000, factor: 1, randomize: false } },
});
