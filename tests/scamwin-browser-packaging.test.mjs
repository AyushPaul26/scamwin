import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('hosted browser functions include the dynamically loaded Playwright manifest', () => {
  const env = { ...process.env };
  delete env.SCAMWIN_PUBLISHER_PRIVATE_KEY;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const imported = await import('./next.config.ts');
    const config = imported.default.default ?? imported.default;
    assert.ok(config.outputFileTracingIncludes?.['/*']?.includes('./node_modules/playwright-core/browsers.json'));
    assert.ok(JSON.parse(fs.readFileSync('node_modules/playwright-core/browsers.json', 'utf8')).browsers.length > 0);
  `], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 0, child.stderr);
});
