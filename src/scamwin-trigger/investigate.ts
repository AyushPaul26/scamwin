import { schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import { getScamwinStore } from '../../lib/scamwin/repository-core';
import { runInvestigation } from '../../lib/scamwin/pipeline';
export const investigate = schemaTask({ id: 'scamwin-investigate', schema: z.object({ id: z.string().min(1).max(120), generation: z.number().int().positive() }).strict(), queue: { name: 'scamwin-investigations', concurrencyLimit: 2 }, maxDuration: 300, retry: { maxAttempts: 1 }, run: async (payload, { signal }) => { await runInvestigation(payload.id, payload.generation, getScamwinStore(), { signal }); return { checkId: payload.id }; } });
