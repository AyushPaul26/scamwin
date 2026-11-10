import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createConnectorTestStore } from './utils/scamwin-connector-test-db';
import * as tables from '../lib/db/scamwin-extension-schema';
import { ExtensionService } from '../lib/scamwin/connectors/extension-service';
import { extensionConfiguration } from '../lib/scamwin/connectors/extension-runtime';
import { extensionRequest } from '../lib/scamwin/connectors/extension-http';
import type { ConnectorDatabase } from '../lib/scamwin/connectors/store';
const NOW = '2026-11-10T12:00:00.000Z', clientId = 'a'.repeat(32), verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const approval = { ticket: `${clientId}.${challenge}`, mode: 'manual', origins: [], contains: [], consent: true, automaticDailyLimit: 1 };
async function fixture() { const t = await createConnectorTestStore(Object.values(tables)); let now = Date.parse(NOW); const service = new ExtensionService({ database: t.database, keyring: t.keyring, now: () => new Date(now), appOrigin: 'https://scamwin.vercel.app', automaticEnabled: true }); return { ...t, service, advanceClock: (ms: number) => { now += ms; t.advance(ms); } }; }
async function pair(t: Awaited<ReturnType<typeof fixture>>, options = {}) { const a = await t.service.approve('owner', { ...approval, ...options }); return t.service.redeem({ clientId, verifier, code: a.code }); }
const capture = (extra = {}) => ({ deliveryId: crypto.randomUUID(), mode: 'manual', url: 'https://example.com/offer', capturedAt: NOW, text: 'An offer asks for a payment', urls: ['https://example.com/pay'], truncated: false, ...extra });
test('extension pairing requires local verifier AND authenticated approval handoff, consumes code once and stores hashes only', async () => { const t = await fixture(); try {
    const a = await t.service.approve('owner', approval);
    await assert.rejects(t.service.redeem({ clientId, verifier: 'x'.repeat(43), code: a.code }));
    await assert.rejects(t.service.redeem({ clientId: 'b'.repeat(32), verifier, code: a.code }));
    const grant = await t.service.redeem({ clientId, verifier, code: a.code });
    await assert.rejects(t.service.redeem({ clientId, verifier, code: a.code }));
    const rows = await t.database.query('SELECT * FROM connector_extension_grants');
    assert.equal(rows.rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes(grant.token));
    assert.ok(!JSON.stringify(rows).includes(verifier));
    assert.equal(grant.origins.length, 0);
}
finally {
    await t.close();
} });
test('extension manual capture is queued through selected revision and deduplicated without main admission', async () => { const t = await fixture(); try {
    const g = await pair(t), p = capture();
    await t.service.intake(g.token, clientId, p);
    await t.service.intake(g.token, clientId, p);
    assert.equal((await t.database.query('SELECT * FROM connector_revisions')).rows.length, 1);
    assert.equal((await t.database.query('SELECT * FROM connector_preparations')).rows.length, 1);
    assert.equal((await t.database.query('SELECT * FROM connector_jobs')).rows.length, 0);
    const r = (await t.database.query('SELECT selection_reason FROM connector_revisions')).rows[0];
    assert.equal(r.selection_reason, 'user_selected');
}
finally {
    await t.close();
} });
test('extension rejects private origins, app self ingestion, forged owners, oversize, stale capture and wrong client before persistence', async () => { const t = await fixture(); try {
    const g = await pair(t);
    for (const p of [capture({ url: 'http://127.0.0.1/' }), capture({ url: 'https://router.local/' }), capture({ url: 'https://scamwin.vercel.app/checks' }), capture({ ownerId: 'victim' }), capture({ text: 'x'.repeat(262145) }), capture({ capturedAt: '2026-11-10T11:00:00Z' }), capture({ urls: ['http://192.168.1.1/'] })])
        await assert.rejects(t.service.intake(g.token, clientId, p));
    await assert.rejects(t.service.intake(g.token, 'b'.repeat(32), capture()));
    assert.equal((await t.database.query('SELECT * FROM connector_revisions')).rows.length, 0);
}
finally {
    await t.close();
} });
test('extension auto uses exact approved scope and ordinary selection path; manual survives selective nonmatch', async () => { const t = await fixture(); try {
    const g = await pair(t, { mode: 'selective', origins: ['https://example.com'], contains: ['important'] });
    await assert.rejects(t.service.intake(g.token, clientId, capture({ mode: 'automatic', url: 'https://other.com/' })));
    await t.service.intake(g.token, clientId, capture({ mode: 'automatic' }));
    assert.equal((await t.database.query('SELECT state FROM connector_items')).rows[0].state, 'not_selected');
    assert.equal((await t.database.query('SELECT * FROM connector_preparations')).rows.length, 0);
    await t.service.intake(g.token, clientId, capture({ url: 'https://example.com/manual' }));
    assert.equal((await t.database.query('SELECT * FROM connector_preparations')).rows.length, 1);
}
finally {
    await t.close();
} });
test('extension grant revocation and connection epoch change immediately fence intake; expired approvals fail', async () => { const t = await fixture(); try {
    const g = await pair(t);
    await t.service.revoke(g.token, clientId);
    await assert.rejects(t.service.intake(g.token, clientId, capture()));
    const a = await t.service.approve('owner', approval);
    t.advanceClock(301000);
    await assert.rejects(t.service.redeem({ clientId, verifier, code: a.code }));
}
finally {
    await t.close();
} });
test('extension flags default off and use the shared SCAMWIN feature gates', () => {
    assert.equal(extensionConfiguration({}).enabled, false);
    assert.equal(extensionConfiguration({ CONNECTORS_ENABLED: 'true', CONNECTOR_EXTENSION_ENABLED: 'true', CONNECTOR_AUTOMATION_ENABLED: 'true' }).enabled, false);
    const enabled = { SCAMWIN_CONNECTORS_ENABLED: 'true', SCAMWIN_CONNECTOR_EXTENSION_ENABLED: 'true' };
    assert.equal(extensionConfiguration(enabled).enabled, true);
    assert.equal(extensionConfiguration(enabled).automaticEnabled, false);
    assert.equal(extensionConfiguration({ ...enabled, SCAMWIN_CONNECTOR_AUTOMATION_ENABLED: 'true' }).automaticEnabled, true);
    assert.equal(extensionConfiguration({ ...enabled, SCAMWIN_CONNECTORS_ENABLED: 'false', SCAMWIN_CONNECTOR_AUTOMATION_ENABLED: 'true' }).enabled, false);
    assert.equal(extensionConfiguration({ ...enabled, SCAMWIN_CONNECTOR_EXTENSION_ENABLED: 'false', SCAMWIN_CONNECTOR_AUTOMATION_ENABLED: 'true' }).automaticEnabled, false);
});
test('extension HTTP refuses page-origin CSRF, absent bearer, owner assertions and oversized streamed bodies', async () => { const t = await fixture(); try {
    const g = await pair(t);
    const request = (body: unknown, headers = {}) => new Request('https://scamwin.vercel.app/api/scamwin/connectors/extension/intake', { method: 'POST', headers: { 'content-type': 'application/json', 'x-scamwin-extension': clientId, authorization: `Bearer ${g.token}`, ...headers }, body: JSON.stringify(body) });
    assert.equal((await extensionRequest(request(capture(), { origin: 'https://evil.com' }), 'intake', t.service)).status, 403);
    assert.equal((await extensionRequest(request(capture(), { authorization: '' }), 'intake', t.service)).status, 401);
    assert.equal((await extensionRequest(request(capture({ ownerId: 'victim' })), 'intake', t.service)).status, 400);
    assert.equal((await extensionRequest(request({ text: 'x'.repeat(2 * 1024 * 1024) }), 'intake', t.service)).status, 413);
    assert.equal((await extensionRequest(request(capture()), 'intake', t.service)).status, 200);
}
finally {
    await t.close();
} });
test('owner erasure generation prevents an in-flight pairing approval recreating erased data', async () => { const t = await fixture(); try {
    let fence = false;
    const database: ConnectorDatabase = { query: t.database.query.bind(t.database), transaction: async (fn) => { if (!fence) {
            fence = true;
            await t.database.query('UPDATE connector_owner_generations SET generation=generation+1 WHERE owner_id=$1', ['owner']);
        } return t.database.transaction(fn); } };
    const service = new ExtensionService({ database, keyring: t.keyring, now: () => new Date(NOW), appOrigin: 'https://scamwin.vercel.app', automaticEnabled: true });
    await assert.rejects(service.approve('owner', approval), /owner_data_erased/);
    assert.equal((await t.database.query('SELECT * FROM connector_connections')).rows.length, 0);
}
finally {
    await t.close();
} });
test('old, expired or already-revoked grants can be unlinked without reviving or disconnecting a newer epoch', async () => { const t = await fixture(); try {
    const g = await pair(t), c = (await t.store.getConnection('owner', g.connectionId))!;
    await t.store.configureConnection(c, { mode: 'manual', scope: ['manual:public', 'https://other.com'], rules: {}, consent: true, paused: false, automaticDailyLimit: 1 });
    await t.service.revoke(g.token, clientId);
    assert.equal((await t.store.getConnection('owner', g.connectionId))!.status, 'active');
    await t.service.revoke(g.token, clientId);
    const other = await pair(t);
    t.advanceClock(31 * 86400000);
    await t.service.revoke(other.token, clientId);
}
finally {
    await t.close();
} });
test('manual selection of the same previously filtered snapshot reports its queued state', async () => { const t = await fixture(); try {
    const g = await pair(t, { mode: 'selective', origins: ['https://example.com'], contains: ['important'] });
    await t.service.intake(g.token, clientId, capture({ mode: 'automatic' }));
    const result = await t.service.intake(g.token, clientId, capture());
    assert.equal(result.queued, true);
    assert.equal((await t.database.query('SELECT * FROM connector_revisions')).rows.length, 1);
    assert.equal((await t.database.query('SELECT * FROM connector_preparations')).rows.length, 1);
}
finally {
    await t.close();
} });
