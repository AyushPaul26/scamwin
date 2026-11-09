import { defineConfig } from '@trigger.dev/sdk';
if (!process.env.SCAMWIN_PUBLISHER_PROJECT_REF) throw new Error('Set SCAMWIN_PUBLISHER_PROJECT_REF to a separate publisher-only Trigger project.');
export default defineConfig({ project: process.env.SCAMWIN_PUBLISHER_PROJECT_REF, runtime: 'node-24', dirs: ['./src/scamwin-publisher'], maxDuration: 300, retries: { enabledInDev: false, default: { maxAttempts: 1, minTimeoutInMs: 1000, maxTimeoutInMs: 1000, factor: 1, randomize: false } } });
