import { randomUUID } from 'node:crypto';
import type { Observation, OfferIntent, ScamwinStore } from './contracts';
import { extractOfferIntent, compareOfferWithEvidence, ProviderError } from './ai';
import { collectWebsite } from './collector';
import { probeOrigin } from './origin-probe';
import { assessEvidence, userUrlObservation, validateAssessmentEvidence } from './analysis';
import { officialIdentity } from './official-sources';
import { findRelatedCases } from './correlation';
import { createProgressWriter, finishInterruptedStages } from './progress';
import { sealLiveViewLocator } from './live-view-crypto';
import { isApprovedLiveViewUrl } from './live-view-provider';
import { verifyOfficialOffer } from './official-verification';
import { officialCatalog } from './official-source-catalog';
import { readOfficialSource } from './official-source-reader';

type LookupResult = { status: string; message: string; chainId: number; checkedAt?: string; warnings: { publisher: string; active: boolean; fresh: boolean; trusted: boolean; category: number; revision: number; expiresAt: string }[] };
type Dependencies = { env?: Record<string, string | undefined>; signal?: AbortSignal; extract?: typeof extractOfferIntent; collect?: typeof collectWebsite; probe?: typeof probeOrigin; compare?: typeof compareOfferWithEvidence; lookup?: (hostname: string) => Promise<LookupResult>; verifyOfficial?: typeof verifyOfficialOffer };
/** Only identifiers enter the durable job payload. All private content is loaded here. */
export async function runInvestigation(checkId: string, generation: number, store: ScamwinStore, dependencies: Dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const initial = await store.getInternalCheck(checkId);
  if (!initial || initial.generation !== generation) return;
  if (initial.state === 'cancel_requested') { await store.updateRun(checkId, generation, initial.revision, { state: 'canceled' }); return; }
  const check = await store.claimRun(checkId, generation);
  if (!check) return; // Duplicate delivery cannot acquire a second run.
  const ownerId = check.ownerId, source = { checkId, runId: check.runId };
  const pipelineDeadlineAtMs = Date.now() + 240_000;
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(240_000), ...(dependencies.signal ? [dependencies.signal] : [])]);
  const progress = createProgressWriter(checkId, generation, store, { signal });
  const liveScope = { ownerId, checkId, runId: check.runId, generation };
  let liveSessionId: string | undefined;
  let liveAbandoned = false;
  const retireLiveView = async (reasonCode: string) => {
    liveAbandoned = true;
    if (liveSessionId) await store.updateLiveView(liveScope, liveSessionId, { status: 'ended', endedAt: new Date().toISOString(), reasonCode }).catch(() => false);
  };
  const unavailableLiveView = async (reasonCode: string) => {
    liveAbandoned = true;
    liveSessionId ??= randomUUID();
    const at = new Date().toISOString(), expiresAt = new Date(Math.min(Date.now() + 60_000, Date.parse(check.createdAt) + 300_000)).toISOString();
    // A no-locator tombstone races safely with a delayed mint-persistence callback.
    await store.putLiveView(liveScope, { sessionId: liveSessionId, scope: liveScope, status: 'unavailable', encryptedLocator: null, createdAt: at, expiresAt, endedAt: at, reasonCode }).catch(() => false);
    await store.updateLiveView(liveScope, liveSessionId, { status: 'unavailable', endedAt: at, reasonCode }).catch(() => false);
  };
  const watch = setInterval(() => { void store.getInternalCheck(checkId).then(c => { if (!c || c.generation !== generation || !['validating','collecting','analyzing'].includes(c.state)) controller.abort(); }).catch(() => controller.abort()); }, 1500);
  watch.unref();
  const observations: Observation[] = [];
  const add = async (items: Observation[]) => { for (const item of items) { signal.throwIfAborted(); observations.push(await store.saveObservation(ownerId, item)); } };
  const missing = (kind: string, reason: string, sourceKind: Observation['sourceKind'] = 'user_text'): Observation => ({ ...source, id: randomUUID(), kind, status: 'unavailable', sourceKind, sourceRef: 'provider-status', observedAt: new Date().toISOString(), data: { reason }, collectorVersion: 'scamwin-1', policyVersion: 'scamwin-fixture-v1' });
  try {
    await progress.beginStage('intake');
    await add(userUrlObservation(check.input, source));
    await add([{ ...source, id: randomUUID(), kind: 'submitted_offer', status: 'observed', sourceKind: 'user_text', sourceRef: 'your-submission', observedAt: new Date().toISOString(), data: { message: check.input.message, promisedBenefit: check.input.promisedBenefit, intendedAction: check.input.intendedAction }, collectorVersion: 'scamwin-1', policyVersion: 'scamwin-fixture-v1' }]);
    for(const artifact of (await store.listArtifacts(ownerId,checkId)).filter(item=>item.kind==='input')) await add([{...source,id:randomUUID(),kind:'submitted_image',status:'observed',sourceKind:'user_image',sourceRef:artifact.name,observedAt:artifact.createdAt,artifactId:artifact.id,data:{sha256:artifact.sha256,qrPayloadStatus:'not_decoded',description:'A user-supplied screenshot, not a live observation of the website. No model-guessed QR payload is used as a recipient.'},collectorVersion:'scamwin-intake-1',policyVersion:'scamwin-fixture-v1'}]);
    let intent: OfferIntent | undefined;
    try { intent = await (dependencies.extract ?? extractOfferIntent)({ ...check.input, images: check.input.images.filter(image => image.dataUrl) }, { env, signal }); }
    catch (error) { signal.throwIfAborted(); await add([missing('offer_extraction', error instanceof ProviderError ? error.message : 'AI offer extraction could not be completed.')]); }
    await progress.finishStage('intake', intent ? 'completed' : 'unavailable');
    await progress.patchRun({ ...(intent ? { intent } : {}), state: 'collecting' });
    await progress.beginStage('browser');
    if (env.SCAMWIN_LIVE_VIEW_ENABLED === 'true' && !/^[a-fA-F0-9]{64}$/.test(env.SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY ?? '')) await unavailableLiveView('viewer_key_missing');
    const collection = await (dependencies.collect ?? collectWebsite)(check.input.url, source, {
      env, signal,
      onProgress: async phase => { await progress.detailStage('browser', phase); },
      ...(env.SCAMWIN_LIVE_VIEW_ENABLED === 'true' && /^[a-fA-F0-9]{64}$/.test(env.SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY ?? '') ? {
        onLiveViewReady: async (view: { liveURL: string; issuedAt: string; expiresAt: string; providerOrigin: string }) => {
          signal.throwIfAborted();
          if (!isApprovedLiveViewUrl(view.liveURL, view.providerOrigin)) throw Error('live_view_invalid_response');
          if (liveAbandoned) throw Error('live_view_stopped');
          const sessionId = randomUUID(), expiresAt = new Date(Math.min(Date.parse(view.expiresAt), Date.parse(check.createdAt) + 300_000)).toISOString();
          liveSessionId = sessionId;
          const binding = { scope: liveScope, sessionId, expiresAt };
          const encryptedLocator = sealLiveViewLocator(view.liveURL, binding, env);
          const saved = await store.putLiveView(liveScope, { sessionId, scope: liveScope, status: 'ready', encryptedLocator, createdAt: view.issuedAt, expiresAt });
          if (liveAbandoned || signal.aborted) {
            await store.updateLiveView(liveScope, sessionId, { status: 'unavailable', reasonCode: 'viewer_stopped' }).catch(() => false);
            throw Error('live_view_stopped');
          }
          if (!saved) throw Error('live_view_stopped');
        },
        onLiveViewConnected: async () => {
          if (liveSessionId && !liveAbandoned && !signal.aborted) await store.updateLiveView(liveScope, liveSessionId, { status: 'connected', connectedAt: new Date().toISOString() });
        },
        onLiveViewEnded: async ({ reasonCode }: { reasonCode: string }) => { await retireLiveView(reasonCode); },
        onLiveViewUnavailable: async ({ reasonCode }: { reasonCode: string }) => {
          await unavailableLiveView(reasonCode);
        },
      } : {}),
    });
    await retireLiveView('collection_complete');
    await add(collection.observations);
    for (const image of collection.captures) {
      signal.throwIfAborted(); const artifact = await store.saveArtifact(ownerId, { ...image, ...source, kind: 'capture' });
      await add([{ ...source, id: randomUUID(), kind: 'capture', status: 'observed', sourceKind: 'live_page', sourceRef: check!.input.url, observedAt: new Date().toISOString(), artifactId: artifact.id, data: { sha256: artifact.sha256 }, collectorVersion: 'scamwin-browser-1', policyVersion: 'scamwin-fixture-v1' }]);
    }
    await progress.finishStage('browser', collection.observations.some(item => item.kind === 'page' && item.status === 'observed') ? (collection.observations.some(item => item.status === 'blocked') ? 'blocked' : 'completed') : 'unavailable');
    await progress.beginStage('trust');
    const trust = await (dependencies.probe ?? probeOrigin)(check.input.url, source, { env, signal });
    await add([trust]);
    await progress.finishStage('trust', trust.status === 'observed' ? 'completed' : trust.status === 'blocked' ? 'blocked' : trust.status === 'not_applicable' || trust.status === 'not_checked' ? 'skipped' : 'unavailable');
    await progress.beginStage('registry');
    let registryAvailable = false;
    if (check!.input.url) {
      let registry: LookupResult;
      if (dependencies.lookup) registry = await dependencies.lookup(new URL(check!.input.url).hostname);
      else if (!env.SCAMWIN_REGISTRY_ADDRESS || !env.SCAMWIN_REGISTRY_PUBLISHER) registry = { status: 'unconfigured', chainId: 84532, warnings: [], message: 'The shared warning registry is not configured.' };
      else registry = await (await import('./registry')).lookupRegistry(new URL(check!.input.url).hostname);
      registryAvailable = registry.status === 'ready';
      await add([{ ...source, id: randomUUID(), kind: 'registry_lookup', status: registry.status === 'ready' ? 'observed' : 'unavailable', sourceKind: 'registry', sourceRef: 'base-sepolia:84532', observedAt: registry.checkedAt ?? new Date().toISOString(), data: { fresh: registry.status === 'ready', warnings: registry.warnings.length, ...(registry.status === 'ready' ? {} : { reason: registry.message }) }, collectorVersion: 'scamwin-registry-1', policyVersion: 'scamwin-fixture-v1' }]);
      for (const warning of registry.warnings) await add([{ ...source, id: randomUUID(), kind: 'registry_warning', status: 'observed', sourceKind: 'registry', sourceRef: 'base-sepolia:84532', observedAt: registry.checkedAt ?? new Date().toISOString(), data: { ...warning }, collectorVersion: 'scamwin-registry-1', policyVersion: 'scamwin-fixture-v1' }]);
    }
    await progress.finishStage('registry', !check.input.url ? 'skipped' : registryAvailable ? 'completed' : 'unavailable');
    if (env.SCAMWIN_OFFICIAL_VERIFICATION_ENABLED === 'true') {
      await progress.beginStage('official');
      try {
        const official = await (dependencies.verifyOfficial ?? verifyOfficialOffer)({ input: check.input, intent: intent ?? null, scope: source, signal, pipelineDeadlineAtMs, checkExpiresAt: check.expiresAt }, { catalog: officialCatalog, reader: readOfficialSource, now: () => new Date(), makeId: randomUUID });
        await add(official);
        const checked = official.some(item => item.kind === 'official_document' && item.status === 'observed');
        const applicable = official.some(item => item.kind === 'official_offer' && item.data.offerStatus !== 'not_applicable');
        await progress.finishStage('official', checked ? 'completed' : applicable ? 'unavailable' : 'skipped');
      } catch {
        signal.throwIfAborted();
        await add([missing('official_verification_failure', 'Official-source verification could not be completed. No company or offer was cleared.', 'official_source')]);
        await progress.finishStage('official', 'unavailable');
      }
    } else await progress.finishStage('official', 'skipped');
    await progress.patchRun({ state: 'analyzing' });
    await progress.beginStage('comparison');
    let comparisonAvailable = Boolean(intent && observations.some(item => item.kind === 'page' && item.sourceKind === 'live_page' && item.status === 'observed'));
    if (intent) {
      if (env.SCAMWIN_OFFICIAL_VERIFICATION_ENABLED !== 'true') await add(officialIdentity(intent, check!.input.url, source, env));
      try {
        const concerns = await (dependencies.compare ?? compareOfferWithEvidence)(intent, observations, { env, signal });
        for (const concern of concerns) await add([{ ...source, id: randomUUID(), kind: 'semantic_mismatch', status: 'observed', sourceKind: 'live_page', sourceRef: check!.input.url, observedAt: new Date().toISOString(), data: { description: concern.explanation, quote: concern.quote, basedOnEvidenceId: concern.evidenceId }, collectorVersion: 'scamwin-ai-comparison-1', policyVersion: 'scamwin-fixture-v1' }]);
      } catch (error) { signal.throwIfAborted(); comparisonAvailable = false; await add([missing('offer_comparison', error instanceof ProviderError ? error.message : 'The offer and page comparison could not be completed.')]); }
    }
    let relation: Awaited<ReturnType<typeof findRelatedCases>>;
    try { relation = await findRelatedCases(ownerId, checkId, check!.input.url, observations, store, env); }
    catch { relation = { status: 'unavailable', relatedCases: [], message: 'Private indicator correlation was unavailable. No match or absence of matches was inferred.' }; }
    await add([{ ...source, id: randomUUID(), kind: 'related_lookup', status: relation.status === 'available' ? 'observed' : 'unavailable', sourceKind: 'user_text', sourceRef: 'your-private-history', observedAt: new Date().toISOString(), data: { reason: relation.message, matches: relation.relatedCases.length }, collectorVersion: 'scamwin-correlation-1', policyVersion: 'scamwin-fixture-v1' }]);
    const relatedCases = relation.relatedCases;
    await progress.finishStage('comparison', comparisonAvailable ? 'completed' : 'unavailable');
    await progress.beginStage('assessment');
    const assessment = validateAssessmentEvidence(assessEvidence(check!.input, observations, intent), observations.map(item => item.id));
    await progress.finishStage('assessment', 'completed', { state: assessment.missingChecks.length ? 'partial' : 'completed', assessment, relatedCases });
  } catch {
    await progress.flush();
    const latest = await store.getInternalCheck(checkId);
    if (latest?.generation === generation && ['queued', 'validating', 'collecting', 'analyzing', 'cancel_requested'].includes(latest.state)) await store.updateRun(checkId, generation, latest.revision, { state: latest.state === 'cancel_requested' ? 'canceled' : 'failed', stages: finishInterruptedStages(latest.stages, latest.state === 'cancel_requested' ? 'canceled' : 'unavailable', new Date().toISOString()), errorCode: signal.aborted ? 'deadline_or_cancellation' : 'investigation_unavailable', availability: 'The investigation stopped before a complete assessment could be saved. Existing observations remain available.' });
  } finally { clearInterval(watch); controller.abort(); await retireLiveView('investigation_ended'); }
}
