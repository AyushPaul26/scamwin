import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePaymentUri } from '../lib/scamwin/policy';

test('owned refund fixtures expose an inspectable synthetic checkpoint without an active payment control', async () => {
  const offer = await import('../app/lab/refund-offer/route');
  const checkpoint = await import('../app/lab/refund-checkpoint/route');
  const policy = await import('../app/lab/official-refund-policy/route');
  const fixtures = [offer, checkpoint, policy];
  const responses = fixtures.map(fixture => fixture.GET());
  const html = await Promise.all(responses.map(response => response.text()));

  for (let index = 0; index < responses.length; index++) {
    assert.match(responses[index].headers.get('content-type') ?? '', /^text\/html; charset=utf-8$/);
    assert.equal(responses[index].headers.get('cache-control'), 'no-store');
    assert.match(html[index], /Scamwin fictional training fixture\. No real refund or payment\./);
    assert.match(html[index], /Fictional Demo Refunds/);
    assert.doesNotMatch(html[index], /<(?:script|form|input|iframe|img|link|video|audio)\b/i);
    assert.equal(Object.keys(fixtures[index]).join(','), 'GET');
  }

  assert.match(html[0], /href="\/lab\/refund-checkpoint"/);
  const paymentAnchor = html[1].match(/<a\b[^>]*data-scamwin-checkpoint[^>]*>/)?.[0] ?? '';
  assert.match(paymentAnchor, /\binert\b/);
  assert.match(paymentAnchor, /aria-disabled="true"/);
  const paymentUri = paymentAnchor.match(/href="([^"]+)"/)?.[1].replaceAll('&amp;', '&') ?? '';
  assert.deepEqual(parsePaymentUri(paymentUri), {
    direction: 'outgoing', recipient: 'scamwin-fictional-recipient@example.invalid', amount: '499', currency: 'INR',
  });
  assert.match(html[1], /Your refund of ₹2,499 is ready/);
  assert.match(html[1], /processing fee of ₹499/);
  assert.match(html[2], /never requires an upfront fee/);
  assert.match(html[2], /never asks for a password or one-time code/);
  assert.doesNotMatch(html[2], /href="upi:/);
});
