import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryStore} from '../lib/scamwin/store';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {ConnectorActivityService} from '../lib/scamwin/connectors/activity-service';
test('manual activity reads real owned main history without copying content or connector admissions',async()=>{
 let now=Date.parse('2026-11-01T12:00:00Z');const f=await createConnectorTestStore(),main=new MemoryStore({now:()=>new Date(now)});
 try{for(let i=0;i<21;i++){const check=await main.createCheck('alice',{url:'',message:'private historical reference',images:[],promisedBenefit:'',intendedAction:''},`manual-${i}`);await main.updateRun(check.id,check.generation,check.revision,{state:'failed'});now+=86400000;}
 const service=new ConnectorActivityService(f.database,f.store,main);const first=await service.list('alice',{filter:'manual'});assert.equal(first.items.length,20);assert.ok(first.nextCursor);const last=await service.list('alice',{filter:'manual',before:first.nextCursor});assert.equal(last.items.length,1);
 assert.ok(first.items.every(a=>a.checkHref?.startsWith('/checks/')));assert.ok(!JSON.stringify(first).includes('private historical reference'));assert.equal((await service.list('mallory',{filter:'manual'})).items.length,0);
 }finally{await f.close();}
});
