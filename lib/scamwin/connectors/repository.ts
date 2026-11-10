import { Pool } from '@neondatabase/serverless';
import { assertConnectorDatabaseUrl, checkConnectorDatabase } from '../../../scripts/check-scamwin-connector-database.mjs';
import { PostgresConnectorStore, ConnectorStoreError, type ConnectorDatabase, type ConnectorSql } from './store';
import type { ConnectorStore } from './contracts';
import type { ConnectorKeyring } from './crypto';

export function connectorKeyringFromEnvironment(env: Record<string, string | undefined> = process.env): ConnectorKeyring {
  const version = env.SCAMWIN_CONNECTOR_ENCRYPTION_KEY_VERSION ?? 'k1';
  const key = env.SCAMWIN_CONNECTOR_ENCRYPTION_KEY, identifier = env.SCAMWIN_CONNECTOR_IDENTIFIER_KEY;
  if (version === 'identifier' || !/^[a-zA-Z0-9_-]{1,40}$/.test(version) || !key || !/^[a-fA-F0-9]{64}$/.test(key) || !identifier || !/^[a-fA-F0-9]{64}$/.test(identifier)) throw new ConnectorStoreError('connector_key_unavailable');
  const keys: Record<string, Buffer> = { [version]: Buffer.from(key, 'hex'), identifier: Buffer.from(identifier, 'hex') };
  // Optional explicitly versioned old keys permit envelope rotation without losing access.
  if (env.SCAMWIN_CONNECTOR_PREVIOUS_ENCRYPTION_KEYS) {
    let previous: unknown; try { previous = JSON.parse(env.SCAMWIN_CONNECTOR_PREVIOUS_ENCRYPTION_KEYS); } catch { throw new ConnectorStoreError('connector_key_unavailable'); }
    if (!previous || typeof previous !== 'object' || Array.isArray(previous) || Object.keys(previous).length > 5) throw new ConnectorStoreError('connector_key_unavailable');
    for (const [name, value] of Object.entries(previous)) {
      if (name === 'identifier' || name === version || !/^[a-zA-Z0-9_-]{1,40}$/.test(name) || typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) throw new ConnectorStoreError('connector_key_unavailable');
      keys[name] = Buffer.from(value, 'hex');
    }
  }
  return { activeVersion: version, keys };
}
/** Pool transactions are real Postgres transactions. Target verification always precedes application SQL. */
export function createConnectorDatabase(connectorUrl: string, mainUrl: string): ConnectorDatabase {
  assertConnectorDatabaseUrl(connectorUrl, mainUrl);
  const pool = new Pool({ connectionString: connectorUrl });
  let verified: Promise<unknown> | null = null;
  const ready = () => verified ??= checkConnectorDatabase({ connectorUrl, mainUrl, query: async (text: string) => (await pool.query(text)).rows });
  return {
    async query(text, params) { await ready(); return pool.query(text, params); },
    async transaction<T>(fn: (sql: ConnectorSql) => Promise<T>) {
      await ready(); const client = await pool.connect();
      try { await client.query('BEGIN'); const value = await fn({ query: (text, params) => client.query(text, params) }); await client.query('COMMIT'); return value; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
let injected: ConnectorStore | null = null, production: ConnectorStore | null = null;
let productionDatabase: ConnectorDatabase | null = null;
/** Shared isolated database factory for supplemental provider/runtime stores. Never falls back to main. */
export function getConnectorDatabase(): ConnectorDatabase {
  if (productionDatabase) return productionDatabase;
  const url = process.env.SCAMWIN_CONNECTOR_DATABASE_URL, main = process.env.DATABASE_URL;
  if (!url || !main) throw new ConnectorStoreError('connector_database_unavailable');
  productionDatabase = createConnectorDatabase(url, main);
  return productionDatabase;
}
export function setConnectorStoreForTests(store: ConnectorStore | null) {
  if (process.env.NODE_ENV === 'production') throw new ConnectorStoreError('test_injection_disabled');
  injected = store;
}
export function getConnectorStore(): ConnectorStore {
  if (injected) return injected;
  if (production) return production;
  const url = process.env.SCAMWIN_CONNECTOR_DATABASE_URL, main = process.env.DATABASE_URL;
  if (!url || !main) throw new ConnectorStoreError('connector_database_unavailable');
  const keyring = connectorKeyringFromEnvironment();
  production = new PostgresConnectorStore(getConnectorDatabase(), { keyring });
  return production;
}
