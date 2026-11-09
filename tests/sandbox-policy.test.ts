import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sandboxEnvironment, desktopWebSocketUrl, sandboxLabels } from '../lib/sandbox-policy';
test('sandbox labels separate deployments and identify the bot', () => {
  assert.deepEqual(sandboxLabels('bot-1', 'development'), { project: 'openmods', environment: 'development', botId: 'bot-1' });
  assert.equal(sandboxEnvironment(undefined), 'development');
  assert.throws(() => sandboxEnvironment('prod-typo'));
});
test('desktop URL preserves signed access and only accepts HTTPS', () => {
  assert.equal(desktopWebSocketUrl('https://desktop.example/?token=secret'), 'wss://desktop.example/websockify?token=secret');
  assert.throws(() => desktopWebSocketUrl('http://desktop.example/'));
  assert.throws(() => desktopWebSocketUrl('https://user:pass@desktop.example/'));
});
