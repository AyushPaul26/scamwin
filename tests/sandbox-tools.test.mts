import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createRequire } from 'node:module';
import { tool } from 'ai';
import { z } from 'zod';
const require=createRequire(import.meta.url);
const calls:string[]=[];
let abortInFolder: AbortController | undefined; let uploads=0;
mock.module(require.resolve('../lib/daytona'),{namedExports:{MEMORY_FILE:'MEMORY.md',getBotSandbox:async(id:string)=>({
  process:{executeCommand:async(command:string,_cwd:string,_env:unknown,timeout:number)=>{calls.push(`${id}:${timeout}:${command}`);return{exitCode:7,result:'x'.repeat(21000)}}},
  fs:{downloadFile:async()=>Buffer.from('saved note'),createFolder:async()=>{abortInFolder?.abort()},uploadFile:async()=>{uploads++}},
})}});
const {createSandboxTools,sequentialTools}=await import('../lib/sandbox-tools');
test('shell uses current server-selected sandbox, timeout and bounded output; stop prevents another action',async()=>{
  let id='a'; const tools=createSandboxTools(async()=>id);
  const options={toolCallId:'call',messages:[],context:{},abortSignal:new AbortController().signal};
  const first=await tools.bash.execute!({command:'test',timeout:60},options);
  assert.ok('exitCode' in first);
  assert.equal(first.exitCode,7);assert.ok(first.output.length<20100);assert.match(calls.at(-1)!,/^a:60:/);
  id='b';await tools.bash.execute!({command:'test',timeout:600},options);assert.match(calls.at(-1)!,/^b:600:/);
  const count=calls.length;const stop=new AbortController();stop.abort();await assert.rejects(async()=>tools.bash.execute!({command:'never',timeout:60},{...options,abortSignal:stop.signal}));assert.equal(calls.length,count);
});
test('parallel model tool calls execute sequentially and aborted queued actions never run',async()=>{
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);const order:string[]=[];
  const tools=sequentialTools({action:tool({inputSchema:z.object({id:z.string()}),execute:async({id})=>{order.push(id);if(id==='first')await gate;return id;}})});
  const options={toolCallId:'x',messages:[],context:{}};const first=tools.action.execute!({id:'first'},options);
  const stop=new AbortController();const second=tools.action.execute!({id:'second'},{...options,abortSignal:stop.signal});
  await Promise.resolve();assert.deepEqual(order,['first']);stop.abort();release();await first;await assert.rejects(async()=>second);assert.deepEqual(order,['first']);
});
test('saved screenshot output converts back to model image data',async()=>{
  const tools=createSandboxTools(async()=>'a');
  const result=await tools.viewScreen.toModelOutput!({toolCallId:'x',input:{},output:{base64:'aGVsbG8=',mediaType:'image/jpeg',width:100,height:80}});
  assert.deepEqual(result,{type:'content',value:[{type:'text',text:'Desktop 100×80; coordinates start at top left.'},{type:'file',mediaType:'image/jpeg',data:{type:'data',data:'aGVsbG8='}}]});
});

test('stop during folder creation prevents the following file upload',async()=>{
 const tools=createSandboxTools(async()=>'a'); abortInFolder=new AbortController();const before=uploads;
 await assert.rejects(async()=>tools.writeFile.execute!({path:'folder/file.txt',content:'never upload'},{toolCallId:'x',messages:[],context:{},abortSignal:abortInFolder!.signal}));
 assert.equal(uploads,before);abortInFolder=undefined;
});
