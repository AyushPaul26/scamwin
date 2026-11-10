import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryStore} from '../lib/scamwin/store';
import type {CheckRecord} from '../lib/scamwin/contracts';

test('history pages use descending IDs for equal timestamps without losing owner or search filters', async () => {
  const store = new MemoryStore({now: () => new Date('2026-11-10T12:00:00.000Z')});
  const template = await store.createCheck('alice', {url: 'https://example.com', message: 'History needle', promisedBenefit: 'Refund', intendedAction: 'Receive money', images: []}, 'template');
  const records = (store as unknown as {checks: Map<string, CheckRecord>}).checks;
  records.clear();
  // Seed saved terminal history directly; admission quotas are not pagination fixtures.
  for (let i = 1; i <= 25; i++) {
    const id = `history-${String(i).padStart(2, '0')}`;
    records.set(id, {...structuredClone(template), id, submissionKey: id, state: 'failed'});
  }
  records.set('foreign', {...structuredClone(template), id: 'foreign', ownerId: 'bob', state: 'failed'});
  records.set('unmatched', {...structuredClone(template), id: 'unmatched', input: {...template.input, message: 'Different item'}, state: 'failed'});
  records.set('expired', {...structuredClone(template), id: 'expired', expiresAt: '2026-11-09T12:00:00.000Z', state: 'failed'});
  const first = await store.listChecks('alice', {query: 'needle'});
  const second = await store.listChecks('alice', {query: 'needle', page: 2});
  assert.equal(first.total, 25);
  assert.deepEqual(first.checks.map(c => c.id), ['history-25','history-24','history-23','history-22','history-21','history-20','history-19','history-18','history-17','history-16','history-15','history-14','history-13','history-12','history-11','history-10','history-09','history-08','history-07','history-06']);
  assert.deepEqual(second.checks.map(c => c.id), ['history-05','history-04','history-03','history-02','history-01']);
  assert.deepEqual(await store.listChecks('alice', {query: 'needle'}), first);
  assert.equal(new Set([...first.checks, ...second.checks].map(c => c.id)).size, 25);
  assert.equal((await store.listChecks('bob', {})).total, 1);
});
