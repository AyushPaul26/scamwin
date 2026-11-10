import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
const backend = process.env.SCAMWIN_INVESTIGATION_BACKEND === 'vercel' ? 'vercel' : process.env.SCAMWIN_INVESTIGATION_BACKEND === 'trigger' ? 'trigger' : null;
console.log(`investigation backend: ${backend ?? 'missing'}`);
const groups = {
  web: ['APP_BASE_URL','AUTH0_DOMAIN','AUTH0_CLIENT_ID','AUTH0_CLIENT_SECRET','AUTH0_SECRET','DATABASE_URL'],
  ai: ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN'],
  investigation: backend === 'trigger' ? ['TRIGGER_SECRET_KEY','TRIGGER_PROJECT_REF','DATABASE_URL','BROWSERLESS_TOKEN','SCAMWIN_INDICATOR_HMAC_SECRET'] : ['DATABASE_URL','BROWSERLESS_TOKEN','SCAMWIN_INDICATOR_HMAC_SECRET'],
  browserContainment: ['SCAMWIN_APPROVED_ORIGINS','SCAMWIN_BROWSER_CAPABILITY_VERIFIED'],
  ...(process.env.SCAMWIN_LIVE_VIEW_ENABLED === 'true' ? { liveView: ['SCAMWIN_LIVE_VIEW_ENCRYPTION_KEY'] } : {}),
  maintenance: ['CRON_SECRET'],
  registry: ['SCAMWIN_REGISTRY_ADDRESS','SCAMWIN_REGISTRY_PUBLISHER'],
  publisherWorkerOnly: ['SCAMWIN_PUBLISHER_PRIVATE_KEY'],
};
for (const [group, keys] of Object.entries(groups)) console.log(`${group}: ${keys.map(key => `${key}=${process.env[key] ? 'present' : 'missing'}`).join(', ')}`);
console.log(`official sources: ${process.env.SCAMWIN_OFFICIAL_VERIFICATION_ENABLED === 'true' ? 'enabled' : 'disabled'}; reviewed catalogue only, no provider key required`);
console.log('Presence only; no credentials, service connections, purchases or deployments are tested.');
if (Object.keys(process.env).some(key => key.startsWith('NEXT_PUBLIC_') && /SECRET|TOKEN|PRIVATE_KEY|DATABASE_URL/.test(key))) { console.error('A sensitive-looking public variable name is configured. Remove its NEXT_PUBLIC_ prefix.'); process.exitCode = 1; }
