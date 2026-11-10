import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {readOwnerGeneration,assertOwnerGeneration,advanceOwnerGeneration} from '../lib/scamwin/connectors/privacy-fence';

test('an already claimed operation cannot attach after owner erasure; a fresh operation can',async()=>{
 const db=await createConnectorTestStore();
 try {
  const generation=await readOwnerGeneration(db.database,'owner');
  await db.database.transaction(sql=>advanceOwnerGeneration(sql,'owner'));
  await assert.rejects(db.database.transaction(sql=>assertOwnerGeneration(sql,'owner',generation)),/owner_data_erased/);
  const fresh=await readOwnerGeneration(db.database,'owner');
  assert.equal(fresh,generation+1);
  await db.database.transaction(sql=>assertOwnerGeneration(sql,'owner',fresh));
  assert.equal(await readOwnerGeneration(db.database,'other'),0);
 }finally{await db.close();}
});

 test('expanded callback claimed before erasure cannot attach a provider grant',async()=>{
 const {ExpandedAuthorizationService,PostgresExpandedAuthorizationPersistence}=await import('../lib/scamwin/connectors/expanded-auth');
 const f=await createConnectorTestStore();try{
 const service=new ExpandedAuthorizationService(f.store,new PostgresExpandedAuthorizationPersistence(f.database,{keyring:f.keyring}),{origin:'https://scamwin.example',enabled:true,drivers:[{provider:'discord',authorizationUrl:v=>`https://discord.com/oauth2/authorize?state=${v.state}`,exchange:async()=>{await f.database.transaction(sql=>advanceOwnerGeneration(sql,'owner'));return {identity:{accountId:'discord-user',label:'Discord',metadata:{}},grant:{accessToken:'token',scopes:['identify','applications.commands']}};},refresh:async v=>v}]});
 const start=await service.begin('owner',{provider:'discord'}),state=new URL(start.authorizationUrl).searchParams.get('state')!;
 await assert.rejects(service.complete('owner','discord',new URLSearchParams({state,code:'code'}),start.browserBindingSecret),/owner_data_erased/);
 assert.equal((await f.store.listConnections('owner')).items.length,0);
 }finally{await f.close();}
 });
