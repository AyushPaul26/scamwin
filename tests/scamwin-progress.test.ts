import assert from 'node:assert/strict';
import test from 'node:test';
import type { CheckRecord, RunPatch, ScamwinStore } from '../lib/scamwin/contracts';
import { createInitialStages, createProgressWriter, finishInterruptedStages } from '../lib/scamwin/progress';

function fixture() {
  let record: CheckRecord = {
    id: 'check', ownerId: 'owner', submissionKey: 'key', runId: 'run', generation: 1, revision: 1,
    state: 'validating', createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z', input: { url: '', message: 'offer', promisedBenefit: '', intendedAction: 'receive_money', images: [] },
    stages: createInitialStages(),
  };
  const writes: CheckRecord[] = [];
  const store = {
    async getInternalCheck() { await new Promise(resolve => setTimeout(resolve, 1)); return structuredClone(record); },
    async updateRun(_id: string, generation: number, revision: number, patch: RunPatch) {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (generation !== record.generation || revision !== record.revision) return null;
      record = { ...record, ...patch, revision: record.revision + 1 };
      writes.push(structuredClone(record)); return structuredClone(record);
    },
  } as unknown as ScamwinStore;
  return { store, writes, read: () => record, replace: (patch: Partial<CheckRecord>) => { record = { ...record, ...patch }; } };
}

test('initial stages describe the six actual operations without fabricated start times', () => {
  const stages = createInitialStages();
  assert.deepEqual(stages.map(s => s.id), ['intake', 'browser', 'trust', 'registry', 'comparison', 'assessment']);
  assert.ok(stages.every(s => s.status === 'pending' && !s.startedAt && !s.finishedAt));
});

test('progress serializes concurrent writes and preserves genuine start/end times', async () => {
  const f = fixture(); let tick = 0;
  const writer = createProgressWriter('check', 1, f.store, { now: () => new Date(Date.UTC(2026, 10, 10, 0, 0, tick++)) });
  await writer.beginStage('intake');
  await writer.finishStage('intake', 'completed');
  await writer.patchRun({ state: 'collecting' });
  await writer.beginStage('browser');
  await Promise.all([writer.detailStage('browser', 'navigate'), writer.detailStage('browser', 'read_page')]);
  await writer.finishStage('browser', 'completed');
  await writer.flush();
  const stages = f.read().stages;
  assert.equal(stages[1].status, 'completed');
  assert.ok(stages[1].startedAt && stages[1].finishedAt);
  assert.ok(Date.parse(stages[1].finishedAt!) >= Date.parse(stages[1].startedAt!));
  assert.equal(stages[1].detailCode, 'read_page');
  assert.equal(f.writes.length, 7);
  assert.deepEqual(f.writes.map(w => w.revision), [2, 3, 4, 5, 6, 7, 8]);
});

test('a late browser detail cannot resurrect a completed stage', async () => {
  const f = fixture(); const writer = createProgressWriter('check', 1, f.store);
  await writer.beginStage('browser'); await writer.finishStage('browser', 'completed');
  const revision = f.read().revision;
  await writer.detailStage('browser', 'navigate'); await writer.beginStage('browser');
  assert.equal(f.read().revision, revision);
  assert.equal(f.read().stages[1].status, 'completed');
});

test('cancellation and stale generations stop progress without modifying the new run', async () => {
  const f = fixture(); const writer = createProgressWriter('check', 1, f.store);
  f.replace({ state: 'cancel_requested' });
  await assert.rejects(writer.beginStage('browser'), /progress_stopped/);
  f.replace({ state: 'validating', generation: 2 });
  await assert.rejects(writer.beginStage('browser'), /progress_stopped/);
  assert.equal(f.writes.length, 0);
});

test('interruption freezes running stages and skips unstarted work', () => {
  const stages = createInitialStages();
  stages[0] = { ...stages[0], status: 'completed', startedAt: '2026-11-10T00:00:00.000Z', finishedAt: '2026-11-10T00:00:01.000Z' };
  stages[1] = { ...stages[1], status: 'running', startedAt: '2026-11-10T00:00:02.000Z' };
  const interrupted = finishInterruptedStages(stages, 'canceled', '2026-11-10T00:00:03.000Z');
  assert.equal(interrupted[0].status, 'completed'); assert.equal(interrupted[1].status, 'canceled');
  assert.equal(interrupted[1].finishedAt, '2026-11-10T00:00:03.000Z');
  assert.ok(interrupted.slice(2).every(s => s.status === 'skipped' && !s.startedAt));
});
