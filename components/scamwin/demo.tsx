"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loading, Notice, PageHead } from "./core";
import { ResultView, type Detail } from "./result";

export function Demo() {
  const [scenario, setScenario] = useState("refund"); const [data, setData] = useState<Detail | null>(null); const [error, setError] = useState(""); const [version, setVersion] = useState(0);
  useEffect(() => { const controller = new AbortController(); fetch(`/api/scamwin/demo?scenario=${scenario}`, { signal: controller.signal, cache: "no-store" }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(value => { setData(value); setError(""); }).catch(e => { if (e.name !== "AbortError") setError("The sample could not be loaded. Try again."); }); return () => controller.abort(); }, [scenario, version]);
  return <><PageHead eyebrow="An offer, unpacked" title="See how a check comes together." description="Explore a refund request, a comparison offer or a limited-evidence result. Every record here is synthetic." /><div className="sw-demo-banner"><div><strong>Read-only demonstration</strong><p>No website was visited. These examples don’t assess a real person or business.</p></div><Link href="/check" className="sw-text-link">Check your own offer <ArrowRight size={14} /></Link></div><div className="sw-scenario-buttons" aria-label="Choose sample">{[{ id: "refund", label: "Refund / payment mismatch" }, { id: "legitimate", label: "Comparison offer" }, { id: "limited", label: "Missing evidence" }].map(item => <button key={item.id} aria-pressed={scenario === item.id} onClick={() => { setData(null); setScenario(item.id); }}>{item.label}</button>)}</div>{error ? <Notice title="Sample unavailable" error>{error}<Button className="sw-btn sw-btn-outline" onClick={() => setVersion(v => v + 1)}>Try again</Button></Notice> : data ? <ResultView data={data} demo /> : <Loading label="Opening synthetic evidence…" />}</>;
}
