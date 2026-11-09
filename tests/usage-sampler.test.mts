import assert from 'node:assert/strict';
import { mock,test } from 'node:test';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);let fail=false;const saved=new Map<string,unknown>();let writes=0;
mock.module(require.resolve('@trigger.dev/sdk'),{namedExports:{schedules:{task:(definition:unknown)=>definition}}});
mock.module(require.resolve('../lib/runtime-db'),{namedExports:{runtimeDb:()=>({select:()=>({from:async()=>[{id:'bot',sandboxId:'owned',userId:'owner'}]}),insert:()=>({values:(rows:{idempotencyKey:string}[])=>({onConflictDoNothing:async()=>{writes++;for(const row of rows)saved.set(row.idempotencyKey,row)}})})})}});
mock.module(require.resolve('../lib/daytona'),{namedExports:{getDaytona:()=>({list:async function*(){yield{id:'owned',labels:{project:'openmods',environment:'development',botId:'bot'}};if(fail)throw new Error('poll failed');yield{id:'foreign',labels:{project:'openmods',environment:'development',botId:'bot'}};yield{id:'owned',labels:{project:'openmods',environment:'production',botId:'bot'}};}})}});
process.env.OPENMODS_ENV='development';
const {sampleSandboxUsage}=await import('../src/trigger/usage');
const run=(sampleSandboxUsage as unknown as {run:(payload:{timestamp:Date})=>Promise<{observed:number}>}).run;
test('samples only owned environment labels and deduplicates the interval',async()=>{
 const timestamp=new Date('2026-11-01T00:01:00Z');assert.deepEqual(await run({timestamp}),{observed:1});await run({timestamp});assert.equal(saved.size,1);assert.match([...saved.keys()][0],/^sandbox:development:owned:/);
});
test('failed poll writes no partial observations and never wakes a machine',async()=>{fail=true;const before=writes;await assert.rejects(run({timestamp:new Date()}));assert.equal(writes,before);});
