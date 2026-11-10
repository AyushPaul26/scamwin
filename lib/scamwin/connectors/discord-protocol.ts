import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import type { ExpandedAuthorizationDriver } from './expanded-auth';
import type { ConnectorGrant } from './contracts';
import { ConnectorStoreError } from './store';
export const discordSnowflake = z.string().regex(/^[1-9][0-9]{16,19}$/);
const tokenSchema = z.object({ access_token: z.string().min(1).max(16384), refresh_token: z.string().min(1).max(16384).optional(), token_type: z.string().refine(v => v.toLowerCase() === 'bearer'), expires_in: z.number().int().positive().max(31536000), scope: z.string().max(2000) });
const fail = (code: string): never => { throw new ConnectorStoreError(code); };
/** Exact raw UTF-8 timestamp plus body, before parsing even Discord's PING probes. */
export function verifyDiscordRequest(raw: Uint8Array, timestamp: string | null, signature: string | null, publicKey: string, nowMs = Date.now()) {
    if (!timestamp || !/^\d{10,11}$/.test(timestamp) || !signature || !/^[a-fA-F0-9]{128}$/.test(signature) || !/^[a-fA-F0-9]{64}$/.test(publicKey))
        return false;
    const age = nowMs - Number(timestamp) * 1000;
    if (age > 300000 || age < -30000)
        return false;
    try {
        const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
        return verify(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(raw)]), key, Buffer.from(signature, 'hex'));
    }
    catch {
        return false;
    }
}
/** Confidential identify-only OAuth. Installation of commands is a separate explicit action. */
export class DiscordAuthorizationDriver implements ExpandedAuthorizationDriver {
    readonly provider = 'discord' as const;
    constructor(private readonly options: {
        clientId: string;
        clientSecret: string;
        fetch?: typeof fetch;
        now?: () => Date;
    }) { discordSnowflake.parse(options.clientId); if (!options.clientSecret || options.clientSecret.length > 16384)
        fail('invalid_configuration'); }
    authorizationUrl(input: {
        state: string;
        redirectUri: string;
        verifier: string;
        nonce: string;
    }) { const url = new URL('https://discord.com/oauth2/authorize'); url.search = new URLSearchParams({ client_id: this.options.clientId, response_type: 'code', scope: 'identify', state: input.state, redirect_uri: input.redirectUri, code_challenge: createHash('sha256').update(input.verifier).digest('base64url'), code_challenge_method: 'S256' }).toString(); return url.href; }
    private async response(url: string, init: RequestInit, signal: AbortSignal, empty = false) {
        signal.throwIfAborted();
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
        let response: Response;
        try {
            response = await (this.options.fetch ?? fetch)(url, { ...init, signal: deadline, redirect: 'error', cache: 'no-store' });
        }
        catch {
            return fail('provider_unavailable');
        }
        if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400))
            fail(response.status === 401 ? 'reconnect_required' : 'provider_rejected');
        if (empty) {
            await response.body?.cancel();
            return {};
        }
        const reader = response.body?.getReader();
        if (!reader)
            fail('malformed_response');
        let total = 0;
        const chunks: Uint8Array[] = [];
        try {
            while (true) {
                deadline.throwIfAborted();
                const part = await reader!.read();
                if (part.done)
                    break;
                total += part.value.byteLength;
                if (total > 65536)
                    fail('response_too_large');
                chunks.push(part.value);
            }
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        }
        catch {
            return fail('malformed_response');
        }
        finally {
            await reader!.cancel().catch(() => { });
            reader!.releaseLock();
        }
    }
    private form(path: 'token' | 'token/revoke', fields: Record<string, string>, signal: AbortSignal, empty = false) { return this.response(`https://discord.com/api/oauth2/${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ client_id: this.options.clientId, client_secret: this.options.clientSecret, ...fields }).toString() }, signal, empty); }
    private parseToken(raw: unknown, previous?: ConnectorGrant): ConnectorGrant { const value = tokenSchema.parse(raw), scopes = [...new Set(value.scope.split(/\s+/).filter(Boolean))]; if (scopes.length !== 1 || scopes[0] !== 'identify')
        fail('discord_unexpected_scope'); return { accessToken: value.access_token, refreshToken: value.refresh_token ?? previous?.refreshToken, scopes, expiresAt: new Date((this.options.now?.() ?? new Date()).getTime() + value.expires_in * 1000).toISOString() }; }
    async exchange(input: {
        code: string;
        redirectUri: string;
        verifier: string;
        nonce: string;
        issuedAfter: number;
        signal: AbortSignal;
    }) { const grant = this.parseToken(await this.form('token', { grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier }, input.signal)); const raw = await this.response('https://discord.com/api/v10/users/@me', { method: 'GET', headers: { authorization: `Bearer ${grant.accessToken}`, accept: 'application/json' } }, input.signal); const user = z.object({ id: discordSnowflake, username: z.string().min(1).max(200), global_name: z.string().max(200).nullable().optional(), bot: z.boolean().optional() }).parse(raw); if (user.bot)
        fail('discord_identity_required'); return { identity: { accountId: user.id, label: user.global_name || user.username, metadata: { applicationId: this.options.clientId } }, grant }; }
    async refresh(grant: ConnectorGrant, signal: AbortSignal) { if (!grant.refreshToken)
        fail('reconnect_required'); return this.parseToken(await this.form('token', { grant_type: 'refresh_token', refresh_token: grant.refreshToken! }, signal), grant); }
    async revoke(grant: ConnectorGrant, signal: AbortSignal) { await this.form('token/revoke', { token: grant.refreshToken ?? grant.accessToken, token_type_hint: grant.refreshToken ? 'refresh_token' : 'access_token' }, signal, true); return { status: 'revoked' as const }; }
}
