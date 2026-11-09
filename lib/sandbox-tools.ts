import { createWebTools } from './web-tools';
import { privateOperation } from './private-operation';
import { reportToolOutcome } from './monitoring';
import { tool, type InferUITools, type UIMessage, type ToolSet, type UIDataTypes } from 'ai';
import { z } from 'zod';
import { getBotSandbox, MEMORY_FILE } from './daytona';
import type { Sandbox } from '@daytona/sdk';
export type BotIdentity = { id: string; name: string; avatar: string };
export type ChatMetadata = { recipient?: BotIdentity; author?: BotIdentity; recipientId?: string };
const truncate = (text: string) => text.length > 20000 ? `${text.slice(0, 20000)}\n[Output truncated]` : text;
const point = { x: z.number().int().min(0), y: z.number().int().min(0) };
export function createSandboxTools(resolve: () => Promise<string>) {
  async function sandbox(signal?: AbortSignal, desktop = false): Promise<Sandbox> {
    signal?.throwIfAborted();
    const id = await resolve();
    signal?.throwIfAborted();
    const instance = await getBotSandbox(id, signal);
    signal?.throwIfAborted();
    if (desktop) {
      const status = await instance.computerUse.getStatus();
      signal?.throwIfAborted();
      if (status.status !== 'active') await instance.computerUse.start();
    }
    signal?.throwIfAborted();
    return instance;
  }
  async function screenshot(signal?: AbortSignal) {
    const instance = await sandbox(signal, true);
    for (const quality of [70, 45, 25]) {
      signal?.throwIfAborted();
      const shot = await instance.computerUse.screenshot.takeCompressed({ format: 'jpeg', quality, showCursor: true });
      if (shot.screenshot && shot.screenshot.length < 350000) {
        signal?.throwIfAborted();
        const display = await instance.computerUse.display.getInfo();
        return { base64: shot.screenshot, mediaType: 'image/jpeg' as const, width: display.displays?.[0]?.width, height: display.displays?.[0]?.height };
      }
    }
    throw new Error('Screenshot is too large. Reduce desktop resolution and retry.');
  }
  const imageOutput = ({ output }: { output: Awaited<ReturnType<typeof screenshot>> }) => ({ type: 'content' as const, value: [
    { type: 'text' as const, text: `Desktop ${output.width}×${output.height}; coordinates start at top left.` },
    { type: 'file' as const, mediaType: output.mediaType, data: { type: 'data' as const, data: output.base64 } },
  ] });
  return {
    ...createWebTools(resolve),
    bash: tool({ description: 'Run a shell command in your isolated computer. Each call starts a fresh shell.', inputSchema: z.object({ command: z.string().min(1).max(20000), cwd: z.string().optional(), timeout: z.number().int().min(1).max(600).default(60) }), execute: async ({ command, cwd, timeout }, { abortSignal }) => {
      const result = await (await sandbox(abortSignal)).process.executeCommand(command, cwd?.replace(/^~(\/|$)/, '') || undefined, undefined, timeout);
      return { exitCode: result.exitCode, output: truncate(result.result) };
    } }),
    readFile: tool({ description: 'Read a text file on your computer.', inputSchema: z.object({ path: z.string().min(1).max(4096) }), execute: async ({ path }, { abortSignal }) => ({ content: truncate((await (await sandbox(abortSignal)).fs.downloadFile(path)).toString('utf8')) }) }),
    writeFile: tool({ description: 'Write a text file on your computer.', inputSchema: z.object({ path: z.string().min(1).max(4096), content: z.string().max(100000) }), execute: async ({ path, content }, { abortSignal }) => {
      const instance = await sandbox(abortSignal);
      const parent = path.slice(0, path.lastIndexOf('/'));
      if (parent) await instance.fs.createFolder(parent, '755');
      abortSignal?.throwIfAborted();
      await resolve();
      abortSignal?.throwIfAborted();
      await instance.fs.uploadFile(Buffer.from(content), path); return { path, bytes: Buffer.byteLength(content) };
    } }),
    listFiles: tool({ description: 'List files in a directory on your computer.', inputSchema: z.object({ path: z.string().max(4096).default('.') }), execute: async ({ path }, { abortSignal }) => {
      const files = await (await sandbox(abortSignal)).fs.listFiles(path); return { files: files.slice(0, 200).map(({ name, isDir, size }) => ({ name, isDir, size })), truncated: files.length > 200 };
    } }),
    recall: tool({ description: 'Recall your saved memory across conversations. Use before answering about past decisions or user preferences.', inputSchema: z.object({}), execute: async (_, { abortSignal }) => ({ memory: truncate((await (await sandbox(abortSignal)).fs.downloadFile(MEMORY_FILE)).toString('utf8')) }) }),
    remember: tool({ description: 'Save a useful note for future conversations. Explicit requests to remember require this tool.', inputSchema: z.object({ note: z.string().trim().min(1).max(12000) }), execute: async ({ note }, { abortSignal }) => {
      const encoded = Buffer.from(`- ${note}\n`).toString('base64');
      const response = await (await sandbox(abortSignal)).process.executeCommand(`printf '%s' '${encoded}' | base64 -d >> ${MEMORY_FILE}`);
      if (response.exitCode !== 0) throw new Error('Could not save memory.'); return { remembered: true };
    } }),
    mouseClick: tool({ description: 'Click desktop coordinates after viewing the screen.', inputSchema: z.object({ ...point, button: z.enum(['left', 'right', 'middle']).default('left'), double: z.boolean().default(false) }), execute: async ({ x, y, button, double }, { abortSignal }) => { await (await sandbox(abortSignal, true)).computerUse.mouse.click(x, y, button, double); return { x, y }; } }),
    mouseMove: tool({ description: 'Move the mouse.', inputSchema: z.object(point), execute: async ({ x, y }, { abortSignal }) => { await (await sandbox(abortSignal, true)).computerUse.mouse.move(x, y); return { x, y }; } }),
    mouseDrag: tool({ description: 'Drag between desktop coordinates.', inputSchema: z.object({ startX: point.x, startY: point.y, endX: point.x, endY: point.y }), execute: async ({ startX, startY, endX, endY }, { abortSignal }) => { await (await sandbox(abortSignal, true)).computerUse.mouse.drag(startX, startY, endX, endY); return { x: endX, y: endY }; } }),
    mouseScroll: tool({ description: 'Scroll the desktop.', inputSchema: z.object({ ...point, direction: z.enum(['up', 'down']), amount: z.number().int().min(1).max(50).default(3) }), execute: async ({ x, y, direction, amount }, { abortSignal }) => { await (await sandbox(abortSignal, true)).computerUse.mouse.scroll(x, y, direction, amount); return { scrolled: true }; } }),
    keyboardType: tool({ description: 'Type into the focused application.', inputSchema: z.object({ text: z.string().max(20000) }), execute: async ({ text }, { abortSignal }) => { await (await sandbox(abortSignal, true)).computerUse.keyboard.type(text); return { typed: text.length }; } }),
    keyboardPress: tool({ description: 'Press a key with optional modifiers.', inputSchema: z.object({ key: z.string().min(1).max(40), modifiers: z.array(z.enum(['ctrl', 'alt', 'shift', 'cmd'])).max(4).default([]) }), execute: async ({ key, modifiers }, { abortSignal }) => { await (await sandbox(abortSignal, true)).computerUse.keyboard.press(key, modifiers); return { pressed: key }; } }),
    viewScreen: tool<Record<string, never>, Awaited<ReturnType<typeof screenshot>>, Record<string, unknown>>({ description: 'Inspect your desktop privately before and after GUI actions.', inputSchema: z.object({}), execute: async (_, { abortSignal }) => screenshot(abortSignal), toModelOutput: imageOutput }),
    showScreen: tool<Record<string, never>, Awaited<ReturnType<typeof screenshot>>, Record<string, unknown>>({ description: 'Show a screenshot to the user when requested.', inputSchema: z.object({}), execute: async (_, { abortSignal }) => screenshot(abortSignal), toModelOutput: imageOutput }),
  };
}
export function createHandoffTool(change: (id: string) => Promise<BotIdentity>) {
  return tool({ description: 'Pass this turn to a teammate whose role is better suited. Stop speaking after handing off.', inputSchema: z.object({ botId: z.string().min(1).max(128), note: z.string().min(1).max(2000) }), execute: async ({ botId }, { abortSignal }) => { abortSignal?.throwIfAborted(); return change(botId); } });
}
export type ChatTools = ReturnType<typeof createSandboxTools> & { handoff?: ReturnType<typeof createHandoffTool> };
export type ChatUIMessage = UIMessage<ChatMetadata, UIDataTypes, InferUITools<ReturnType<typeof createSandboxTools> & { handoff: ReturnType<typeof createHandoffTool> }>>;

// Providers may still emit multiple calls in one step. Serialize effects even then.
export function sequentialTools<T extends ToolSet>(tools: T): T {
  let tail: Promise<unknown> = Promise.resolve();
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute;
    if (!execute) return [name, definition];
    return [name, { ...definition, execute: (input: unknown, options: Parameters<NonNullable<typeof execute>>[1]) => {
      const result = tail.then(async () => {
        options.abortSignal?.throwIfAborted();
        const started = Date.now();
        try { const output = await privateOperation(() => execute(input, options)); reportToolOutcome(name, Date.now() - started, 'completed'); return output; }
        catch { reportToolOutcome(name, Date.now() - started, options.abortSignal?.aborted ? 'interrupted' : 'failed'); throw new Error(options.abortSignal?.aborted ? 'Tool interrupted.' : 'Tool failed. Check the inputs and try again.'); }
      });
      tail = result.catch(() => undefined);
      return result;
    } }];
  })) as T;
}
