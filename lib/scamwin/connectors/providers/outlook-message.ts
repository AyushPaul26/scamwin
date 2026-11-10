import { createHash } from 'node:crypto';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { ProviderItem } from '../contracts';

export const outlookDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const outlookRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const outlookAttachmentRef = (messageId: string, attachmentId: string) => `outlook-${outlookDigest({ messageId, attachmentId })}`;
export const OUTLOOK_RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEXT_LIMIT = 262144;
const clampUtf8 = (value: string, maximum: number) => {
  const bytes = Buffer.from(value); if (bytes.length <= maximum) return value;
  let end = maximum; while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
};

/** Inert bounded extraction: HTML is never rendered, fetched, or executed. */
export function parseOutlookMessage(raw: Record<string, unknown>, attachments: ProviderItem['attachments'], attachmentDiagnostics: { reason: string; count: number }[] = []) {
  const diagnostics = [...attachmentDiagnostics];
  const diagnostic = (reason: string, count = 1) => { const prior = diagnostics.find(d => d.reason === reason); if (prior) prior.count += count; else diagnostics.push({ reason, count }); };
  let text = '', urlsOverflow = 0, textOverflow = 0, unavailable = false, inlineAttachments = false;
  const field = (value: unknown) => {
    if (typeof value !== 'string') return '';
    const clean = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''), bounded = clampUtf8(clean, 2048);
    if (bounded !== clean) { diagnostic('metadata_byte_limit'); textOverflow += Buffer.byteLength(clean) - Buffer.byteLength(bounded); }
    return bounded;
  };
  const urls: string[] = [], seen = new Set<string>();
  const addUrl = (value: string) => {
    if (value.length > 4096) { diagnostic('link_length_limit'); return; }
    let url: URL; try { url = new URL(value); } catch { return; }
    if (!['https:', 'http:'].includes(url.protocol)) return;
    if (url.username || url.password) { diagnostic('credentialed_link'); return; }
    if (seen.has(value)) return; seen.add(value);
    if (urls.length === 200) { urlsOverflow++; return; }
    urls.push(value);
  };
  const body = raw.body;
  if (!outlookRecord(body) || typeof body.content !== 'string' || !['text', 'html'].includes(String(body.contentType).toLowerCase())) {
    diagnostic('body_unavailable'); unavailable = true;
  } else if (String(body.contentType).toLowerCase() === 'text') text = body.content;
  else {
    const tree = parseFragment(body.content, { scriptingEnabled: false }); const stack: DefaultTreeAdapterTypes.Node[] = [tree]; const pieces: string[] = []; let visited = 0;
    while (stack.length) {
      if (++visited > 20000) { diagnostic('html_node_limit'); break; }
      const node = stack.pop()!;
      if ('tagName' in node && ['iframe', 'object', 'svg'].includes(node.tagName)) diagnostic('embedded_content_unavailable');
      if ('tagName' in node && ['script', 'style', 'template', 'iframe', 'svg'].includes(node.tagName)) continue;
      if (node.nodeName === '#text') pieces.push((node as DefaultTreeAdapterTypes.TextNode).value);
      if ('tagName' in node) {
        if (node.tagName === 'a') for (const attr of node.attrs) if (attr.name === 'href') addUrl(attr.value);
        if (node.tagName === 'img') for (const attr of node.attrs) if (attr.name === 'src' && attr.value.trim()) {
          if (/^cid:/i.test(attr.value.trim())) inlineAttachments = true;
          else diagnostic('remote_image_unavailable');
        }
        if (['p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3'].includes(node.tagName)) pieces.push('\n');
      }
      if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
    }
    text = pieces.join('');
  }
  if (!unavailable) {
    for (const match of text.matchAll(/https?:\/\/[^\s<>"\u0000-\u001f]+/g)) {
      let destination = match[0].replace(/[,.;!?]+$/, '');
      while (destination.endsWith(')') && (destination.match(/\)/g)?.length ?? 0) > (destination.match(/\(/g)?.length ?? 0)) destination = destination.slice(0, -1);
      addUrl(destination);
    }
    const address = (value: unknown) => outlookRecord(value) && outlookRecord(value.emailAddress) ? field(value.emailAddress.address) : '';
    const context = Object.entries({ subject: field(raw.subject), from: address(raw.from), sender: address(raw.sender), providerReceivedDateTime: field(raw.receivedDateTime), internetMessageId: field(raw.internetMessageId) }).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join('\n');
    text = `${context ? `[Untrusted message claims]\n${context}\n\n` : ''}${text}`;
    const length = Buffer.byteLength(text);
    if (length > TEXT_LIMIT) { text = clampUtf8(text, TEXT_LIMIT); textOverflow += length - Buffer.byteLength(text); diagnostic('text_byte_limit'); }
  }
  if (urlsOverflow) diagnostic('link_limit', urlsOverflow);
  if (raw.hasAttachments === undefined || typeof raw.hasAttachments !== 'boolean') diagnostic('attachment_state_unavailable');
  if (attachments.length) diagnostic('attachment_not_analyzed', attachments.length);
  return { text, urls, inlineAttachments, extraction: { coverage: unavailable ? 'unavailable' as const : diagnostics.length ? 'partial' as const : 'complete' as const, diagnostics, overflow: { textBytes: textOverflow, urls: urlsOverflow, attachments: Math.max(0, attachmentDiagnostics.find(d => d.reason === 'attachment_limit')?.count ?? 0) } } };
}
