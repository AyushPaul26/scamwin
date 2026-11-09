import type { CheckRecord, CheckStage, RunPatch, ScamwinStore } from './contracts';

export const investigationStages = [
  ['intake', 'Understanding your offer'],
  ['browser', 'Observing the website'],
  ['trust', 'Checking the connection'],
  ['registry', 'Checking shared warnings'],
  ['comparison', 'Comparing promise and request'],
  ['assessment', 'Preparing your result'],
] as const;
export type InvestigationStageId = (typeof investigationStages)[number][0];
export type BrowserDetailCode = 'load_client' | 'connect_browser' | 'create_context' | 'configure_routes' | 'navigate' | 'read_page' | 'capture';
type FinishedStageStatus = 'completed' | 'unavailable' | 'blocked' | 'skipped' | 'canceled';
const activeStates = new Set(['queued', 'validating', 'collecting', 'analyzing']);

export function createInitialStages(): CheckStage[] {
  return investigationStages.map(([id, label]) => ({ id, label, status: 'pending' }));
}

export function finishInterruptedStages(stages: CheckStage[], status: 'unavailable' | 'canceled', at: string): CheckStage[] {
  return stages.map(stage => stage.status === 'running'
    ? { ...stage, status, finishedAt: stage.finishedAt ?? at }
    : stage.status === 'pending' ? { ...stage, status: 'skipped' } : { ...stage });
}

/** One ordered writer owns all progress and pipeline patches for a run. */
export function createProgressWriter(checkId: string, generation: number, store: ScamwinStore, options: { now?: () => Date; signal?: AbortSignal } = {}) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  let tail: Promise<unknown> = Promise.resolve();
  const write = (getPatch: (current: CheckRecord) => RunPatch | null): Promise<CheckRecord> => {
    const operation = tail.then(async () => {
      options.signal?.throwIfAborted();
      const current = await store.getInternalCheck(checkId);
      if (!current || current.generation !== generation || !activeStates.has(current.state)) throw new Error('progress_stopped');
      const patch = getPatch(current);
      if (!patch) return current;
      const saved = await store.updateRun(checkId, generation, current.revision, patch);
      if (!saved) throw new Error('progress_stopped');
      return saved;
    });
    // Keep the queue usable after a rejected operation; each caller retains its own rejection.
    tail = operation.catch(() => undefined);
    return operation;
  };
  const stageWrite = (id: InvestigationStageId, change: (stage: CheckStage) => CheckStage, runPatch: Omit<RunPatch, 'stages'> = {}): Promise<CheckRecord> => write(current => {
    const stages = createInitialStages().map(initial => current.stages.find(stage => stage.id === initial.id) ?? initial);
    const index = stages.findIndex(stage => stage.id === id), original = stages[index];
    const next = change(original);
    if (next === original) return null;
    stages[index] = next;
    return { ...runPatch, stages };
  });
  return {
    patchRun: (patch: RunPatch) => write(() => patch),
    beginStage: (id: InvestigationStageId) => stageWrite(id, stage => stage.status === 'pending' ? { ...stage, status: 'running', startedAt: now() } : stage),
    detailStage: (id: InvestigationStageId, detailCode: BrowserDetailCode) => stageWrite(id, stage => stage.status === 'running' && stage.detailCode !== detailCode ? { ...stage, detailCode } : stage),
    finishStage: (id: InvestigationStageId, status: FinishedStageStatus = 'completed', runPatch: Omit<RunPatch, 'stages'> = {}) => stageWrite(id, stage => ['pending', 'running'].includes(stage.status) ? { ...stage, status, finishedAt: stage.status === 'running' ? now() : undefined } : stage, runPatch),
    flush: async () => { await tail; },
  };
}
