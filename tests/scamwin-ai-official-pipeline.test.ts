import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareOfferWithEvidence, extractOfferIntent } from '../lib/scamwin/ai';
import type { CheckInput, Observation, OfferIntent } from '../lib/scamwin/contracts';
import { officialCatalog } from '../lib/scamwin/official-source-catalog';
import { verifyOfficialOffer } from '../lib/scamwin/official-verification';
import { runInvestigation } from '../lib/scamwin/pipeline';
import { MemoryStore } from '../lib/scamwin/store';
import { officialNow } from './fixtures/scamwin-official-fixture';

const listingUrl = 'https://job-boards.greenhouse.io/figma/jobs/5579204004';
const input: CheckInput = {
  url: listingUrl, message: '', promisedBenefit: '', intendedAction: 'share_information',
  claimedCompany: 'Figma', offerReference: '5579204004', images: [],
};
const modelIntent: OfferIntent = {
  promisedBenefit: null, claimedOrganization: 'Figma', intendedAction: 'share_information',
  requestedActions: [], extractedCandidates: [], uncertainties: ['No offer message was supplied.'],
};

async function runFigmaFixture(paymentRequested: boolean) {
  const ownerId = 'synthetic-figma-owner';
  const store = new MemoryStore();
  const submitted = { ...input, ...(paymentRequested ? { intendedAction: 'receive_money' } : {}) };
  const check = await store.createCheck(ownerId, submitted, `figma-ai-${paymentRequested}`);
  const intent = { ...modelIntent, intendedAction: submitted.intendedAction };
  const env = {
    CLOUDFLARE_ACCOUNT_ID: 'synthetic-account', CLOUDFLARE_API_TOKEN: 'synthetic-token',
    SCAMWIN_OFFICIAL_VERIFICATION_ENABLED: 'true', SCAMWIN_INDICATOR_HMAC_SECRET: 's'.repeat(64),
  };
  const observed = (kind: string, data: Observation['data']): Observation => ({
    id: `figma-${kind}`, checkId: check.id, runId: check.runId, kind, data,
    status: 'observed', sourceKind: 'live_page', sourceRef: listingUrl,
    observedAt: officialNow.toISOString(), collectorVersion: 'fixture', policyVersion: 'fixture',
  });
  let extractionCalls = 0, comparisonCalls = 0, officialIds = 0;
  const readSources: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format?.type, 'json_schema');
    const schema = body.response_format.json_schema;
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    if (schema.properties?.promisedBenefit) {
      extractionCalls++;
      assert.deepEqual([...schema.required].sort(), Object.keys(modelIntent).sort());
      assert.match(JSON.stringify(body.messages[1].content), /5579204004/);
      return Response.json({ success: true, result: { response: JSON.stringify(intent) } });
    }
    comparisonCalls++;
    assert.deepEqual(schema.required, ['concerns']);
    assert.match(body.messages[1].content, /figma-page/);
    return Response.json({ success: true, result: { response: { concerns: [] } } });
  };
  await runInvestigation(check.id, 1, store, {
    env,
    extract: (value, options) => extractOfferIntent(value, { ...options, fetcher }),
    compare: (value, evidence, options) => compareOfferWithEvidence(value, evidence, { ...options, fetcher }),
    collect: async () => ({ observations: [
      observed('page', { text: 'Synthetic recruitment page for this pipeline test.', readable: true, complete: true }),
      observed('action_review', { complete: true }),
      ...(paymentRequested ? [observed('payment_action', { direction: 'outgoing', recipient: 'fixture@example', selectedCheckpoint: true })] : []),
    ], captures: [] }),
    probe: async () => ({ ...observed('tls', { valid: true }), sourceKind: 'origin_probe' }),
    lookup: async () => ({ status: 'ready', chainId: 84532, warnings: [], message: '', checkedAt: officialNow.toISOString() }),
    verifyOfficial: (args) => verifyOfficialOffer({ ...args, pipelineDeadlineAtMs: officialNow.getTime() + 240_000 }, {
      catalog: officialCatalog, now: () => new Date(officialNow), makeId: () => `figma-official-${++officialIds}`,
      reader: async (source, reference) => {
        readSources.push(source.id);
        const listing = source.kind === 'greenhouse_job';
        if (listing) assert.deepEqual(reference, { kind: 'greenhouse_post_id', value: '5579204004', origin: 'explicit_field' });
        const url = listing ? 'https://boards-api.greenhouse.io/v1/boards/figma/jobs/5579204004' : source.entryUrl;
        return {
          sourceId: source.id, readUrl: url, finalReadUrl: url, status: 'ok', fetchedAt: officialNow.toISOString(),
          contentType: listing ? 'application/json' : 'text/html', digest: 'a'.repeat(64), reasonCode: null,
          // A synthetic listing response, with the user's exact public reference.
          body: listing ? JSON.stringify({ id: 5579204004, company_name: 'Figma', title: 'Fixture Engineer', location: { name: 'Fixture location' }, content: 'Synthetic published job fixture.' }) : '<title>Fixture careers page</title>',
        };
      },
    }),
  });
  const saved = await store.getCheck(ownerId, check.id);
  const evidence = await store.listObservations(ownerId, check.id);
  assert.ok(saved);
  assert.deepEqual(saved.intent, intent);
  assert.equal(saved.stages.find(stage => stage.id === 'intake')?.status, 'completed');
  assert.equal(saved.stages.find(stage => stage.id === 'comparison')?.status, 'completed');
  assert.equal(saved.stages.find(stage => stage.id === 'official')?.status, 'completed');
  assert.equal(evidence.some(item => item.kind === 'offer_extraction' || item.kind === 'offer_comparison'), false);
  assert.equal(extractionCalls, 1);
  assert.equal(comparisonCalls, 1);
  assert.deepEqual(readSources, ['figma-greenhouse', 'figma-careers']);
  const offer = evidence.find(item => item.kind === 'official_offer');
  assert.equal(offer?.data.offerStatus, 'matched_public_reference');
  assert.equal(offer?.data.referenceValue, '5579204004');
  assert.equal(offer?.data.canonicalListingUrl, listingUrl);
  assert.ok(evidence.some(item => item.kind === 'official_next_step' && item.data.purpose === 'listing' && item.data.canonicalUrl === listingUrl));
  assert.equal((await store.listObservations('another-owner', check.id)).length, 0);
  return saved;
}

test('reference-only Figma extraction reaches a matching official listing without an AI validation gap', async () => {
  const saved = await runFigmaFixture(false);
  assert.equal(saved.state, 'completed');
  assert.equal(saved.assessment?.risk, 'no_observed_red_flags');
  assert.deepEqual(saved.assessment?.missingChecks, []);
  assert.match(saved.assessment!.summary, /not a guarantee/i);
});

test('a matching Figma listing after AI extraction does not override observed payment direction risk', async () => {
  const saved = await runFigmaFixture(true);
  assert.equal(saved.state, 'completed');
  assert.equal(saved.assessment?.risk, 'high_risk');
  assert.deepEqual(saved.assessment?.findings.find(item => item.id === 'payment-direction')?.evidenceIds, ['figma-payment_action']);
});
