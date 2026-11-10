import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../scripts/check-scamwin-connectors.mjs', import.meta.url);
const base = () => ({
  APP_BASE_URL: 'https://scamwin.vercel.app', DATABASE_URL: 'postgresql://test:main-marker@main.example/main',
  SCAMWIN_CONNECTORS_ENABLED: 'true', SCAMWIN_CONNECTOR_DATABASE_URL: 'postgresql://test:db-marker@connectors.example/scamwin_connectors',
  SCAMWIN_CONNECTOR_ENCRYPTION_KEY: 'a'.repeat(64), SCAMWIN_CONNECTOR_IDENTIFIER_KEY: 'b'.repeat(64),
  SCAMWIN_CONNECTOR_DISPATCH_SECRET: 'dispatch-marker-'.repeat(4),
});
const inspect = async env => (await import(script.href)).inspectConnectorConfiguration(env);
const has = (result, key, reason) => result.checks.some(check => check.key === key && !check.ok && (!reason || check.reason === reason));

test('completely unconfigured connectors are valid disabled, never connected or verified', async () => {
  const result = await inspect({});
  assert.equal(result.ok, true);
  assert.equal(result.status, 'disabled');
  assert.equal(result.liveAcceptance, 'not_checked');
  for (const provider of Object.values(result.providers)) assert.equal(provider.available, false);
});

test('global activation rejects reused database, equal keys, invalid versions, and unsafe origins', async () => {
  for (const [key, value] of [
    ['SCAMWIN_CONNECTOR_DATABASE_URL', 'postgresql://test:secret@main-pooler.example/scamwin_connectors'],
    ['SCAMWIN_CONNECTOR_IDENTIFIER_KEY', 'a'.repeat(64)],
    ['SCAMWIN_CONNECTOR_ENCRYPTION_KEY_VERSION', 'identifier'],
    ['SCAMWIN_CONNECTOR_PREVIOUS_ENCRYPTION_KEYS', JSON.stringify({ k1: 'c'.repeat(64) })],
    ['APP_BASE_URL', 'https://scamwin.vercel.app/private?marker=do-not-print'],
  ]) {
    const result = await inspect({ ...base(), [key]: value });
    assert.equal(result.ok, false, key);
    assert.ok(has(result, key), key);
  }
});

test('Gmail requires public eligibility or a bounded private pilot allowlist and exact callback', async () => {
  const env = { ...base(), SCAMWIN_CONNECTOR_GMAIL_ENABLED: 'true', SCAMWIN_GOOGLE_CLIENT_ID: 'gmail-client', SCAMWIN_GOOGLE_CLIENT_SECRET: 'gmail-secret-marker' };
  assert.equal((await inspect(env)).providers.gmail.available, false);
  const pilot = { ...env, SCAMWIN_GMAIL_TEST_USER_PILOT: 'true', SCAMWIN_GMAIL_PILOT_SUBJECTS: '["auth0|private-owner-marker"]' };
  const result = await inspect(pilot);
  assert.equal(result.ok, true);
  assert.equal(result.providers.gmail.available, true);
  assert.equal(result.providers.gmail.publicEligible, false);
  assert.equal((await inspect({ ...pilot, SCAMWIN_GMAIL_PILOT_SUBJECTS: '[]' })).ok, false);
  assert.equal((await inspect({ ...pilot, SCAMWIN_GOOGLE_REDIRECT_URI: 'https://other.example/callback' })).ok, false);
});

test('provider capabilities retain manual Discord, selected Drive and foreground extension limits', async () => {
  const env = { ...base(), SCAMWIN_CONNECTOR_AUTOMATION_ENABLED: 'true', SCAMWIN_CONNECTOR_RUNTIME_ENABLED: 'true',
    SCAMWIN_CONNECTOR_DISCORD_ENABLED: 'true', SCAMWIN_DISCORD_CLIENT_ID: '123456789012345678', SCAMWIN_DISCORD_CLIENT_SECRET: 'discord-marker', SCAMWIN_DISCORD_PUBLIC_KEY: 'c'.repeat(64),
    SCAMWIN_CONNECTOR_DRIVE_ENABLED: 'true', SCAMWIN_DRIVE_CLIENT_ID: 'drive-client', SCAMWIN_DRIVE_CLIENT_SECRET: 'drive-marker', SCAMWIN_DRIVE_INSTALLATION_ACCEPTED: 'true',
    SCAMWIN_CONNECTOR_EXTENSION_ENABLED: 'true' };
  const result = await inspect(env);
  assert.equal(result.ok, true);
  assert.equal(result.providers.discord.automaticAvailable, false);
  assert.equal(result.providers.discord.capability, 'manual_only');
  assert.equal(result.providers.extension.capability, 'foreground_pages_only');
  assert.equal(result.providers.drive.capability, 'selected_files_only');
  assert.equal(result.providers.drive.automaticAvailable, false);
  assert.equal((await inspect({ ...env, SCAMWIN_GOOGLE_CLIENT_ID: 'drive-client' })).ok, false);
});

test('push requires canonical keys and real contact; obsolete and malformed flags are actionable', async () => {
  const env = { ...base(), SCAMWIN_PRIVATE_PUSH_ENABLED: 'true', SCAMWIN_WEB_PUSH_PUBLIC_KEY: 'P'.repeat(87), SCAMWIN_WEB_PUSH_PRIVATE_KEY: 'Q'.repeat(43), SCAMWIN_WEB_PUSH_SUBJECT: 'mailto:replace-with-operator@example.com' };
  assert.equal((await inspect(env)).ok, false);
  assert.equal((await inspect({ ...env, SCAMWIN_WEB_PUSH_SUBJECT: 'mailto:operator@scamwin.test' })).ok, true);
  const stale = await inspect({ SCAMWIN_GMAIL_OAUTH_ENABLED: 'true', SCAMWIN_PUSH_VAPID_PRIVATE_KEY: 'private-marker', SCAMWIN_CONNECTOR_AUTOMATION_ENABLED: 'TRUE' });
  assert.ok(has(stale, 'SCAMWIN_GMAIL_OAUTH_ENABLED', 'obsolete_setting'));
  assert.ok(has(stale, 'SCAMWIN_PUSH_VAPID_PRIVATE_KEY', 'obsolete_setting'));
  assert.ok(has(stale, 'SCAMWIN_CONNECTOR_AUTOMATION_ENABLED', 'expected_true_or_false'));
});

test('empty boolean flags and dispatch-key reuse are rejected before activation', async () => {
  const empty = await inspect({ SCAMWIN_CONNECTORS_ENABLED: '' });
  assert.equal(empty.ok, false);
  assert.ok(has(empty, 'SCAMWIN_CONNECTORS_ENABLED', 'expected_true_or_false'));
  const reused = await inspect({ ...base(), SCAMWIN_CONNECTOR_DISPATCH_SECRET: 'a'.repeat(64) });
  assert.equal(reused.ok, false);
  assert.ok(has(reused, 'SCAMWIN_CONNECTOR_DISPATCH_SECRET'));
});

test('all server provider gates require their own credentials and Telegram keeps identity separate from bot access', async () => {
  for (const provider of ['gmail', 'outlook', 'telegram', 'slack', 'teams', 'discord', 'drive']) {
    const result = await inspect({ ...base(), [`SCAMWIN_CONNECTOR_${provider.toUpperCase()}_ENABLED`]: 'true' });
    assert.equal(result.ok, false, provider);
    assert.equal(result.providers[provider].available, false, provider);
  }
  const telegram = await inspect({ ...base(), SCAMWIN_CONNECTOR_TELEGRAM_ENABLED: 'true', SCAMWIN_TELEGRAM_CLIENT_ID: '123456', SCAMWIN_TELEGRAM_CLIENT_SECRET: 'identity-secret' });
  assert.equal(telegram.ok, false);
  assert.ok(has(telegram, 'SCAMWIN_TELEGRAM_BOT_TOKEN'));
});

test('CLI is offline and prints only sanitized configuration facts, never supplied values', () => {
  const env = { ...base(), SCAMWIN_CONNECTOR_GMAIL_ENABLED: 'true', SCAMWIN_GOOGLE_CLIENT_ID: 'client-private-marker', SCAMWIN_GOOGLE_CLIENT_SECRET: 'secret-private-marker', SCAMWIN_GMAIL_TEST_USER_PILOT: 'true', SCAMWIN_GMAIL_PILOT_SUBJECTS: '["auth0|owner-private-marker"]' };
  const child = spawnSync(process.execPath, [fileURLToPath(script)], { env, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.liveAcceptance, 'not_checked');
  for (const value of ['db-marker', 'main-marker', 'client-private-marker', 'secret-private-marker', 'owner-private-marker', 'connectors.example', 'dispatch-marker']) assert.equal((child.stdout + child.stderr).includes(value), false, value);
});

test('CLI never auto-loads a local env file and sanitizes malformed JSON failures', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'scamwin-checker-test-'));
  try {
    await writeFile(join(fixture, '.env.local'), 'SCAMWIN_CONNECTORS_ENABLED=true\n');
    const disabled = spawnSync(process.execPath, [fileURLToPath(script)], { cwd: fixture, env: {}, encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(JSON.parse(disabled.stdout).status, 'disabled');
    const invalid = spawnSync(process.execPath, [fileURLToPath(script)], { env: { ...base(), SCAMWIN_CONNECTOR_PREVIOUS_ENCRYPTION_KEYS: '{private-parser-marker' }, encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).status, 'invalid');
    assert.equal((invalid.stdout + invalid.stderr).includes('private-parser-marker'), false);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
