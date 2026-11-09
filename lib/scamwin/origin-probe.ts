import { lookup } from 'node:dns/promises';
import { connect, checkServerIdentity } from 'node:tls';
import ipaddr from 'ipaddr.js';
import { randomUUID } from 'node:crypto';
import type { Observation } from './contracts';
import { approvedOrigins, isAllowedOrigin, normalizeTarget, POLICY_VERSION } from './policy';

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
type ProbeOptions = { env?: Record<string, string | undefined>; signal?: AbortSignal; resolve?: typeof lookup };
/** Worker-only, DNS-pinned TLS handshake. No target fetch runs in Vercel. */
export async function probeOrigin(url: string, source: { checkId: string; runId: string }, options: ProbeOptions = {}): Promise<Observation> {
  const env = options.env ?? process.env;
  const result = (status: Observation['status'], data: Observation['data']): Observation => ({ id: randomUUID(), ...source, kind: 'tls', status, sourceKind: 'origin_probe', sourceRef: url, observedAt: new Date().toISOString(), data, collectorVersion: 'scamwin-tls-1', policyVersion: POLICY_VERSION });
  let target: ReturnType<typeof normalizeTarget>;
  try { target = normalizeTarget(url); } catch { return result('not_checked', { reason: 'No valid origin was selected for HTTPS validation.' }); }
  if (!target.url.startsWith('https:')) return result('not_checked', { reason: 'The selected URL uses unencrypted HTTP. No origin TLS handshake was performed.' });
  if (env.SCAMWIN_ORIGIN_PROBE_ENABLED !== 'true' || !isAllowedOrigin(url, approvedOrigins(env))) return result('not_checked', { reason: 'Origin TLS validation is disabled or outside the approved operator-owned scope.' });
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
  try {
    signal.throwIfAborted();
    const records = await new Promise<Awaited<ReturnType<typeof lookup>> | { address: string; family: number }[]>((resolve, reject) => {
      const abort = () => reject(new Error('Origin DNS deadline or cancellation'));
      signal.addEventListener('abort', abort, { once: true });
      void (options.resolve ?? lookup)(target.hostname, { all: true, verbatim: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
    if (!Array.isArray(records)) return result('unavailable', { reason: 'The origin DNS response was unsupported.' });
    if (!records.length || records.some(record => !isPublicAddress(record.address))) return result('blocked', { reason: 'The origin DNS result includes a non-public or unsupported address.' });
    signal.throwIfAborted();
    const record = records[0];
    return await new Promise<Observation>(resolve => {
      let settled = false;
      const socket = connect({ host: record.address, port: 443, servername: target.hostname, rejectUnauthorized: true, checkServerIdentity: (_, cert) => checkServerIdentity(target.hostname, cert) });
      const finish = (observation: Observation) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); socket.destroy(); resolve(observation); };
      const abort = () => finish(result('unavailable', { reason: 'Origin TLS validation reached its deadline or was canceled.' }));
      signal.addEventListener('abort', abort, { once: true });
      socket.once('secureConnect', () => {
        const cert = socket.getPeerCertificate();
        finish(result('observed', { valid: socket.authorized, protocol: socket.getProtocol(), issuer: String(cert.issuer?.O || '').slice(0, 500), validFrom: cert.valid_from, validTo: cert.valid_to, fingerprint: cert.fingerprint256, hostname: target.hostname, limitation: 'A valid TLS certificate establishes this hostname’s encrypted connection, not the legitimacy of the offer.' }));
      });
      socket.once('error', error => {
        const code = (error as NodeJS.ErrnoException).code ?? '';
        const invalid = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code);
        finish(result(invalid ? 'observed' : 'unavailable', invalid ? { valid: false, code, reason: 'Origin certificate validation failed.' } : { reason: 'The origin TLS connection could not be completed.' }));
      });
      if (signal.aborted) abort();
    });
  } catch { options.signal?.throwIfAborted(); return result('unavailable', { reason: 'Public DNS or origin TLS validation was unavailable.' }); }
}
