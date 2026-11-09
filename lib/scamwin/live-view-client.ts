import type { LiveViewResponse } from "./live-view-contracts";

export type LiveViewIdentity = { checkId: string; runId: string; generation: number };
export type LiveViewSnapshot = { response: LiveViewResponse | null; error: string };
export type LivePanelState = LiveViewResponse["state"] | "interrupted";
const terminal = (value: LiveViewResponse | null) => !!value && ["ended", "unavailable", "expired"].includes(value.state);
export const liveRunKey = (value: LiveViewIdentity) => JSON.stringify([value.checkId, value.runId, value.generation]);
export function acceptLiveViewResponse(identity: LiveViewIdentity, current: LiveViewResponse | null, incoming: LiveViewResponse): LiveViewResponse | null {
  if (incoming.runId !== identity.runId || incoming.generation !== identity.generation || terminal(current)) return current;
  if (current && "viewerUrl" in current) {
    if (incoming.state === "starting") return current;
    if ("viewerUrl" in incoming) {
      if (incoming.sessionId !== current.sessionId || Date.parse(incoming.issuedAt) < Date.parse(current.issuedAt)) return current;
      if (incoming.state === "ready" && current.state === "live") return current;
      if (incoming.state === current.state && incoming.viewerUrl !== current.viewerUrl) return current;
      return { ...incoming, viewerUrl: current.viewerUrl, expiresAt: current.expiresAt };
    }
  }
  return incoming;
}
export function livePanelState(options: { active: boolean; demo?: boolean; response: LiveViewResponse | null; error: string; unavailable?: boolean }): LivePanelState {
  if (options.demo || options.unavailable) return "unavailable";
  if (!options.active) return "ended";
  if (options.error) return "interrupted";
  return options.response?.state ?? "starting";
}
export type LiveDisclosure = { runKey: string; open: boolean; chosen: boolean };
export function disclosureForRun(previous: LiveDisclosure | null, runKey: string, autoOpen: boolean): LiveDisclosure {
  if (!previous || previous.runKey !== runKey) return { runKey, open: autoOpen, chosen: false };
  return !previous.chosen && autoOpen && !previous.open ? { ...previous, open: true } : previous;
}

function parseResponse(value: unknown): LiveViewResponse {
  if (!value || typeof value !== "object") throw new Error("invalid_response");
  const row = value as Record<string, unknown>;
  if (typeof row.runId !== "string" || row.runId.length > 120 || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1) throw new Error("invalid_response");
  const identity = { runId: row.runId, generation: Number(row.generation) };
  if (["starting", "ended", "unavailable", "expired"].includes(String(row.state))) return { ...identity, state: row.state as "starting" | "ended" | "unavailable" | "expired" };
  if (!["ready", "live"].includes(String(row.state)) || typeof row.sessionId !== "string" || !row.sessionId || row.sessionId.length > 120 || typeof row.viewerUrl !== "string" || row.viewerUrl.length > 16384 || typeof row.issuedAt !== "string" || !Number.isFinite(Date.parse(row.issuedAt)) || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))) throw new Error("invalid_response");
  const url = new URL(row.viewerUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("invalid_response");
  return { ...identity, state: row.state as "ready" | "live", sessionId: row.sessionId, viewerUrl: row.viewerUrl, issuedAt: row.issuedAt, expiresAt: row.expiresAt };
}
export async function requestOwnedLiveView(identity: LiveViewIdentity, signal: AbortSignal): Promise<LiveViewResponse> {
  const response = await fetch(`/api/scamwin/checks/${encodeURIComponent(identity.checkId)}/live-view`, {
    signal, credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "X-Scamwin-Run-Id": identity.runId, "X-Scamwin-Generation": String(identity.generation) },
  });
  if ([401, 403, 404].includes(response.status)) return { state: "unavailable", runId: identity.runId, generation: identity.generation };
  if (response.status === 409) return { state: "ended", runId: identity.runId, generation: identity.generation };
  if (!response.ok) throw new Error("live_view_unavailable");
  return parseResponse(await response.json());
}
type ClientOptions = {
  request?: (identity: LiveViewIdentity, signal: AbortSignal) => Promise<LiveViewResponse>;
  isVisible: () => boolean; publish: (snapshot: LiveViewSnapshot) => void; now?: () => number;
  schedule?: (callback: () => void, delay: number) => unknown; cancel?: (handle: unknown) => void;
};
/** One owner request at a time, independent of React render/visibility churn. */
export class LiveViewClient {
  private snapshot: LiveViewSnapshot = { response: null, error: "" };
  private disposed = false;
  private inFlight = false;
  private sequence = 0;
  private timer: unknown;
  private timeout?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private preparationDeadline: number;
  private schedule: NonNullable<ClientOptions["schedule"]>;
  private cancel: NonNullable<ClientOptions["cancel"]>;
  constructor(private identity: LiveViewIdentity, private options: ClientOptions) {
    this.preparationDeadline = (options.now?.() ?? Date.now()) + 60000;
    this.schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancel = options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }
  start() { void this.poll(); }
  private clearTimer() { if (this.timer !== undefined) { this.cancel(this.timer); this.timer = undefined; } }
  visibilityChanged() { if (!this.disposed && !this.inFlight && !terminal(this.snapshot.response)) { this.clearTimer(); void this.poll(); } }
  reconnect() { this.visibilityChanged(); }
  dispose() { this.disposed = true; this.sequence++; this.clearTimer(); clearTimeout(this.timeout); this.abort?.abort(); }
  private expired() {
    const response = this.snapshot.response;
    if ((!response || response.state === "starting") && (this.options.now?.() ?? Date.now()) >= this.preparationDeadline) {
      this.snapshot = { response: { state: "unavailable", runId: this.identity.runId, generation: this.identity.generation, reasonCode: "viewer_not_available" }, error: "" };
      this.options.publish(this.snapshot); return true;
    }
    if (response && "expiresAt" in response && Date.parse(response.expiresAt) <= (this.options.now?.() ?? Date.now())) {
      this.snapshot = { response: { state: "expired", runId: this.identity.runId, generation: this.identity.generation }, error: "" };
      this.options.publish(this.snapshot); return true;
    }
    return false;
  }
  private async poll() {
    if (this.disposed || this.inFlight || terminal(this.snapshot.response) || this.expired()) return;
    // Preparing a viewer is visible-page work; a hidden page does not acquire it.
    if (!this.options.isVisible() && (!this.snapshot.response || this.snapshot.response.state === 'starting')) {
      this.clearTimer();
      this.timer = this.schedule(() => { void this.poll(); }, 10000);
      return;
    }
    this.clearTimer(); this.inFlight = true;
    const sequence = ++this.sequence, abort = new AbortController(); this.abort = abort;
    const current = this.snapshot.response, now = this.options.now?.() ?? Date.now();
    const timeoutMs = current && "expiresAt" in current ? Math.min(8000, Math.max(1, Date.parse(current.expiresAt) - now)) : 8000;
    try {
      const timeout = new Promise<never>((_resolve, reject) => { this.timeout = setTimeout(() => { abort.abort(); reject(new Error("request_timeout")); }, timeoutMs); });
      const incoming = await Promise.race([(this.options.request ?? requestOwnedLiveView)(this.identity, abort.signal), timeout]);
      if (this.disposed || sequence !== this.sequence || this.expired()) return;
      const response = acceptLiveViewResponse(this.identity, this.snapshot.response, incoming);
      if (response) { this.snapshot = { response, error: "" }; this.options.publish(this.snapshot); }
    } catch {
      if (!this.disposed && sequence === this.sequence && !this.expired()) {
        this.snapshot = { ...this.snapshot, error: "The live view was interrupted. Saved evidence remains available." };
        this.options.publish(this.snapshot);
      }
    } finally {
      clearTimeout(this.timeout); this.inFlight = false;
      if (!this.disposed && sequence === this.sequence && !terminal(this.snapshot.response)) {
        let delay = this.options.isVisible() ? (!this.snapshot.response || this.snapshot.response.state === 'starting' ? 1000 : 2000) : 10000;
        const response = this.snapshot.response;
        if (response && "expiresAt" in response) delay = Math.min(delay, Math.max(0, Date.parse(response.expiresAt) - (this.options.now?.() ?? Date.now())));
        this.timer = this.schedule(() => { void this.poll(); }, delay);
      }
    }
  }
}
