import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {PostgresConnectorStore,ConnectorStoreError} from '../lib/scamwin/connectors/store';
import {ConnectorRuntimeStore} from '../lib/scamwin/connectors/runtime-store';
import {PrivateNotificationStore} from '../lib/scamwin/connectors/notification-store';
import {purgeSupplementalData,supplementalTables} from '../lib/scamwin/connectors/supplemental-data';
import * as notifications from '../lib/db/scamwin-notification-schema';
import {MemoryStore} from '../lib/scamwin/store';

const DAY=86400000,secret='synthetic-maintenance-secret';
type Environment=Record<string,string|undefined>;
const configured:Environment={CRON_SECRET:secret,DATABASE_URL:'postgresql://test@main.example/main',SCAMWIN_CONNECTOR_DATABASE_URL:'postgresql://test@connectors.example/scamwin_connectors',SCAMWIN_CONNECTORS_ENABLED:'false',SCAMWIN_CONNECTOR_RUNTIME_ENABLED:'false',SCAMWIN_CONNECTOR_AUTOMATION_ENABLED:'false'};
const request=(authorization=`Bearer ${secret}`)=>new Request('https://scamwin.example/api/scamwin/maintenance',{headers:{authorization}});
async function executeModule(path:string,dependencies:Record<string,unknown>,globals:Record<string,unknown>={}){
  const exports:Record<string,unknown>={};
  // The pre-fix route has no retention import. Keeping the absent module empty lets
  // its genuine gate-off failure reproduce against the real saved SQL content.
  const source=await readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>{if(!(name in dependencies))throw Error(`Unexpected dependency ${name}`);return dependencies[name];},Buffer,Response,Date,...globals});
  return exports;
}
async function fixture(environment:Environment=configured){
  const {assertConnectorDatabaseUrl}=await import('../scripts/check-scamwin-connector-database.mjs');
  const sql=await createConnectorTestStore([...supplementalTables,...Object.values(notifications)]);
  let clock=Date.parse('2026-11-10T12:00:00Z'),databaseCalls=0,mainCalls=0,mainFailure=false;
  const now=()=>new Date(clock);
  class PurgeOnlyMainStore extends MemoryStore{
    async purgeExpired(){mainCalls++;if(mainFailure)throw Error('Synthetic main outage');return super.purgeExpired();}
    async leaseOutbox():Promise<never>{throw Error('Maintenance must never dispatch work');}
  }
  const main=new PurgeOnlyMainStore({now});
  const factory=(connectorUrl:string,mainUrl:string)=>{databaseCalls++;assertConnectorDatabaseUrl(connectorUrl,mainUrl);return sql.database;};
  const retention=await executeModule('lib/scamwin/connectors/retention.ts',{
    './repository':{createConnectorDatabase:factory},'./store':{PostgresConnectorStore,ConnectorStoreError},'./runtime-store':{ConnectorRuntimeStore},'./notification-store':{PrivateNotificationStore},'./supplemental-data':{purgeSupplementalData},
  });
  const route=await executeModule('app/api/scamwin/maintenance/route.ts',{
    'node:crypto':{timingSafeEqual},'@/lib/scamwin/repository':{getScamwinStore:()=>main},
    '@/lib/scamwin/connectors/retention':{purgeConfiguredConnectorRetention:()=>((retention.purgeConfiguredConnectorRetention as (env:Environment,now:()=>Date)=>Promise<unknown>)(environment,now))},
  },{process:{env:environment}});
  return {...sql,main,now,GET:route.GET as (request:Request)=>Promise<Response>,advance:(ms:number)=>{clock+=ms;sql.advance(ms);},databaseCalls:()=>databaseCalls,mainCalls:()=>mainCalls,failMain:()=>{mainFailure=true;}};
}

test('authenticated daily maintenance expires connector content with all gates off and no encryption/provider credentials',async()=>{
  const f=await fixture();
  try{
    const c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'retention-fixture',scope:['inbox']});
    await f.store.saveGrant(c,{accessToken:'synthetic-only',scopes:['inbox']});
    const saved=await f.store.saveSelectedRevision(c,{providerItemId:'message',revisionHash:'a'.repeat(64),receivedAt:f.now().toISOString(),text:'Synthetic private message',urls:[],attachments:[]});
    await f.store.enqueueTarget(c,{revisionId:saved.revision.id,targetId:'body-0',generation:1,input:{message:'Synthetic private message',url:null,images:[]}});
    const runtime=new ConnectorRuntimeStore(f.database,f.keyring,f.now);
    await runtime.stageRevision(c,saved.revision.id);
    await runtime.consumeDelivery(crypto.randomUUID());
    await f.database.query('INSERT INTO connector_telegram_events(id,connection_id,owner_id,epoch,item_key,update_id,deleted,encrypted_value,content_expires_at,expires_at) VALUES($1,$2,$3,$4,$5,1,0,$6,$7,$8)',['retained-event',c.id,'owner',c.epoch,'opaque-item','synthetic-ciphertext',f.now().toISOString(),new Date(f.now().getTime()+90*DAY).toISOString()]);
    await f.database.query('INSERT INTO connector_slack_limits(id,due_at,expires_at) VALUES($1,$2,$2)',['expired-metadata',f.now().toISOString()]);
    const n=new PrivateNotificationStore(f.database,f.now);
    const alert=await n.publish('owner',{connectionId:c.id,epoch:c.epoch,revisionId:saved.revision.id,itemId:saved.item.id,kind:'coverage',reason:'partial',counts:{discovered:1,checked:0,pending:1,unsupported:0},material:'a'.repeat(64)});
    assert.ok(alert);
    await f.database.query('INSERT INTO connector_notification_projection(revision_id,owner_id,checked_at,expires_at) VALUES($1,$2,$3,$3)',['expired-projection','owner',f.now().toISOString()]);
    await f.database.query('INSERT INTO connector_push_subscriptions(id,owner_id,endpoint_key,epoch,generation,encrypted_subscription,created_at,expires_at) VALUES($1,$2,$3,1,1,$4,$5,$5)',['expired-device','owner','opaque-device','synthetic-ciphertext',f.now().toISOString()]);
    await f.database.query('INSERT INTO connector_owner_generations(owner_id,generation) VALUES($1,2) ON CONFLICT(owner_id) DO UPDATE SET generation=2',['owner']);
    for(const [id,created] of [['old-erasure','2026-08-01T12:00:00Z'],['fresh-erasure',f.now().toISOString()]])await f.database.query('INSERT INTO connector_erasure_checks(id,owner_id,admission_key,admission_deadline_at,created_at) VALUES($1,$2,$3,$4,$4)',[id,'owner',id,created]);
    const manual=await f.main.createCheck('owner',{url:'https://example.org',message:'Manual evidence',promisedBenefit:'',intendedAction:'',images:[]},'manual-only');
    for(const authorization of ['', 'Bearer wrong',`Bearer ${secret}x`])assert.equal((await f.GET(request(authorization))).status,401);
    assert.equal(f.databaseCalls(),0);assert.equal(f.mainCalls(),0);
    f.advance(31*DAY);
    const response=await f.GET(request());
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    const result=await response.json();assert.equal(result.checks,1);
    const revision=(await f.database.query('SELECT encrypted_content,manifest FROM connector_revisions WHERE id=$1',[saved.revision.id])).rows[0];
    assert.equal(revision.encrypted_content===null,true,'The independent maintenance path must physically erase expired connector bodies');
    assert.equal((await f.database.query('SELECT encrypted_input FROM connector_jobs')).rows[0].encrypted_input,null);
    assert.equal((await f.database.query('SELECT encrypted_value FROM connector_telegram_events')).rows[0].encrypted_value,null);
    assert.equal(Number((await f.database.query('SELECT count(*) AS n FROM connector_dispatches')).rows[0].n),0);
    assert.equal(Number((await f.database.query('SELECT count(*) AS n FROM connector_slack_limits')).rows[0].n),0);
    assert.equal(Number((await f.database.query('SELECT count(*) AS n FROM connector_notification_projection')).rows[0].n),0);
    assert.equal(Number((await f.database.query('SELECT count(*) AS n FROM connector_push_subscriptions')).rows[0].n),0);
    assert.deepEqual((await f.database.query('SELECT id FROM connector_erasure_checks ORDER BY id')).rows.map(r=>r.id),['fresh-erasure']);
    assert.equal(Number((await f.database.query('SELECT count(*) AS n FROM connector_private_outcomes')).rows[0].n),1,'Fresh 90-day alert metadata is preserved');
    assert.equal(await f.main.getCheck('owner',manual.id),null);
    assert.equal(f.databaseCalls(),1);
    assert.deepEqual(result.connectorRetention,{status:'purged'});
    f.advance(60*DAY);
    assert.equal((await f.GET(request())).status,200);
    for(const table of ['connector_revisions','connector_jobs','connector_items','connector_private_outcomes','connector_telegram_events','connector_erasure_checks'])assert.equal(Number((await f.database.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),0,table);
    assert.equal(Number((await f.database.query('SELECT generation FROM connector_owner_generations WHERE owner_id=$1',['owner'])).rows[0].generation),2,'Retention must preserve the erasure generation fence');
  }finally{await f.close();}
});

test('truly unconfigured connectors are a no-op and cannot prevent existing manual maintenance',async()=>{
  const f=await fixture({CRON_SECRET:secret});
  try{
    const c=await f.main.createCheck('owner',{message:'Manual evidence',url:'',promisedBenefit:'',intendedAction:'',images:[]},'unconfigured-manual');
    f.advance(31*DAY);
    const response=await f.GET(request());assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.checks,1);assert.deepEqual(result.connectorRetention,{status:'unconfigured'});
    assert.equal(f.databaseCalls(),0);assert.equal(await f.main.getCheck('owner',c.id),null);
  }finally{await f.close();}
});

test('connector target rejection does not prevent main cleanup or expose configured URLs',async()=>{
  const f=await fixture({...configured,SCAMWIN_CONNECTOR_DATABASE_URL:configured.DATABASE_URL});
  try{
    const response=await f.GET(request());assert.equal(response.status,503);assert.equal(f.mainCalls(),1);
    const body=await response.text();assert.equal(body.includes('postgresql'),false);
    assert.equal(body.includes('main.example'),false);
  }finally{await f.close();}
});

test('partially configured storage is reported unavailable instead of a successful unconfigured no-op',async()=>{
  const f=await fixture({CRON_SECRET:secret,SCAMWIN_CONNECTORS_ENABLED:'true',SCAMWIN_CONNECTOR_ENCRYPTION_KEY:'synthetic-missing-store-marker'});
  try{
    const response=await f.GET(request());assert.equal(response.status,503);assert.equal(f.mainCalls(),1);assert.equal(f.databaseCalls(),0);
    const body=await response.text();assert.equal(body.includes('synthetic-missing-store-marker'),false);
  }finally{await f.close();}
});

test('main maintenance outage does not prevent independent isolated connector cleanup',async()=>{
  const f=await fixture();
  try{
    const c=await f.store.createConnection('owner',{provider:'gmail',providerAccountId:'main-outage',scope:['inbox']});
    await f.store.saveGrant(c,{accessToken:'synthetic-only',scopes:['inbox']});
    const saved=await f.store.saveSelectedRevision(c,{providerItemId:'message',revisionHash:'b'.repeat(64),receivedAt:f.now().toISOString(),text:'Synthetic retained content',urls:[],attachments:[]});
    f.advance(31*DAY);f.failMain();
    assert.equal((await f.GET(request())).status,503);
    assert.equal((await f.database.query('SELECT encrypted_content FROM connector_revisions WHERE id=$1',[saved.revision.id])).rows[0].encrypted_content,null);
    assert.equal(f.databaseCalls(),1);
  }finally{await f.close();}
});
