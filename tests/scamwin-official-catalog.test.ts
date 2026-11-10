import assert from "node:assert/strict";
import test from "node:test";
import { officialCatalogSchema, officialOfferDataSchema, officialNextStepDataSchema, type OfficialCatalog, type OfficialSource } from "../lib/scamwin/official-verification-contracts";
import { resolveOfficialCompany } from "../lib/scamwin/official-source-catalog";
import { buildOfficialNavigationUrl, buildOfficialReadUrl, isWithinOfficialSource } from "../lib/scamwin/official-source-policy";

const now = new Date("2026-11-10T12:00:00.000Z");
const greenhouse: OfficialSource = { id: "acme-board", companyId: "acme", kind: "greenhouse_job", purpose: "careers", entryUrl: "https://job-boards.greenhouse.io/acme", boardToken: "acme", listingUrlTemplate: "https://job-boards.greenhouse.io/acme/jobs/{postId}", delegationEvidenceUrl: "https://acme.example/careers" };
const staticSource: OfficialSource = { id: "acme-static", companyId: "acme", kind: "jobposting_jsonld", purpose: "careers", entryUrl: "https://acme.example/careers", listingOrigin: "https://acme.example", listingPathPrefix: "/careers/jobs", relationshipEvidenceUrl: "https://acme.example/careers" };
const catalog: OfficialCatalog = { version: "fixture-1", companies: [{ id: "acme", name: "Acme Example", aliases: ["Acme"], firstPartyHosts: ["acme.example"], reviewedAt: "2026-11-10T10:00:00.000Z", reviewEvidenceUrl: "https://acme.example/about", offerTypes: ["recruitment"], sources: [greenhouse, staticSource] }] };

test("only exact reviewed aliases establish a current company source", () => {
  assert.equal(resolveOfficialCompany("  ACME  ", catalog, now).status, "recognized");
  assert.equal(resolveOfficialCompany("Acme Example", catalog, now).company?.id, "acme");
  assert.equal(resolveOfficialCompany("Acme Incorporated", catalog, now).status, "unlisted");
  assert.equal(resolveOfficialCompany(null, catalog, now).status, "not_claimed");
  for (const reviewedAt of ["2026-10-10T12:00:00.000Z", "2026-11-11T00:00:00.000Z"]) {
    const stale = structuredClone(catalog); stale.companies[0].reviewedAt = reviewedAt;
    assert.deepEqual(resolveOfficialCompany("Acme", stale, now), { status: "expired", company: null });
  }
});

test("alias collisions are ambiguous even if the first company is current", () => {
  const collision = structuredClone(catalog);
  collision.companies.push({ ...collision.companies[0], id: "other", name: "Other Example", sources: [] });
  assert.deepEqual(resolveOfficialCompany("acme", collision, now), { status: "ambiguous", company: null });
});

test("review evidence must be first-party and source IDs belong to their company", () => {
  assert.equal(officialCatalogSchema.safeParse(catalog).success, true);
  for (const mutate of [
    (c: OfficialCatalog) => { c.companies[0].reviewEvidenceUrl = "https://acme.example.evil.org/about"; },
    (c: OfficialCatalog) => { c.companies[0].sources[0].companyId = "other"; },
    (c: OfficialCatalog) => { c.companies[0].sources.push(c.companies[0].sources[0]); },
    (c: OfficialCatalog) => { c.companies.push(c.companies[0]); },
    (c: OfficialCatalog) => { c.companies[0].aliases = Array(21).fill("extra"); },
    (c: OfficialCatalog) => { (c.companies[0].sources[0] as typeof greenhouse).delegationEvidenceUrl = "https://other.example/proof"; },
  ]) { const changed = structuredClone(catalog); mutate(changed); assert.equal(officialCatalogSchema.safeParse(changed).success, false); }
});

test("Greenhouse read and navigation scopes use distinct exact URLs and the reviewed tenant", () => {
  const reference = { kind: "greenhouse_post_id" as const, value: "12345", origin: "explicit_field" as const };
  assert.equal(buildOfficialReadUrl(greenhouse, reference), "https://boards-api.greenhouse.io/v1/boards/acme/jobs/12345");
  assert.equal(buildOfficialNavigationUrl(greenhouse, reference, "listing"), "https://job-boards.greenhouse.io/acme/jobs/12345");
  assert.equal(isWithinOfficialSource("https://boards-api.greenhouse.io/v1/boards/acme/jobs/12345", greenhouse, "read"), true);
  assert.equal(isWithinOfficialSource("https://boards-api.greenhouse.io/v1/boards/acme/jobs/12345", greenhouse, "navigation"), false);
  assert.equal(isWithinOfficialSource("https://job-boards.greenhouse.io/acme/jobs/12345", greenhouse, "read"), false);
  assert.equal(isWithinOfficialSource("https://job-boards.greenhouse.io/other/jobs/12345", greenhouse, "navigation"), false);
  assert.equal(buildOfficialReadUrl(greenhouse, { ...reference, value: "12345?secret=private" }), null);
  assert.equal(buildOfficialReadUrl(greenhouse, { ...reference, kind: "canonical_listing_url", value: "https://job-boards.greenhouse.io/other/jobs/12345" }), null);
  assert.equal(buildOfficialReadUrl(greenhouse, { ...reference, kind: "canonical_listing_url", value: "https://job-boards.greenhouse.io/acme/jobs/12345" }), "https://boards-api.greenhouse.io/v1/boards/acme/jobs/12345");
  assert.equal(buildOfficialNavigationUrl(greenhouse, null, "careers"), "https://job-boards.greenhouse.io/acme");
  assert.equal(buildOfficialNavigationUrl(greenhouse, null, "refund"), null);
});

test("static scope rejects suffix, subdomain, prefix and encoded path escapes", () => {
  assert.equal(isWithinOfficialSource("https://acme.example/careers/jobs/42", staticSource, "read"), true);
  for (const url of ["https://acme.example.evil.org/careers/jobs/42", "https://unreviewed.acme.example/careers/jobs/42", "https://acme.example/careers/jobs-extra/42", "https://acme.example/careers/jobs/%2e%2e/pay", "https://acme.example/careers/jobs/%252e%252e/pay", "https://acme.example/careers/jobs/a%2fb", "https://acme.example/careers/jobs/42?token=secret", "https://acme.example/careers/jobs/42#private", "https://u:p@acme.example/careers/jobs/42", "https://acme.example:444/careers/jobs/42"]) {
    assert.equal(isWithinOfficialSource(url, staticSource, "read"), false, url);
    assert.equal(isWithinOfficialSource(url, staticSource, "navigation"), false, url);
  }
  assert.equal(buildOfficialReadUrl(staticSource, { kind: "canonical_listing_url", value: "https://acme.example/careers/jobs/42", origin: "submitted_url" }), "https://acme.example/careers/jobs/42");
  assert.equal(buildOfficialReadUrl(staticSource, { kind: "greenhouse_post_id", value: "42", origin: "explicit_field" }), null);
});

test("invalid configuration cannot broaden source scope and IDNs use ASCII hostnames", () => {
  const invalid = { ...staticSource, entryUrl: "https://acme.example/careers?private=1" };
  assert.equal(isWithinOfficialSource("https://acme.example/careers/jobs/42", invalid, "read"), false);
  const idn = officialCatalogSchema.parse({ version: "idn", companies: [{ ...catalog.companies[0], firstPartyHosts: ["bücher.example"], reviewEvidenceUrl: "https://bücher.example/about", sources: [] }] });
  assert.deepEqual(idn.companies[0].firstPartyHosts, ["xn--bcher-kva.example"]);
});

test("flat official observations enforce quote, IDs and unknown-key boundaries", () => {
  const offer = { schemaVersion: 1, catalogVersion: "fixture-1", companyId: "acme", reasonCode: "exact", offerStatus: "matched_public_reference", sourceId: "acme-board", referenceKind: "greenhouse_post_id", referenceValue: "12345", title: "Engineer", location: null, validThrough: null, canonicalListingUrl: "https://job-boards.greenhouse.io/acme/jobs/12345", quote: "Published Engineer", differingFields: [], basedOnEvidenceIds: ["document"] };
  assert.equal(officialOfferDataSchema.safeParse(offer).success, true);
  assert.equal(officialOfferDataSchema.safeParse({ ...offer, quote: "x".repeat(801) }).success, false);
  assert.equal(officialOfferDataSchema.safeParse({ ...offer, body: "raw HTML" }).success, false);
  assert.equal(officialOfferDataSchema.safeParse({ ...offer, differingFields: ["salary"] }).success, false);
  const step = { schemaVersion: 1, catalogVersion: "fixture-1", companyId: "acme", reasonCode: null, stepId: "step", sourceId: "acme-board", purpose: "listing", label: "View listing", hostname: "job-boards.greenhouse.io", canonicalUrl: "https://job-boards.greenhouse.io/acme/jobs/12345", referenceKind: "greenhouse_post_id", referenceValue: "12345", referenceOrigin: "explicit_field", evidenceIds: ["document"], expiresAt: "2026-11-10T18:00:00.000Z", basis: "live_listing" };
  assert.equal(officialNextStepDataSchema.safeParse(step).success, true);
  assert.equal(officialNextStepDataSchema.safeParse({ ...step, publicReference: { kind: "greenhouse_post_id", value: "12345" } }).success, false);
  assert.equal(officialNextStepDataSchema.safeParse({ ...step, evidenceIds: Array(9).fill("document") }).success, false);
});
