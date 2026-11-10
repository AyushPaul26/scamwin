import type { ProviderAdapter, ProviderItem, ProviderPage } from '../contracts';
import { ConnectorStoreError } from '../store';
/** Ingested snapshots use ordinary Core preparations. No browser history or mailbox API exists. */
export class ExtensionAdapter implements ProviderAdapter {
    readonly capabilities = { pull: false, history: false, selectedItem: true, push: true, edits: true, attachments: false };
    async pullChanges(): Promise<ProviderPage> { throw new ConnectorStoreError('visible_browser_required'); }
    async readItem(): Promise<ProviderItem> { throw new ConnectorStoreError('extension_snapshot_required'); }
    async revoke() { return { status: 'revoked' as const }; } // Core's epoch fence revokes every hashed extension grant.
    async activationHook() { return { cursor: 'visible-pages-only', capturedAt: new Date().toISOString() }; }
}
