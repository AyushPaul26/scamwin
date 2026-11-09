import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { auth0 } from '@/lib/auth0';
import { getDb } from '@/lib/db';
import { usageEntries } from '@/lib/db/schema';
import { sandboxEnvironment } from '@/lib/sandbox-policy';
import { utcMonthStart } from '@/lib/usage-policy';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
async function UsageContent() {
  const session = await auth0.getSession();
  if (!session?.user.sub) redirect('/sign-in');
  let rows;
  try { rows = await getDb().select().from(usageEntries).where(and(eq(usageEntries.userId, session.user.sub), eq(usageEntries.environment, sandboxEnvironment()))).orderBy(desc(usageEntries.eventAt)); }
  catch { return <p role="alert">Usage could not be loaded. Please refresh to retry.</p>; }
  const month = utcMonthStart(new Date());
  return <>
    <h1 className="text-2xl font-medium">Usage</h1>
    <p className="text-sm text-muted-foreground">Informational usage only. Sandbox runtime is estimated from five-minute observations; provider invoices remain authoritative.</p>
    {([['This month (UTC)', rows.filter(row => row.eventAt >= month)], ['All time', rows]] as const).map(([label, entries]) => {
      const ai = entries.filter(row => row.kind === 'ai');
      const unknown = ai.filter(row => row.costMicros === null).length;
      const knownCost = ai.reduce((sum, row) => sum + (row.costMicros ?? 0), 0) / 1e6;
      return <Card key={label}><CardHeader><CardTitle>{label}</CardTitle><CardDescription>{ai.reduce((sum, row) => sum + (row.inputTokens ?? 0) + (row.outputTokens ?? 0), 0).toLocaleString()} reported AI tokens</CardDescription>
        <p className="text-sm text-muted-foreground">Input: {ai.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0).toLocaleString()} · Output: {ai.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0).toLocaleString()} · Cached input: {ai.reduce((sum, row) => sum + (row.cachedTokens ?? 0), 0).toLocaleString()}</p>
        <p>Estimated AI cost: {ai.length === 0 ? 'No recorded usage' : unknown === ai.length ? 'Unavailable — model rates are not configured' : `$${knownCost.toFixed(4)}${unknown ? ' + usage with unavailable costs' : ''}`}</p>
        <p>Estimated sandbox usage: {(entries.reduce((sum, row) => sum + (row.sandboxSeconds ?? 0), 0) / 3600).toFixed(2)} hours</p>
      </CardHeader></Card>;
    })}
    <p className="text-xs text-muted-foreground">Last recorded observation: {rows[0]?.eventAt.toISOString() ?? 'None yet'}. Stale or missing observations can indicate a delayed sampler or unavailable tracking; they do not mean zero actual usage.</p>
  </>;
}
export default function UsagePage() { return <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6 pt-20 md:pt-10"><Suspense fallback={<p role="status">Loading usage…</p>}><UsageContent /></Suspense></main>; }
