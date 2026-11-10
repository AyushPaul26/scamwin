import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, access, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = (name, args, cwd = root) => spawnSync(process.execPath, [join(root, 'scripts', name), ...args], { cwd, encoding: 'utf8', timeout: 15000, windowsHide: true, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP } });
const exists = async path => access(path).then(() => true, () => false);
const parse = text => Object.fromEntries(text.trim().split('\n').map(line => line.split('=')));

test('VAPID generator writes canonical keys privately and refuses overwrite', async () => {
  const fixture = await mkdtemp(join(root, '.env-generator-test-'));
  try {
    const output = join(fixture, '.env.push.local');
    const child = command('generate-scamwin-vapid.mjs', [output]);
    assert.equal(child.status, 0, child.stderr);
    const original = await readFile(output, 'utf8'), values = parse(original);
    assert.match(values.SCAMWIN_WEB_PUSH_PUBLIC_KEY ?? '', /^[A-Za-z0-9_-]{87}$/);
    assert.match(values.SCAMWIN_WEB_PUSH_PRIVATE_KEY ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.equal(values.SCAMWIN_WEB_PUSH_SUBJECT, '');
    for (const value of [values.SCAMWIN_WEB_PUSH_PUBLIC_KEY, values.SCAMWIN_WEB_PUSH_PRIVATE_KEY]) assert.equal((child.stdout + child.stderr).includes(value), false);
    assert.notEqual(command('generate-scamwin-vapid.mjs', [output]).status, 0);
    assert.equal(await readFile(output, 'utf8'), original);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('connector generator creates independent new keys with safe disabled defaults and no output leak', async () => {
  const fixture = await mkdtemp(join(root, '.env-generator-test-'));
  try {
    const output = join(fixture, '.env.connectors.local');
    const child = command('generate-scamwin-connector-secrets.mjs', [output]);
    assert.equal(child.status, 0, child.stderr);
    const original = await readFile(output, 'utf8'), values = parse(original);
    const secrets = ['SCAMWIN_CONNECTOR_ENCRYPTION_KEY', 'SCAMWIN_CONNECTOR_IDENTIFIER_KEY', 'SCAMWIN_CONNECTOR_DISPATCH_SECRET'].map(key => values[key]);
    for (const secret of secrets) { assert.match(secret, /^[a-f0-9]{64}$/); assert.equal((child.stdout + child.stderr).includes(secret), false); }
    assert.equal(new Set(secrets).size, 3);
    for (const [key, value] of Object.entries(values)) if (!key.endsWith('_KEY') && !key.endsWith('_SECRET')) assert.equal(value, 'false', key);
    assert.notEqual(command('generate-scamwin-connector-secrets.mjs', [output]).status, 0);
    assert.equal(await readFile(output, 'utf8'), original);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('both generators refuse absent paths, nonprivate names, outside roots and available symlink escapes', async t => {
  const fixture = await mkdtemp(join(root, '.env-generator-test-')), outside = await mkdtemp(join(tmpdir(), 'scamwin-generator-test-'));
  try {
    const link = join(fixture, 'outside');
    let linked = false;
    try { await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); linked = true; }
    catch (error) { if (error.code !== 'EPERM') throw error; t.diagnostic('Sandbox disallows junction creation; lexical outside-root rejection remains covered.'); }
    const unignored = join(root, 'tests', `generator-${Date.now()}`);
    await mkdir(unignored);
    try {
      for (const name of ['generate-scamwin-connector-secrets.mjs', 'generate-scamwin-vapid.mjs']) {
        assert.notEqual(command(name, []).status, 0);
        for (const output of [join(fixture, 'credentials.txt'), join(outside, '.env.keys'), ...(linked ? [join(link, '.env.keys')] : []), join(unignored, 'config.txt')]) {
          const child = command(name, [output]);
          assert.notEqual(child.status, 0, name);
          assert.equal(await exists(output), false, name);
          assert.equal((child.stdout + child.stderr).includes(output), false);
        }
      }
    } finally { await rm(unignored, { recursive: true, force: true }); }
  } finally { await rm(fixture, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
