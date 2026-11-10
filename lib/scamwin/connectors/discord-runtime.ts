import type { ConnectorStore } from './contracts';
import type { ConnectorDatabase } from './store';
import type { ConnectorKeyring } from './crypto';
import type { PostgresExpandedAuthorizationPersistence } from './expanded-auth';
import { DiscordAuthorizationDriver } from './discord-protocol';
import { DiscordStore } from './discord-store';
import { DiscordSetupService } from './discord-setup';
import { DiscordInteractionService } from './discord-interactions';
import { DiscordAdapter } from './providers/discord';
export function discordConfiguration(env: Record<string, string | undefined> = process.env) { const clientId = env.SCAMWIN_DISCORD_CLIENT_ID, clientSecret = env.SCAMWIN_DISCORD_CLIENT_SECRET, publicKey = env.SCAMWIN_DISCORD_PUBLIC_KEY; return { enabled: env.SCAMWIN_CONNECTORS_ENABLED === 'true' && env.SCAMWIN_CONNECTOR_DISCORD_ENABLED === 'true' && !!clientId && /^[1-9][0-9]{16,19}$/.test(clientId) && !!clientSecret && !!publicKey && /^[a-fA-F0-9]{64}$/.test(publicKey), automaticEnabled: false as const, clientId, clientSecret, publicKey }; }
export function discordAuthorizationDriver(environment: Record<string, string | undefined> = process.env, transport: typeof fetch = fetch) { const c = discordConfiguration(environment); return c.enabled ? new DiscordAuthorizationDriver({ clientId: c.clientId!, clientSecret: c.clientSecret!, fetch: transport }) : null; }
/** Root13 supplies the guarded isolated DB and registers the provider and HTTP services. */
export function createDiscordIntegration(deps: {
    core: ConnectorStore;
    database: ConnectorDatabase;
    keyring: ConnectorKeyring;
    persistence: PostgresExpandedAuthorizationPersistence;
    fetch?: typeof fetch;
    environment?: Record<string, string | undefined>;
    now?: () => Date;
}) { const configuration = discordConfiguration(deps.environment); if (!configuration.enabled)
    throw new Error('provider_unavailable'); const store = new DiscordStore(deps.database, deps.keyring, deps.core, deps.persistence, deps.now), driver = new DiscordAuthorizationDriver({ clientId: configuration.clientId!, clientSecret: configuration.clientSecret!, fetch: deps.fetch, now: deps.now }); return { configuration, store, adapter: new DiscordAdapter({ store, core: deps.core, driver, fetch: deps.fetch, now: deps.now }), setup: new DiscordSetupService({ core: deps.core, store, applicationId: configuration.clientId!, enabled: true }), interactions: new DiscordInteractionService({ store, applicationId: configuration.clientId!, enabled: true, now: deps.now }), applicationId: configuration.clientId!, publicKey: configuration.publicKey! }; }
