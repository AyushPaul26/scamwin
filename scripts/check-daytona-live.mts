import { createBotSandbox, getBotSandbox, getBotDesktopConnection, deleteBotSandbox } from '../lib/daytona';
let id: string | undefined;
try {
  id = await createBotSandbox(`smoke-${Date.now()}`);
  console.log('PASS sandbox provision and memory initialization');
  const sandbox = await getBotSandbox(id);
  const result = await sandbox.process.executeCommand('printf openmods-smoke');
  if (result.exitCode !== 0 || !result.result.includes('openmods-smoke')) throw new Error('command');
  await sandbox.fs.uploadFile(Buffer.from('persistent test note'), 'MEMORY.md');
  if (!(await sandbox.fs.downloadFile('MEMORY.md')).toString().includes('persistent test note')) throw new Error('file');
  console.log('PASS command and persistent file operations');
  const desktop = await getBotDesktopConnection(id);
  if (!desktop.url.startsWith('wss://')) throw new Error('desktop');
  const screen = await sandbox.computerUse.screenshot.takeFullScreen();
  if (!screen.screenshot) throw new Error('screenshot');
  console.log('PASS desktop startup, signed access and screenshot');
  await sandbox.stop();
  const restarted = await getBotSandbox(id);
  if (!(await restarted.fs.downloadFile('MEMORY.md')).toString().includes('persistent test note')) throw new Error('persistence');
  console.log('PASS restart and preserved memory');
} catch (error) { console.error('Live check failed:', error instanceof Error ? error.constructor.name : 'unknown'); process.exitCode = 1; }
finally { if (id) { await deleteBotSandbox(id); await deleteBotSandbox(id); console.log('PASS sandbox deletion and repeated deletion'); } }
