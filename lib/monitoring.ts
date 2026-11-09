import * as Sentry from '@sentry/node';
export function reportOperation(operation: string) {
  // No upstream error payload: providers can embed prompts and signed URLs in it.
  console.error(`OpenMods operation failed: ${operation}`);
  try { Sentry.captureException(new Error(`OpenMods operation failed: ${operation}`)); } catch { /* Observability never gates the operation. */ }
}

export function reportToolOutcome(tool: string, durationMs: number, outcome: 'completed' | 'failed' | 'interrupted') {
  // Fixed tool names and numeric timings only; never include inputs or outputs.
  try { console.info('OpenMods tool', { tool, durationMs, outcome }); } catch { /* best effort */ }
}
