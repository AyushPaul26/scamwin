"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, Eye, LoaderCircle, Monitor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dateLabel } from "./core";
import { useScamwinLiveView } from "@/hooks/use-scamwin-live-view";
import { disclosureForRun, livePanelState, liveRunKey, type LiveDisclosure, type LivePanelState } from "@/lib/scamwin/live-view-client";
import type { CheckStage } from "@/lib/scamwin/contracts";
import type { LiveViewResponse, SanitizedLiveViewStatus } from "@/lib/scamwin/live-view-contracts";

export type LiveCapture = { url: string; observedAt: string; expiresAt?: string };
export type LiveInspectionProps = {
  checkId: string; runId: string; generation: number; browserStage?: CheckStage;
  liveStatus?: SanitizedLiveViewStatus; capture?: LiveCapture; demo?: boolean; hostname?: string;
  onCancel?: () => void; cancelPending?: boolean; cancelRequested?: boolean;
};
const terminalStates = ["ended", "unavailable", "expired"];
function availableCapture(capture: LiveCapture) {
  return /^\/api\/scamwin\/artifacts\/[A-Za-z0-9_-]+$/.test(capture.url) && (!capture.expiresAt || Date.parse(capture.expiresAt) > Date.now());
}
const descriptions: Record<LivePanelState, { title: string; text: string }> = {
  starting: { title: "Preparing the website view", text: "The live view will appear here while this website is being inspected." },
  ready: { title: "Connecting to the live view", text: "The website is being inspected. The provider has not reported a connected viewer yet." },
  live: { title: "Live website inspection", text: "You’re watching the browser collecting this check’s evidence. This view is watch only." },
  interrupted: { title: "Live view interrupted", text: "The stream status could not be refreshed. The investigation can continue collecting evidence." },
  unavailable: { title: "Live view unavailable", text: "This check has no live website view. Any available saved evidence appears below." },
  ended: { title: "Website inspection ended", text: "The browser session has closed. The captured screenshot, when available, is saved evidence." },
  expired: { title: "Live view expired", text: "The temporary viewing session has expired. Any available capture is shown below." },
};

export function LiveInspection(props: LiveInspectionProps) {
  const { checkId, runId, generation, browserStage, liveStatus, demo, cancelRequested } = props;
  const currentStatus = liveStatus?.runId === runId && liveStatus.generation === generation ? liveStatus : undefined;
  const active = !demo && !cancelRequested && browserStage?.status === "running" && !terminalStates.includes(currentStatus?.state ?? "");
  const { response, error, reconnect } = useScamwinLiveView({ checkId, runId, generation, active });
  const runKey = liveRunKey({ checkId, runId, generation });
  const [savedDisclosure, setDisclosure] = useState<LiveDisclosure | null>(null);
  const disclosure = disclosureForRun(savedDisclosure, runKey, active && !terminalStates.includes(response?.state ?? ""));
  if (disclosure !== savedDisclosure) setDisclosure(disclosure);
  let state = livePanelState({ active, demo, response, error, unavailable: browserStage?.status === "unavailable" || browserStage?.status === "blocked" });
  if (!demo && !cancelRequested && !active && browserStage?.status === "pending") state = "starting";
  if (currentStatus && terminalStates.includes(currentStatus.state)) state = currentStatus.state as "ended" | "unavailable" | "expired";
  // Connected is reported by backend Browserless events, never iframe load.
  if (active && response && "viewerUrl" in response && currentStatus?.state === "live" && currentStatus.sessionId === response.sessionId && !error) state = "live";
  return <LiveInspectionView {...props} open={disclosure.open} state={state} response={active ? response : null} error={error} onReconnect={reconnect}
    onToggle={() => setDisclosure({ runKey, open: !disclosure.open, chosen: true })} />;
}

export type LiveInspectionViewProps = Omit<LiveInspectionProps, "browserStage" | "liveStatus"> & {
  open: boolean; state: LivePanelState; response?: LiveViewResponse | null; error?: string;
  onToggle: () => void; onReconnect?: () => void;
};
/** Controlled presentation is shared by the live component and deterministic UI fixtures. */
export function LiveInspectionView(props: LiveInspectionViewProps) {
  const { open, state, response, onToggle, onReconnect, hostname, demo, capture, onCancel, cancelPending, cancelRequested } = props;
  const bodyId = useId(), titleId = useId();
  const [failedCapture, setFailedCapture] = useState<string | null>(null);
  useEffect(() => {
    if (!capture?.expiresAt) return;
    const delay = Date.parse(capture.expiresAt) - Date.now();
    if (!Number.isFinite(delay)) return;
    const timeout = setTimeout(() => setFailedCapture(capture.url), Math.max(0, Math.min(delay, 2147483647)));
    return () => clearTimeout(timeout);
  }, [capture?.url, capture?.expiresAt]);
  const description = descriptions[state];
  const frame = !demo && ["ready", "live", "interrupted"].includes(state) && response && "viewerUrl" in response ? response : null;
  const hasCapture = !demo && terminalStates.includes(state) && capture && availableCapture(capture) && failedCapture !== capture.url;
  return <section className="sw-panel sw-live-inspection" aria-labelledby={titleId} data-live-state={state}>
    <div className="sw-live-header">
      <div className="sw-live-title"><Monitor size={18} aria-hidden="true" /><div><h2 id={titleId}>Website inspection</h2><p>{hostname || "This check’s website"}</p></div></div>
      <div className="sw-live-controls">
        {onCancel && <Button className="sw-btn sw-btn-outline" type="button" onClick={onCancel} disabled={cancelPending || cancelRequested}>{cancelRequested ? "Cancellation requested" : "Cancel check"}</Button>}
        <Button className="sw-btn sw-btn-outline" type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          {open ? "Collapse view" : "Open view"}<ChevronDown size={14} aria-hidden="true" className={open ? "sw-live-chevron-open" : undefined} />
        </Button>
      </div>
    </div>
    <div id={bodyId} className="sw-live-body" hidden={!open}>
      <div className="sw-live-status" role="status"><Eye size={14} aria-hidden="true" /><span>{demo ? "Synthetic sample · no live session" : description.title}</span><span className="sw-live-watch-only">Watch only</span></div>
      <div className="sw-live-viewport">
        {frame ? <iframe key={frame.sessionId} className="sw-live-frame" src={frame.viewerUrl} title={`Watch-only website inspection${hostname ? ` of ${hostname}` : ""}`}
          sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" tabIndex={-1}
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'; usb 'none'"
          style={{ pointerEvents: "none", width: "100%", aspectRatio: "3 / 2", border: 0 }} />
          : hasCapture ? <figure className="sw-live-capture">
            {/* The source is an authenticated owner artifact, never a target-site URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={capture.url} width={1200} height={800} alt={`Captured screenshot${hostname ? ` of ${hostname}` : " from this website inspection"}`} onError={() => setFailedCapture(capture.url)} loading="lazy" />
          </figure>
          : <div className="sw-live-placeholder">{state === "starting" && !demo ? <LoaderCircle className="sw-spin" size={24} aria-hidden="true" /> : <Monitor size={25} aria-hidden="true" />}<strong>{demo ? "This example has no live browser" : description.title}</strong><p>{demo ? "Synthetic examples show how evidence is presented. They do not visit a website." : description.text}</p></div>}
      </div>
      {frame && <p className="sw-live-caption">{description.text} Stream provided by Browserless.</p>}
      {hasCapture && <p className="sw-live-caption">Captured screenshot · <time dateTime={capture.observedAt}>{dateLabel(capture.observedAt)}</time></p>}
      {state === "interrupted" && <div className="sw-live-recovery"><p>{props.error || description.text}</p>{onReconnect && <Button type="button" className="sw-btn sw-btn-outline" onClick={onReconnect}><RefreshCw size={13} aria-hidden="true" />Reconnect view</Button>}</div>}
      {terminalStates.includes(state) && !demo && !hasCapture && <p className="sw-live-caption">No captured screenshot is available. Saved findings and evidence remain below.</p>}
    </div>
  </section>;
}
