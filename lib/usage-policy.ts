import { z } from 'zod';
const ratesSchema = z.record(z.string(), z.object({ input: z.number().nonnegative(), cachedInput: z.number().nonnegative(), output: z.number().nonnegative() }));
export function estimateModelCost(model: string, usage: { inputTokens?: number; outputTokens?: number; cachedTokens?: number }, config = process.env.MODEL_RATES_JSON) {
  if (!config || usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  try {
    const rate = ratesSchema.parse(JSON.parse(config))[model];
    if (!rate) return null;
    const cached = Math.min(usage.inputTokens, usage.cachedTokens ?? 0);
    return { costMicros: Math.ceil((usage.inputTokens - cached) * rate.input + cached * rate.cachedInput + usage.outputTokens * rate.output), rates: rate };
  } catch { return null; }
}
export const sampleSlot = (date: Date) => Math.floor(date.getTime() / 300000) * 300000;
export const utcMonthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
