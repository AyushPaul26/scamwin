import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { scamwinReadiness } from '../lib/scamwin/readiness';

const web = {
  APP_BASE_URL: 'https://demo.example', AUTH0_DOMAIN: 'demo.auth0.com',
  AUTH0_CLIENT_ID: 'client', AUTH0_CLIENT_SECRET: 'client-secret', AUTH0_SECRET: 'secret', DATABASE_URL: 'database',
};

test('Vercel presence readiness accepts an explicitly selected backend without Trigger credentials', () => {
  const result = scamwinReadiness({ ...web, SCAMWIN_INVESTIGATION_BACKEND: 'vercel' });
  assert.equal(result.configured, true);
  assert.equal(result.readiness.find(item => item.id === 'worker')?.status, 'limited');
  assert.equal(result.limits.globalActiveChecks, 2);
});

test('an unselected or credentialless Trigger backend never reports configured', () => {
  assert.equal(scamwinReadiness({ ...web, TRIGGER_SECRET_KEY: 'present' }).configured, false);
  assert.equal(scamwinReadiness({ ...web, SCAMWIN_INVESTIGATION_BACKEND: 'trigger' }).configured, false);
  assert.equal(scamwinReadiness({ ...web, SCAMWIN_INVESTIGATION_BACKEND: 'trigger', TRIGGER_SECRET_KEY: 'present' }).configured, true);
});

function checkConfig(values: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test', ...values };
  return spawnSync(process.execPath, [resolve('scripts/check-scamwin-config.mjs')], { cwd: tmpdir(), env, encoding: 'utf8' });
}

test('config checker selects Vercel requirements without demanding Trigger project keys or exposing values', () => {
  const result = checkConfig({ ...web, SCAMWIN_INVESTIGATION_BACKEND: 'vercel', SCAMWIN_INDICATOR_HMAC_SECRET: 'never-print-this' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /investigation backend: vercel/);
  assert.doesNotMatch(result.stdout, /TRIGGER_PROJECT_REF|TRIGGER_SECRET_KEY|never-print-this/);
  assert.match(result.stdout, /SCAMWIN_INDICATOR_HMAC_SECRET=present/);
});

test('config checker reports missing explicit backend even when a Trigger credential is present', () => {
  const result = checkConfig({ TRIGGER_SECRET_KEY: 'never-print-this' });
  assert.match(result.stdout, /investigation backend: missing/);
  assert.doesNotMatch(result.stdout, /never-print-this/);
});

test('config checker demands Trigger project settings only when Trigger is selected', () => {
  const result = checkConfig({ SCAMWIN_INVESTIGATION_BACKEND: 'trigger', TRIGGER_SECRET_KEY: 'never-print-this' });
  assert.match(result.stdout, /investigation backend: trigger/);
  assert.match(result.stdout, /TRIGGER_SECRET_KEY=present/);
  assert.match(result.stdout, /TRIGGER_PROJECT_REF=missing/);
  assert.doesNotMatch(result.stdout, /never-print-this/);
});

test('config checker keeps public secrets an error', () => {
  const result = checkConfig({ NEXT_PUBLIC_BROWSERLESS_TOKEN: 'never-print-this' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sensitive-looking public variable/);
  assert.doesNotMatch(result.stdout + result.stderr, /never-print-this/);
});
