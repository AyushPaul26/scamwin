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
test('connected-app readiness validates isolated configuration without claiming live coverage or gating manual checks', () => {
  const base = {...web, SCAMWIN_INVESTIGATION_BACKEND: 'vercel'};
  assert.equal(scamwinReadiness(base).readiness.find(item => item.id === 'connected_apps')?.status, 'missing');
  const enabled = {...base, DATABASE_URL: 'postgresql://test:main@main.example/main', SCAMWIN_CONNECTORS_ENABLED: 'true', SCAMWIN_CONNECTOR_DATABASE_URL: 'postgresql://test:private-db-marker@connectors.example/scamwin_connectors', SCAMWIN_CONNECTOR_ENCRYPTION_KEY: 'a'.repeat(64), SCAMWIN_CONNECTOR_IDENTIFIER_KEY: 'b'.repeat(64), SCAMWIN_CONNECTOR_DISPATCH_SECRET: 'private-dispatch-marker-'.repeat(3)};
  const result = scamwinReadiness(enabled);
  assert.equal(result.configured, true);
  assert.equal(result.readiness.find(item => item.id === 'connected_apps')?.status, 'limited');
  assert.doesNotMatch(JSON.stringify(result), /private-db-marker|private-dispatch-marker|aaaaaaaaaaaaaaaa/);
  const invalid = scamwinReadiness({...enabled, SCAMWIN_CONNECTOR_DATABASE_URL: enabled.DATABASE_URL});
  assert.equal(invalid.configured, true);
  assert.equal(invalid.readiness.find(item => item.id === 'connected_apps')?.status, 'missing');
});
test('the main configuration checker includes disabled/invalid connector status without printing supplied values', () => {
  const disabled = checkConfig({...web, SCAMWIN_INVESTIGATION_BACKEND: 'vercel'});
  assert.match(disabled.stdout, /connected apps: disabled/);
  const invalid = checkConfig({...web, SCAMWIN_INVESTIGATION_BACKEND: 'vercel', SCAMWIN_CONNECTORS_ENABLED: 'true', SCAMWIN_CONNECTOR_DATABASE_URL: 'private-do-not-print'});
  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout, /connected apps: invalid/);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /private-do-not-print/);
});

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

test('optional viewer readiness never changes basic app gating or returns its encryption key', () => {
  const base = { ...web, SCAMWIN_INVESTIGATION_BACKEND: 'vercel' };
  assert.equal(scamwinReadiness(base).configured, true);
  const key = 'ab'.repeat(32);
  const enabled = scamwinReadiness({ ...base, SCAMWIN_LIVE_VIEW_ENABLED: 'true', SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY: key, BROWSERLESS_TOKEN: 'private-browser-token' });
  assert.equal(enabled.configured, true);
  assert.equal(enabled.readiness.find(item => item.id === 'live_view')?.status, 'limited');
  assert.doesNotMatch(JSON.stringify(enabled), new RegExp(`${key}|private-browser-token`));
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

test('official verification is optional, default-off and never changes basic app readiness', () => {
  const base = { ...web, DATABASE_URL: 'private-database-marker', SCAMWIN_INVESTIGATION_BACKEND: 'vercel' };
  const disabled = scamwinReadiness(base);
  assert.equal(disabled.configured, true);
  assert.equal(disabled.readiness.find(item => item.id === 'official_sources')?.status, 'missing');
  const enabled = scamwinReadiness({ ...base, SCAMWIN_OFFICIAL_VERIFICATION_ENABLED: 'true' });
  assert.equal(enabled.configured, true);
  assert.match(enabled.readiness.find(item => item.id === 'official_sources')?.message ?? '', /reviewed|catalogue/i);
  assert.doesNotMatch(JSON.stringify(enabled), /client-secret|private-database-marker/);
});

test('official configuration reports feature status without demanding a provider key or making lookups', () => {
  const result = checkConfig({ SCAMWIN_INVESTIGATION_BACKEND: 'vercel', SCAMWIN_OFFICIAL_VERIFICATION_ENABLED: 'true' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /official sources: enabled/);
  assert.doesNotMatch(result.stdout, /GREENHOUSE_API_KEY|SEARCH_API_KEY/);
});
