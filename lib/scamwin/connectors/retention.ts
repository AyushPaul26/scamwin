import {PostgresConnectorStore,ConnectorStoreError,type ConnectorDatabase} from './store';
import {ConnectorRuntimeStore} from './runtime-store';
import {PrivateNotificationStore} from './notification-store';
import {purgeSupplementalData} from './supplemental-data';
import type {ConnectorKeyring} from './crypto';

// Existing purge methods only erase ciphertext and update coverage metadata.
// No keys are supplied: an accidental future crypto operation fails closed.
const retentionKeyring:ConnectorKeyring={activeVersion:'retention_only',keys:{}};

/** Physical retention is independent of provider/import/dispatch capability gates. */
export async function purgeConnectorRetention(database:ConnectorDatabase,now:()=>Date=()=>new Date()){
  const core=new PostgresConnectorStore(database,{keyring:retentionKeyring,now});
  const runtime=new ConnectorRuntimeStore(database,retentionKeyring,now);
  const notifications=new PrivateNotificationStore(database,now);
  let failed=false;
  // Attempt every independent dataset even if one cleanup is temporarily unavailable.
  for(const cleanup of [
    ()=>core.purgeExpired(),
    ()=>runtime.purgeExpired(),
    ()=>purgeSupplementalData(database,now()),
    ()=>notifications.purgeExpired(),
    ()=>database.query("DELETE FROM connector_erasure_checks WHERE created_at<=$1::timestamptz-interval '90 days'",[now().toISOString()]),
  ])try{await cleanup();}catch{failed=true;}
  if(failed)throw new ConnectorStoreError('connector_retention_unavailable');
  return {status:'purged' as const};
}

/** Never falls back to the main DB or loads provider/encryption configuration. */
export async function purgeConfiguredConnectorRetention(env:Record<string,string|undefined>=process.env,now:()=>Date=()=>new Date()){
  const connectorUrl=env.SCAMWIN_CONNECTOR_DATABASE_URL;
  if(!connectorUrl){
    if(env.SCAMWIN_CONNECTORS_ENABLED==='true'||env.SCAMWIN_CONNECTOR_RUNTIME_ENABLED==='true'||env.SCAMWIN_PRIVATE_PUSH_ENABLED==='true'||env.SCAMWIN_CONNECTOR_ENCRYPTION_KEY||env.SCAMWIN_CONNECTOR_IDENTIFIER_KEY)throw new ConnectorStoreError('connector_database_unavailable');
    return {status:'unconfigured' as const};
  }
  if(!env.DATABASE_URL)throw new ConnectorStoreError('connector_database_unavailable');
  // The guarded factory proves a separate project and current_database() before SQL.
  // Keep it lazy so a deployment with no connector store needs no connector setup.
  const {createConnectorDatabase}=await import('./repository');
  return purgeConnectorRetention(createConnectorDatabase(connectorUrl,env.DATABASE_URL),now);
}
