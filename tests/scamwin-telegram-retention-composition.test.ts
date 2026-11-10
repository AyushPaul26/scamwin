import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {purgeSupplementalData,supplementalTables} from '../lib/scamwin/connectors/supplemental-data';

test('generic supplemental cleanup fences expired active Telegram authority without provider or encryption credentials',async()=>{
 const t=await createConnectorTestStore(supplementalTables);try{
  const initial=await t.store.createConnection('owner',{provider:'telegram',providerAccountId:'expired-link',scope:['identity']});
  const c=await t.store.configureConnection(initial,{mode:'all_new',scope:['identity'],rules:{},consent:true,paused:false,automaticDailyLimit:1});
  const now=new Date('2026-11-10T12:00:00Z');
  await t.database.query('INSERT INTO connector_telegram_links(connection_id,owner_id,epoch,user_key,encrypted_identity,started_at,start_completed,business_key,encrypted_business,last_update,disabled,expires_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,3,0,$6)',[c.id,c.ownerId,c.epoch,'opaque-user','unreadable-expired-identity',now.toISOString(),'opaque-business','unreadable-expired-business']);
  const selected=await t.store.saveRevision(c,{providerItemId:'source',revisionHash:'a'.repeat(64),receivedAt:now.toISOString(),text:'Queued evidence',urls:[],attachments:[]});
  const job=await t.store.enqueueTarget(c,{revisionId:selected.revision.id,targetId:'body-0',generation:1,input:{message:'Queued evidence',url:null,images:[]}});
  // Preserve the public ConnectorSql composition contract: no keyring, provider factory or transaction helper.
  await purgeSupplementalData({query:t.database.query.bind(t.database)},now);
  await purgeSupplementalData({query:t.database.query.bind(t.database)},now);
  const current=await t.store.getConnection(c.ownerId,c.id);
  assert.equal(current?.status,'disconnected');assert.equal(current?.epoch,c.epoch+1);
  assert.equal((await t.database.query('SELECT state FROM connector_jobs WHERE id=$1',[job.id])).rows[0].state,'canceled');
  assert.equal((await t.database.query("SELECT id FROM connector_activity WHERE connection_id=$1 AND reason='telegram_link_expired_relink_required'",[c.id])).rows.length,1);
  assert.equal((await t.database.query('SELECT connection_id FROM connector_telegram_links')).rows.length,0);
 }finally{await t.close();}
});

test('bounded generic Telegram expiry preserves every unfenced link for the next maintenance pass',async()=>{
 const t=await createConnectorTestStore(supplementalTables);try{
  const now=new Date('2026-11-10T12:00:00Z');
  await t.database.query("INSERT INTO connector_connections(id,owner_id,provider,account_key,epoch,mode,status,scope,scope_version,rules,automatic_daily_limit,activation_at,created_at,updated_at) SELECT 'expired-'||n,'owner','telegram','account-'||n,1,'all_new','active','[\"identity\"]'::jsonb,1,'{}'::jsonb,1,$1,$1,$1 FROM generate_series(1,101) n",[now.toISOString()]);
  await t.database.query("INSERT INTO connector_telegram_links(connection_id,owner_id,epoch,user_key,encrypted_identity,started_at,start_completed,business_key,encrypted_business,last_update,disabled,expires_at) SELECT id,owner_id,epoch,'user-'||id,'unreadable-identity',$1,1,'business-'||id,'unreadable-business',3,0,$1 FROM connector_connections",[now.toISOString()]);
  const sql={query:t.database.query.bind(t.database)};
  await purgeSupplementalData(sql,now);
  assert.equal(Number((await t.database.query("SELECT count(*) AS n FROM connector_connections WHERE status='active'")).rows[0].n),1);
  assert.equal((await t.database.query('SELECT connection_id FROM connector_telegram_links')).rows.length,1);
  assert.equal(Number((await t.database.query("SELECT count(*) AS n FROM connector_activity WHERE reason='telegram_link_expired_relink_required'")).rows[0].n),100);
  await purgeSupplementalData(sql,now);
  assert.equal(Number((await t.database.query("SELECT count(*) AS n FROM connector_connections WHERE status='active'")).rows[0].n),0);
  assert.equal((await t.database.query('SELECT connection_id FROM connector_telegram_links')).rows.length,0);
  assert.equal(Number((await t.database.query("SELECT count(*) AS n FROM connector_activity WHERE reason='telegram_link_expired_relink_required'")).rows[0].n),101);
 }finally{await t.close();}
});
