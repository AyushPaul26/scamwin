export interface SchedulerEnv {
  SCAMWIN_CONNECTOR_SCHEDULER_ENABLED?: string;
  SCAMWIN_CONNECTOR_APP_ORIGIN?: string;
  SCAMWIN_CONNECTOR_DISPATCH_SECRET?: string;
}

export interface SchedulerDependencies {
  fetch: typeof fetch;
  now: () => number;
  randomUUID: () => string;
  setTimeout: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout: (token: unknown) => void;
}

export type StageResult = { status: 'ok'; httpStatus: number } | {
  status: 'failed';
  reason: 'timeout' | 'transport_error' | 'http_error' | 'response_too_large';
  httpStatus?: number;
};
export type ScheduleResult = { status: 'disabled' | 'invalid_configuration' } | {
  status: 'completed'; tick: StageResult; drain: StageResult;
};

const RESPONSE_LIMIT = 8 * 1024;
const DEADLINE_MS = { tick: 60_000, drain: 305_000 } as const;
type Action = keyof typeof DEADLINE_MS;

function appOrigin(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    // Compare the original too: URL parsing silently trims whitespace, normalizes
    // numeric IPs, removes default ports and permits empty query/hash markers.
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.pathname !== '/' || url.search || url.hash
      || (value !== url.origin && value !== `${url.origin}/`)) return;
    const host = url.hostname;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|home|home\.arpa|lan|test|invalid|example|onion)$/.test(host)) return;
    return url.origin;
  } catch { return; }
}

class StageFailure extends Error {
  constructor(readonly reason: 'timeout' | 'response_too_large') { super(reason); }
}

async function dispatch(
  action: Action, origin: string, key: CryptoKey, dependencies: SchedulerDependencies,
): Promise<StageResult> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bodyComplete = false;
  let timer: unknown;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = dependencies.setTimeout(() => {
        reject(new StageFailure('timeout'));
        controller.abort();
      }, DEADLINE_MS[action]);
    });
    const operation = (async (): Promise<StageResult> => {
      const body = JSON.stringify({ version: 1, action, deliveryId: dependencies.randomUUID() });
      const timestamp = Math.trunc(dependencies.now()).toString();
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}\n${body}`)));
      const signature = `${timestamp}.${Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      if (controller.signal.aborted) throw new StageFailure('timeout');
      const response = await dependencies.fetch(`${origin}/api/scamwin/connectors/${action}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Scamwin-Dispatch-Signature': signature },
        body,
      });
      if (controller.signal.aborted) {
        // A transport that resolves after abort must not leave its body open.
        void response.body?.cancel().catch(() => {});
        throw new StageFailure('timeout');
      }
      reader = response.body?.getReader();
      const advertised = response.headers.get('Content-Length');
      if (advertised && Number(advertised) > RESPONSE_LIMIT) throw new StageFailure('response_too_large');
      let received = 0;
      if (reader) {
        while (true) {
          if (controller.signal.aborted) throw new StageFailure('timeout');
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value.byteLength;
          if (received > RESPONSE_LIMIT) throw new StageFailure('response_too_large');
        }
      }
      bodyComplete = true;
      return response.ok ? { status: 'ok', httpStatus: response.status }
        : { status: 'failed', reason: 'http_error', httpStatus: response.status };
    })();
    return await Promise.race([operation, deadline]);
  } catch (error) {
    return { status: 'failed', reason: error instanceof StageFailure ? error.reason : 'transport_error' };
  } finally {
    dependencies.clearTimeout(timer);
    if (!bodyComplete) {
      controller.abort();
      // Cancellation is cleanup, not background processing. Do not await a
      // potentially stalled upstream cancel handshake past the stage deadline.
      void reader?.cancel().catch(() => {});
    } else {
      reader?.releaseLock();
    }
  }
}

export async function runConnectorSchedule(
  env: SchedulerEnv,
  overrides: Partial<SchedulerDependencies> = {},
): Promise<ScheduleResult> {
  if (env.SCAMWIN_CONNECTOR_SCHEDULER_ENABLED !== 'true') return { status: 'disabled' };
  const origin = appOrigin(env.SCAMWIN_CONNECTOR_APP_ORIGIN);
  const secret = env.SCAMWIN_CONNECTOR_DISPATCH_SECRET;
  if (!origin || !secret || Array.from(secret).length < 32) return { status: 'invalid_configuration' };
  const dependencies: SchedulerDependencies = {
    fetch: (...args) => fetch(...args), now: () => Date.now(), randomUUID: () => crypto.randomUUID(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (token) => clearTimeout(token as ReturnType<typeof setTimeout>),
    ...overrides,
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const tick = await dispatch('tick', origin, key, dependencies);
  // Existing durable jobs must be drainable even while provider sync is broken.
  const drain = await dispatch('drain', origin, key, dependencies);
  return { status: 'completed', tick, drain };
}

const worker = {
  async scheduled(_controller: unknown, env: SchedulerEnv): Promise<ScheduleResult> {
    return runConnectorSchedule(env);
  },
};

export default worker;
