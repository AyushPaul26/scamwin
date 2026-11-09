import { createHash } from 'node:crypto';

export type DailyCheckAllowance = { schemaVersion: 1; ownerId: string; dailyLimit: 5; utcDay: string; expiresAt: string };

/** Dedicated operator metadata, never a browser-submitted quota value. */
export function dailyCheckAllowanceKey(ownerId: string): string {
  return `scamwin-test-allowance:${createHash('sha256').update(ownerId).digest('hex')}`;
}

export function createDailyCheckAllowance(ownerId: string, now: Date): DailyCheckAllowance {
  if (!ownerId || ownerId.length > 300) throw new Error('invalid_allowance_owner');
  const expires = new Date(now); expires.setUTCHours(24, 0, 0, 0);
  return { schemaVersion: 1, ownerId, dailyLimit: 5, utcDay: now.toISOString().slice(0, 10), expiresAt: expires.toISOString() };
}

/** Match SQL's owner, literal-limit and canonical UTC-day fence. */
export function effectiveDailyCheckLimit(ownerId: string, value: unknown, now: Date): 3 | 5 {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isFinite(now.getTime())) return 3;
  const row = value as Record<string, unknown>, expires = new Date(now);
  expires.setUTCHours(24, 0, 0, 0);
  return Object.keys(row).length === 5 && ['schemaVersion', 'ownerId', 'dailyLimit', 'utcDay', 'expiresAt'].every(key => Object.hasOwn(row, key))
    && row.schemaVersion === 1 && row.ownerId === ownerId && row.dailyLimit === 5
    && row.utcDay === now.toISOString().slice(0, 10) && row.expiresAt === expires.toISOString() ? 5 : 3;
}
