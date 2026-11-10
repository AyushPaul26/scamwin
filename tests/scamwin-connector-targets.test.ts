import assert from 'node:assert/strict';
import test from 'node:test';
import { boundManifest, metadataManifest } from '../lib/scamwin/connectors/policy';
import { createConnectorTestStore } from './utils/scamwin-connector-test-db';
import { planTextChunks } from '../lib/scamwin/connectors/normalization';
import { buildTargetInput, enqueueRevisionTargets, planItemTargets, prepareRaster, projectParentRisk } from '../lib/scamwin/connectors/targets';
import sharp from 'sharp';
import { toMainCheckInput } from '../lib/scamwin/connectors/admission';

test('overlapping body target identities reserve enough chunks and unsupported files never become image work', () => {
  const content = boundManifest({ text: 'a'.repeat(24000), urls: ['https://example.com/a', 'https://example.com/b', 'http://127.0.0.1/a', 'javascript:alert(1)'], attachments: [{ id: 'file', name: 'file.pdf', mediaType: 'application/pdf', supported: true }] });
  const manifest = metadataManifest(content);
  assert.equal(manifest.targets.filter(t => t.kind === 'text').length, 3);
  assert.equal(manifest.targets.find(t => t.id === 'attachment-0')?.status, 'unsupported');
  assert.equal(manifest.targets.find(t => t.id === 'url-2')?.status, 'not_checked');
  assert.equal(manifest.targets.find(t => t.id === 'url-3')?.status, 'not_checked');
  assert.equal(manifest.coverage, 'partial');
});

test('bounded shared chunks overlap without broken surrogates and every URL retains its own validated child', async () => {
  const text = 'a'.repeat(11743) + '😀' + 'b'.repeat(12500);
  const chunks = planTextChunks(text);
  assert.equal(chunks.length, 3); assert.equal(chunks[0].end, 11743);
  assert.equal(chunks[1].start, 11231);
  assert.ok(chunks.every(c => !/[\uD800-\uDBFF]$/.test(c.text)));
  const content = { ...boundManifest({ text, urls: ['https://example.com/a', 'https://example.com/b', 'https://example.com/a'], attachments: [] }), sourceReference: { id: 'mail', receivedAt: '2026-11-10T12:00:00Z' } };
  const revision = { id: 'r', itemId: 'i', revisionHash: 'a'.repeat(64), manifest: metadataManifest(content), selectionReason: 'all_new', createdAt: '2026-11-10T12:00:00Z', contentExpiresAt: '2026-12-10T12:00:00Z', expiresAt: '2027-02-08T12:00:00Z' };
  const plan = planItemTargets({ revision, content }); assert.equal(plan.targets.length, 5);
  const children = await Promise.all(plan.targets.map(t => buildTargetInput({ revision, content }, t.id)));
  assert.ok(children.every(c => toMainCheckInput(c).message.length <= 12000));
  assert.deepEqual(children.slice(3).map(c => c.url), ['https://example.com/a', 'https://example.com/b']);
});

test('raster preparation sniffs bytes, bounds input and strips metadata into a main-valid raster', async () => {
  const png = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#ffaa00' } }).png().toBuffer();
  const image = await prepareRaster(png, 'image.png', new AbortController().signal);
  assert.ok(Buffer.from(image.dataUrl.split(',')[1], 'base64').length <= 160 * 1024);
  toMainCheckInput({ message: '', url: null, images: [image] });
  await assert.rejects(prepareRaster(Buffer.from('<svg></svg>'), 'image.png', new AbortController().signal), /unsupported_raster/);
  await assert.rejects(prepareRaster(new Uint8Array(10 * 1024 * 1024 + 1), 'image.png', new AbortController().signal), /image_too_large/);
});

test('attachment URL cannot become loader authority and parent risk keeps grounded payment concern', async () => {
  const f = await createConnectorTestStore();
  try {
    let c = await f.store.createConnection('alice', { provider: 'gmail', providerAccountId: 'image-account', scope: ['inbox'] });
    c = await f.store.configureConnection(c, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const saved = await f.store.saveRevision(c, { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00Z', text: '', urls: [], attachments: [{ id: 'http://169.254.169.254/secret', name: 'x.png', mediaType: 'image/png', supported: true }] });
    const content = await f.store.readRevisionContent(c, saved.revision.id); assert.ok(content);
    let calls = 0;
    await assert.rejects(buildTargetInput({ revision: saved.revision, content }, 'attachment-0', { connection: c, loadAttachment: async () => { calls++; return new Uint8Array(); } }), /invalid_attachment_reference/);
    assert.equal(calls, 0);
    const concern = { checkId: 'risk', runId: 'run-risk', risk: 'high_risk' as const, evidenceIds: ['payment'], coverage: 'partial' as const };
    const listing = { checkId: 'listing', runId: 'run-listing', risk: 'no_observed_red_flags' as const, evidenceIds: ['official'], coverage: 'complete' as const };
    assert.equal(projectParentRisk([concern, listing], 'partial').risk, 'high_risk');
    assert.equal(projectParentRisk([listing], 'partial').risk, 'inconclusive');
  } finally { await f.close(); }
});

test('completed delivery with partial child remains partial and selected Manual work is explicitly authorized', async () => {
  const { store, close } = await createConnectorTestStore();
  try {
    const c = await store.createConnection('alice', { provider: 'gmail', providerAccountId: 'selected', scope: ['inbox'] });
    await store.saveGrant(c, { accessToken: 'fixture', scopes: ['inbox'] });
    const input = { providerItemId: 'mail', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00.000Z', text: 'hello', urls: [], attachments: [] };
    await assert.rejects(store.saveRevision(c, input), /background_import_disabled/);
    const saved = await store.saveSelectedRevision(c, input);
    assert.equal(saved.revision.selectionReason, 'user_selected');
    assert.equal((await store.readRevisionContent(c, saved.revision.id))?.sourceReference.id, 'mail');
    await store.enqueueTarget(c, { revisionId: saved.revision.id, targetId: 'body-0', generation: 1, input: { message: 'hello', url: null, images: [] } });
    const lease = await store.leaseDueJob(); assert.ok(lease);
    await store.recordAdmission(lease, 'check');
    await store.finishJob(lease, { status: 'completed', childState: 'partial' });
    const revision = await store.getRevision(c, saved.revision.id);
    assert.equal(revision?.manifest.coverage, 'partial');
    assert.equal(revision?.manifest.counts.checked, 0);
    assert.equal((await store.getItem(c, saved.item.id))?.state, 'partial');
  } finally { await close(); }
});

test('authorized raster loader receives encrypted source reference, input is immutable, and bytes expire in seven days', async () => {
  const f = await createConnectorTestStore();
  try {
    let c = await f.store.createConnection('alice', { provider: 'gmail', providerAccountId: 'raster-account', scope: ['inbox'] });
    c = await f.store.configureConnection(c, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const saved = await f.store.saveRevision(c, { providerItemId: 'provider-message', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00Z', text: '', urls: [], attachments: [{ id: 'opaque-provider-attachment', name: 'proof.png', mediaType: 'image/png', supported: true }] });
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffaa00' } }).png().toBuffer(); let calls = 0;
    const deps = { connectorStore: f.store, now: () => new Date('2026-11-10T12:00:00Z'), loadAttachment: async (_connection: unknown, source: { id: string }, attachment: { id: string }, budget: { maxBytes: number }) => {
      calls++; assert.equal(source.id, 'provider-message'); assert.equal(attachment.id, 'opaque-provider-attachment'); assert.equal(budget.maxBytes, 10485760); return png;
    } };
    const stopped = new AbortController(); stopped.abort();
    await assert.rejects(enqueueRevisionTargets(c, saved.revision.id, { ...deps, signal: stopped.signal }));
    assert.equal((await f.store.getRevision(c, saved.revision.id))?.manifest.targets[0].status, 'pending');
    assert.equal(calls, 0);
    assert.equal((await enqueueRevisionTargets(c, saved.revision.id, deps)).enqueued, 1);
    assert.equal((await enqueueRevisionTargets(c, saved.revision.id, deps)).enqueued, 0); assert.equal(calls, 1);
    const lease = await f.store.leaseDueJob(); assert.ok(lease); const input = await f.store.readJobInput(lease); assert.equal(input.images.length, 1);
    const raw = (await f.database.query('SELECT encrypted_content FROM connector_revisions WHERE id=$1', [saved.revision.id])).rows[0].encrypted_content;
    assert.ok(!String(raw).includes('provider-message'));
    f.advance(7 * 86400000 + 1); await f.store.purgeExpired();
    assert.equal((await f.database.query('SELECT encrypted_input FROM connector_jobs WHERE id=$1', [lease.job.id])).rows[0].encrypted_input, null);
    assert.equal((await f.store.getRevision(c, saved.revision.id))?.manifest.coverage, 'partial');
    assert.ok(await f.store.readRevisionContent(c, saved.revision.id));
  } finally { await f.close(); }
});

test('upstream parser diagnostics and omitted counts survive all available child completions', async () => {
  const f = await createConnectorTestStore();
  try {
    let c = await f.store.createConnection('alice', { provider: 'gmail', providerAccountId: 'parser-account', scope: ['inbox'] });
    c = await f.store.configureConnection(c, { mode: 'all_new', scope: ['inbox'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    const saved = await f.store.saveRevision(c, { providerItemId: 'provider-message', revisionHash: 'a'.repeat(64), receivedAt: '2026-11-10T12:00:00Z', text: 'available body', urls: [], attachments: [], extraction: { coverage: 'partial', diagnostics: [{ reason: 'missing_body', count: 1 }], overflow: { textBytes: 100, urls: 2, attachments: 1 } } });
    await enqueueRevisionTargets(c, saved.revision.id, { connectorStore: f.store });
    const lease = await f.store.leaseDueJob(); assert.ok(lease); await f.store.recordAdmission(lease, 'check');
    await f.store.finishJob(lease, { status: 'completed', childState: 'completed' });
    const revision = await f.store.getRevision(c, saved.revision.id);
    assert.equal(revision?.manifest.coverage, 'partial'); assert.equal(revision?.manifest.counts.discovered, 4);
    assert.equal(revision?.manifest.extraction?.diagnostics[0].reason, 'missing_body');
    assert.deepEqual(revision?.manifest.overflow, { textBytes: 100, urls: 2, attachments: 1 });
    const empty = await f.store.saveRevision(c, { providerItemId: 'missing-only', revisionHash: 'b'.repeat(64), receivedAt: '2026-11-10T12:00:00Z', text: '', urls: [], attachments: [], extraction: { coverage: 'unavailable', diagnostics: [{ reason: 'missing_body', count: 1 }], overflow: { textBytes: 0, urls: 0, attachments: 0 } } });
    assert.equal(empty.item.state, 'source_unavailable'); assert.equal(empty.revision.manifest.coverage, 'partial');
  } finally { await f.close(); }
});
