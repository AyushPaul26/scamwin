"use client";

import * as React from 'react';
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Assessment, Artifact, Observation } from '@/lib/scamwin/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';

export type EvidenceArtifact = Omit<Artifact, 'dataUrl'> & { url?: string };

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Time unavailable' : new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

export function EvidenceLinks({ evidenceIds, observations }: { evidenceIds: readonly string[]; observations: readonly Observation[] }) {
  const ids = [...new Set(evidenceIds)].filter(id => observations.some(o => o.id === id));
  if (!ids.length) return null;
  return <div className="sw-evidence-links">{ids.map(id => <a key={id} href={`#evidence-${id}`} onClick={() => {
    const detail = document.getElementById(`evidence-${id}`);
    if (detail instanceof HTMLDetailsElement) detail.open = true;
  }}>Evidence {observations.findIndex(o => o.id === id) + 1} <ExternalLink size={9} className="inline" aria-hidden="true" /></a>)}</div>;
}

export function FindingEvidence({ finding, observations }: { finding: Assessment['findings'][number]; observations: readonly Observation[] }) {
  const evidenceIds = [...finding.evidenceIds];
  for (const id of finding.evidenceIds) {
    const interpretation = observations.find(o => o.id === id && o.kind === 'semantic_mismatch');
    const base = interpretation && observations.find(o => o.id === interpretation.data.basedOnEvidenceId
      && o.checkId === interpretation.checkId && o.runId === interpretation.runId);
    if (base) evidenceIds.push(base.id);
  }
  return <li className="sw-finding">
    <p>{finding.statement}</p>
    <span className="sw-small-copy">{finding.classification === 'inference' ? 'Inference from evidence' : 'Observation'}</span>
    <EvidenceLinks evidenceIds={evidenceIds} observations={observations} />
  </li>;
}

function PrivateCapture({ artifact, observation, number }: { artifact: EvidenceArtifact; observation: Observation; number: number }) {
  const expiry = new Date(artifact.expiresAt).valueOf();
  const [expired, setExpired] = useState(() => !Number.isFinite(expiry) || expiry <= Date.now());
  const [failed, setFailed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  useEffect(() => {
    if (expired) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Math.min(expiry - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [expired, expiry]);
  // Only accept the owner endpoint supplied by the authenticated detail response.
  const safeUrl = artifact.url === `/api/scamwin/artifacts/${encodeURIComponent(artifact.id)}` ? artifact.url : undefined;
  if (!safeUrl || expired || failed) return <p className="sw-small-copy">{expired ? 'Captured screenshot expired.' : 'Captured screenshot unavailable.'} The saved evidence remains below.</p>;
  return <figure className="sw-evidence-capture">
    <button type="button" className="sw-evidence-capture-link" onClick={() => setEnlarged(true)} aria-label={`Enlarge captured screenshot, evidence ${number}`}>
      {/* The authenticated, private image endpoint must not pass through an image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={safeUrl} alt={`Captured screenshot of the inspected page, evidence ${number}`} width={1200} height={800} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </button>
    <figcaption>Captured screenshot · {dateLabel(observation.observedAt)} · Private image</figcaption>
    <Dialog open={enlarged} onOpenChange={setEnlarged}><DialogContent className="sw sw-dialog sw-capture-dialog"><DialogTitle>Captured website screenshot</DialogTitle><DialogDescription>Saved {dateLabel(observation.observedAt)}. This is a captured image of the inspected page.</DialogDescription>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={safeUrl} alt={`Enlarged captured screenshot, evidence ${number}`} width={1200} height={800} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      <DialogClose render={<Button className="sw-btn sw-btn-outline" />}>Close image</DialogClose></DialogContent></Dialog>
  </figure>;
}

export function EvidenceRecord({ observation: o, number, artifacts, demo = false }: { observation: Observation; number: number; artifacts: readonly EvidenceArtifact[]; demo?: boolean }) {
  const artifact = artifacts.find(a => a.id === o.artifactId && a.checkId === o.checkId && (!a.runId || a.runId === o.runId));
  const capture = o.kind === 'capture' && o.sourceKind === 'live_page' && o.status === 'observed';
  return <article className="sw-evidence-record">
    {capture && (artifact && artifact.kind === 'capture' && !demo
      ? <PrivateCapture key={`${artifact.id}-${artifact.expiresAt}`} artifact={artifact} observation={o} number={number} />
      : <p className="sw-small-copy">{demo ? 'Synthetic sample · no private capture.' : 'Captured screenshot unavailable. The saved evidence remains below.'}</p>)}
    <details className="sw-observation" id={`evidence-${o.id}`}>
      <summary><span>Evidence {number} · {o.kind.replaceAll('_', ' ')}</span><span className={`sw-badge sw-badge-${o.status.replaceAll('_', '-')}`}>{o.status.replaceAll('_', ' ')}</span></summary>
      <dl className="sw-evidence-data">{Object.entries(o.data).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{value === null ? 'Not available' : Array.isArray(value) ? value.join(' · ') : String(value)}</dd></div>)}</dl>
      <p className="sw-evidence-meta"><span>Source: {o.sourceKind.replaceAll('_', ' ')} · {o.sourceKind === 'user_image' ? 'User-supplied screenshot, not a live observation' : o.sourceRef}</span><span>{dateLabel(o.observedAt)} · Collector {o.collectorVersion} · Policy {o.policyVersion}</span></p>
      {artifact && artifact.kind === 'input' && !demo && artifact.url === `/api/scamwin/artifacts/${encodeURIComponent(artifact.id)}` && <a className="sw-text-link" href={artifact.url} target="_blank" rel="noreferrer">Open private image <ExternalLink size={12} className="inline" aria-hidden="true" /></a>}
      <details className="sw-evidence-raw"><summary>Full saved record</summary><pre className="sw-code">{JSON.stringify(o, null, 2)}</pre></details>
    </details>
  </article>;
}
