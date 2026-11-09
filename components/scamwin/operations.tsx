"use client";
import { useEffect, useState, useTransition } from "react";
import { setOperationalPauseAction } from "@/app/scamwin/actions";
import { Button } from "@/components/ui/button";
import { Badge, Gate, Loading, Notice, PageHead, Readiness, dateLabel, useBootstrap } from "./core";

type OperationState = { investigationPaused: boolean; publicationPaused: boolean; updatedAt?: string };

export function Operations() {
  const { data } = useBootstrap();
  return <>
    <PageHead eyebrow="Admin workspace" title="A clear view of availability." description="Configured service readiness and the boundaries of this demonstration." />
    <Gate role="admin">{data && <>
      <PauseControls />
      <section className="sw-panel sw-section"><h2>Online services</h2><p>Readiness reflects configured dependencies. Provider quota and runtime errors remain authoritative for each check.</p><Readiness data={data} /></section>
      <div className="sw-account-grid" style={{ marginTop: 25 }}>
        <section className="sw-panel sw-section"><h2>Collection boundary</h2><p>Live browser collection is restricted to operator-owned demonstration origins. Unsupported websites receive URL, message and reviewed-warning analysis with live technical facts marked not checked.</p><p>Private input is never sent to a paid fallback. Free-tier exhaustion pauses the affected module.</p></section>
        <section className="sw-panel sw-section"><h2>Data lifecycle</h2><p>Private checks expire after 30 days. Image artifacts expire after 7 days. Owner-authorized reads exclude deleted or expired content.</p><p>Public warning history is separate from private evidence deletion. Publication status must come from an actual registry observation.</p></section>
      </div>
      <section className="sw-panel sw-section"><h2>Application admission limits</h2><p>These are demonstration caps, not guaranteed provider entitlements.</p><code className="sw-code" style={{ marginTop: 20 }}>{JSON.stringify(data.limits || { availability: "Limits are not supplied by the server." }, null, 2)}</code></section>
    </>}</Gate>
  </>;
}

function PauseControls() {
  const [state, setState] = useState<OperationState | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [version, setVersion] = useState(0);
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/scamwin/operations", { cache: "no-store", signal: controller.signal }).then(async response => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Operational state could not be loaded.");
      if (typeof payload.state?.investigationPaused !== "boolean" || typeof payload.state?.publicationPaused !== "boolean") throw new Error("Operational state could not be confirmed.");
      setState(payload.state); setError("");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Operational state could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);

  function reload() { setLoading(true); setFeedback(""); setVersion(value => value + 1); }
  function update(scope: "investigation" | "publication", paused: boolean) {
    start(async () => {
      setFeedback("");
      try {
        const result = await setOperationalPauseAction(scope, paused);
        if (!result.ok) { setError(result.error); return; }
        setState(result.data.state); setError("");
        setFeedback(scope === "investigation" ? paused ? "New checks are paused. Ongoing runs can finish." : "New checks can start again, subject to service availability and quotas." : paused ? "New warning signatures are paused. Already signed transactions still reconcile." : "New warning signatures can resume, subject to publisher availability.");
      } catch { setError("The update could not be confirmed. Reload operational state before trying again."); }
    });
  }

  return <section aria-label="Operational pause controls">
    {error && <Notice title="Operational state needs attention" error>{error} <Button className="sw-btn sw-btn-outline" disabled={loading || pending} onClick={reload}>Reload operational state</Button></Notice>}
    {loading ? <Loading label="Loading operational controls..." /> : state && <>
      <div className="sw-account-grid">
        <section className="sw-panel sw-section" style={{ marginTop: 0 }}>
          <div className="sw-section-head"><h2>New checks</h2><Badge value={state.investigationPaused ? "paused" : "accepting"} /></div>
          <p>Pausing prevents new investigation starts. Ongoing runs can finish, and saved results remain readable.</p>
          <Button className="sw-btn sw-btn-outline" style={{ marginTop: 22, width: "100%" }} disabled={pending || !!error} aria-busy={pending} onClick={() => update("investigation", !state.investigationPaused)}>{state.investigationPaused ? "Resume new checks" : "Pause new checks"}</Button>
        </section>
        <section className="sw-panel sw-section" style={{ marginTop: 0 }}>
          <div className="sw-section-head"><h2>Warning signatures</h2><Badge value={state.publicationPaused ? "paused" : "accepting"} /></div>
          <p>Pausing prevents new warning transaction signatures. Already signed transactions still reconcile, and registry reads continue.</p>
          <Button className="sw-btn sw-btn-outline" style={{ marginTop: 22, width: "100%" }} disabled={pending || !!error} aria-busy={pending} onClick={() => update("publication", !state.publicationPaused)}>{state.publicationPaused ? "Resume new warning signatures" : "Pause new warning signatures"}</Button>
        </section>
      </div>
      <p className="sw-small-copy" style={{ marginTop: 13 }}>{state.updatedAt ? `Operational state updated ${dateLabel(state.updatedAt)}` : "Authoritative operational state loaded from the server."}</p>
    </>}
    <p role="status" className="sw-small-copy" style={{ minHeight: 22, marginTop: 10 }}>{pending ? "Saving operational state..." : feedback}</p>
  </section>;
}
