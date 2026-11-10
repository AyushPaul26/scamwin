"use client";

import { useId } from "react";
import { ArrowRight } from "lucide-react";
import type { Observation } from "@/lib/scamwin/contracts";
import { EvidenceLinks } from "./finding-evidence";
import type { CompanyStatus, DestinationStatus, FreshnessStatus, OfferStatus, OfficialVerificationView } from "@/lib/scamwin/official-verification-contracts";
import { dateLabel } from "./core";

const companyLabels: Record<CompanyStatus, string> = {
  recognized: "Reviewed official sources recognized.", ambiguous: "The company name matches more than one reviewed organization.",
  unlisted: "No reviewed official sources for this company.", expired: "This company's source review has expired.", not_claimed: "No company was identified in this offer.",
};
const destinationLabels: Record<DestinationStatus, string> = {
  first_party_source: "Within a reviewed company source.", reviewed_delegate: "Within a reviewed partner route.",
  known_domain_unreviewed_path: "Company domain recognized; this path was not reviewed.",
  unrecognized: "Not in the reviewed company or partner routes.", not_provided: "No destination was provided for comparison.",
};
const offerLabels: Record<OfferStatus, string> = {
  matched_public_reference: "Published listing found at the checked time.", details_differ: "The public listing has details to compare.",
  explicitly_closed: "The official source explicitly marks this listing as closed.", not_found_in_checked_source: "Not found in the checked official source.",
  reference_needed: "Add a public listing link or posting ID to check this exact offer.",
  not_publicly_verifiable: "This private offer cannot be verified through a public listing.", unavailable: "The official source could not be checked.", not_applicable: "An exact public listing check does not apply to this offer.",
};
const freshnessLabels: Record<FreshnessStatus, string> = { fresh: "Source checked at the time below", stale: "Historical source check", reference_only: "Reviewed reference only", not_checked: "Live source check not completed" };
const purposeLabels = { listing: "Public listing", careers: "Careers", support: "Support", refund: "Refund help", identity_help: "Identity request help" };
const basisLabels = { live_listing: "Checked live from a public listing.", live_entry: "Official route checked live.", reviewed_entry: "Reviewed route, not checked live." };
const alternativePurposeLabels = { recruitment: "Find a job through reviewed sources", recruitment_support: "Verify a recruitment request", shopping: "Shopping", refund: "Refund help", application: "Application help", identity_request: "Identity request help", unknown: "Your purpose" };

export function OfficialVerification({ checkId, verification, observations }: { checkId: string; verification: OfficialVerificationView; observations: readonly Observation[] }) {
  const titleId = useId();
  const { company, destination, offer } = verification;
  const alternativesEnabled = verification.alternatives !== undefined;
  const steps = alternativesEnabled
    ? verification.alternatives!.map(alternative => ({ ...alternative, purpose: alternative.stepPurpose, evidenceIds: alternative.authorityEvidenceIds, alternative }))
    : verification.steps.map(step => ({ ...step, alternative: undefined }));
  return <section className="sw-section sw-panel sw-official-verification" aria-labelledby={titleId}>
    <div className="sw-section-head"><h2 id={titleId}>Company and offer verification</h2><span className="sw-small-copy">Saved source evidence</span></div>
    <p>Company sources, the submitted destination and the exact offer are separate checks. A published listing does not authenticate the sender or remove action risks.</p>
    <dl className="sw-official-facts">
      <div><dt>Company reference</dt><dd>{company.name && <strong>{company.name}</strong>}<p>{companyLabels[company.status]}</p><EvidenceLinks evidenceIds={company.evidenceIds} observations={observations} /></dd></div>
      <div><dt>Submitted destination</dt><dd>{destination.hostname && <strong>{destination.hostname}</strong>}<p>{destinationLabels[destination.status]}</p><EvidenceLinks evidenceIds={destination.evidenceIds} observations={observations} /></dd></div>
      <div><dt>Exact offer</dt><dd><p>{offerLabels[offer.status]}</p>{offer.title && <strong>{offer.title}</strong>}{offer.location && <p className="sw-small-copy">Listing location: {offer.location}</p>}{offer.reference && <p className="sw-small-copy">Public reference: {offer.reference}</p>}{offer.differingFields.length > 0 && <p className="sw-small-copy">Compare the {offer.differingFields.join(" and ")} with your offer.</p>}<EvidenceLinks evidenceIds={offer.evidenceIds} observations={observations} /></dd></div>
    </dl>
    <div className="sw-official-provenance"><div><strong>{freshnessLabels[verification.freshness]}</strong><p>{verification.checkedAt ? <>Source check: <time dateTime={verification.checkedAt}>{dateLabel(verification.checkedAt)}</time></> : "No live source-check time is available."}</p>{verification.freshness === "stale" && <p>These saved facts are historical. Start a new check to collect current evidence.</p>}</div><EvidenceLinks evidenceIds={verification.sourceEvidenceIds} observations={observations} /></div>
    {verification.explanation && <p className="sw-official-explanation">{verification.explanation}</p>}
    {offer.status === "reference_needed" && <a className="sw-text-link sw-official-new-check" href="/check">Start a new check with the public reference <ArrowRight size={13} aria-hidden="true" /></a>}
    {offer.quote && <blockquote className="sw-decision-quote">“{offer.quote}”</blockquote>}
    <div className="sw-official-next">
      <h3>Official next step</h3>
      {steps.length ? <>
        <p>Use these sources to independently verify the request before paying or sharing information.</p>
        {alternativesEnabled && <p>These routes do not authenticate a personal offer or remove the observed payment or information-sharing risks.</p>}
        <ul>{steps.map(step => <li key={step.stepId}>
          <div className="sw-official-step-context">
            <span>{step.alternative ? alternativePurposeLabels[step.alternative.purpose] : purposeLabels[step.purpose]}</span>
            <strong>{step.hostname}</strong>
            {step.alternative && <p>{purposeLabels[step.purpose]} · {step.alternative.relationship === "first_party" ? "First-party source" : "Reviewed partner route"}</p>}
            <p>{basisLabels[step.basis]}</p>
            {step.alternative && <>
              <p>Authority reviewed: <time dateTime={step.alternative.reviewedAt}>{dateLabel(step.alternative.reviewedAt)}</time></p>
              <p>{step.alternative.fetchedAt ? <>Source fetched: <time dateTime={step.alternative.fetchedAt}>{dateLabel(step.alternative.fetchedAt)}</time></> : "No live fetch for this reviewed route."}</p>
            </>}
            <p className="sw-small-copy">Link available until <time dateTime={step.expiresAt}>{dateLabel(step.expiresAt)}</time></p>
            <EvidenceLinks evidenceIds={step.evidenceIds} observations={observations} />
          </div>
          <a className="sw-btn sw-btn-outline" href={`/api/scamwin/checks/${encodeURIComponent(checkId)}/official-next-step/${encodeURIComponent(step.stepId)}`} rel="noreferrer">
            {step.label}<ArrowRight size={14} aria-hidden="true" />
          </a>
        </li>)}</ul>
      </> : <p>{alternativesEnabled ? "No reviewed alternative available. " : "No current official link is available for this check. "}Find the company through a source you already trust and verify the request independently.</p>}
    </div>
  </section>;
}
