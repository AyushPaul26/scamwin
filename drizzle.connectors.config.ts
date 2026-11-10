import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { execFileSync } from 'node:child_process';
import { assertConnectorDatabaseUrl } from './scripts/check-scamwin-connector-database.mjs';

config({ path: '.env.local', quiet: true });
const url = assertConnectorDatabaseUrl(process.env.SCAMWIN_CONNECTOR_DATABASE_URL, process.env.DATABASE_URL);
// drizzle-kit loads configuration before DDL. This child only runs SELECT current_database().
try { execFileSync(process.execPath, ['scripts/check-scamwin-connector-database.mjs'], { env: process.env, stdio: 'pipe' }); }
catch { throw new Error('connector_database_target: target verification failed; connector DDL refused'); }
export default defineConfig({ dialect: 'postgresql', schema: ['./lib/db/scamwin-connector-privacy-schema.ts', './lib/db/scamwin-connector-runtime-schema.ts', './lib/db/scamwin-connector-schema.ts', './lib/db/scamwin-discord-schema.ts', './lib/db/scamwin-drive-schema.ts', './lib/db/scamwin-extension-schema.ts', './lib/db/scamwin-notification-schema.ts', './lib/db/scamwin-slack-schema.ts', './lib/db/scamwin-teams-schema.ts', './lib/db/scamwin-telegram-schema.ts'], dbCredentials: { url } });
