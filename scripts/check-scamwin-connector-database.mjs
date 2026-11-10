import { pathToFileURL } from 'node:url';

/** No SQL (and especially no DDL) is allowed before this URL comparison succeeds. */
export function assertConnectorDatabaseUrl(connectorUrl, mainUrl) {
  try {
    if (!connectorUrl || !mainUrl) throw new Error();
    const connector = new URL(connectorUrl), main = new URL(mainUrl);
    const host = u => u.hostname.toLowerCase().replace(/-pooler(?=\.)/, '');
    if (!['postgres:', 'postgresql:'].includes(connector.protocol) || !['postgres:', 'postgresql:'].includes(main.protocol)
      || decodeURIComponent(connector.pathname) !== '/scamwin_connectors' || host(connector) === host(main)
      || !connector.hostname || connector.hash) throw new Error();
    return connectorUrl;
  } catch { throw new Error('connector_database_target: use a separate connector project and scamwin_connectors database'); }
}
export async function checkConnectorDatabase({ connectorUrl, mainUrl, query }) {
  assertConnectorDatabaseUrl(connectorUrl, mainUrl);
  const rows = await query('select current_database() as database');
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].database !== 'scamwin_connectors') throw new Error('connector_database_target: current_database mismatch');
  return { database: 'scamwin_connectors', isolated: true };
}
async function runTargetCheck() {
  try {
    assertConnectorDatabaseUrl(process.env.SCAMWIN_CONNECTOR_DATABASE_URL, process.env.DATABASE_URL);
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.SCAMWIN_CONNECTOR_DATABASE_URL);
    const result = await checkConnectorDatabase({ connectorUrl: process.env.SCAMWIN_CONNECTOR_DATABASE_URL, mainUrl: process.env.DATABASE_URL, query: text => sql.query(text) });
    console.log(`Connector target accepted: ${result.database} (isolated target). No DDL applied.`);
  } catch {
    console.error('Connector database target check failed. No DDL applied.'); process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void runTargetCheck();
