import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runOfficialSourceAcceptance } from '../scripts/check-scamwin-official-sources';
import type { OfficialCatalog, OfficialReader, OfficialSource } from '../lib/scamwin/official-verification-contracts';
import { officialBoard, officialFixtureCatalog, officialFixtureDocument, officialNow } from './fixtures/scamwin-official-fixture';

const argv = ['--company', 'example-company', '--post', '12345'];
const now = () => new Date(officialNow);

test('acceptance refuses malformed arguments and private or arbitrary URL references before reading', async () => {
  let reads = 0;
  const reader: OfficialReader = async () => { reads++; throw new Error('must not read'); };
  for (const args of [
    [], ['--company', 'example-company'], [...argv, '--post', '54321'],
    ['--url', 'https://company.example/careers/jobs/12345', '--post', '12345'],
    ['--company', 'https://company.example', '--post', '12345'],
    ['--company', 'example-company', '--post', 'https://job-boards.greenhouse.io/examplecompany/jobs/12345'],
    ['--company', 'example-company', '--post', 'https://127.0.0.1/private'],
    ['--company', 'example-company', '--post', '12345?token=private-value'],
    ['--company', 'example-company', '--post', 'private@example.org'],
    ['--company', 'example-company', '--post', ' 12345 '],
    ['--company', 'example-company', '--post', '0'],
    ['--company', 'example-company', '--post', '0012345'],
    ['--company', 'example-company', '--post', '1'.repeat(21)],
    ['--company', 'example-company', '--post', '1'.repeat(121)],
  ]) {
    const result = await runOfficialSourceAcceptance(args, { catalog: officialFixtureCatalog, reader, now });
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.status, 'refused');
    assert.equal(result.report.reasonCode, 'invalid_arguments');
    assert.doesNotMatch(JSON.stringify(result), /private-value|private@example|127\.0\.0\.1/);
  }
  assert.equal(reads, 0);
});

test('acceptance resolves exact catalogue IDs and refuses invalid, unknown and expired catalogue entries before reading', async () => {
  let reads = 0;
  const reader: OfficialReader = async () => { reads++; throw new Error('must not read'); };
  const cases: { catalog: OfficialCatalog; args: string[]; reason: string }[] = [
    { catalog: officialFixtureCatalog, args: ['--company', 'unknown-company', '--post', '12345'], reason: 'unknown_company' },
    { catalog: officialFixtureCatalog, args: ['--company', 'example', '--post', '12345'], reason: 'unknown_company' },
  ];
  for (const reviewedAt of ['2026-10-11T12:00:00.000Z', '2026-11-11T12:00:00.000Z']) {
    const expired = structuredClone(officialFixtureCatalog);
    expired.companies[0].reviewedAt = reviewedAt;
    cases.push({ catalog: expired, args: argv, reason: 'expired_company' });
  }
  const invalid = structuredClone(officialFixtureCatalog);
  invalid.companies[0].reviewEvidenceUrl = 'https://wrong-company.example/careers';
  cases.push({ catalog: invalid, args: argv, reason: 'invalid_catalog' });
  for (const item of cases) {
    const result = await runOfficialSourceAcceptance(item.args, { catalog: item.catalog, reader, now });
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.status, 'refused');
    assert.equal(result.report.reasonCode, item.reason);
  }
  assert.equal(reads, 0);
});

test('acceptance refuses absent or ambiguous exact-post sources without choosing a board', async () => {
  let reads = 0;
  const reader: OfficialReader = async () => { reads++; throw new Error('must not read'); };
  const noBoard = structuredClone(officialFixtureCatalog);
  noBoard.companies[0].sources = noBoard.companies[0].sources.filter(source => source.kind !== 'greenhouse_job');
  const twoBoards = structuredClone(officialFixtureCatalog);
  const secondBoard: OfficialSource = { ...officialBoard, id: 'second-example-board', kind: 'greenhouse_job', purpose: 'careers', boardToken: 'secondexample', entryUrl: 'https://job-boards.greenhouse.io/secondexample', listingUrlTemplate: 'https://job-boards.greenhouse.io/secondexample/jobs/{postId}', delegationEvidenceUrl: 'https://company.example/careers' };
  twoBoards.companies[0].sources.push(secondBoard);
  for (const [catalog, reason] of [[noBoard, 'no_exact_post_source'], [twoBoards, 'ambiguous_source']] as const) {
    const result = await runOfficialSourceAcceptance(argv, { catalog, reader, now });
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.status, 'refused');
    assert.equal(result.report.reasonCode, reason);
  }
  assert.equal(reads, 0);
});

test('acceptance checks one trusted public post under the shared reader budget and prints no source content', async () => {
  let reads = 0;
  const reader: OfficialReader = async (source, reference, { signal, budget }) => {
    reads++;
    assert.equal(source.id, 'example-board');
    assert.deepEqual(reference, { kind: 'greenhouse_post_id', value: '12345', origin: 'explicit_field' });
    assert.equal(signal.aborted, false);
    assert.deepEqual(budget, { deadlineAtMs: officialNow.getTime() + 20_000, documentsRemaining: 2, requestsRemaining: 4, bytesRemaining: 524288 });
    budget.documentsRemaining--;
    budget.requestsRemaining -= 2;
    budget.bytesRemaining -= 512;
    const document = officialFixtureDocument(source);
    document.body = JSON.stringify({ id: 12345, company_name: 'Example Company', title: 'Private output sentinel', content: 'Do not print this body' });
    return document;
  };
  const result = await runOfficialSourceAcceptance(['--post', '12345', '--company', 'example-company'], { catalog: officialFixtureCatalog, reader, now });
  assert.equal(reads, 1);
  assert.deepEqual(result, {
    exitCode: 0,
    report: {
      status: 'ok', companyId: 'example-company', sourceId: 'example-board',
      catalogVersion: 'official-fixture-1', checkedAt: '2026-11-10T12:00:00.000Z', fetchedAt: '2026-11-10T12:00:00.000Z',
      offerStatus: 'matched_public_reference',
      budget: { documentsUsed: 1, documentLimit: 2, requestsUsed: 2, requestLimit: 4, bytesUsed: 512, byteLimit: 524288, elapsedMs: 0, stageLimitMs: 20000 },
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /Private output sentinel|Do not print|https:\/\//);
});

test('acceptance reports bounded unavailable and absent results without claiming fraud or retrying', async () => {
  for (const [status, offerStatus] of [['not_found', 'not_found_in_checked_source'], ['unavailable', 'unavailable'], ['blocked', 'unavailable']] as const) {
    let reads = 0;
    const reader: OfficialReader = async (source, _reference, { budget }) => {
      reads++;
      budget.documentsRemaining--;
      budget.requestsRemaining--;
      return { ...officialFixtureDocument(source), status, body: null, reasonCode: 'do-not-print-secret-or-provider-error' };
    };
    const result = await runOfficialSourceAcceptance(argv, { catalog: officialFixtureCatalog, reader, now });
    assert.equal(reads, 1);
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.status, status);
    assert.equal(result.report.offerStatus, offerStatus);
    assert.equal(result.report.sourceId, 'example-board');
    assert.doesNotMatch(JSON.stringify(result), /do-not-print|fraud/);
  }
});

test('acceptance fails a malformed or mismatched post and redacts thrown reader failures', async () => {
  const malformed: OfficialReader = async source => ({ ...officialFixtureDocument(source), body: JSON.stringify({ id: 54321, title: 'Wrong post' }) });
  const mismatch = await runOfficialSourceAcceptance(argv, { catalog: officialFixtureCatalog, reader: malformed, now });
  assert.equal(mismatch.exitCode, 1);
  assert.equal(mismatch.report.status, 'ok');
  assert.equal(mismatch.report.offerStatus, 'unavailable');
  const broken: OfficialReader = async () => { throw new Error('secret-environment-private-input'); };
  const failure = await runOfficialSourceAcceptance(argv, { catalog: officialFixtureCatalog, reader: broken, now });
  assert.equal(failure.exitCode, 1);
  assert.equal(failure.report.status, 'unavailable');
  assert.equal(failure.report.fetchedAt, null);
  assert.doesNotMatch(JSON.stringify(failure), /secret-environment-private-input|Error|stack/);
});

test('CLI import stays inert and direct invalid invocation reports refusal without loading environment files', () => {
  const imported = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', "await import('./scripts/check-scamwin-official-sources.ts'); process.stdout.write('imported');"], { encoding: 'utf8', timeout: 20000 });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, 'imported');
  const invoked = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-scamwin-official-sources.ts', '--post', 'https://127.0.0.1/private'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(invoked.status, 1, invoked.stderr);
  assert.equal(invoked.stderr, '');
  assert.equal(JSON.parse(invoked.stdout).reasonCode, 'invalid_arguments');
  assert.doesNotMatch(invoked.stdout, /127\.0\.0\.1|private/);
});
