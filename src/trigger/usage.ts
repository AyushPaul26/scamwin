import { privateOperation } from '../../lib/private-operation';
import { schedules } from '@trigger.dev/sdk';
import { runtimeDb } from '../../lib/runtime-db';
import { bots, usageEntries } from '../../lib/db/schema';
import { getDaytona } from '../../lib/daytona';
import { sandboxEnvironment } from '../../lib/sandbox-policy';
import { sampleSlot } from '../../lib/usage-policy';
export const sampleSandboxUsage = schedules.task({
  id: 'openmods-sandbox-usage',
  cron: { pattern: '*/5 * * * *', timezone: 'UTC', window: '0m', environments: ['PRODUCTION'] },
  queue: { concurrencyLimit: 1 }, maxDuration: 120,
  run: async ({ timestamp }) => privateOperation(async () => {
    const environment = sandboxEnvironment();
    const db = runtimeDb();
    const owners = new Map((await db.select({ id: bots.id, sandboxId: bots.sandboxId, userId: bots.userId }).from(bots)).map(bot => [bot.sandboxId, bot]));
    const rows = [];
    for await (const sandbox of getDaytona().list({ states: ['started', 'starting', 'stopping'] })) {
      const owner = owners.get(sandbox.id);
      if (!owner || sandbox.labels?.project !== 'openmods' || sandbox.labels?.environment !== environment || sandbox.labels?.botId !== owner.id) continue;
      rows.push({ userId: owner.userId, environment, kind: 'sandbox', sandboxSeconds: 300, eventAt: new Date(sampleSlot(timestamp)), idempotencyKey: `sandbox:${environment}:${sandbox.id}:${sampleSlot(timestamp)}` });
    }
    // A failed list does not leave a partial sample.
    if (rows.length) await db.insert(usageEntries).values(rows).onConflictDoNothing();
    return { observed: rows.length };
  }),
});
