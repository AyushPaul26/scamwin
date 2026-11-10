import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {supplementalTables} from '../lib/scamwin/connectors/supplemental-data';
import * as notifications from '../lib/db/scamwin-notification-schema';
import {ConnectorPrivacyService} from '../lib/scamwin/connectors/privacy-service';
import {PrivateNotificationStore} from '../lib/scamwin/connectors/notification-store';
import {readOwnerGeneration} from '../lib/scamwin/connectors/privacy-fence';
test('owner erasure deletes source and push preferences, fences late source saves and preserves another owner',async()=>{
 const f=await createConnectorTestStore([...supplementalTables,...Object.values(notifications)]);try{
  const c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'a',scope:['inbox']});
  await f.store.saveGrant(c,{accessToken:'token',scopes:['https://www.googleapis.com/auth/gmail.readonly']});
  await f.store.createConnection('other',{provider:'gmail',providerAccountId:'b',scope:['inbox']});
  const item={providerItemId:'mail',revisionHash:'a'.repeat(64),receivedAt:'2026-11-10T12:00:00.000Z',text:'private body',urls:[],attachments:[]};
  const saved=await f.store.saveSelectedRevision(c,item);await new PrivateNotificationStore(f.database).setAllResults('owner',true);
  const generation=await readOwnerGeneration(f.database,'owner');
  const service=new ConnectorPrivacyService(f.database,f.keyring,{lookupCheckAdmission:async()=>{throw Error('no children');},requestCancel:async()=>null,deleteCheck:async()=>{throw Error('manual checks must not be touched');}});
  assert.deepEqual(await service.erase('owner'),{erased:true,cleanupPending:false});
  assert.equal((await f.store.listConnections('owner')).items.length,0);assert.equal((await f.store.listConnections('other')).items.length,1);
  assert.equal((await f.database.query('SELECT * FROM connector_revisions')).rows.length,0);assert.equal((await f.database.query('SELECT * FROM connector_notification_preferences')).rows.length,0);
  await assert.rejects(f.store.saveSelectedRevision(c,item),/connection_unavailable/);
  await assert.rejects(new PrivateNotificationStore(f.database).publish('owner',{connectionId:c.id,epoch:c.epoch,revisionId:saved.revision.id,itemId:saved.item.id,kind:'coverage',reason:'partial',counts:{discovered:1,checked:0,pending:1,unsupported:0},material:'a'.repeat(64)},generation),/owner_data_erased/);
  assert.equal((await f.database.query('SELECT * FROM connector_private_outcomes')).rows.length,0);
 }finally{await f.close();}
});
test('erasure retains unresolved admission intent and deletes a late connected child without touching manual checks',async()=>{
 const f=await createConnectorTestStore([...supplementalTables,...Object.values(notifications)]);try{
  const c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'a',scope:['inbox']});await f.store.saveGrant(c,{accessToken:'token',scopes:['https://www.googleapis.com/auth/gmail.readonly']});
  const saved=await f.store.saveSelectedRevision(c,{providerItemId:'mail',revisionHash:'a'.repeat(64),receivedAt:'2026-11-10T12:00:00.000Z',text:'hello',urls:[],attachments:[]});
  const job=await f.store.enqueueTarget(c,{revisionId:saved.revision.id,targetId:'body-0',generation:1,input:{message:'hello',url:null,images:[]}});
  await f.database.query("UPDATE connector_jobs SET admission_attempted_at=$1,admission_class='user_selected' WHERE id=$2",['2026-11-10T12:00:00Z',job.id]);
  let late=false;const removed:string[]=[];
  const service=new ConnectorPrivacyService(f.database,f.keyring,{lookupCheckAdmission:async(owner,key)=>{assert.equal(owner,'owner');assert.equal(key,job.admissionKey);return late?{status:'existing',checkId:'connected-child',state:'queued'}:{status:'pending'};},requestCancel:async()=>null,deleteCheck:async(_owner,id)=>{removed.push(id);return true;}});
  assert.equal((await service.erase('owner')).cleanupPending,true);assert.deepEqual(removed,[]);
  late=true;assert.equal((await service.cleanup('owner')).cleanupPending,false);assert.deepEqual(removed,['connected-child']);
 }finally{await f.close();}
});
