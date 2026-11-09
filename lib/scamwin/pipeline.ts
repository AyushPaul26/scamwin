import { randomUUID } from 'node:crypto';
import type { CheckRecord, Observation, OfferIntent, ScamwinStore, RunPatch } from './contracts';
import { extractOfferIntent, compareOfferWithEvidence, ProviderError } from './ai';
import { collectWebsite } from './collector';
import { probeOrigin } from './origin-probe';
import { assessEvidence, userUrlObservation, validateAssessmentEvidence } from './analysis';
import { officialIdentity } from './official-sources';
import { findRelatedCases } from './correlation';

type LookupResult = { status: string; message: string; chainId: number; checkedAt?: string; warnings: { publisher: string; active: boolean; fresh: boolean; trusted: boolean; category: number; revision: number; expiresAt: string }[] };
type Dependencies = { env?: Record<string, string | undefined>; signal?: AbortSignal; extract?: typeof extractOfferIntent; collect?: typeof collectWebsite; probe?: typeof probeOrigin; compare?: typeof compareOfferWithEvidence; lookup?: (hostname: string) => Promise<LookupResult> };
/** Only identifiers enter the durable job payload. All private content is loaded here. */
export async function runInvestigation(checkId: string, generation: number, store: ScamwinStore, dependencies: Dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const initial = await store.getInternalCheck(checkId);
  if (!initial || initial.generation !== generation) return;
  if (initial.state === 'cancel_requested') { await store.updateRun(checkId, generation, initial.revision, { state: 'canceled' }); return; }
  let check: CheckRecord | null = await store.claimRun(checkId, generation);
  if (!check) return; // Duplicate delivery cannot acquire a second run.
  const ownerId = check.ownerId, source = { checkId, runId: check.runId };
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(240_000), ...(dependencies.signal ? [dependencies.signal] : [])]);
  const watch = setInterval(() => { void store.getInternalCheck(checkId).then(c => { if (!c || c.generation !== generation || !['validating','collecting','analyzing'].includes(c.state)) controller.abort(); }).catch(() => controller.abort()); }, 1500);
  watch.unref();
  const observations: Observation[] = [];
  const add = async (items: Observation[]) => { for (const item of items) { signal.throwIfAborted(); observations.push(await store.saveObservation(ownerId, item)); } };
  const missing = (kind: string, reason: string, sourceKind: Observation['sourceKind'] = 'user_text'): Observation => ({ ...source, id: randomUUID(), kind, status: 'unavailable', sourceKind, sourceRef: 'provider-status', observedAt: new Date().toISOString(), data: { reason }, collectorVersion: 'scamwin-1', policyVersion: 'scamwin-fixture-v1' });
  const patch = async (value: RunPatch) => {
    signal.throwIfAborted(); const current = await store.getInternalCheck(checkId);
    if (!current || current.generation !== generation || current.state === 'cancel_requested') { controller.abort(); signal.throwIfAborted(); }
    check = await store.updateRun(checkId, generation, current!.revision, value);
    if (!check) throw Error('stale_run');
  };
  try {
    await add(userUrlObservation(check.input, source));
    await add([{ ...source, id: randomUUID(), kind: 'submitted_offer', status: 'observed', sourceKind: 'user_text', sourceRef: 'your-submission', observedAt: new Date().toISOString(), data: { message: check.input.message, promisedBenefit: check.input.promisedBenefit, intendedAction: check.input.intendedAction }, collectorVersion: 'scamwin-1', policyVersion: 'scamwin-fixture-v1' }]);
    for(const artifact of (await store.listArtifacts(ownerId,checkId)).filter(item=>item.kind==='input')) await add([{...source,id:randomUUID(),kind:'submitted_image',status:'observed',sourceKind:'user_image',sourceRef:artifact.name,observedAt:artifact.createdAt,artifactId:artifact.id,data:{sha256:artifact.sha256,qrPayloadStatus:'not_decoded',description:'A user-supplied screenshot, not a live observation of the website. No model-guessed QR payload is used as a recipient.'},collectorVersion:'scamwin-intake-1',policyVersion:'scamwin-fixture-v1'}]);
    let intent: OfferIntent | undefined;
    try { intent = await (dependencies.extract ?? extractOfferIntent)({ ...check.input, images: check.input.images.filter(image => image.dataUrl) }, { env, signal }); }
    catch (error) { signal.throwIfAborted(); await add([missing('offer_extraction', error instanceof ProviderError ? error.message : 'AI offer extraction could not be completed.')]); }
    await patch({ ...(intent ? { intent } : {}), state: 'collecting', stages: [{ id: 'intake', label: 'Validate your offer', status: intent ? 'completed' : 'unavailable' }, { id: 'evidence', label: 'Collect available evidence', status: 'running' }, { id: 'assessment', label: 'Explain the findings', status: 'pending' }] });
    const collection = await (dependencies.collect ?? collectWebsite)(check!.input.url, source, { env, signal });
    await add(collection.observations);
    for (const image of collection.captures) {
      signal.throwIfAborted(); const artifact = await store.saveArtifact(ownerId, { ...image, ...source, kind: 'capture' });
      await add([{ ...source, id: randomUUID(), kind: 'capture', status: 'observed', sourceKind: 'live_page', sourceRef: check!.input.url, observedAt: new Date().toISOString(), artifactId: artifact.id, data: { sha256: artifact.sha256 }, collectorVersion: 'scamwin-browser-1', policyVersion: 'scamwin-fixture-v1' }]);
    }
    await add([await (dependencies.probe ?? probeOrigin)(check!.input.url, source, { env, signal })]);
    if (check!.input.url) {
      let registry: LookupResult;
      if (dependencies.lookup) registry = await dependencies.lookup(new URL(check!.input.url).hostname);
      else if (!env.SCAMWIN_REGISTRY_ADDRESS || !env.SCAMWIN_REGISTRY_PUBLISHER) registry = { status: 'unconfigured', chainId: 84532, warnings: [], message: 'The shared warning registry is not configured.' };
      else registry = await (await import('./registry')).lookupRegistry(new URL(check!.input.url).hostname);
      await add([{ ...source, id: randomUUID(), kind: 'registry_lookup', status: registry.status === 'ready' ? 'observed' : 'unavailable', sourceKind: 'registry', sourceRef: 'base-sepolia:84532', observedAt: registry.checkedAt ?? new Date().toISOString(), data: { fresh: registry.status === 'ready', warnings: registry.warnings.length, ...(registry.status === 'ready' ? {} : { reason: registry.message }) }, collectorVersion: 'scamwin-registry-1', policyVersion: 'scamwin-fixture-v1' }]);
      for (const warning of registry.warnings) await add([{ ...source, id: randomUUID(), kind: 'registry_warning', status: 'observed', sourceKind: 'registry', sourceRef: 'base-sepolia:84532', observedAt: registry.checkedAt ?? new Date().toISOString(), data: { ...warning }, collectorVersion: 'scamwin-registry-1', policyVersion: 'scamwin-fixture-v1' }]);
    }
    await patch({ state: 'analyzing' });
    if (intent) {
      await add(officialIdentity(intent, check!.input.url, source, env));
      try {
        const concerns = await (dependencies.compare ?? compareOfferWithEvidence)(intent, observations, { env, signal });
        for (const concern of concerns) await add([{ ...source, id: randomUUID(), kind: 'semantic_mismatch', status: 'observed', sourceKind: 'live_page', sourceRef: check!.input.url, observedAt: new Date().toISOString(), data: { description: concern.explanation, quote: concern.quote, basedOnEvidenceId: concern.evidenceId }, collectorVersion: 'scamwin-ai-comparison-1', policyVersion: 'scamwin-fixture-v1' }]);
      } catch (error) { signal.throwIfAborted(); await add([missing('offer_comparison', error instanceof ProviderError ? error.message : 'The offer and page comparison could not be completed.')]); }
    }
    let relation: Awaited<ReturnType<typeof findRelatedCases>>;
    try { relation = await findRelatedCases(ownerId, checkId, check!.input.url, observations, store, env); }
    catch { relation = { status: 'unavailable', relatedCases: [], message: 'Private indicator correlation was unavailable. No match or absence of matches was inferred.' }; }
    await add([{ ...source, id: randomUUID(), kind: 'related_lookup', status: relation.status === 'available' ? 'observed' : 'unavailable', sourceKind: 'user_text', sourceRef: 'your-private-history', observedAt: new Date().toISOString(), data: { reason: relation.message, matches: relation.relatedCases.length }, collectorVersion: 'scamwin-correlation-1', policyVersion: 'scamwin-fixture-v1' }]);
    const relatedCases = relation.relatedCases;
    const assessment = validateAssessmentEvidence(assessEvidence(check!.input, observations, intent), observations.map(item => item.id));
    await patch({ state: assessment.missingChecks.length ? 'partial' : 'completed', assessment, relatedCases, stages: [{ id: 'intake', label: 'Validate your offer', status: intent ? 'completed' : 'unavailable' }, { id: 'evidence', label: 'Collect available evidence', status: assessment.missingChecks.length ? 'unavailable' : 'completed' }, { id: 'assessment', label: 'Explain the findings', status: 'completed' }] });
  } catch {
    const latest = await store.getInternalCheck(checkId);
    if (latest?.generation === generation && ['queued', 'validating', 'collecting', 'analyzing', 'cancel_requested'].includes(latest.state)) await store.updateRun(checkId, generation, latest.revision, { state: latest.state === 'cancel_requested' ? 'canceled' : 'failed', errorCode: signal.aborted ? 'deadline_or_cancellation' : 'investigation_unavailable', availability: 'The investigation stopped before a complete assessment could be saved. Existing observations remain available.' });
  } finally { clearInterval(watch); controller.abort(); }
}
