import { z } from 'zod';
import type { ConnectorStore } from './contracts';
import type { DiscordStore } from './discord-store';
import { ConnectorStoreError } from './store';
import { discordSelectionSchema, discordInstallationUrl } from './discord-ui';
const selection = discordSelectionSchema.extend({ id: z.string().uuid(), epoch: z.number().int().positive() });
export class DiscordSetupService {
    constructor(private readonly deps: {
        core: ConnectorStore;
        store: DiscordStore;
        applicationId: string;
        enabled: boolean;
    }) { }
    async select(owner: string, input: unknown) { if (!this.deps.enabled)
        throw new ConnectorStoreError('provider_unavailable'); const v = selection.parse(input), c = await this.deps.core.getConnection(owner, v.id); if (!c || c.epoch !== v.epoch || c.provider !== 'discord' || c.status !== 'active')
        throw new ConnectorStoreError('connection_unavailable'); await this.deps.store.identity(c, this.deps.applicationId); const saved = await this.deps.core.configureConnection(c, { mode: 'manual', scope: [...new Set(v.contexts)].map(s => `discord:${s}`), rules: {}, consent: true, paused: false, automaticDailyLimit: c.automaticDailyLimit }); await this.deps.store.bind(saved, this.deps.applicationId); return { id: saved.id, epoch: saved.epoch, mode: 'manual' as const, installationUrl: discordInstallationUrl(this.deps.applicationId)! }; }
}
