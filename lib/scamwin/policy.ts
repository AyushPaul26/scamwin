import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export const POLICY_VERSION = 'scamwin-fixture-v1';
export const COLLECTOR_LIMITS = { milliseconds: 60_000, requests: 100, bytes: 15 * 1024 * 1024, redirects: 3, documents: 2, text: 100 * 1024, captures: 3 } as const;
export function normalizeTarget(value: string) {
  if (!value || value.length > 4096 || /\s/.test(value)) throw new Error('Enter one public HTTP or HTTPS URL.');
  const url = new URL(value);
  const hostname = domainToASCII(url.hostname.toLowerCase().replace(/\.$/, ''));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !hostname.includes('.') || isIP(hostname) || hostname.startsWith('[') || /(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(hostname)) throw new Error('Only public website URLs without credentials or custom ports are supported.');
  if (!hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('Invalid hostname.');
  url.hostname = hostname; url.hash = '';
  return { url: url.href, hostname, origin: url.origin };
}
export function isAllowedOrigin(value: string, allowed: readonly string[]): boolean {
  try { return allowed.some(origin => normalizeTarget(origin).origin === normalizeTarget(value).origin); } catch { return false; }
}
export function approvedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  return (env.SCAMWIN_APPROVED_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean).map(v => {
    const parsed = normalizeTarget(v);
    if (!parsed.url.startsWith('https:') || new URL(parsed.url).pathname !== '/') throw new Error('Approved origins must be exact HTTPS origins.');
    return parsed.origin;
  });
}
export function parsePaymentUri(value: string): { direction: 'outgoing'; recipient: string; amount: string | null; currency: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'upi:' || url.hostname !== 'pay' || url.username || url.password || url.port) return null;
    for (const key of ['pa', 'am', 'cu']) if (url.searchParams.getAll(key).length > 1) return null;
    const recipient = url.searchParams.get('pa') ?? '', amount = url.searchParams.get('am'), currency = url.searchParams.get('cu') ?? 'INR';
    if (!/^[a-zA-Z0-9._-]{1,200}@[a-zA-Z0-9._-]{1,100}$/.test(recipient) || currency !== 'INR' || (amount !== null && (!/^\d{1,9}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0))) return null;
    return { direction: 'outgoing', recipient, amount, currency };
  } catch { return null; }
}
export function extractUrlSignals(value: string): { code: string; summary: string }[] {
  const { hostname, url } = normalizeTarget(value), signals: { code: string; summary: string }[] = [];
  if (url.startsWith('http:')) signals.push({ code: 'unencrypted_http', summary: 'The selected address uses unencrypted HTTP. Do not submit sensitive information over this connection.' });
  if (hostname.includes('xn--')) signals.push({ code: 'internationalized_domain', summary: 'This domain uses internationalized encoding. Compare the exact address with the independently verified official site.' });
  if (/(?:^|[-.])(login|verify|refund|kyc|account|secure)(?:[-.]|$)/i.test(hostname)) signals.push({ code: 'identity_language', summary: 'The domain includes account or offer-related wording. This is a weak URL signal, not proof of fraud.' });
  if (hostname.split('.').length > 5) signals.push({ code: 'many_subdomains', summary: 'The address has several subdomain levels. Read the actual registered destination carefully.' });
  return signals;
}
