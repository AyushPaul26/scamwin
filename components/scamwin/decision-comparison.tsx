"use client";

import * as React from 'react';
import type { Observation } from '@/lib/scamwin/contracts';
import type { DecisionComparison as Comparison, DecisionField } from '@/lib/scamwin/decision-comparison';
import { EvidenceLinks } from './finding-evidence';

const provenanceLabels = {
  user_stated: 'Stated by you', extracted: 'Extracted from your offer', observed: 'Observed evidence',
  inferred: 'Inference from evidence', unknown: 'Not established',
};

function ComparisonField({ label, field, observations }: { label: string; field: DecisionField; observations: readonly Observation[] }) {
  return <div className="sw-decision-field">
    <dt className="sw-decision-label">{label}</dt>
    <dd>
      <p className="sw-decision-value">{field.text}</p>
      <span className="sw-decision-provenance">{provenanceLabels[field.provenance]}</span>
      {field.quote && <blockquote className="sw-decision-quote">“{field.quote}”</blockquote>}
      <EvidenceLinks evidenceIds={field.evidenceIds} observations={observations} />
    </dd>
  </div>;
}

export function DecisionComparison({ comparison, observations }: { comparison: Comparison; observations: readonly Observation[] }) {
  return <section className="sw-section sw-panel sw-decision-comparison" aria-label="Promise, intention and observed request">
    <h2>The decision you’re considering</h2>
    <dl className="sw-decision-trace">
      <ComparisonField label="The promise" field={comparison.promise} observations={observations} />
      <ComparisonField label="Your intended action" field={comparison.intention} observations={observations} />
      <ComparisonField label="Observed request" field={comparison.request} observations={observations} />
    </dl>
    <dl className="sw-decision-destination">
      <ComparisonField label="Observed destination" field={comparison.observedDestination} observations={observations} />
    </dl>
    {comparison.mismatch && <div className={`sw-decision-mismatch sw-decision-mismatch-${comparison.mismatch.classification}`}>
      <p className="sw-decision-label">{comparison.mismatch.classification === 'observation' ? 'Observed difference' : 'Inferred difference'}</p>
      <p>{comparison.mismatch.text}</p>
      <EvidenceLinks evidenceIds={comparison.mismatch.evidenceIds} observations={observations} />
    </div>}
  </section>;
}
