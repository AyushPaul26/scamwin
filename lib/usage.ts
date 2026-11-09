import { runtimeDb } from './runtime-db';
import { usageEntries } from './db/schema';
import { sandboxEnvironment } from './sandbox-policy';
import { estimateModelCost } from './usage-policy';
import type { LanguageModelUsage } from 'ai';
export async function recordAiUsage(owner: string, runId: string, turn: number, model: string, usage: LanguageModelUsage) {
  const counts = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedTokens: usage.inputTokenDetails?.cacheReadTokens };
  const cost = estimateModelCost(model, counts);
  const values = { userId: owner, environment: sandboxEnvironment(), kind: 'ai', model, ...counts, costMicros: cost?.costMicros, rates: cost?.rates, idempotencyKey: `ai:${sandboxEnvironment()}:${runId}:${turn}` };
  // Retry only the idempotent write; never re-execute the model or its tools.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await runtimeDb().insert(usageEntries).values(values).onConflictDoNothing(); return; }
    catch { if (attempt === 2) throw new Error('Usage write failed.'); }
  }
}
