import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore } from '../lib/scamwin/store';

test('reference-only checks remain searchable by company and public reference within their account', async () => {
  const store = new MemoryStore();
  const input = { url: '', message: '', promisedBenefit: '', intendedAction: '', images: [], claimedCompany: 'Example Company', offerReference: '12345' };
  const check = await store.createCheck('owner', input, 'reference-only');
  assert.equal((await store.listChecks('owner', { query: 'Example Company' })).checks[0]?.id, check.id);
  assert.equal((await store.listChecks('owner', { query: '12345' })).checks[0]?.id, check.id);
  assert.equal((await store.listChecks('other', { query: '12345' })).checks.length, 0);
  await assert.rejects(store.createCheck('owner', { ...input, offerReference: '54321' }, 'reference-only'), /submission_conflict/);
});
