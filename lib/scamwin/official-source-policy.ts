import { officialSourceSchema, parseOfficialUrl, publicOfferReferenceSchema, type OfficialSource, type OfficialStep, type PublicOfferReference } from "./official-verification-contracts";

const numericPost = (value: string) => /^[0-9]{1,120}$/.test(value);
function postId(source: Extract<OfficialSource, { kind: "greenhouse_job" }>, reference: PublicOfferReference | null): string | null {
  if (!reference || !publicOfferReferenceSchema.safeParse(reference).success) return null;
  if (reference.kind === "greenhouse_post_id") return numericPost(reference.value) ? reference.value : null;
  const url = parseOfficialUrl(reference.value);
  if (!url) return null;
  const [prefix, suffix] = source.listingUrlTemplate.split("{postId}");
  const candidate = url.href.startsWith(prefix) && url.href.endsWith(suffix) ? url.href.slice(prefix.length, suffix ? -suffix.length : undefined) : "";
  return numericPost(candidate) && source.listingUrlTemplate.replace("{postId}", candidate) === url.href ? candidate : null;
}
function isListing(source: Extract<OfficialSource, { kind: "jobposting_jsonld" }>, url: URL): boolean {
  const prefix = source.listingPathPrefix.replace(/\/$/, "");
  return url.origin === source.listingOrigin && (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
}
export function buildOfficialReadUrl(source: OfficialSource, reference: PublicOfferReference | null): string | null {
  const parsed = officialSourceSchema.safeParse(source);
  if (!parsed.success) return null;
  const current = parsed.data;
  if (current.kind === "greenhouse_job") {
    const id = postId(current, reference);
    return id ? `https://boards-api.greenhouse.io/v1/boards/${current.boardToken}/jobs/${id}` : null;
  }
  if (current.kind === "official_entry" || reference === null) return current.entryUrl;
  if (!publicOfferReferenceSchema.safeParse(reference).success || reference.kind !== "canonical_listing_url") return null;
  const url = parseOfficialUrl(reference.value);
  return url && isListing(current, url) ? url.href : null;
}
export function buildOfficialNavigationUrl(source: OfficialSource, reference: PublicOfferReference | null, purpose: OfficialStep["purpose"]): string | null {
  const parsed = officialSourceSchema.safeParse(source);
  if (!parsed.success) return null;
  const current = parsed.data;
  if (purpose !== "listing") return purpose === current.purpose ? current.entryUrl : null;
  if (current.kind === "official_entry") return null;
  if (current.kind === "greenhouse_job") {
    const id = postId(current, reference);
    return id ? current.listingUrlTemplate.replace("{postId}", id) : null;
  }
  if (!reference || !publicOfferReferenceSchema.safeParse(reference).success || reference.kind !== "canonical_listing_url") return null;
  const url = parseOfficialUrl(reference.value);
  return url && isListing(current, url) ? url.href : null;
}
export function isWithinOfficialSource(value: string, source: OfficialSource, use: "read" | "navigation"): boolean {
  const parsed = officialSourceSchema.safeParse(source), url = parseOfficialUrl(value);
  if (!parsed.success || !url || !["read", "navigation"].includes(use)) return false;
  const current = parsed.data;
  if (current.kind === "official_entry") return url.href === current.entryUrl;
  if (current.kind === "jobposting_jsonld") return url.href === current.entryUrl || isListing(current, url);
  if (use === "navigation") return url.href === current.entryUrl || postId(current, { kind: "canonical_listing_url", value: url.href, origin: "submitted_url" }) !== null;
  const prefix = `https://boards-api.greenhouse.io/v1/boards/${current.boardToken}/jobs/`;
  return url.href.startsWith(prefix) && numericPost(url.href.slice(prefix.length));
}
