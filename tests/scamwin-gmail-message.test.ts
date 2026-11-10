import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGmailMessage, type GmailRawMessage, type GmailRawPart } from '../lib/scamwin/connectors/providers/gmail-message';

const encoded = (text: string) => Buffer.from(text).toString('base64url');
const textPart = (partId: string, text: string, mimeType = 'text/plain'): GmailRawPart => ({
  partId, mimeType, filename: '', headers: [{ name: 'Content-Type', value: `${mimeType}; charset=UTF-8` }],
  body: { size: Buffer.byteLength(text), data: encoded(text) },
});
const message = (payload: GmailRawPart): GmailRawMessage => ({
  id: 'message-1', threadId: 'thread-1', historyId: '90071992547409931234',
  internalDate: '1794312000000', sizeEstimate: 999999999999, labelIds: ['INBOX'], payload,
});
const codes = (result: ReturnType<typeof parseGmailMessage>) => result.diagnostics.map((entry) => entry.code);

test('preserves opaque source identity and provider time independently of untrusted Date and sender headers', () => {
  const raw = message(textPart('0', 'Routine notes: https://example.org/a'));
  raw.payload!.headers!.push({ name: 'From', value: 'Claimed Sender <claim@example.org>' }, { name: 'Date', value: 'Tue, 01 Jan 1980 00:00:00 GMT' });
  const result = parseGmailMessage(raw);
  assert.equal(result.coverage, 'complete');
  assert.deepEqual(result.source, { provider: 'gmail', messageId: 'message-1', threadId: 'thread-1', historyId: '90071992547409931234', internalDateMs: '1794312000000' });
  assert.equal(result.untrustedContext.from, 'Claimed Sender <claim@example.org>');
  assert.equal(result.untrustedContext.date, 'Tue, 01 Jan 1980 00:00:00 GMT');
  assert.equal(result.bodyText, 'Routine notes: https://example.org/a');
  assert.deepEqual(result.links, [{ url: 'https://example.org/a', partId: '0', kind: 'text' }]);
});

test('nested MIME alternatives prefer plain text once while retaining hidden HTML destinations', () => {
  const result = parseGmailMessage(message({ partId: '', mimeType: 'multipart/mixed', body: { size: 0 }, parts: [
    { partId: '0', mimeType: 'multipart/alternative', body: { size: 0 }, parts: [
      textPart('0.0', 'Hello there https://plain.example/'),
      textPart('0.1', '<p>Hello there</p><a hidden href="https://hidden.example/pay?a=1&amp;b=2">safe label</a><script>fetch("https://script.example/")</script><img src="https://pixel.example/">', 'text/html'),
    ] }, textPart('1', 'Second section'),
  ] }));
  assert.equal(result.bodyText, 'Hello there https://plain.example/\n\nSecond section');
  assert.deepEqual(result.links, [
    { url: 'https://plain.example/', partId: '0.0', kind: 'text' },
    { url: 'https://hidden.example/pay?a=1&b=2', partId: '0.1', kind: 'html_href' },
  ]);
  assert.deepEqual(result.bodySources, [{ partId: '0.0', mediaType: 'text/plain' }, { partId: '1', mediaType: 'text/plain' }]);
  assert.equal(result.coverage, 'complete');
});

test('HTML-only content decodes entities, readable boundaries and hostile inert markup without executing or loading it', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('parser attempted network'); };
  try {
    const result = parseGmailMessage(message(textPart('html', '<div>Hello &amp; welcome</div><div>Next<br>line</div><a href="javascript:alert(1)">label</a><a href="//relative.example/x">relative</a><iframe src="https://frame.example/"></iframe><style>.x{}</style>', 'text/html')));
    assert.equal(result.bodyText, 'Hello & welcome\nNext\nline\nlabelrelative');
    assert.deepEqual(result.links, []);
    assert.equal(result.coverage, 'complete');
  } finally { globalThis.fetch = originalFetch; }
});

test('decodes Unicode base64url and adjacent RFC2047 B/Q header words', () => {
  const raw = message(textPart('0', 'नमस्ते 🌍'));
  raw.payload!.headers!.push({ name: 'Subject', value: '=?UTF-8?B?SGVsbG8=?=\r\n =?UTF-8?Q?_=E2=9C=93?=' });
  const result = parseGmailMessage(raw);
  assert.equal(result.bodyText, 'नमस्ते 🌍');
  assert.equal(result.untrustedContext.subject, 'Hello ✓');
  assert.equal(result.coverage, 'complete');
});

test('malformed body base64url and invalid UTF-8 never become fabricated successful text', () => {
  for (const data of ['%%%bad', 'a', 'SGVsbG8===', '_w']) {
    const result = parseGmailMessage(message({ partId: 'bad', mimeType: 'text/plain', body: { size: 4, data } }));
    assert.equal(result.bodyText, '');
    assert.equal(result.coverage, 'unavailable');
    assert.ok(codes(result).includes(data === '_w' ? 'malformed_text_encoding' : 'malformed_base64url'));
  }
});

test('unsupported body charset and malformed encoded headers produce explicit coverage diagnostics', () => {
  const raw = message(textPart('0', 'ASCII-looking bytes'));
  raw.payload!.headers = [
    { name: 'Content-Type', value: 'text/plain; charset=x-unknown-charset' },
    { name: 'Subject', value: '=?UTF-8?Q?broken=ZZ?=' },
    { name: 'From', value: '=?x-unknown?B?YWJj?=' },
  ];
  const result = parseGmailMessage(raw);
  assert.equal(result.bodyText, '');
  assert.equal(result.untrustedContext.subject, undefined);
  assert.equal(result.untrustedContext.from, undefined);
  assert.ok(codes(result).includes('unsupported_charset'));
  assert.ok(codes(result).includes('malformed_encoded_header'));
  assert.equal(result.coverage, 'unavailable');
});

test('detached text and inline raster retain only provider-scoped metadata; PDF and executable remain unsupported', () => {
  const result = parseGmailMessage(message({ partId: '', mimeType: 'multipart/mixed', parts: [
    textPart('0', 'Message text'),
    { partId: '1', mimeType: 'text/plain', body: { size: 55, attachmentId: 'detached-1' } },
    { partId: '2', mimeType: 'image/png', filename: 'inline.png', headers: [{ name: 'Content-Disposition', value: 'inline' }], body: { size: 5, attachmentId: 'image-2' } },
    { partId: '3', mimeType: 'application/pdf', filename: 'terms.pdf', body: { size: 100, attachmentId: 'pdf-3' } },
    { partId: '4', mimeType: 'application/x-msdownload', filename: 'run.exe', body: { size: 999999999999, data: 'AAAA' } },
  ] }));
  assert.deepEqual(result.attachments.map((attachment) => ({ partId: attachment.partId, handling: attachment.handling })), [
    { partId: '1', handling: 'detached_text' }, { partId: '2', handling: 'preparable_image' },
    { partId: '3', handling: 'unsupported' }, { partId: '4', handling: 'unsupported' },
  ]);
  assert.deepEqual(result.attachments[1], { provider: 'gmail', messageId: 'message-1', partId: '2', attachmentId: 'image-2', mediaType: 'image/png', filename: 'inline.png', declaredBytes: 5, inline: true, handling: 'preparable_image' });
  assert.equal(result.coverage, 'partial');
  assert.ok(codes(result).includes('detached_body'));
  assert.ok(codes(result).includes('unsupported_content'));
  assert.ok(result.attachments.every((attachment) => !('data' in attachment) && !('url' in attachment)));
});

test('decoded text bytes are bounded at 256KiB without cutting UTF-8 or trusting sizeEstimate', () => {
  const result = parseGmailMessage(message(textPart('large', `${'x'.repeat(262143)}🌍tail`)));
  assert.equal(Buffer.byteLength(result.bodyText), 262143);
  assert.equal(result.bodyText.endsWith('�'), false);
  assert.equal(result.coverage, 'partial');
  assert.ok(codes(result).includes('text_byte_limit'));
});

test('limits apply across alternatives and sibling parts, not only to final chosen text', () => {
  const result = parseGmailMessage(message({ partId: '', mimeType: 'multipart/alternative', parts: [
    textPart('0', 'x'.repeat(200000)), textPart('1', `<p>${'y'.repeat(200000)}</p>`, 'text/html'),
  ] }));
  assert.equal(result.bodyText.length, 200000);
  assert.ok(result.stats.decodedTextBytes <= 262144);
  assert.ok(codes(result).includes('text_byte_limit'));
  assert.equal(result.coverage, 'partial');
});

test('200 distinct HTTP(S) destinations are retained with explicit discovered-link overflow', () => {
  const links = Array.from({ length: 201 }, (_, index) => `https://example.org/${index}`);
  const result = parseGmailMessage(message(textPart('0', `${links.join(' ')} ${links[0]}`)));
  assert.equal(result.links.length, 200);
  assert.equal(result.stats.linksDiscovered, 201);
  assert.ok(codes(result).includes('link_limit'));
  assert.equal(result.coverage, 'partial');
});

test('20 attachment records are retained while discovered overflow is reported', () => {
  const result = parseGmailMessage(message({ mimeType: 'multipart/mixed', parts: Array.from({ length: 21 }, (_, index) => ({ partId: `${index}`, mimeType: 'image/jpeg', filename: `${index}.jpg`, body: { attachmentId: `asset-${index}`, size: 1 } })) }));
  assert.equal(result.attachments.length, 20);
  assert.equal(result.stats.attachmentsDiscovered, 21);
  assert.ok(codes(result).includes('attachment_limit'));
  assert.equal(result.coverage, 'unavailable');
});

test('part traversal and nested MIME depth stop with explicit lower-bound coverage', () => {
  let nested = textPart('leaf', 'too deep');
  for (let index = 0; index < 25; index++) nested = { mimeType: 'multipart/mixed', parts: [nested] };
  const deep = parseGmailMessage(message(nested));
  assert.equal(deep.bodyText, '');
  assert.ok(codes(deep).includes('mime_depth_limit'));
  const wide = parseGmailMessage(message({ mimeType: 'multipart/mixed', parts: Array.from({ length: 205 }, (_, index) => textPart(`${index}`, 'x')) }));
  assert.ok(wide.stats.partsVisited <= 200);
  assert.ok(codes(wide).includes('mime_part_limit'));
  assert.equal(wide.coverage, 'partial');
});

test('missing identity, missing body and invalid provider timestamps are explicit unavailable/partial states', () => {
  const noIdentity = parseGmailMessage({ payload: textPart('0', 'hello') });
  assert.equal(noIdentity.coverage, 'unavailable');
  assert.ok(codes(noIdentity).includes('missing_message_id'));
  const noBody = parseGmailMessage(message({ mimeType: 'text/plain', body: { size: 50 } }));
  assert.equal(noBody.coverage, 'unavailable');
  assert.ok(codes(noBody).includes('missing_body'));
  const wrongTime = parseGmailMessage({ ...message(textPart('0', 'hello')), internalDate: '90071992547409931234' });
  assert.equal(wrongTime.source.internalDateMs, undefined);
  assert.ok(codes(wrongTime).includes('invalid_internal_date'));
  assert.equal(wrongTime.coverage, 'partial');
});

test('header allocation is bounded and truncation never masquerades as complete header context', () => {
  const raw = message(textPart('0', 'hello'));
  raw.payload!.headers!.push({ name: 'Subject', value: 'x'.repeat(1000000) });
  const result = parseGmailMessage(raw);
  assert.ok((result.untrustedContext.subject?.length ?? 0) <= 2048);
  assert.ok(codes(result).includes('header_limit'));
  assert.equal(result.coverage, 'partial');
});

test('single-byte ISO-8859-1 decoding preserves its charset rather than silently remapping Windows code points', () => {
  const raw = message({ partId: 'latin', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }], body: { data: 'gOn_', size: 3 } });
  const result = parseGmailMessage(raw);
  assert.equal(result.bodyText, '\u0080éÿ');
  assert.equal(result.coverage, 'complete');
});

test('literal URL punctuation and balanced parentheses remain part of actual destinations', () => {
  const result = parseGmailMessage(message(textPart('0', 'https://example.org/a! https://example.org/Function_(math)')));
  assert.deepEqual(result.links.map((link) => link.url), ['https://example.org/a!', 'https://example.org/Function_(math)']);
});

test('wide MIME children below the depth limit still consume the part traversal budget', () => {
  let nested: GmailRawPart = { mimeType: 'multipart/mixed', parts: Array.from({ length: 1000 }, (_, index) => textPart(`leaf-${index}`, 'out of depth')) };
  for (let index = 0; index < 16; index++) nested = { mimeType: 'multipart/mixed', parts: [nested] };
  const result = parseGmailMessage(message(nested));
  assert.equal(result.bodyText, '');
  assert.equal(result.stats.partsVisited, 200);
  assert.ok(codes(result).includes('mime_depth_limit'));
  assert.ok(codes(result).includes('mime_part_limit'));
});

test('credentialed destinations are omitted with explicit partial coverage, never exposed as fetch URLs', () => {
  const result = parseGmailMessage(message(textPart('0', '<a href="https://user:secret@example.org/">pay</a><a href="https://example.org/ok#fragment">other</a>', 'text/html')));
  assert.deepEqual(result.links, [{ url: 'https://example.org/ok#fragment', partId: '0', kind: 'html_href' }]);
  assert.ok(codes(result).includes('credentialed_link'));
  assert.equal(result.coverage, 'partial');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('bounded HTML traversal advertises omitted content instead of reporting full coverage', () => {
  const result = parseGmailMessage(message(textPart('0', `${'<i>x</i>'.repeat(10001)}<a href="https://beyond.example/">beyond</a>`, 'text/html')));
  assert.ok(codes(result).includes('html_node_limit'));
  assert.equal(result.coverage, 'partial');
  assert.equal(result.links.some((link) => link.url === 'https://beyond.example/'), false);
});

test('partial alternatives fall back to readable HTML while retaining exact href destinations and encoded filenames', () => {
  const result = parseGmailMessage(message({ mimeType: 'multipart/mixed', parts: [
    { mimeType: 'multipart/alternative', parts: [
      { partId: 'bad', mimeType: 'text/plain', body: { data: '%bad', size: 2 } },
      textPart('html', '<a href="https://example.org/a!">Welcome ✓</a>', 'text/html'),
    ] },
    { partId: 'image', mimeType: 'image/png', filename: '=?UTF-8?Q?photo_=E2=9C=93.png?=', body: { attachmentId: 'opaque', size: 40 } },
  ] }));
  assert.equal(result.bodyText, 'Welcome ✓');
  assert.equal(result.attachments[0].filename, 'photo ✓.png');
  assert.equal(result.links[0].url, 'https://example.org/a!');
  assert.equal(result.coverage, 'partial');
});

test('an empty plain alternative cannot hide the only meaningful readable HTML representation', () => {
  const result = parseGmailMessage(message({ mimeType: 'multipart/alternative', parts: [
    textPart('plain', '  \n '), textPart('html', '<p>Your payment details have changed.</p>', 'text/html'),
  ] }));
  assert.equal(result.bodyText, 'Your payment details have changed.');
  assert.deepEqual(result.bodySources, [{ partId: 'html', mediaType: 'text/html' }]);
  assert.equal(result.coverage, 'complete');
});

test('noscript and object fallback text and anchors remain readable without loading object resources', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('parser attempted network'); };
  try {
    const result = parseGmailMessage(message(textPart('fallback', '<p>Account notice</p><noscript><p><a href="https://noscript.example/pay">Pay now</a></p></noscript><object data="https://resource.example/document.pdf"><p><a href="https://fallback.example/details">Read details</a></p></object>', 'text/html')));
    assert.equal(result.bodyText, 'Account notice\nPay now\nRead details');
    assert.deepEqual(result.links, [
      { url: 'https://noscript.example/pay', partId: 'fallback', kind: 'html_href' },
      { url: 'https://fallback.example/details', partId: 'fallback', kind: 'html_href' },
    ]);
    assert.equal(result.coverage, 'complete');
    assert.deepEqual(result.diagnostics, []);
  } finally { globalThis.fetch = originalFetch; }
});

test('positive declared size with empty body data is unavailable while genuine zero-byte text is complete', () => {
  const missing = parseGmailMessage(message({ partId: 'missing', mimeType: 'text/plain', body: { data: '', size: 50 } }));
  assert.equal(missing.bodyText, '');
  assert.deepEqual(missing.bodySources, []);
  assert.equal(missing.coverage, 'unavailable');
  assert.ok(codes(missing).includes('missing_body'));
  assert.equal(missing.stats.decodedTextBytes, 0);
  const empty = parseGmailMessage(message({ partId: 'empty', mimeType: 'text/plain', body: { data: '', size: 0 } }));
  assert.equal(empty.bodyText, '');
  assert.deepEqual(empty.bodySources, [{ partId: 'empty', mediaType: 'text/plain' }]);
  assert.equal(empty.coverage, 'complete');
  assert.deepEqual(empty.diagnostics, []);
});
