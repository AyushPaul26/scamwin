import { installSecurityToolkit } from './security-toolkit';
import { privateOperation } from './private-operation';
import { Daytona, DaytonaNotFoundError, DaytonaConflictError } from '@daytona/sdk';
import { desktopWebSocketUrl, sandboxEnvironment, sandboxLabels } from './sandbox-policy';
import { reportOperation } from './monitoring';
import { BotProvisioningError } from './bot-provisioning-error';

export const MEMORY_FILE = 'MEMORY.md';
let client: Daytona | undefined;
export function getDaytona() {
  if (!process.env.DAYTONA_API_KEY) throw new Error('Sandbox service is not configured.');
  return client ??= new Daytona({ otelEnabled: false, apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL || 'https://app.daytona.io/api' });
}
async function createBotSandboxInternal(botId: string) {
  const api = getDaytona();
  const sandbox = await api.create({ labels: sandboxLabels(botId), autoStopInterval: 15, autoDeleteInterval: -1 }).catch(() => {
    reportOperation('bot-sandbox-create');
    throw new BotProvisioningError('create');
  });
  let stage: 'toolkit' | 'memory' = 'toolkit';
  try {
    if (process.env.OPENMODS_SECURITY_TOOLS === 'true') await installSecurityToolkit(sandbox);
    stage = 'memory';
    const result = await sandbox.process.executeCommand(`touch ${MEMORY_FILE}`);
    if (result.exitCode !== 0) throw new Error('Could not initialize bot memory.');
    return sandbox.id;
  } catch {
    reportOperation(`bot-sandbox-${stage}`);
    try { await api.delete(sandbox); }
    catch { console.error('Sandbox cleanup required', { sandboxId: sandbox.id, operation: 'initialize' }); }
    throw new BotProvisioningError(stage);
  }
}
async function getBotSandboxInternal(sandboxId: string, signal?: AbortSignal) {
  const sandbox = await getDaytona().get(sandboxId);
  if (sandbox.labels?.project !== 'openmods' || sandbox.labels?.environment !== sandboxEnvironment()) {
    throw new Error('Sandbox is not available in this environment.');
  }
  signal?.throwIfAborted();
  if (sandbox.state !== 'started') await sandbox.start();
  return sandbox;
}
async function deleteBotSandboxInternal(sandboxId: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const api = getDaytona();
      const sandbox = await api.get(sandboxId);
      if (sandbox.labels?.project !== 'openmods' || sandbox.labels?.environment !== sandboxEnvironment()) throw new Error('Sandbox environment mismatch.');
      await api.delete(sandbox);
      return;
    } catch (error) {
      if (error instanceof DaytonaNotFoundError) return;
      if (!(error instanceof DaytonaConflictError) || attempt === 9) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
async function getBotDesktopConnectionInternal(sandboxId: string) {
  const sandbox = await getBotSandbox(sandboxId);
  if ((await sandbox.computerUse.getStatus()).status !== 'active') await sandbox.computerUse.start();
  const preview = await sandbox.getSignedPreviewUrl(6080, 3600);
  return { url: desktopWebSocketUrl(preview.url), expiresAt: Date.now() + 3600000 };
}

export const createBotSandbox = (botId: string) => privateOperation(() => createBotSandboxInternal(botId));
export const getBotSandbox = (sandboxId: string, signal?: AbortSignal) => privateOperation(() => getBotSandboxInternal(sandboxId, signal));
export const deleteBotSandbox = (sandboxId: string) => privateOperation(() => deleteBotSandboxInternal(sandboxId));
export const getBotDesktopConnection = (sandboxId: string) => privateOperation(() => getBotDesktopConnectionInternal(sandboxId));
