import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export interface ConnectorKeyring { activeVersion: string; keys: Record<string, Buffer> }
export interface SecretBinding { ownerId: string; connectionId: string; epoch: number; purpose: 'grant' | 'cursor' | 'page' | 'content' | 'input' | 'oauth' | 'identifier' | 'subscription' }
const envelopeSchema = z.object({ v: z.literal(1), k: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), iv: z.string(), tag: z.string(), data: z.string(), wiv: z.string(), wtag: z.string(), wrapped: z.string() }).strict();
const aad = (b: SecretBinding) => Buffer.from(JSON.stringify(['scamwin-connectors-v1', b.ownerId, b.connectionId, b.epoch, b.purpose]));
function validKey(key: Buffer | undefined): Buffer { if (!key || key.length !== 32) throw new Error('connector_key_unavailable'); return key; }
function encrypt(value: Buffer, key: Buffer, context: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(context);
  return { iv: iv.toString('base64url'), tag: '', data: Buffer.concat([cipher.update(value), cipher.final()]).toString('base64url'), cipher };
}
function decrypt(data: string, iv: string, tag: string, key: Buffer, context: Buffer) {
  for (const part of [data, iv, tag]) if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error();
  const nonce = Buffer.from(iv, 'base64url'), auth = Buffer.from(tag, 'base64url');
  if (nonce.length !== 12 || auth.length !== 16) throw new Error();
  const cipher = createDecipheriv('aes-256-gcm', key, nonce); cipher.setAAD(context); cipher.setAuthTag(auth);
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]);
}
export function sealConnectorSecret(value: string, binding: SecretBinding, keyring: ConnectorKeyring): string {
  if (!value || Buffer.byteLength(value) > 2 * 1024 * 1024) throw new Error('connector_secret_size');
  const context = aad(binding), dataKey = randomBytes(32);
  const payload = encrypt(Buffer.from(value), dataKey, context), wrapped = encrypt(dataKey, validKey(keyring.keys[keyring.activeVersion]), context);
  return JSON.stringify({ v: 1, k: keyring.activeVersion, iv: payload.iv, tag: payload.cipher.getAuthTag().toString('base64url'), data: payload.data, wiv: wrapped.iv, wtag: wrapped.cipher.getAuthTag().toString('base64url'), wrapped: wrapped.data });
}
export function openConnectorSecret(value: string, binding: SecretBinding, keyring: ConnectorKeyring): string {
  try {
    if (value.length > 3 * 1024 * 1024) throw new Error();
    const e = envelopeSchema.parse(JSON.parse(value)), context = aad(binding);
    const dataKey = decrypt(e.wrapped, e.wiv, e.wtag, validKey(keyring.keys[e.k]), context);
    return decrypt(e.data, e.iv, e.tag, validKey(dataKey), context).toString('utf8');
  } catch { throw new Error('connector_decryption_failed'); }
}
/** Use a stable, separate identifier key: rotating the encryption key must not break dedupe/account binding. */
export function privateIdentifier(value: string, binding: SecretBinding, keyring: ConnectorKeyring) {
  return createHmac('sha256', validKey(keyring.keys.identifier)).update(aad(binding)).update('\0').update(value).digest('hex');
}
export function signDispatch(body: string, timestampMs: number, key: Buffer) {
  const timestamp = Math.trunc(timestampMs).toString();
  return `${timestamp}.${createHmac('sha256', validKey(key)).update(`${timestamp}\n${body}`).digest('hex')}`;
}
export function verifyDispatch(body: string, signature: string, key: Buffer, nowMs = Date.now()) {
  if (!/^\d{13}\.[a-f0-9]{64}$/.test(signature)) return false;
  const timestamp = Number(signature.slice(0, 13));
  if (timestamp > nowMs + 30000 || nowMs - timestamp > 300000) return false;
  const expected = Buffer.from(signDispatch(body, timestamp, key));
  return timingSafeEqual(Buffer.from(signature), expected);
}
