import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDailyCheckAllowance, dailyCheckAllowanceKey, effectiveDailyCheckLimit } from '../lib/scamwin/daily-check-allowance';

const now = new Date('2026-11-10T12:00:00.000Z');
test('temporary allowance grants a total of five only to its owner for the current UTC day', () => {
  const record = createDailyCheckAllowance('alice', now);
  assert.deepEqual(record, { schemaVersion: 1, ownerId: 'alice', dailyLimit: 5, utcDay: '2026-11-10', expiresAt: '2026-11-11T00:00:00.000Z' });
  assert.equal(effectiveDailyCheckLimit('alice', record, now), 5);
  assert.equal(effectiveDailyCheckLimit('bob', record, now), 3);
  assert.equal(effectiveDailyCheckLimit('alice', record, new Date('2026-11-11T00:00:00Z')), 3);
  assert.equal(effectiveDailyCheckLimit('alice', record, new Date('2026-11-09T23:59:59Z')), 3);
  assert.deepEqual(createDailyCheckAllowance('alice', now), record); // Repeated grants never add another two.
});
test('missing or malformed operator metadata cannot raise a limit or throw', () => {
  const record = createDailyCheckAllowance('alice', now);
  for (const invalid of [undefined, null, [], true, '5', {}, { ...record, extra: true }, { ...record, schemaVersion: '1' }, { ...record, dailyLimit: '5' }, { ...record, dailyLimit: 50 }, { ...record, expiresAt: '2099-01-01T00:00:00.000Z' }, { ...record, expiresAt: 'invalid' }, { ...record, expiresAt: '2026-11-10T23:59:59.000Z' }, { ...record, utcDay: '2026-11-09' }]) assert.equal(effectiveDailyCheckLimit('alice', invalid, now), 3);
});
test('operator lookup keys are deterministic, owner-separated and contain no raw subject', () => {
  const key = dailyCheckAllowanceKey('auth0|private-subject');
  assert.match(key, /^scamwin-test-allowance:[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /auth0|private-subject/);
  assert.equal(dailyCheckAllowanceKey('auth0|private-subject'), key);
  assert.notEqual(dailyCheckAllowanceKey('another-subject'), key);
});
