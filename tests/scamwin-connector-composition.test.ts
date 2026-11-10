import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {ConnectorRuntimeStore} from '../lib/scamwin/connectors/runtime-store';
import {ConnectorProviderRegistry} from '../lib/scamwin/connectors/registry';
import {createExpandedAuthorization,registerIntegratedProviders} from '../lib/scamwin/connectors/integration';

test('default-off composition installs no extra provider and configured Discord remains manual-only',async()=>{
 const f=await createConnectorTestStore();try{
  const context={connectorStore:f.store,database:f.database,keyring:f.keyring,runtime:new ConnectorRuntimeStore(f.database,f.keyring),meteredFetch:fetch};
  const registry=new ConnectorProviderRegistry();registerIntegratedProviders(context,registry,{});assert.deepEqual(registry.ids(),[]);
  const env={APP_BASE_URL:'https://scamwin.example',SCAMWIN_CONNECTORS_ENABLED:'true',SCAMWIN_CONNECTOR_DISCORD_ENABLED:'true',SCAMWIN_DISCORD_CLIENT_ID:'123456789012345678',SCAMWIN_DISCORD_CLIENT_SECRET:'secret',SCAMWIN_DISCORD_PUBLIC_KEY:'a'.repeat(64)};
  registerIntegratedProviders(context,registry,env);assert.deepEqual(registry.ids(),['discord']);assert.equal(registry.get('discord').capabilities.pull,false);
  assert.ok(createExpandedAuthorization(context,env).service);
 }finally{await f.close();}
});
