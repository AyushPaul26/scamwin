"use client";

import { useEffect, useId, useState } from "react";
import { CheckCircle2, Circle, CircleMinus, LoaderCircle, XCircle } from "lucide-react";
import type { CheckStage } from "@/lib/scamwin/contracts";
import { dateLabel } from "./core";

const stagesInOrder = ["intake", "browser", "trust", "registry", "comparison", "assessment"];
const statuses: Record<CheckStage["status"], string> = { pending: "Waiting", running: "In progress", completed: "Completed", unavailable: "Unavailable", blocked: "Blocked", skipped: "Skipped", canceled: "Canceled" };
const details: Record<string, string> = {
  load_client: "Preparing the browser", connect_browser: "Connecting to the browser", create_context: "Preparing a private page",
  configure_routes: "Applying collection limits", navigate: "Opening the website", read_page: "Reading the page", capture: "Capturing the page",
};
function duration(start: string, end: string | number) {
  const elapsed = Math.max(0, Math.floor(((typeof end === "number" ? end : Date.parse(end)) - Date.parse(start)) / 1000));
  return Number.isFinite(elapsed) ? elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s` : "Time unavailable";
}
export type InvestigationProgressProps = { stages: CheckStage[]; createdAt: string; finishedAt?: string };
export function InvestigationProgress({ stages, createdAt, finishedAt }: InvestigationProgressProps) {
  const titleId = useId();
  const running = !finishedAt && stages.some(stage => stage.status === "running" || stage.status === "pending");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const update = () => setNow(Date.now()); update();
    const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [running]);
  const ordered = [...stages].sort((a, b) => {
    const left = stagesInOrder.indexOf(a.id), right = stagesInOrder.indexOf(b.id);
    return (left < 0 ? stagesInOrder.length : left) - (right < 0 ? stagesInOrder.length : right);
  });
  const start = ordered.find(stage => stage.startedAt)?.startedAt;
  const end = finishedAt || (!stages.some(stage => stage.status === "pending" || stage.status === "running") ? stages.map(stage => stage.finishedAt).filter((time): time is string => !!time).sort().at(-1) : undefined);
  return <section className="sw-panel sw-investigation-progress" aria-labelledby={titleId}>
    <div className="sw-progress-header"><h2 id={titleId}>Investigation progress</h2><p className="sw-progress-timer">{start ? "Investigation time" : "Since submission"}<span>{end ? duration(start || createdAt, end) : now ? duration(start || createdAt, now) : "Time recorded below"}</span></p></div>
    <ol className="sw-progress-list">{ordered.map(stage => {
      const Icon = stage.status === "completed" ? CheckCircle2 : stage.status === "running" ? LoaderCircle : ["unavailable", "blocked", "canceled"].includes(stage.status) ? XCircle : stage.status === "skipped" ? CircleMinus : Circle;
      return <li className="sw-progress-stage" data-stage={stage.id} data-status={stage.status} key={stage.id}>
        <Icon size={17} className={stage.status === "running" ? "sw-spin" : undefined} aria-hidden="true" />
        <div className="sw-progress-stage-content"><div className="sw-progress-stage-heading"><h3>{stage.label}</h3><span className={`sw-badge sw-badge-${stage.status}`}>{statuses[stage.status]}</span></div>
          {stage.detailCode && details[stage.detailCode] && <p className="sw-progress-detail">{details[stage.detailCode]}</p>}
          {stage.startedAt && <p className="sw-progress-time"><time dateTime={stage.startedAt}>{dateLabel(stage.startedAt)}</time>{stage.finishedAt && <> · {duration(stage.startedAt, stage.finishedAt)}<span className="sr-only"> · Finished <time dateTime={stage.finishedAt}>{dateLabel(stage.finishedAt)}</time></span></>}</p>}
        </div>
      </li>;
    })}</ol>
  </section>;
}
