import 'server-only';
import type { ExtensionService } from './extension-service';
import { extensionConfiguration } from './extension-runtime';
import { ConnectorStoreError } from './store';
let factory: (() => ExtensionService) | undefined;
export function registerExtensionService(value: () => ExtensionService) { factory = value; }
export function extensionService() { if (!extensionConfiguration().enabled || !factory)
    throw new ConnectorStoreError('provider_unavailable'); return factory(); }
