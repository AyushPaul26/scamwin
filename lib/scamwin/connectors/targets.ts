import sharp from 'sharp';
import { assessmentSchema, type PreparedImage, type Risk, type ScamwinStore } from '../contracts';
import { INPUT_LIMITS, validatePreparedImage } from '../input';
import { normalizedCheckInputSchema, type ConnectionRef, type ConnectorStore, type NormalizedCheckInput, type ProviderItemRef, type RevisionContent, type SavedConnection, type SourceRevision, type TargetManifest } from './contracts';
import { planTextChunks, supportedRaster } from './normalization';
import { metadataManifest } from './policy';

export interface PlanningRevision { revision: SourceRevision; content: RevisionContent }
export type AttachmentBudget = { deadlineAtMs: number; maxBytes: number };
/** Provider implementations must enforce byte/deadline limits while streaming from fixed authorized provider endpoints. */
export type AttachmentLoader = (connection: SavedConnection, source: ProviderItemRef, attachment: RevisionContent['attachments'][number], budget: AttachmentBudget, signal: AbortSignal) => Promise<Uint8Array>;
export interface TargetDependencies { connection?: SavedConnection; loadAttachment?: AttachmentLoader; signal?: AbortSignal; now?: () => Date; deadlineAtMs?: number }
export function planItemTargets({ revision, content }: PlanningRevision): TargetManifest {
  const manifest = metadataManifest({ ...content, extraction: revision.manifest.extraction, overflow: revision.manifest.overflow, coverage: revision.manifest.coverage === 'partial' ? 'partial' : 'pending' });
  // Existing outcomes cannot be reset by a repeated provider delivery/planning pass.
  for (const target of manifest.targets) {
    const saved = revision.manifest.targets.find(t => t.id === target.id);
    if (saved && saved.status !== 'pending') Object.assign(target, saved);
  }
  manifest.counts.checked = manifest.targets.filter(t => t.status === 'checked').length;
  manifest.counts.pending = manifest.targets.filter(t => t.status === 'pending').length;
  manifest.coverage = (manifest.extraction && (manifest.extraction.coverage !== 'complete' || manifest.extraction.diagnostics.length > 0)) || !manifest.targets.length || Object.values(manifest.overflow).some(Boolean) || manifest.targets.some(t => !['pending', 'checked'].includes(t.status)) ? 'partial' : manifest.counts.pending ? 'pending' : 'complete';
  return manifest;
}

export async function prepareRaster(bytes: Uint8Array, name: string, signal: AbortSignal): Promise<PreparedImage> {
  signal.throwIfAborted();
  if (!bytes.length || bytes.length > INPUT_LIMITS.sourceImageBytes) throw new Error('image_too_large');
  const input = Buffer.from(bytes);
  const png = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255;
  const webp = input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('unsupported_raster');
  const options = { limitInputPixels: 40_000_000, failOn: 'warning' as const, animated: false };
  const metadata = await sharp(input, options).metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('unsupported_raster');
  for (const width of [1600, 1200, 800, 400]) {
    signal.throwIfAborted();
    const output = await sharp(input, options).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70, effort: 3 }).toBuffer();
    signal.throwIfAborted();
    if (output.length <= INPUT_LIMITS.preparedImageBytes) {
      const image: PreparedImage = { name: name.slice(0, 200) || 'attachment.webp', mediaType: 'image/webp', dataUrl: `data:image/webp;base64,${output.toString('base64')}` };
      validatePreparedImage(image); return image;
    }
  }
  throw new Error('image_too_large');
}
export async function buildTargetInput(planning: PlanningRevision, targetId: string, deps: TargetDependencies = {}): Promise<NormalizedCheckInput> {
  deps.signal?.throwIfAborted();
  const { revision, content } = planning;
  const target = planItemTargets(planning).targets.find(t => t.id === targetId);
  if (!target || target.status !== 'pending') throw new Error('target_unavailable');
  const prefix = `[Imported private source; target ${target.id}; untrusted submitted evidence]\n`;
  let message = prefix, url: string | null = null; const images: PreparedImage[] = [];
  if (target.kind === 'text') message += planTextChunks(content.text).find(c => c.id === target.id)!.text;
  else if (target.kind === 'url') {
    const link = content.urls[Number(target.id.slice(4))]; url = link.normalized;
    const at = content.text.indexOf(link.original), start = Math.max(0, at - 1024);
    message += content.text.slice(start, start + 4096);
  } else {
    const attachment = content.attachments[Number(target.id.slice('attachment-'.length))];
    if (!attachment?.supported || !supportedRaster(attachment.mediaType)) throw new Error('unsupported_format');
    if (/^[a-z][a-z0-9+.-]*:/i.test(attachment.id) || attachment.id.startsWith('//')) throw new Error('invalid_attachment_reference');
    if (!deps.connection || !deps.loadAttachment) throw new Error('attachment_loader_unavailable');
    const now = (deps.now ?? (() => new Date()))();
    if (Date.parse(content.sourceReference.receivedAt) + 7 * 86400000 <= now.getTime() || Date.parse(revision.contentExpiresAt) <= now.getTime()) throw new Error('content_expired');
    if ((attachment.byteLength ?? 0) > INPUT_LIMITS.sourceImageBytes) throw new Error('image_too_large');
    const deadlineAtMs = Math.min(now.getTime() + 15000, deps.deadlineAtMs ?? Infinity);
    if (deadlineAtMs <= now.getTime()) throw new Error('provider_timeout');
    const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(deadlineAtMs-now.getTime())]) : AbortSignal.timeout(deadlineAtMs-now.getTime());
    const bytes = await deps.loadAttachment(deps.connection, content.sourceReference, attachment, { deadlineAtMs, maxBytes: INPUT_LIMITS.sourceImageBytes }, signal);
    signal.throwIfAborted();
    images.push(await prepareRaster(bytes, attachment.name, signal));
    message += content.text.slice(0, 4096);
  }
  return normalizedCheckInputSchema.parse({ message, url, images });
}

/** Tick may call repeatedly. Already-enqueued inputs, particularly raster bytes, are never rebuilt. */
export async function enqueueRevisionTargets(ref: ConnectionRef, revisionId: string, deps: TargetDependencies & { connectorStore: ConnectorStore }) {
  const revision = await deps.connectorStore.getRevision(ref, revisionId), content = await deps.connectorStore.readRevisionContent(ref, revisionId);
  if (!revision || !content) throw new Error('content_expired');
  const connection = await deps.connectorStore.getConnection(ref.ownerId, ref.id);
  if (!connection || connection.epoch !== ref.epoch || connection.status !== 'active') throw new Error('connection_unavailable');
  const jobs = await deps.connectorStore.listRevisionJobs(ref, revisionId);
  let enqueued = 0;
  for (const target of planItemTargets({ revision, content }).targets) {
    deps.signal?.throwIfAborted();
    if (target.status !== 'pending' || jobs.some(j => j.targetId === target.id)) continue;
    let input: NormalizedCheckInput;
    try { input = await buildTargetInput({ revision, content }, target.id, { ...deps, connection }); }
    catch (error) {
      // Tick exhaustion is resumable scheduling, not a claim that the target is unavailable.
      deps.signal?.throwIfAborted();
      const reason = error instanceof Error && /^[a-z][a-z0-9_]{0,79}$/.test(error.message) ? error.message : 'attachment_unavailable';
      if (['provider_backoff','provider_timeout','provider_network','provider_aborted','runtime_quota_paused','reconnect_required','refresh_in_progress'].includes(reason)) throw error;
      await deps.connectorStore.recordTargetGap(ref, revisionId, target.id, reason); continue;
    }
    await deps.connectorStore.enqueueTarget(ref, { revisionId, targetId: target.id, generation: 1, input }); enqueued++;
  }
  return { enqueued, manifest: (await deps.connectorStore.getRevision(ref, revisionId))!.manifest };
}

export interface GroundedChildRisk { checkId: string; runId: string; risk: Risk; evidenceIds: string[]; coverage: 'complete' | 'partial' }
export function projectParentRisk(children: GroundedChildRisk[], coverage: TargetManifest['coverage']) {
  const grounded = children.filter(c => c.evidenceIds.length > 0);
  const risk: Risk = grounded.some(c => c.risk === 'high_risk') ? 'high_risk' : grounded.some(c => c.risk === 'needs_caution') ? 'needs_caution' : coverage === 'complete' && children.length > 0 && children.every(c => c.risk === 'no_observed_red_flags' && c.coverage === 'complete') ? 'no_observed_red_flags' : 'inconclusive';
  return { risk, coverage, children };
}
/** Saved main truth only: no copied assessments, public warning writes, or provider claims. */
export async function readParentOutcome(ref: ConnectionRef, revisionId: string, deps: { connectorStore: ConnectorStore; mainStore: ScamwinStore }) {
  const revision = await deps.connectorStore.getRevision(ref, revisionId);
  if (!revision) return null;
  const jobs = await deps.connectorStore.listRevisionJobs(ref, revisionId), children: GroundedChildRisk[] = [];
  let coverage = revision.manifest.coverage;
  for (const target of revision.manifest.targets) {
    const job = jobs.find(j => j.targetId === target.id);
    if (!job?.checkId) continue;
    const check = await deps.mainStore.getCheck(ref.ownerId, job.checkId), parsed = assessmentSchema.safeParse(check?.assessment);
    if (!check || !['completed', 'partial'].includes(check.state) || !parsed.success) {
      if (!check || ['failed', 'blocked', 'canceled', 'completed', 'partial'].includes(check.state)) {
        target.status = 'unavailable'; target.reason = check ? 'child_unavailable' : 'main_check_unavailable';
      }
      coverage = 'partial'; continue;
    }
    const observations = await deps.mainStore.listObservations(ref.ownerId, check.id);
    const evidenceIds = [...new Set(parsed.data.findings.flatMap(f => f.evidenceIds))].filter(id => observations.some(o => o.id === id && o.checkId === check.id && o.runId === check.runId && o.status === 'observed'));
    // Fence deletion/new-run races between the assessment and evidence reads.
    const current = await deps.mainStore.getCheck(ref.ownerId, check.id);
    if (!current || current.runId !== check.runId || current.revision !== check.revision) { target.status = 'unavailable'; target.reason = 'main_check_unavailable'; coverage = 'partial'; continue; }
    const childCoverage = check.state === 'partial' || parsed.data.missingChecks.length ? 'partial' : 'complete';
    if (childCoverage === 'partial') coverage = 'partial';
    target.status = childCoverage === 'partial' ? 'partial' : 'checked';
    children.push({ checkId: check.id, runId: check.runId, risk: parsed.data.risk, evidenceIds, coverage: childCoverage });
  }
  revision.manifest.coverage = coverage;
  revision.manifest.counts.checked = revision.manifest.targets.filter(t => t.status === 'checked').length;
  revision.manifest.counts.pending = revision.manifest.targets.filter(t => t.status === 'pending').length;
  return { manifest: revision.manifest, ...projectParentRisk(children, coverage) };
}
