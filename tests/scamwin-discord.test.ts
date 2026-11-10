import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { DiscordAuthorizationDriver, verifyDiscordRequest } from '../lib/scamwin/connectors/discord-protocol';
import { discordInteractions, DiscordInteractionService } from '../lib/scamwin/connectors/discord-interactions';
import { DiscordStore } from '../lib/scamwin/connectors/discord-store';
import { DiscordSetupService } from '../lib/scamwin/connectors/discord-setup';
import { createConnectorTestStore } from './utils/scamwin-connector-test-db';
import * as tables from '../lib/db/scamwin-discord-schema';
import { PostgresExpandedAuthorizationPersistence } from '../lib/scamwin/connectors/expanded-auth';
import { sealConnectorSecret } from '../lib/scamwin/connectors/crypto';
import { DiscordAdapter } from '../lib/scamwin/connectors/providers/discord';
import { discordConfiguration } from '../lib/scamwin/connectors/discord-runtime';
import { downloadDiscordAttachment } from '../lib/scamwin/connectors/discord-media';
import { discordCommandConfiguration, discordInstallationUrl } from '../lib/scamwin/connectors/discord-ui';
import { ConnectorRuntimeStore } from '../lib/scamwin/connectors/runtime-store';
const NOW = Date.parse('2026-11-10T12:00:00Z'), APP = '100000000000000001', ACTOR = '200000000000000001', CHANNEL = '300000000000000001', MESSAGE = '400000000000000001';
const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
function request(value: unknown, options: {
    stamp?: string;
    signature?: string;
    raw?: string;
} = {}) { const stamp = options.stamp ?? String(NOW / 1000), body = options.raw ?? JSON.stringify(value); return new Request('https://app.example/interactions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature-timestamp': stamp, 'x-signature-ed25519': options.signature ?? sign(null, Buffer.from(stamp + body), keys.privateKey).toString('hex') }, body }); }
function payload(id = '500000000000000001') { return { id, application_id: APP, type: 2, context: 0, guild_id: '600000000000000001', channel_id: CHANNEL, member: { user: { id: ACTOR } }, authorizing_integration_owners: { '1': ACTOR }, data: { type: 3, name: 'Check with Scamwin', target_id: MESSAGE, resolved: { messages: { [MESSAGE]: { id: MESSAGE, channel_id: CHANNEL, content: 'Offer https://example.test', timestamp: '2026-11-10T11:59:00Z', attachments: [] } } } } }; }
test('Discord identify flow uses S256 fixed form endpoints and provider-returned user identity', async () => { const calls: {
    url: string;
    init?: RequestInit;
}[] = []; const driver = new DiscordAuthorizationDriver({ clientId: APP, clientSecret: 'server-secret', now: () => new Date(NOW), fetch: async (url, init) => { calls.push({ url: String(url), init }); return Response.json(String(url).endsWith('/users/@me') ? { id: ACTOR, username: 'alice', global_name: 'Alice' } : { access_token: 'access', refresh_token: 'rotated', token_type: 'Bearer', expires_in: 3600, scope: 'identify' }); } }); const u = new URL(driver.authorizationUrl({ state: 'one-use-state', redirectUri: 'https://app.example/callback', verifier: 'a'.repeat(43), nonce: 'unused' })); assert.equal(u.origin, 'https://discord.com'); assert.equal(u.searchParams.get('scope'), 'identify'); assert.equal(u.searchParams.get('code_challenge_method'), 'S256'); assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update('a'.repeat(43)).digest('base64url')); const result = await driver.exchange({ code: 'code', redirectUri: 'https://app.example/callback', verifier: 'a'.repeat(43), nonce: 'unused', issuedAfter: NOW, signal: new AbortController().signal }); assert.equal(result.identity.accountId, ACTOR); assert.equal(result.identity.metadata.applicationId, APP); assert.equal(result.identity.label, 'Alice'); assert.deepEqual(result.grant.scopes, ['identify']); assert.equal(calls[0].url, 'https://discord.com/api/oauth2/token'); assert.equal(new URLSearchParams(String(calls[0].init?.body)).get('code_verifier'), 'a'.repeat(43)); assert.equal(calls[0].init?.redirect, 'error'); await driver.refresh(result.grant, new AbortController().signal); assert.equal(new URLSearchParams(String(calls[2].init?.body)).get('grant_type'), 'refresh_token'); await driver.revoke(result.grant, new AbortController().signal); assert.equal(calls.at(-1)?.url, 'https://discord.com/api/oauth2/token/revoke'); assert.equal(new URLSearchParams(String(calls.at(-1)?.init?.body)).get('token'), 'rotated'); });
test('Discord exact raw signatures protect PING, freshness, changed bytes and malformed JSON before dispatch', async () => { const raw = Buffer.from('{"type":1}'), stamp = String(NOW / 1000), sig = sign(null, Buffer.concat([Buffer.from(stamp), raw]), keys.privateKey).toString('hex'); assert.equal(verifyDiscordRequest(raw, stamp, sig, publicKey, NOW), true); assert.equal(verifyDiscordRequest(Buffer.concat([raw, Buffer.from(' ')]), stamp, sig, publicKey, NOW), false); assert.equal(verifyDiscordRequest(raw, stamp, sig, publicKey, NOW + 301000), false); const deps = { publicKey, applicationId: APP, enabled: true, now: () => NOW, handle: async () => { throw Error('must not dispatch'); } }; assert.equal((await discordInteractions(request({ type: 1 }, { signature: '0'.repeat(128) }), deps)).status, 401); assert.deepEqual(await (await discordInteractions(request({ type: 1 }), deps)).json(), { type: 1 }); assert.equal((await discordInteractions(request({ type: 1 }, { stamp: String(NOW / 1000 - 301) }), deps)).status, 401); assert.equal((await discordInteractions(request(null, { raw: '{' }), deps)).status, 400); assert.equal((await discordInteractions(request([{ type: 1 }]), deps)).status, 400); });
async function fixture() { const t = await createConnectorTestStore(Object.values(tables)); const c = await t.store.createConnection('owner', { provider: 'discord', providerAccountId: 'identity', scope: ['unselected'] }); await t.store.saveGrant(c, { accessToken: 'private-token', refreshToken: 'refresh', expiresAt: '2026-11-10T13:00:00Z', scopes: ['identify'] }); const identity = { accountId: ACTOR, label: 'Alice', metadata: { applicationId: APP } }; await t.database.query('UPDATE connector_connections SET encrypted_identity=$1 WHERE id=$2', [sealConnectorSecret(JSON.stringify(identity), { ownerId: 'owner', connectionId: `${c.id}:identity`, epoch: c.epoch, purpose: 'grant' }, t.keyring), c.id]); const auth = new PostgresExpandedAuthorizationPersistence(t.database, { keyring: t.keyring, now: () => new Date(NOW) }), store = new DiscordStore(t.database, t.keyring, t.store, auth, () => new Date(NOW)); const setup = new DiscordSetupService({ core: t.store, store, applicationId: APP, enabled: true }); const selected = await setup.select('owner', { id: c.id, epoch: c.epoch, contexts: ['server_messages'], consent: true }); const current = (await t.store.getConnection('owner', c.id))!; const service = new DiscordInteractionService({ store, applicationId: APP, enabled: true, now: () => new Date(NOW) }); return { ...t, storeCore: t.store, c: current, store, setup, selected, service }; }
test('signed Discord selection atomically saves source and durable preparation before ephemeral ACK; retry is deduped', async () => { const t = await fixture(); try {
    const deps = { publicKey, applicationId: APP, enabled: true, now: () => NOW, handle: t.service.handle.bind(t.service) };
    const response = await discordInteractions(request(payload()), deps);
    assert.equal(response.status, 200);
    const ack = await response.json();
    assert.equal(ack.type, 4);
    assert.equal(ack.data.flags, 64);
    assert.equal(ack.data.allowed_mentions.parse.length, 0);
    assert.equal((await t.database.query('SELECT * FROM connector_discord_events')).rows.length, 1);
    assert.equal((await t.database.query('SELECT * FROM connector_preparations')).rows.length, 1);
    const r = (await t.database.query('SELECT * FROM connector_revisions')).rows[0];
    assert.equal((await t.storeCore.readRevisionContent(t.c, String(r.id)))?.text,'Offer https://example.test');
    assert.equal((await discordInteractions(request(payload()), deps)).status, 200);
    assert.equal((await t.database.query('SELECT * FROM connector_revisions')).rows.length, 1);
    const event = await t.database.query('SELECT * FROM connector_discord_events');
    assert.ok(!JSON.stringify(event).includes(ACTOR));
    assert.ok(!JSON.stringify(event).includes('Offer'));
}
finally {
    await t.close();
} });
test('Discord rejects actor, installation, target, command, application, private-context and stale-epoch forgery', async () => { const t = await fixture(); try {
    const base = payload();
    const variants = [{ ...base, application_id: '900000000000000001' }, { ...base, member: { user: { id: '900000000000000001' } } }, { ...base, authorizing_integration_owners: { '1': '900000000000000001' } }, { ...base, data: { ...base.data, name: 'Other command' } }, { ...base, data: { ...base.data, target_id: '900000000000000001' } }, { ...base, data: { ...base.data, resolved: { messages: { ...base.data.resolved.messages, ['900000000000000001']: base.data.resolved.messages[MESSAGE] } } } }, { ...base, data: { ...base.data, resolved: { messages: { [MESSAGE]: { ...base.data.resolved.messages[MESSAGE], channel_id: '900000000000000001' } } } } }, { ...base, context: 1, user: { id: ACTOR }, member: undefined, guild_id: undefined }];
    for (const v of variants)
        await assert.rejects(t.service.handle(v));
    assert.equal((await t.database.query('SELECT * FROM connector_revisions')).rows.length, 0);
    await t.storeCore.revokeConnection(t.c.ownerId, t.c.id, t.c.epoch);
    await assert.rejects(t.service.handle(base));
}
finally {
    await t.close();
} });
test('Discord automatic mode is unavailable under all flags and cannot be activated', async () => { const config = discordConfiguration({ SCAMWIN_CONNECTORS_ENABLED: 'true', SCAMWIN_CONNECTOR_DISCORD_ENABLED: 'true', SCAMWIN_DISCORD_CLIENT_ID: APP, SCAMWIN_DISCORD_CLIENT_SECRET: 'secret', SCAMWIN_DISCORD_PUBLIC_KEY: publicKey, SCAMWIN_CONNECTOR_AUTOMATION_ENABLED: 'true' }); assert.equal(config.automaticEnabled, false); const t = await fixture(); try {
    const adapter = new DiscordAdapter({ store: t.store, core: t.storeCore, driver: new DiscordAuthorizationDriver({ clientId: APP, clientSecret: 'secret' }) });
    assert.equal(adapter.capabilities.pull, false);
    assert.equal(adapter.capabilities.history, false);
    await assert.rejects(adapter.activationHook(), /discord_manual_only/);
    await assert.rejects(adapter.pullChanges(), /discord_manual_only/);
    await assert.rejects(t.setup.select('owner', { id: t.c.id, epoch: t.c.epoch, contexts: ['server_messages'], consent: false }));
}
finally {
    await t.close();
} });
test('Discord media requires the exact saved selection, encrypts signed CDN URLs and expires after seven days', async () => { const t = await fixture(); try {
    const p = payload(), fileId = '700000000000000001', url = `https://cdn.discordapp.com/attachments/${CHANNEL}/${fileId}/photo.png?ex=${Math.floor((NOW + 86400000) / 1000).toString(16)}&is=${Math.floor(NOW / 1000).toString(16)}&hm=${'a'.repeat(64)}`;
    const withFile = { ...p, data: { ...p.data, resolved: { messages: { [MESSAGE]: { ...p.data.resolved.messages[MESSAGE], attachments: [{ id: fileId, filename: 'photo.png', content_type: 'image/png', size: 3, url }] } } } } };
    await t.service.handle(withFile);
    const revision = (await t.database.query('SELECT id FROM connector_revisions')).rows[0], content = (await t.storeCore.readRevisionContent(t.c, String(revision.id)))!;
    assert.equal(content.attachments[0].supported, true);
    assert.ok(!JSON.stringify(content).includes('hm='));
    const rows = await t.database.query('SELECT * FROM connector_discord_media');
    assert.equal(rows.rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes('cdn.discordapp.com'));
    assert.equal(new Date(String(rows.rows[0].expires_at)).getTime(), NOW + 7 * 86400000);
    let calls = 0;
    const adapter = new DiscordAdapter({ store: t.store, core: t.storeCore, driver: new DiscordAuthorizationDriver({ clientId: APP, clientSecret: 'secret' }), now: () => new Date(NOW), fetch: async (_url, init) => { calls++; assert.equal(init?.redirect, 'error'); assert.equal(init?.headers, undefined); return new Response(new Uint8Array([1, 2, 3])); } });
    const bytes = await adapter.readAttachment(t.c, content.sourceReference, content.attachments[0], { maxBytes: 100, deadlineAtMs: Date.now() + 10000 }, new AbortController().signal);
    assert.equal(bytes.byteLength, 3);
    assert.equal(calls, 1);
    await assert.rejects(adapter.readAttachment({ ...t.c, ownerId: 'other' }, content.sourceReference, content.attachments[0], { maxBytes: 100, deadlineAtMs: Date.now() + 10000 }, new AbortController().signal));
    assert.equal(calls, 1);
    await t.database.query('UPDATE connector_discord_media SET expires_at=$1', [new Date(NOW - 1).toISOString()]);
    await assert.rejects(adapter.readAttachment(t.c, content.sourceReference, content.attachments[0], { maxBytes: 100, deadlineAtMs: Date.now() + 10000 }, new AbortController().signal), /attachment_unavailable/);
    assert.equal(calls, 1);
}
finally {
    await t.close();
} });
test('Discord CDN rejects redirects, private origins, wrong selected paths, expired signatures and oversized bytes', async () => { const fileId = '700000000000000001', valid = `https://cdn.discordapp.com/attachments/${CHANNEL}/${fileId}/photo.png`; let calls = 0; const options = { channelId: CHANNEL, attachmentId: fileId, maxBytes: 2, deadlineAtMs: Date.now() + 10000, signal: new AbortController().signal, nowMs: NOW, fetch: async () => { calls++; return new Response(new Uint8Array([1, 2, 3])); } }; for (const url of ['http://127.0.0.1/file', valid.replace(CHANNEL, '900000000000000001'), valid + '?ex=1&is=1&hm=' + 'a'.repeat(64), valid.replace('cdn.discordapp.com', 'cdn.discordapp.com.evil.test'), valid.replace('/photo.png', '/%2fphoto.png')])
    await assert.rejects(downloadDiscordAttachment(url, options), /attachment_unavailable/); assert.equal(calls, 0); await assert.rejects(downloadDiscordAttachment(valid, options), /response_too_large/); assert.equal(calls, 1); await assert.rejects(downloadDiscordAttachment(valid, { ...options, fetch: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }) }), /attachment_unavailable/); });
test('Discord explicitly selected old messages use app receipt for retention and preserve provider dates as context', async () => { const t = await fixture(); try {
    const p = payload(), f = '700000000000000001';
    await t.service.handle({ ...p, data: { ...p.data, resolved: { messages: { [MESSAGE]: { ...p.data.resolved.messages[MESSAGE], timestamp: new Date(NOW - 31 * 86400000).toISOString(), attachments: [{ id: f, filename: 'old.png', content_type: 'image/png', size: 3, url: `https://cdn.discordapp.com/attachments/${CHANNEL}/${f}/old.png` }] } } } } });
    const revision = (await t.database.query('SELECT id FROM connector_revisions')).rows[0], content = (await t.storeCore.readRevisionContent(t.c, String(revision.id)))!;
    assert.equal(content.attachments[0].supported, true);
    assert.equal(new Date(String((await t.database.query('SELECT expires_at FROM connector_discord_media')).rows[0].expires_at)).getTime(),NOW+7*86400000);
    assert.equal(Date.parse(content.sourceReference.receivedAt),NOW);
    assert.equal(Date.parse((await t.storeCore.getRevision(t.c,String(revision.id)))!.contentExpiresAt),NOW+30*86400000);
    const savedRevision=(await t.storeCore.getRevision(t.c,String(revision.id)))!;
    assert.equal((await t.store.media(t.c,content.sourceReference.id,savedRevision.revisionHash)).createdAt,new Date(NOW-31*86400000).toISOString());
    assert.equal(content.text,'Offer https://example.test');
}
finally {
    await t.close();
} });
test('Discord parser bounds text, URLs and attachments and records unsupported embedded evidence', async () => { const t = await fixture(); try {
    const p = payload(), files = Array.from({ length: 21 }, (_, i) => ({ id: String(700000000000000000n + BigInt(i)), filename: 'file.pdf', content_type: 'application/pdf', size: 3, url: 'https://evil.test/file' }));
    await t.service.handle({ ...p, data: { ...p.data, resolved: { messages: { [MESSAGE]: { ...p.data.resolved.messages[MESSAGE], content: Array.from({ length: 201 }, (_, i) => `https://example.test/${i}`).join(' ') + ' ' + 'x'.repeat(270000), attachments: files, embeds: [{ description: 'not checked' }] } } } } });
    const r = (await t.database.query('SELECT id FROM connector_revisions')).rows[0], content = (await t.storeCore.readRevisionContent(t.c, String(r.id)))!, manifest = (await t.storeCore.getRevision(t.c, String(r.id)))!.manifest;
    assert.ok(Buffer.byteLength(content.text) <= 262144);
    assert.equal(content.urls.length, 200);
    assert.equal(content.attachments.length, 20);
    assert.equal(manifest.extraction?.coverage, 'partial');
    assert.equal(manifest.extraction?.overflow.urls, 1);
    assert.equal(manifest.extraction?.overflow.attachments, 1);
    assert.ok(manifest.extraction!.diagnostics.some(d => d.reason === 'discord_embeds_not_checked'));
    assert.ok(content.attachments.every(f => !f.supported));
}
finally {
    await t.close();
} });
test('Discord durable event insert rolls back if source storage fails so signed retries can recover', async () => { const t = await fixture(); try {
    const p = payload(),original=t.database.transaction.bind(t.database);
    t.database.transaction=fn=>original(sql=>fn({query:async(text,params)=>{if(text.startsWith('INSERT INTO connector_preparations'))throw Error('synthetic_storage_failure');return sql.query(text,params);}}));
    await assert.rejects(t.service.handle(p), /synthetic_storage_failure/);
    assert.equal((await t.database.query('SELECT * FROM connector_discord_events')).rows.length, 0);
    assert.equal((await t.database.query('SELECT * FROM connector_revisions')).rows.length, 0);
    t.database.transaction=original;
    await t.service.handle(p);
    assert.equal((await t.database.query('SELECT * FROM connector_discord_events')).rows.length, 1);
    assert.equal((await t.database.query('SELECT * FROM connector_preparations')).rows.length, 1);
}
finally {
    await t.close();
} });
test('Discord user install template requests commands only and exposes no bot or admin installation', () => { const url = new URL(discordInstallationUrl(APP)!); assert.equal(url.searchParams.get('scope'), 'applications.commands'); assert.equal(url.searchParams.get('integration_type'), '1'); assert.equal(url.searchParams.has('permissions'), false); assert.deepEqual(discordCommandConfiguration.integration_types, [1]); assert.deepEqual(discordCommandConfiguration.contexts, [0, 1, 2]); assert.equal(discordCommandConfiguration.type, 3); });
test('Discord rejects extra resolved evidence without retaining arbitrary unselected message bodies', async () => { const t = await fixture(); try {
    const p = payload();
    await assert.rejects(t.service.handle({ ...p, data: { ...p.data, resolved: { messages: { [MESSAGE]: p.data.resolved.messages[MESSAGE], '900000000000000001': { ...p.data.resolved.messages[MESSAGE], id: '900000000000000001', content: 'unselected' } } } } }), /discord_target_mismatch/);
    assert.equal((await t.database.query('SELECT * FROM connector_revisions')).rows.length, 0);
}
finally {
    await t.close();
} });
test('Discord setup checks owner and epoch before storing context consent', async () => { const t = await fixture(); try {
    for (const input of [{ owner: 'another', epoch: t.c.epoch }, { owner: 'owner', epoch: t.c.epoch - 1 }])
        await assert.rejects(t.setup.select(input.owner, { id: t.c.id, epoch: input.epoch, contexts: ['private_messages'], consent: true }), /connection_unavailable/);
    assert.deepEqual((await t.storeCore.getConnection('owner', t.c.id))?.scope, ['discord:server_messages']);
}
finally {
    await t.close();
} });
test('Discord media cannot be downloaded after source deletion even with an earlier saved reference', async () => { const t = await fixture(); try {
    const p = payload(), f = '700000000000000001';
    await t.service.handle({ ...p, data: { ...p.data, resolved: { messages: { [MESSAGE]: { ...p.data.resolved.messages[MESSAGE], attachments: [{ id: f, filename: 'image.png', content_type: 'image/png', size: 1, url: `https://cdn.discordapp.com/attachments/${CHANNEL}/${f}/image.png` }] } } } } });
    const r = (await t.database.query('SELECT id FROM connector_revisions')).rows[0], content = (await t.storeCore.readRevisionContent(t.c, String(r.id)))!;
    await new ConnectorRuntimeStore(t.database, t.keyring, () => new Date(NOW)).deleteProviderItem(t.c, content.sourceReference.id);
    let calls = 0;
    const adapter = new DiscordAdapter({ store: t.store, core: t.storeCore, driver: new DiscordAuthorizationDriver({ clientId: APP, clientSecret: 'secret' }), now: () => new Date(NOW), fetch: async () => { calls++; return new Response(new Uint8Array([1])); } });
    await assert.rejects(adapter.readAttachment(t.c, content.sourceReference, content.attachments[0], { maxBytes: 100, deadlineAtMs: Date.now() + 10000 }, new AbortController().signal), /attachment_unavailable/);
    assert.equal(calls, 0);
}
finally {
    await t.close();
} });
test('Discord callback deadline also bounds a stalled raw request body', async () => { let closeTimer: ReturnType<typeof setTimeout>; const body = new ReadableStream<Uint8Array>({ start(controller) { closeTimer = setTimeout(() => controller.close(), 4000); }, cancel() { clearTimeout(closeTimer); } }); const req = new Request('https://app.example/interactions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature-timestamp': String(NOW / 1000), 'x-signature-ed25519': '0'.repeat(128) }, body, duplex: 'half' } as RequestInit); const started = Date.now(); const response = await discordInteractions(req, { publicKey, applicationId: APP, enabled: true, now: () => NOW, handle: async () => { throw Error('not called'); } }); assert.equal(response.status, 503); assert.ok(Date.now() - started < 3100); });
test('Discord signed manual action uses durable linked identity after profile token expiry and rejects erased linkage', async () => { const t = await fixture(); try {
    await t.storeCore.saveGrant(t.c, { accessToken: 'expired', scopes: ['identify'], expiresAt: new Date(NOW - 1000).toISOString() });
    await t.service.handle(payload());
    assert.equal((await t.database.query('SELECT * FROM connector_preparations')).rows.length, 1);
    await t.database.query('UPDATE connector_connections SET encrypted_identity=NULL WHERE id=$1', [t.c.id]);
    await assert.rejects(t.service.handle(payload('500000000000000002')), /discord_identity_required/);
}
finally {
    await t.close();
} });
test('Discord manual re-selection preserves new revisions when only unsupported embed evidence changes',async()=>{const t=await fixture();try{const p=payload();await t.service.handle(p);await t.service.handle({...payload('500000000000000002'),data:{...p.data,resolved:{messages:{[MESSAGE]:{...p.data.resolved.messages[MESSAGE],embeds:[{description:'New unsupported evidence'}]}}}}});const revisions=(await t.database.query('SELECT manifest FROM connector_revisions')).rows;assert.equal(revisions.length,2);assert.equal(revisions.filter(r=>(r.manifest as {extraction:{coverage:string}}).extraction.coverage==='partial').length,1);}finally{await t.close();}});
test('Discord preserves a complete Unicode message and never starts an already-aborted attachment download',async()=>{const t=await fixture();try{const p=payload();await t.service.handle({...p,data:{...p.data,resolved:{messages:{[MESSAGE]:{...p.data.resolved.messages[MESSAGE],content:'Original text \uFFFD'}}}}});const r=(await t.database.query('SELECT id FROM connector_revisions')).rows[0];assert.equal((await t.storeCore.readRevisionContent(t.c,String(r.id)))?.text,'Original text \uFFFD');let calls=0;const abort=new AbortController();abort.abort();await assert.rejects(downloadDiscordAttachment(`https://cdn.discordapp.com/attachments/${CHANNEL}/700000000000000001/photo.png`,{channelId:CHANNEL,attachmentId:'700000000000000001',maxBytes:100,deadlineAtMs:Date.now()+10000,signal:abort.signal,fetch:async()=>{calls++;return new Response(new Uint8Array([1]));}}));assert.equal(calls,0);}finally{await t.close();}});
test('Discord OAuth rejects mutation grants, bot identities and oversized response bodies before linking',async()=>{for(const scope of ['identify email','bot applications.commands','identify guilds']){let calls=0;const driver=new DiscordAuthorizationDriver({clientId:APP,clientSecret:'private',fetch:async()=>{calls++;return Response.json({access_token:'access',token_type:'Bearer',expires_in:3600,scope});}});await assert.rejects(driver.exchange({code:'code',redirectUri:'https://app.example/callback',verifier:'a'.repeat(43),nonce:'unused',issuedAfter:NOW,signal:new AbortController().signal}),/discord_unexpected_scope/);assert.equal(calls,1);}const driver=new DiscordAuthorizationDriver({clientId:APP,clientSecret:'private',fetch:async(url)=>Response.json(String(url).endsWith('/users/@me')?{id:ACTOR,username:'Bot',bot:true}:{access_token:'access',token_type:'Bearer',expires_in:3600,scope:'identify'})});await assert.rejects(driver.exchange({code:'code',redirectUri:'https://app.example/callback',verifier:'a'.repeat(43),nonce:'unused',issuedAfter:NOW,signal:new AbortController().signal}),/discord_identity_required/);const huge=new DiscordAuthorizationDriver({clientId:APP,clientSecret:'private',fetch:async()=>new Response('x'.repeat(65537))});await assert.rejects(huge.exchange({code:'code',redirectUri:'https://app.example/callback',verifier:'a'.repeat(43),nonce:'unused',issuedAfter:NOW,signal:new AbortController().signal}),/malformed_response/);});
