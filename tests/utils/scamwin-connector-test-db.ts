import { PGlite } from '@electric-sql/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as model from '../../lib/db/scamwin-connector-schema';
import * as runtimeModel from '../../lib/db/scamwin-connector-runtime-schema';
import * as privacyModel from '../../lib/db/scamwin-connector-privacy-schema';
import { PostgresConnectorStore, type ConnectorSql, type ConnectorDatabase } from '../../lib/scamwin/connectors/store';

/** Build a fresh ephemeral Postgres database from the actual Drizzle model, without drizzle-kit push/migrations. */
export async function createConnectorTestStore(extraTables: PgTable[] = []) {
  const db = new PGlite();
  const dialect = new PgDialect();
  const tables: PgTable[] = [model.connectorConnections, model.connectorOAuthFlows, model.connectorItems, model.connectorRevisions, model.connectorDeliveries, model.connectorPendingItems, model.connectorJobs, model.connectorAlerts, model.connectorActivity, model.connectorQuotas, ...Object.values(runtimeModel), ...Object.values(privacyModel), ...extraTables];
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = config.columns.map(c => `${quote(c.name)} ${c.getSQLType()}${c.notNull ? ' NOT NULL' : ''}${c.primary ? ' PRIMARY KEY' : ''}${typeof c.default === 'number' ? ` DEFAULT ${c.default}` : ''}`);
    for (const check of config.checks) columns.push(`CONSTRAINT ${quote(check.name)} CHECK (${dialect.sqlToQuery(check.value).sql})`);
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      columns.push(`FOREIGN KEY (${ref.columns.map(c => quote(c.name)).join(',')}) REFERENCES ${quote(getTableName(ref.foreignTable))} (${ref.foreignColumns.map(c => quote(c.name)).join(',')}) ON DELETE ${fk.onDelete ?? 'no action'}`);
    }
    await db.exec(`CREATE TABLE ${quote(config.name)} (${columns.join(',')})`);
    for (const idx of config.indexes) {
      const fields = idx.config.columns.map(c => { if (!('name' in c) || !c.name) throw new Error('unsupported_test_index'); return quote(c.name); });
      await db.exec(`CREATE ${idx.config.unique ? 'UNIQUE ' : ''}INDEX ${quote(idx.config.name!)} ON ${quote(config.name)} (${fields.join(',')})`);
    }
  }
  const adapter: ConnectorDatabase = {
    query: async (text, params) => db.query(text, params),
    transaction: async fn => db.transaction(async tx => fn({ query: async (text, params) => tx.query(text, params) } as ConnectorSql)),
  };
  let now = Date.parse('2026-11-10T12:00:00.000Z');
  const keyring = { activeVersion: 'k1', keys: { k1: Buffer.alloc(32, 7), identifier: Buffer.alloc(32, 8) } };
  return { store: new PostgresConnectorStore(adapter, { keyring, now: () => new Date(now) }), database: adapter, keyring, advance: (ms: number) => { now += ms; },
    /** Serial suites can reuse one Wasm instance without retaining any rows or clock state. */
    reset: async () => { await db.exec(`TRUNCATE ${tables.map(t => quote(getTableName(t))).join(',')} CASCADE`); now = Date.parse('2026-11-10T12:00:00.000Z'); },
    close: () => db.close() };
}
