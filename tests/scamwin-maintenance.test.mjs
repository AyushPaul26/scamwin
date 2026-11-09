import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('maintenance rejects absent or wrong authorization, purges expired records and never dispatches investigations', () => {
  const routeUrl = pathToFileURL(resolve('app/api/scamwin/maintenance/route.ts')).href;
  const storeUrl = pathToFileURL(resolve('lib/scamwin/store.ts')).href;
  const repositoryUrl = pathToFileURL(resolve('lib/scamwin/repository-core.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    const { GET } = await import(${JSON.stringify(routeUrl)});
    const { MemoryStore } = await import(${JSON.stringify(storeUrl)});
    const { setScamwinStoreForTests } = await import(${JSON.stringify(repositoryUrl)});
    let now = new Date('2026-11-09T00:00:00Z');
    class PurgeOnlyStore extends MemoryStore {
      async leaseOutbox() { throw new Error('Maintenance must not lease investigation or publication jobs'); }
    }
    const store = new PurgeOnlyStore({ now: () => now });
    setScamwinStoreForTests(store);
    const check = await store.createCheck('owner', { url: 'https://example.org/', message: 'Synthetic', promisedBenefit: '', intendedAction: '', images: [] }, 'submission');
    const request = authorization => new Request('https://example.test/api/scamwin/maintenance', { headers: authorization ? { authorization } : {} });
    delete process.env.CRON_SECRET;
    assert.equal((await GET(request('Bearer undefined'))).status, 401);
    process.env.CRON_SECRET = 'synthetic-maintenance-secret';
    assert.equal((await GET(request())).status, 401);
    assert.equal((await GET(request('Bearer incorrect'))).status, 401);
    assert.ok(await store.getCheck('owner', check.id));
    now = new Date('2026-12-10T00:00:00Z');
    const response = await GET(request('Bearer synthetic-maintenance-secret'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).checks, 1);
    assert.equal(await store.getCheck('owner', check.id), null);
  `;
  const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
