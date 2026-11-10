import { isPublicInputUrl } from '../input';
import { planTextChunks, supportedRaster } from './normalization';
import { createHash } from 'node:crypto';
import { attachmentSchema, rulesSchema, type ConnectionMode, type ConnectionRef, type SelectionRules, type ProviderItem, type RevisionContent, type TargetManifest } from './contracts';

export const CONNECTOR_LIMITS = { textBytes: 262144, urls: 200, attachments: 20, contentDays: 30, metadataDays: 90, automaticDay: 8, automaticMonth: 40, ownerAutomaticDay: 1, ownerAutomaticMax: 2, automaticConcurrency: 1 } as const;
export function selectItem(mode: ConnectionMode, rules: SelectionRules, item: { text: string }) {
  rulesSchema.parse(rules);
  if (mode === 'manual') return { selected: false, state: 'paused' as const, reason: 'manual' };
  if (mode === 'all_new') return { selected: true, state: 'queued' as const, reason: 'all_new' };
  if (mode !== 'selective') throw new Error('invalid_mode');
  const selected = (rules.contains ?? []).some(value => item.text.toLocaleLowerCase('en-US').includes(value.toLocaleLowerCase('en-US')));
  return { selected, state: selected ? 'queued' as const : 'not_selected' as const, reason: selected ? 'rules_match' : 'rules_nonmatch' };
}
/** Pure normalization, deliberately performs no network access. Overflow is never reported as completion. */
export function boundManifest(input: Pick<ProviderItem, 'text' | 'urls' | 'attachments' | 'extraction'>): Omit<RevisionContent, 'sourceReference'> & { extraction?: ProviderItem['extraction']; overflow: TargetManifest['overflow']; coverage: 'pending' | 'partial' } {
  const encoded = Buffer.from(input.text, 'utf8');
  let bounded = encoded.subarray(0, CONNECTOR_LIMITS.textBytes);
  // Do not leave a split multi-byte codepoint or synthesize replacement bytes.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text: string;
  while (true) { try { text = decoder.decode(bounded); break; } catch { bounded = bounded.subarray(0, bounded.length - 1); } }
  const seen = new Set<string>(), urls: RevisionContent['urls'] = [];
  let distinct = 0;
  for (const original of input.urls) {
    let normalized: string; try { normalized = new URL(original).href; } catch { normalized = original; }
    if (seen.has(normalized)) continue;
    seen.add(normalized); distinct++;
    if (urls.length < CONNECTOR_LIMITS.urls) urls.push({ original, normalized });
  }
  const attachments = input.attachments.slice(0, CONNECTOR_LIMITS.attachments).map(a => attachmentSchema.parse(a));
  const overflow = { textBytes: encoded.length - bounded.length + (input.extraction?.overflow.textBytes ?? 0), urls: Math.max(0, distinct - urls.length) + (input.extraction?.overflow.urls ?? 0), attachments: Math.max(0, input.attachments.length - attachments.length) + (input.extraction?.overflow.attachments ?? 0) };
  return { text, urls, attachments, overflow, ...(input.extraction ? { extraction: input.extraction } : {}), coverage: (input.extraction && (input.extraction.coverage !== 'complete' || input.extraction.diagnostics.length > 0)) || Object.values(overflow).some(Boolean) || attachments.some(a => !a.supported) ? 'partial' : 'pending' };
}
export function metadataManifest(content: ReturnType<typeof boundManifest>): TargetManifest {
  const targets: TargetManifest['targets'] = [];
  for (const chunk of planTextChunks(content.text)) targets.push({ id: chunk.id, kind: 'text', status: 'pending' });
  content.urls.forEach((u, i) => targets.push({ id: `url-${i}`, kind: 'url', status: isPublicInputUrl(u.normalized) ? 'pending' : 'not_checked', ...(!isPublicInputUrl(u.normalized) ? { reason: 'invalid_public_url' } : {}) }));
  content.attachments.forEach((a, i) => targets.push({ id: `attachment-${i}`, kind: supportedRaster(a.mediaType) && a.supported ? 'image' : 'attachment', status: a.supported && supportedRaster(a.mediaType) ? 'pending' : 'unsupported', ...(a.supported && supportedRaster(a.mediaType) ? {} : { reason: 'unsupported_format' }) }));
  return { targets, ...(content.extraction ? { extraction: content.extraction } : {}), overflow: content.overflow, coverage: content.coverage === 'partial' || !targets.length || targets.some(t => t.status !== 'pending') ? 'partial' : 'pending', counts: { discovered: targets.length + content.overflow.urls + content.overflow.attachments, checked: 0, pending: targets.filter(t => t.status === 'pending').length, unsupported: targets.filter(t => t.status === 'unsupported').length } };
}
export function admissionKey(ref: ConnectionRef, itemId: string, revisionHash: string, targetId: string, generation: number) {
  return createHash('sha256').update(JSON.stringify([ref.id, ref.epoch, itemId, revisionHash, targetId, generation])).digest('hex');
}
export function canonicalHash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
