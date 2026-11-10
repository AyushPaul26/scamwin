import { ExtensionService } from './extension-service';
import { EXTENSION_APP_ORIGIN } from './extension-ui';
import type { ConnectorDatabase } from './store';
import type { ConnectorKeyring } from './crypto';
import { ExtensionAdapter } from './providers/extension';
export function extensionConfiguration(env: Record<string, string | undefined> = process.env) { return { enabled: env.SCAMWIN_CONNECTORS_ENABLED === 'true' && env.SCAMWIN_CONNECTOR_EXTENSION_ENABLED === 'true', automaticEnabled: env.SCAMWIN_CONNECTORS_ENABLED === 'true' && env.SCAMWIN_CONNECTOR_EXTENSION_ENABLED === 'true' && env.SCAMWIN_CONNECTOR_AUTOMATION_ENABLED === 'true', appOrigin: EXTENSION_APP_ORIGIN }; }
export function createExtensionIntegration(deps: {
    database: ConnectorDatabase;
    keyring: ConnectorKeyring;
    now?: () => Date;
    environment?: Record<string, string | undefined>;
}) { const configuration = extensionConfiguration(deps.environment); if (!configuration.enabled)
    throw new Error('provider_unavailable'); const service = new ExtensionService({ ...deps, ...configuration }); return { configuration, service, adapter: new ExtensionAdapter() }; }
