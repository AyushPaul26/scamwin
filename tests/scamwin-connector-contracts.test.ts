import assert from 'node:assert/strict';
import test from 'node:test';
import { selectItem, boundManifest, admissionKey } from '../lib/scamwin/connectors/policy';
import { sealConnectorSecret, openConnectorSecret, privateIdentifier, signDispatch, verifyDispatch } from '../lib/scamwin/connectors/crypto';

test('all_new selects a routine text-only item regardless of selective rules', () => {
  assert.deepEqual(selectItem('all_new', { contains: ['urgent'] }, { text: 'Routine meeting notes' }), { selected: true, state: 'queued', reason: 'all_new' });
});
test('manual imports no background item and selective nonmatch gets no safety verdict', () => {
  assert.deepEqual(selectItem('manual', {}, { text: 'urgent' }), { selected: false, state: 'paused', reason: 'manual' });
  assert.deepEqual(selectItem('selective', { contains: ['urgent'] }, { text: 'Routine notes' }), { selected: false, state: 'not_selected', reason: 'rules_nonmatch' });
});
test('201 distinct URLs and oversized body/attachments preserve explicit overflow coverage', () => {
  const result = boundManifest({ text: 'x'.repeat(262145), urls: Array.from({ length: 201 }, (_, i) => `https://example.org/${i}`), attachments: Array.from({ length: 21 }, (_, i) => ({ id: `${i}`, name: 'document.pdf', mediaType: 'application/pdf', supported: false })) });
  assert.equal(result.urls.length, 200); assert.equal(result.attachments.length, 20);
  assert.equal(Buffer.byteLength(result.text), 262144);
  assert.deepEqual(result.overflow, { textBytes: 1, urls: 1, attachments: 1 });
  assert.equal(result.coverage, 'partial');
});
test('URL identities stay distinct and normalization never fetches', () => {
  const result = boundManifest({ text: 'hello', urls: ['https://example.org', 'https://example.org/', 'https://example.org/unsubscribe'], attachments: [] });
  assert.equal(result.urls.length, 2);
  assert.deepEqual(result.urls[0], { original: 'https://example.org', normalized: 'https://example.org/' });
});
test('admission identity changes on edit/epoch/target/generation and avoids delimiter ambiguity', () => {
  const ref = { id: 'c', ownerId: 'alice', provider: 'gmail' as const, epoch: 1 };
  const key = admissionKey(ref, 'item', 'a'.repeat(64), 'target', 1);
  assert.equal(key.length, 64); assert.equal(key, admissionKey(ref, 'item', 'a'.repeat(64), 'target', 1));
  assert.notEqual(key, admissionKey({ ...ref, epoch: 2 }, 'item', 'a'.repeat(64), 'target', 1));
  assert.notEqual(key, admissionKey(ref, 'item', 'b'.repeat(64), 'target', 1));
  assert.notEqual(key, admissionKey(ref, 'item', 'a'.repeat(64), 'target', 2));
});
test('envelope encryption binds owner/connection/epoch/purpose and hides plaintext', () => {
  const keyring = { activeVersion: 'k1', keys: { k1: Buffer.alloc(32, 7), identifier: Buffer.alloc(32, 8) } };
  const binding = { ownerId: 'alice', connectionId: 'c', epoch: 1, purpose: 'grant' as const };
  const sealed = sealConnectorSecret('token-secret', binding, keyring);
  assert.ok(!sealed.includes('token-secret')); assert.equal(openConnectorSecret(sealed, binding, keyring), 'token-secret');
  for (const changed of [{ ...binding, ownerId: 'bob' }, { ...binding, epoch: 2 }, { ...binding, purpose: 'cursor' as const }]) assert.throws(() => openConnectorSecret(sealed, changed, keyring), /decryption_failed/);
  assert.notEqual(privateIdentifier('abc', binding, keyring), privateIdentifier('abc', { ...binding, ownerId: 'bob' }, keyring));
});
test('identifier hashing requires its stable key instead of silently following encryption rotation', () => {
  const binding = { ownerId: 'alice', connectionId: 'c', epoch: 1, purpose: 'identifier' as const };
  assert.throws(() => privateIdentifier('provider-account', binding, { activeVersion: 'k1', keys: { k1: Buffer.alloc(32, 7) } }), /key_unavailable/);
  const first = { activeVersion: 'k1', keys: { k1: Buffer.alloc(32, 7), identifier: Buffer.alloc(32, 8) } };
  const rotated = { activeVersion: 'k2', keys: { k2: Buffer.alloc(32, 9), identifier: Buffer.alloc(32, 8) } };
  assert.equal(privateIdentifier('provider-account', binding, first), privateIdentifier('provider-account', binding, rotated));
});
test('dispatch signature binds exact body and bounded timestamp without accepting replay age', () => {
  const now = Date.parse('2026-11-10T12:00:00Z'), key = Buffer.alloc(32, 9);
  const signed = signDispatch('body', now, key);
  assert.equal(verifyDispatch('body', signed, key, now + 1000), true);
  assert.equal(verifyDispatch('changed', signed, key, now), false);
  assert.equal(verifyDispatch('body', signed, key, now + 300001), false);
});
