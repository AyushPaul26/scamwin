/** Browser-safe transport types. Locators are confined to the private owner response. */
export type LiveViewScope = { ownerId: string; checkId: string; runId: string; generation: number };
export type LiveViewStatus = "ready" | "connected" | "ended" | "unavailable";
export type LiveViewRecord = {
  sessionId: string; scope: LiveViewScope; status: LiveViewStatus; encryptedLocator: string | null;
  createdAt: string; expiresAt: string; connectedAt?: string; endedAt?: string; reasonCode?: string;
};
export type LiveViewPatch = { status: "connected"; connectedAt?: string } | { status: "ended" | "unavailable"; endedAt?: string; reasonCode?: string };
export type LiveViewBinding = { scope: LiveViewScope; sessionId: string; expiresAt: string };
export type LiveViewResponse =
  | { state: "ready" | "live"; sessionId: string; runId: string; generation: number; viewerUrl: string; issuedAt: string; expiresAt: string }
  | { state: "starting" | "ended" | "unavailable" | "expired"; runId: string; generation: number; reasonCode?: string };
export type SanitizedLiveViewStatus = {
  state: LiveViewResponse["state"]; runId: string; generation: number; sessionId?: string;
  createdAt?: string; expiresAt?: string; connectedAt?: string; endedAt?: string; reasonCode?: string;
};
