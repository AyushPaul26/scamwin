import test from 'node:test';
import assert from 'node:assert/strict';
import {MailboxResourceService} from '../lib/scamwin/connectors/mailbox-resources';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {ConnectorRuntimeStore} from '../lib/scamwin/connectors/runtime-store';
test('mailbox metadata picker returns labels and owner-bound handles, never raw provider IDs',async()=>{
 const f=await createConnectorTestStore();try{
  const c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'a',scope:['inbox']});
  const paths:string[]=[];const service=new MailboxResourceService({core:f.store,runtime:new ConnectorRuntimeStore(f.database,f.keyring),accessToken:async()=> 'token',fetch:async input=>{paths.push(String(input));return Response.json({labels:[{id:'Label_private123',name:'Orders'}]});}});
  const list=await service.list('owner',{id:c.id,epoch:c.epoch});assert.ok(!JSON.stringify(list).includes('Label_private123'));assert.ok(list.resources.some(r=>r.label==='Orders'));assert.ok(paths.every(p=>p.includes('/labels')));
  await assert.rejects(service.resolve('other',{id:c.id,epoch:c.epoch},[list.resources[2].handle]),/connection_unavailable/);
  assert.deepEqual(await service.resolve('owner',{id:c.id,epoch:c.epoch},[list.resources[2].handle]),['label:Label_private123']);
 }finally{await f.close();}
});
