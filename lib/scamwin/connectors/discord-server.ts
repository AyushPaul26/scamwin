import 'server-only';
import type { DiscordSetupService } from './discord-setup';
import type { DiscordInteractionService } from './discord-interactions';
import { ConnectorStoreError } from './store';
export interface DiscordServices {
    setup: DiscordSetupService;
    interactions: DiscordInteractionService;
    publicKey: string;
    applicationId: string;
}
let factory: (() => DiscordServices) | undefined;
export function registerDiscordServices(value: () => DiscordServices) { factory = value; }
export function discordServices() { if (process.env.SCAMWIN_CONNECTORS_ENABLED !== 'true' || process.env.SCAMWIN_CONNECTOR_DISCORD_ENABLED !== 'true' || !factory)
    throw new ConnectorStoreError('provider_unavailable'); return factory(); }
