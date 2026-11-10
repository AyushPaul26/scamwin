import {Buffer} from 'node:buffer';
import {parse, type DefaultTreeAdapterTypes} from 'parse5';
import {buildOfficialNavigationUrl, buildOfficialReadUrl} from './official-source-policy';
import type {OfficialClaim, OfficialDocument, OfficialOfferFact, OfficialSource} from './official-verification-contracts';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TEXT = 8000;
const MAX_QUOTE = 800;
const MAX_HTML_NODES = 20000;
const MAX_JSON_NODES = 8000;
const MAX_JSON_DEPTH = 32;
const MAX_JSONLD_SCRIPTS = 32;

type RecordValue = Record<string, unknown>;
type ParsedHtml = {text: string; scripts: string[]; canonicals: string[]; failed: boolean};
type Listing = {title: string | null; location: string | null; description: string; validThrough: string | null; closureQuote: string | null};

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit = MAX_TEXT): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** parse5 constructs a static tree; no browser, scripts, external entities or requests run. */
function readHtml(body: string, collectStructuredData: boolean): ParsedHtml {
  const result: ParsedHtml = {text: '', scripts: [], canonicals: [], failed: false};
  const stack: DefaultTreeAdapterTypes.Node[] = [parse(body, {scriptingEnabled: false})];
  let nodes = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++nodes > MAX_HTML_NODES) return {...result, failed: true};
    if ('tagName' in node) {
      const attribute = (name: string) => node.attrs.find(attr => attr.name === name)?.value ?? '';
      if (node.tagName === 'script') {
        if (collectStructuredData && attribute('type').trim().toLowerCase() === 'application/ld+json') {
          if (result.scripts.length >= MAX_JSONLD_SCRIPTS) return {...result, failed: true};
          const script = node.childNodes.map(child => 'value' in child ? child.value : '').join('');
          result.scripts.push(script);
        }
        continue;
      }
      if (['style', 'template', 'noscript'].includes(node.tagName)) continue;
      if (collectStructuredData && node.tagName === 'link' && attribute('rel').toLowerCase().split(/\s+/u).includes('canonical')) {
        result.canonicals.push(attribute('href'));
      }
    }
    if ('value' in node && node.nodeName === '#text' && result.text.length < MAX_TEXT) {
      const value = node.value.replace(/\s+/gu, ' ').trim();
      if (value) result.text = `${result.text}${result.text ? '\n' : ''}${value}`.slice(0, MAX_TEXT);
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index]);
    }
  }
  return result;
}

function canonicalEquals(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== 'string') return false;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.href === expected;
  } catch {
    return false;
  }
}

/** Only full ISO dates/times with real calendar days can establish a deadline. */
function validDeadline(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?$/u.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null;
  if (hour && (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)) return null;
  if (zone && zone !== 'Z') {
    const zoneHour = Number(zone.slice(1, 3)), zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) return null;
  }
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function deadlineTime(value: string): number {
  return Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value);
}

function explicitClosureQuote(description: string, status: unknown): string | null {
  if (typeof status === 'string' && normalized(status) === 'closed') return status;
  const statements = ['applications for this job are closed.', 'applications for this position are closed.', 'this job is no longer available.', 'this position has been filled.'];
  return description.split(/\n|(?<=[.!?])\s+/u).find(statement => statements.includes(normalized(statement))) ?? null;
}

function withinJsonLimits(root: unknown): boolean {
  const stack = [{value: root, depth: 0}];
  let nodes = 0;
  while (stack.length) {
    const {value, depth} = stack.pop()!;
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
    if (record(value) || Array.isArray(value)) {
      for (const child of Object.values(value)) stack.push({value: child, depth: depth + 1});
    }
  }
  return true;
}

function locationValue(value: unknown): string | null {
  if (typeof value === 'string') return text(value, 500);
  if (Array.isArray(value)) {
    const values = value.slice(0, 20).map(locationValue).filter((location): location is string => location !== null);
    return values.length ? [...new Set(values)].join('; ').slice(0, 500) : null;
  }
  if (!record(value)) return null;
  const name = text(value.name, 500);
  if (name) return name;
  if (record(value.address)) {
    return [value.address.addressLocality, value.address.addressRegion, value.address.addressCountry]
      .map(part => text(part, 200)).filter(Boolean).join(', ').slice(0, 500) || null;
  }
  return null;
}

function identifierMatches(identifier: unknown, canonicalUrl: string): boolean {
  const value = record(identifier) ? identifier.value : identifier;
  if (canonicalEquals(value, canonicalUrl)) return true;
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) return false;
  const scalar = String(value);
  if (!scalar || scalar.length > 200 || scalar.includes('/') || scalar.includes('?') || scalar.includes('#')) return false;
  try {
    const lastSegment = new URL(canonicalUrl).pathname.split('/').filter(Boolean).at(-1);
    return lastSegment !== undefined && decodeURIComponent(lastSegment) === scalar;
  } catch {
    return false;
  }
}

function collectPostings(scripts: string[]): {postings: RecordValue[]; reasonCode: string | null} {
  const postings: RecordValue[] = [];
  let nodes = 0;
  for (const script of scripts) {
    let parsed: unknown;
    try { parsed = JSON.parse(script); } catch { return {postings: [], reasonCode: 'malformed_jsonld'}; }
    const stack = [{value: parsed, depth: 0}];
    while (stack.length) {
      const {value, depth} = stack.pop()!;
      if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return {postings: [], reasonCode: 'structured_data_limit'};
      if (record(value)) {
        const type = value['@type'];
        if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) postings.push(value);
        for (const child of Object.values(value)) stack.push({value: child, depth: depth + 1});
      } else if (Array.isArray(value)) {
        for (const child of value) stack.push({value: child, depth: depth + 1});
      }
    }
  }
  return {postings, reasonCode: null};
}

function offerFact(claim: OfficialClaim, source: OfficialSource, status: OfficialOfferFact['status'], reasonCode: string, fields: Partial<OfficialOfferFact> = {}): OfficialOfferFact {
  return {status, sourceId: source.id, reference: claim.publicReference?.value ?? null,
    title: null, location: null, validThrough: null, quote: null, canonicalUrl: null,
    differingFields: [], reasonCode, ...fields};
}

function compareListing(claim: OfficialClaim, source: OfficialSource, listing: Listing, canonicalUrl: string, reference: string, now: Date): OfficialOfferFact {
  const differingFields: string[] = [];
  if (claim.title && listing.title && normalized(claim.title) !== normalized(listing.title)) differingFields.push('title');
  if (claim.location && listing.location && normalized(claim.location) !== normalized(listing.location)) differingFields.push('location');
  const closed = listing.closureQuote !== null || (listing.validThrough !== null && deadlineTime(listing.validThrough) <= now.getTime());
  const quote = [listing.closureQuote, listing.validThrough, listing.title, listing.location, listing.description].filter(Boolean).join('\n').slice(0, MAX_QUOTE) || null;
  return offerFact(claim, source, closed ? 'explicitly_closed' : differingFields.length ? 'details_differ' : 'matched_public_reference',
    closed ? 'official_explicit_closure' : differingFields.length ? 'literal_details_differ' : 'exact_public_reference',
    {reference, title: listing.title, location: listing.location, validThrough: listing.validThrough, quote, canonicalUrl, differingFields});
}

/** Interprets only the already identified, bounded official resource; it never searches or reads URLs. */
export function interpretOfficialOffer(claim: OfficialClaim, source: OfficialSource, document: OfficialDocument, now: Date): OfficialOfferFact {
  const unavailable = (reasonCode: string) => offerFact(claim, source, 'unavailable', reasonCode);
  if (claim.offerType === 'refund' || claim.offerType === 'identity_request') return offerFact(claim, source, 'not_publicly_verifiable', 'private_request');
  if (claim.offerType !== 'recruitment') return offerFact(claim, source, 'not_applicable', 'unsupported_offer_type');
  if (source.kind === 'official_entry' || !claim.publicReference) return offerFact(claim, source, 'reference_needed', 'public_reference_required');
  const readUrl = buildOfficialReadUrl(source, claim.publicReference);
  const canonicalUrl = buildOfficialNavigationUrl(source, claim.publicReference, 'listing');
  if (!readUrl || !canonicalUrl) return offerFact(claim, source, 'reference_needed', 'source_scoped_reference_required');
  if (document.sourceId !== source.id || document.readUrl !== readUrl || document.finalReadUrl !== readUrl) return unavailable('document_scope_mismatch');
  if (document.status === 'not_found') return offerFact(claim, source, 'not_found_in_checked_source', 'not_found_in_checked_source');
  if (document.status !== 'ok') return unavailable(document.reasonCode ?? 'source_unavailable');
  if (!document.body || Buffer.byteLength(document.body, 'utf8') > MAX_BODY_BYTES) return unavailable('invalid_or_oversized_body');
  if (!Number.isFinite(now.getTime())) return unavailable('invalid_check_time');

  if (source.kind === 'greenhouse_job') {
    if (!document.contentType || !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/iu.test(document.contentType)) return unavailable('unexpected_content_type');
    let payload: unknown;
    try { payload = JSON.parse(document.body); } catch { return unavailable('malformed_json'); }
    if (!record(payload)) return unavailable('malformed_post');
    if (!withinJsonLimits(payload)) return unavailable('structured_data_limit');
    const reference = new URL(readUrl).pathname.split('/').at(-1)!;
    const id = payload.id;
    if (!((typeof id === 'number' && Number.isSafeInteger(id) && id > 0) || (typeof id === 'string' && /^[1-9]\d{0,19}$/u.test(id)))) return unavailable('missing_public_post_id');
    if (String(id) !== reference) return unavailable('public_post_id_mismatch');
    if (payload.company_name !== undefined && (!claim.organizationName || typeof payload.company_name !== 'string' || normalized(payload.company_name) !== normalized(claim.organizationName))) return unavailable('organization_mismatch');
    if ((payload.title !== undefined && payload.title !== null && typeof payload.title !== 'string') || (payload.content !== undefined && typeof payload.content !== 'string')) return unavailable('malformed_post');
    const description = readHtml(typeof payload.content === 'string' ? payload.content : '', false);
    if (description.failed) return unavailable('html_node_limit');
    const deadline = payload.validThrough !== undefined && payload.valid_through !== undefined && payload.validThrough !== payload.valid_through ? null : validDeadline(payload.validThrough ?? payload.valid_through);
    return compareListing(claim, source, {title: text(payload.title, 500), location: locationValue(payload.location), description: description.text,
      validThrough: deadline, closureQuote: explicitClosureQuote(description.text, payload.status)}, canonicalUrl, reference, now);
  }

  if (!document.contentType || !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/iu.test(document.contentType)) return unavailable('unexpected_content_type');
  const html = readHtml(document.body, true);
  if (html.failed) return unavailable('html_node_limit');
  if (html.canonicals.some(url => !canonicalEquals(url, canonicalUrl))) return unavailable('canonical_url_mismatch');
  const collected = collectPostings(html.scripts);
  if (collected.reasonCode) return unavailable(collected.reasonCode);
  if (!collected.postings.length) return unavailable('no_static_jobposting');
  const listings: Listing[] = [];
  for (const posting of collected.postings) {
    if (!canonicalEquals(posting.url, canonicalUrl)) return unavailable(collected.postings.length > 1 ? 'ambiguous_jobposting' : 'canonical_url_mismatch');
    if (!identifierMatches(posting.identifier, canonicalUrl)) return unavailable('identifier_mismatch');
    if (!record(posting.hiringOrganization) || !claim.organizationName || typeof posting.hiringOrganization.name !== 'string' || normalized(posting.hiringOrganization.name) !== normalized(claim.organizationName)) return unavailable('organization_mismatch');
    if ((posting.title !== undefined && posting.title !== null && typeof posting.title !== 'string') || (posting.description !== undefined && typeof posting.description !== 'string')) return unavailable('malformed_jobposting');
    const description = readHtml(typeof posting.description === 'string' ? posting.description : '', false);
    if (description.failed) return unavailable('html_node_limit');
    listings.push({title: text(posting.title, 500), location: locationValue(posting.jobLocation), description: description.text,
      validThrough: validDeadline(posting.validThrough), closureQuote: explicitClosureQuote(description.text, posting.status)});
  }
  const signatures = new Set(listings.map(listing => JSON.stringify(listing)));
  if (signatures.size !== 1) return unavailable('ambiguous_jobposting');
  return compareListing(claim, source, listings[0], canonicalUrl, claim.publicReference.value, now);
}
