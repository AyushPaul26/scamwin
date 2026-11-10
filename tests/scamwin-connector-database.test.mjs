import assert from 'node:assert/strict';
import test from 'node:test';
import { assertConnectorDatabaseUrl, checkConnectorDatabase } from '../scripts/check-scamwin-connector-database.mjs';

test('copied main URL and same target through another password/pooled host fail before SQL', async () => {
  const main = 'postgresql://user:secret@ep-main.neon.tech/neondb';
  assert.throws(() => assertConnectorDatabaseUrl(main, main), /connector_database_target/);
  assert.throws(() => assertConnectorDatabaseUrl('postgresql://other:different@ep-main-pooler.neon.tech/neondb', main), /connector_database_target/);
  let queries = 0;
  await assert.rejects(checkConnectorDatabase({ connectorUrl: main, mainUrl: main, query: async () => { queries++; return []; } }), /connector_database_target/);
  assert.equal(queries, 0);
});
test('current_database mismatch rejects target before caller can run DDL', async () => {
  let ddl = false;
  await assert.rejects((async () => {
    await checkConnectorDatabase({ connectorUrl: 'postgresql://u:p@ep-connect.neon.tech/scamwin_connectors', mainUrl: 'postgresql://u:p@ep-main.neon.tech/neondb', query: async () => [{ database: 'neondb' }] });
    ddl = true;
  })(), /connector_database_target/);
  assert.equal(ddl, false);
});
test('isolated connector database is accepted with no credential disclosure', async () => {
  const result = await checkConnectorDatabase({ connectorUrl: 'postgresql://u:p@ep-connect.neon.tech/scamwin_connectors', mainUrl: 'postgresql://u:p@ep-main.neon.tech/neondb', query: async () => [{ database: 'scamwin_connectors' }] });
  assert.deepEqual(result, { database: 'scamwin_connectors', isolated: true });
});
