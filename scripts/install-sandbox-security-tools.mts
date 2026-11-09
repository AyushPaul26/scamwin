import { neon } from '@neondatabase/serverless';
import { getBotSandbox } from '../lib/daytona';
import { installSecurityToolkit } from '../lib/security-toolkit';
const rows = await neon(process.env.DATABASE_URL!)`SELECT DISTINCT sandbox_id FROM bots`;
for (const row of rows) {
  const sandbox = await getBotSandbox(row.sandbox_id);
  console.log('Installing security toolkit in owned project sandbox', sandbox.id);
  await installSecurityToolkit(sandbox);
  console.log((await sandbox.process.executeCommand('tail -12 /tmp/openmods-security-install.log')).result);
}
