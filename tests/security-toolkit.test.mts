import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createRequire } from 'node:module';
import type { Sandbox } from '@daytona/sdk';
const require = createRequire(import.meta.url);
const operations: string[] = [];
mock.module(require.resolve('../lib/monitoring'), { namedExports: { reportOperation: (operation: string) => operations.push(operation) } });
const { installSecurityToolkit } = await import('../lib/security-toolkit');
test('toolkit failure retains only allowlisted installation stages before sandbox cleanup', async () => {
  for (const stage of ['packages', 'playwright', 'nikto', 'zap', 'verification', 'private-url-and-token']) {
    const sandbox = {
      fs: { uploadFile: async () => {}, downloadFile: async () => Buffer.from(stage) },
      process: { executeCommand: async () => ({ exitCode: 1 }) },
    } as unknown as Sandbox;
    await assert.rejects(installSecurityToolkit(sandbox), /Security toolkit installation failed/);
    assert.equal(operations.at(-1), `security-toolkit-${stage === 'private-url-and-token' ? 'unknown' : stage}`);
  }
  assert.doesNotMatch(JSON.stringify(operations), /private-url-and-token/);
});
