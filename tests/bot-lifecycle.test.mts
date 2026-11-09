import assert from 'node:assert/strict';
import {mock,test} from 'node:test';
import {createRequire} from 'node:module';
import { BotProvisioningError } from '../lib/bot-provisioning-error';
let provisionFailure: BotProvisioningError | undefined;
const require=createRequire(import.meta.url);let authenticated=true,failDb=false,failCleanup=false;const inserts:Record<string,unknown>[]=[];let provisioned=0,deleted=0;
mock.module(require.resolve('../lib/auth0'),{namedExports:{auth0:{getSession:async()=>authenticated?{user:{sub:'trusted-owner'}}:null}}});
mock.module(require.resolve('../lib/db'),{namedExports:{getDb:()=>({insert:()=>({values:(value:Record<string,unknown>)=>{inserts.push(value);return value}}),batch:async()=>{if(failDb)throw new Error('private-db-error')}})}});
mock.module(require.resolve('../lib/daytona'),{namedExports:{createBotSandbox:async()=>{provisioned++;if(provisionFailure)throw provisionFailure;return 'test-sandbox'},deleteBotSandbox:async()=>{deleted++;if(failCleanup)throw new Error('private-cleanup-error')}}});
mock.module(require.resolve('next/cache'),{namedExports:{revalidatePath:()=>{}}});
mock.module(require.resolve('next/navigation'),{namedExports:{redirect:()=>{throw new Error('redirect')},RedirectType:{replace:'replace'}}});
const {createBot}=await import('../app/dashboard/actions');
function form(){const data=new FormData();for(const[key,value]of Object.entries({name:'Atlas',job:'Developer',instructions:'Use tools',avatar:'a'.repeat(21),userId:'forged-owner'}))data.set(key,value);return data;}
test('create authenticates first and assigns owner, sandbox and membership in one batch',async()=>{
 authenticated=false;await assert.rejects(createBot(form()));assert.equal(provisioned,0);authenticated=true;
 assert.deepEqual(await createBot(form()),{success:true});assert.equal(inserts[0].userId,'trusted-owner');assert.equal(inserts[0].sandboxId,'test-sandbox');assert.equal(inserts.length,3);assert.equal(inserts[2].botId,inserts[0].id);
});
test('database rollback deletes its provisioned sandbox; cleanup failure stays sanitized and retryable',async()=>{
 failDb=true;const first=await createBot(form());assert.ok(first.error);assert.equal(deleted,1);
 failCleanup=true;const next=await createBot(form());assert.ok(next.error);assert.equal(deleted,2);assert.doesNotMatch(JSON.stringify(next),/private-/);
});
test('provisioning rejection identifies setup failures without exposing provider errors or writing a bot',async()=>{
 const beforeInserts=inserts.length,beforeDeletes=deleted;
 for(const stage of ['create','toolkit','memory'] as const){
  provisionFailure=new BotProvisioningError(stage);
  const result=await createBot(form());
  assert.match(result.error!,stage==='toolkit'?/install your bot’s tools/:/prepare your bot’s computer/);
  assert.equal(inserts.length,beforeInserts);assert.equal(deleted,beforeDeletes);
 }
 provisionFailure=undefined;failDb=false;failCleanup=false;
 assert.deepEqual(await createBot(form()),{success:true},'retry succeeds after setup recovers');
});
