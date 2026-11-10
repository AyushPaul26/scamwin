import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

/** Wire DTO for messages.get(format=full). This parser does not perform the request. */
export interface GmailRawPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailRawPart[];
}

export interface GmailRawMessage {
  id?: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailRawPart;
}

export type GmailDiagnosticCode =
  | 'missing_message_id' | 'invalid_source_id' | 'invalid_internal_date' | 'missing_payload'
  | 'header_limit' | 'malformed_encoded_header' | 'unsupported_charset'
  | 'malformed_base64url' | 'malformed_text_encoding' | 'missing_body'
  | 'detached_body' | 'unsupported_content' | 'attachment_not_analyzed'
  | 'text_byte_limit' | 'link_limit' | 'link_length_limit' | 'credentialed_link'
  | 'attachment_limit' | 'mime_depth_limit' | 'mime_part_limit' | 'html_node_limit'
  | 'invalid_metadata' | 'diagnostic_limit';

export interface GmailAttachmentReference {
  provider: 'gmail';
  messageId: string;
  partId: string;
  attachmentId?: string;
  mediaType: string;
  filename?: string;
  declaredBytes?: number;
  inline: boolean;
  handling: 'detached_text' | 'preparable_image' | 'unsupported';
}

export interface GmailParsedMessage {
  source: { provider: 'gmail'; messageId?: string; threadId?: string; historyId?: string; internalDateMs?: string };
  /** Sender, date and subject are message claims, never ownership/authentication evidence. */
  untrustedContext: Partial<Record<'from' | 'to' | 'cc' | 'subject' | 'date' | 'messageId' | 'replyTo', string>>;
  bodyText: string;
  bodySources: { partId: string; mediaType: 'text/plain' | 'text/html' }[];
  links: { url: string; partId: string; kind: 'text' | 'html_href' }[];
  attachments: GmailAttachmentReference[];
  /** Complete means this bounded MIME extraction only, never a safety verdict or attachment analysis. */
  coverage: 'complete' | 'partial' | 'unavailable';
  /** One record per code; partId identifies its first occurrence, count includes all occurrences. */
  diagnostics: { code: GmailDiagnosticCode; partId?: string; count: number }[];
  /** Discovered counts concern visited/decoded input only; limits can hide additional content. */
  stats: { partsVisited: number; decodedTextBytes: number; linksDiscovered: number; attachmentsDiscovered: number; headerBytesRead: number };
}

const MAX_TEXT_BYTES = 256 * 1024;
const MAX_PARTS = 200;
const MAX_DEPTH = 16;
const MAX_HEADERS = 100;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_FIELD_BYTES = 2048;
const MAX_LINKS = 200;
const MAX_ATTACHMENTS = 20;
const MAX_DIAGNOSTICS = 128;
const MAX_HTML_NODES = 20000;
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const CONTEXT_HEADERS = new Map<string, keyof GmailParsedMessage['untrustedContext']>([
  ['from', 'from'], ['to', 'to'], ['cc', 'cc'], ['subject', 'subject'], ['date', 'date'],
  ['message-id', 'messageId'], ['reply-to', 'replyTo'],
]);
const CHARSETS = new Map([
  ['utf-8', 'utf-8'], ['utf8', 'utf-8'], ['us-ascii', 'ascii'], ['ascii', 'ascii'],
  ['iso-8859-1', 'iso-8859-1'], ['latin1', 'iso-8859-1'], ['windows-1252', 'windows-1252'],
]);

/** Pure, bounded JSON-to-content extraction. No HTML rendering, fetches or mailbox mutations. */
export function parseGmailMessage(raw: GmailRawMessage): GmailParsedMessage {
  const result: GmailParsedMessage = {
    source: { provider: 'gmail' }, untrustedContext: {}, bodyText: '', bodySources: [], links: [], attachments: [],
    coverage: 'unavailable', diagnostics: [],
    stats: { partsVisited: 0, decodedTextBytes: 0, linksDiscovered: 0, attachmentsDiscovered: 0, headerBytesRead: 0 },
  };
  let headerCount = 0;
  let readableBody = false;
  // This set is bounded by the text-source budget, not by an attacker-supplied count.
  const discoveredLinks = new Set<string>();

  function diagnose(code: GmailDiagnosticCode, partId?: string) {
    const existing = result.diagnostics.find((entry) => entry.code === code);
    if (existing) { existing.count++; return; }
    if (result.diagnostics.length < MAX_DIAGNOSTICS - 1) result.diagnostics.push({ code, ...(partId === undefined ? {} : { partId }), count: 1 });
    else {
      const overflow = result.diagnostics.find((entry) => entry.code === 'diagnostic_limit');
      if (overflow) overflow.count++;
      else result.diagnostics.push({ code: 'diagnostic_limit', count: 1 });
    }
  }

  function identifier(value: unknown, required = false): string | undefined {
    if (typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x20\x7f]/.test(value)) return value;
    if (required) diagnose('missing_message_id');
    else if (value !== undefined) diagnose('invalid_source_id');
    return undefined;
  }

  result.source.messageId = identifier(raw?.id, true);
  if (!result.source.messageId) return result;
  const messageId = result.source.messageId;
  const threadId = identifier(raw.threadId);
  const historyId = identifier(raw.historyId);
  if (threadId) result.source.threadId = threadId;
  if (historyId) result.source.historyId = historyId;
  // Keep the provider's millisecond string; do not use it as an activation decision.
  if (typeof raw.internalDate === 'string' && /^\d{1,16}$/.test(raw.internalDate) && Number(raw.internalDate) <= 8640000000000000) result.source.internalDateMs = raw.internalDate;
  else diagnose('invalid_internal_date');

  function decodeBytes(bytes: Uint8Array, charset: string, partId: string, truncated = false): string | undefined {
    const selected = CHARSETS.get(charset.toLowerCase());
    if (!selected) { diagnose('unsupported_charset', partId); return; }
    if (selected === 'ascii' && bytes.some((byte) => byte > 127)) { diagnose('malformed_text_encoding', partId); return; }
    try {
      return new TextDecoder(selected === 'ascii' ? 'utf-8' : selected, { fatal: true }).decode(bytes, { stream: truncated });
    } catch { diagnose('malformed_text_encoding', partId); return; }
  }

  function decodeHeader(value: string, partId: string): string | undefined {
    // RFC2047 ignores linear whitespace between adjacent encoded words.
    const unfolded = value.replace(/\r?\n[ \t]+/g, ' ').replace(/(\?=)[ \t]+(?==\?)/g, '$1');
    let failed = false;
    const decoded = unfolded.replace(/=\?([^?\s]+)\?([bqBQ])\?([^?]*)\?=/g, (_word, charset: string, encoding: string, payload: string) => {
      let bytes: Buffer;
      if (encoding.toLowerCase() === 'b') {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
          failed = true; diagnose('malformed_encoded_header', partId); return '';
        }
        bytes = Buffer.from(payload, 'base64');
        if (bytes.toString('base64') !== payload) { failed = true; diagnose('malformed_encoded_header', partId); return ''; }
      } else {
        if (/=(?![0-9a-fA-F]{2})|[^\x21-\x7e]/.test(payload)) { failed = true; diagnose('malformed_encoded_header', partId); return ''; }
        const octets: number[] = [];
        for (let index = 0; index < payload.length; index++) {
          if (payload[index] === '=') { octets.push(Number.parseInt(payload.slice(index + 1, index + 3), 16)); index += 2; }
          else octets.push(payload[index] === '_' ? 32 : payload.charCodeAt(index));
        }
        bytes = Buffer.from(octets);
      }
      const text = decodeBytes(bytes, charset, partId);
      if (text === undefined) failed = true;
      return text ?? '';
    });
    if (decoded.includes('=?')) { failed = true; diagnose('malformed_encoded_header', partId); }
    return failed ? undefined : decoded.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  }

  function readHeaders(part: GmailRawPart, partId: string): Map<string, string> {
    const headers = new Map<string, string>();
    if (!Array.isArray(part.headers)) return headers;
    for (const header of part.headers) {
      if (++headerCount > MAX_HEADERS || result.stats.headerBytesRead >= MAX_HEADER_BYTES) { diagnose('header_limit', partId); break; }
      if (typeof header?.name !== 'string' || typeof header.value !== 'string') { diagnose('invalid_metadata', partId); continue; }
      // Check code units before allocating UTF-8 buffers from response strings.
      if (header.name.length > 128 || header.value.length > MAX_FIELD_BYTES) { diagnose('header_limit', partId); continue; }
      const bytes = Buffer.byteLength(header.name) + Buffer.byteLength(header.value);
      if (bytes > MAX_FIELD_BYTES || result.stats.headerBytesRead + bytes > MAX_HEADER_BYTES) { diagnose('header_limit', partId); continue; }
      result.stats.headerBytesRead += bytes;
      const name = header.name.toLowerCase();
      if (!headers.has(name)) headers.set(name, header.value);
    }
    return headers;
  }

  function addLink(candidate: string, partId: string, kind: 'text' | 'html_href') {
    if (candidate.length > 4096) { diagnose('link_length_limit', partId); return; }
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (url.username || url.password) { diagnose('credentialed_link', partId); return; }
      const normalized = url.href;
      if (discoveredLinks.has(normalized)) return;
      discoveredLinks.add(normalized);
      result.stats.linksDiscovered++;
      if (result.links.length >= MAX_LINKS) { diagnose('link_limit', partId); return; }
      result.links.push({ url: normalized, partId, kind });
    } catch { /* Non-absolute/non-HTTP destinations are not HTTP(S) targets. */ }
  }

  function textLinks(text: string, partId: string) {
    // Preserve literal destination punctuation; prose alone cannot prove it is decoration.
    for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"']+/gi)) addLink(match[0], partId, 'text');
  }

  function htmlText(html: string, partId: string): string {
    const root = parseFragment(html, { scriptingEnabled: false });
    const chunks: string[] = [];
    const stack: { node: DefaultTreeAdapterTypes.Node; closing?: boolean; inert?: boolean }[] = [{ node: root }];
    let visited = 0;
    while (stack.length) {
      if (++visited > MAX_HTML_NODES) { diagnose('html_node_limit', partId); break; }
      const { node, closing, inert } = stack.pop()!;
      if ('tagName' in node) {
        const tag = node.tagName;
        // Scripting is disabled: noscript/object descendants can be useful fallback
        // text and anchors. Walking them does not load an object's data resource.
        if (['script', 'style', 'iframe', 'embed'].includes(tag)) continue;
        const block = /^(?:p|div|br|li|tr|table|section|article|header|footer|h[1-6]|blockquote|pre|hr)$/.test(tag);
        if (block && !inert) chunks.push('\n');
        if (closing) continue;
        if (tag === 'a' || tag === 'area') {
          const href = node.attrs.find((attribute) => attribute.name === 'href');
          if (href) addLink(href.value, partId, 'html_href');
        }
        if (block) stack.push({ node, closing: true, inert });
        if (tag === 'template' && 'content' in node) stack.push({ node: node.content as DefaultTreeAdapterTypes.DocumentFragment, inert: true });
      }
      if ('value' in node && node.nodeName === '#text' && !inert) chunks.push(node.value);
      if ('childNodes' in node && !closing) {
        for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push({ node: node.childNodes[index], inert });
      }
    }
    const text = chunks.join('').replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
    textLinks(text, partId);
    return text;
  }

  function bodyText(part: GmailRawPart, headers: Map<string, string>, partId: string): string | undefined {
    const data = part.body?.data;
    if (typeof data !== 'string') { diagnose('missing_body', partId); return; }
    // Declared length is validation evidence only, never an allocation size.
    if (!data.length && typeof part.body?.size === 'number' && part.body.size > 0) { diagnose('missing_body', partId); return; }
    const remaining = MAX_TEXT_BYTES - result.stats.decodedTextBytes;
    if (remaining <= 0 && data.length) { diagnose('text_byte_limit', partId); return; }
    // At most one bounded base64 prefix is allocated. size/sizeEstimate never controls allocations.
    const maxEncoded = Math.ceil(remaining / 3) * 4;
    const truncated = data.length > maxEncoded;
    const encoded = truncated ? data.slice(0, Math.floor(remaining / 3) * 4) : data;
    if (truncated) diagnose('text_byte_limit', partId);
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(encoded) || encoded.length % 4 === 1 || (encoded.includes('=') && encoded.length % 4 !== 0)) {
      diagnose('malformed_base64url', partId); return;
    }
    let bytes = Buffer.from(encoded, 'base64url');
    if (!truncated && bytes.toString('base64url') !== encoded.replace(/=+$/, '')) { diagnose('malformed_base64url', partId); return; }
    const clipped = bytes.length > remaining;
    if (clipped) { bytes = bytes.subarray(0, remaining); diagnose('text_byte_limit', partId); }
    result.stats.decodedTextBytes += bytes.length;
    const charset = headers.get('content-type')?.match(/(?:^|;)\s*charset\s*=\s*(?:"([^";]+)"|([^;\s]+))/i);
    return decodeBytes(bytes, (charset?.[1] ?? charset?.[2] ?? 'utf-8').trim(), partId, truncated || clipped);
  }

  type Representation = { text: string; sources: GmailParsedMessage['bodySources']; plain: boolean; readable: boolean };
  const empty = (): Representation => ({ text: '', sources: [], plain: false, readable: false });

  function visit(part: GmailRawPart, depth: number, path: string): Representation {
    const partId = typeof part?.partId === 'string' && part.partId.length <= 512 ? part.partId : path;
    if (result.stats.partsVisited >= MAX_PARTS) { diagnose('mime_part_limit', partId); return empty(); }
    result.stats.partsVisited++;
    if (depth > MAX_DEPTH) { diagnose('mime_depth_limit', partId); return empty(); }
    if (!part || typeof part !== 'object') { diagnose('invalid_metadata', partId); return empty(); }
    const headers = readHeaders(part, partId);
    if (depth === 0) for (const [name, key] of CONTEXT_HEADERS) {
      const value = headers.get(name);
      if (value !== undefined) {
        const decoded = decodeHeader(value, partId);
        if (decoded !== undefined) result.untrustedContext[key] = decoded;
      }
    }
    const mediaType = typeof part.mimeType === 'string' && part.mimeType.length <= 128 ? part.mimeType.toLowerCase().trim() : '';
    if (mediaType === 'multipart/mixed' || mediaType === 'multipart/alternative' || mediaType === 'multipart/related' || mediaType === 'multipart/parallel') {
      if (!Array.isArray(part.parts) || !part.parts.length) { diagnose('missing_body', partId); return empty(); }
      const children: Representation[] = [];
      for (let index = 0; index < part.parts.length; index++) {
        if (result.stats.partsVisited >= MAX_PARTS) { diagnose('mime_part_limit', partId); break; }
        children.push(visit(part.parts[index], depth + 1, `${path}.${index}`));
      }
      if (mediaType === 'multipart/alternative') {
        return children.find((child) => child.plain && child.readable && child.text.trim())
          ?? children.find((child) => child.readable && child.text.trim())
          ?? children.find((child) => child.readable) ?? empty();
      }
      return { text: children.map((child) => child.text).filter(Boolean).join('\n\n'), sources: children.flatMap((child) => child.sources), plain: children.some((child) => child.plain), readable: children.some((child) => child.readable) };
    }
    const isText = mediaType === 'text/plain' || mediaType === 'text/html';
    const disposition = headers.get('content-disposition') ?? '';
    const filename = typeof part.filename === 'string' && part.filename.length ? part.filename : undefined;
    const detached = typeof part.body?.attachmentId === 'string' && part.body.attachmentId.length > 0;
    const attachment = !isText || /^attachment(?:;|$)/i.test(disposition.trim()) || !!filename || detached;
    if (attachment) {
      result.stats.attachmentsDiscovered++;
      const handling = detached && isText && !filename && !/^attachment(?:;|$)/i.test(disposition.trim()) ? 'detached_text' : RASTER_TYPES.has(mediaType) ? 'preparable_image' : 'unsupported';
      diagnose(handling === 'detached_text' ? 'detached_body' : handling === 'preparable_image' ? 'attachment_not_analyzed' : 'unsupported_content', partId);
      if (result.attachments.length >= MAX_ATTACHMENTS) { diagnose('attachment_limit', partId); return empty(); }
      let safeFilename: string | undefined;
      if (filename) {
        if (filename.length > MAX_FIELD_BYTES || Buffer.byteLength(filename) > MAX_FIELD_BYTES) diagnose('header_limit', partId);
        else safeFilename = decodeHeader(filename, partId);
      }
      const attachmentId = detached ? identifier(part.body?.attachmentId) : undefined;
      const size = part.body?.size;
      const declaredBytes = typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : undefined;
      if (size !== undefined && declaredBytes === undefined) diagnose('invalid_metadata', partId);
      result.attachments.push({ provider: 'gmail', messageId, partId, ...(attachmentId ? { attachmentId } : {}), mediaType: mediaType || 'application/octet-stream', ...(safeFilename ? { filename: safeFilename } : {}), ...(declaredBytes === undefined ? {} : { declaredBytes }), inline: /^inline(?:;|$)/i.test(disposition.trim()), handling });
      return empty();
    }
    const decoded = bodyText(part, headers, partId);
    if (decoded === undefined) return empty();
    const text = mediaType === 'text/html' ? htmlText(decoded, partId) : decoded;
    if (mediaType === 'text/plain') textLinks(text, partId);
    return { text, sources: [{ partId, mediaType: mediaType as 'text/plain' | 'text/html' }], plain: mediaType === 'text/plain', readable: true };
  }

  if (!raw.payload || typeof raw.payload !== 'object') diagnose('missing_payload');
  else {
    const representation = visit(raw.payload, 0, '0');
    readableBody = representation.readable;
    result.bodySources = representation.sources;
    // MIME section separators are also subject to the final text-byte ceiling.
    const bytes = Buffer.from(representation.text);
    if (bytes.length > MAX_TEXT_BYTES) {
      diagnose('text_byte_limit');
      result.bodyText = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, MAX_TEXT_BYTES), { stream: true });
    } else result.bodyText = representation.text;
  }
  result.coverage = result.diagnostics.length ? (readableBody || result.links.length ? 'partial' : 'unavailable') : 'complete';
  return result;
}
