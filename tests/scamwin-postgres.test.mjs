// Integration test adapter only: no production fallback, socket, or real database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import test from 'node:test';
const require = createRequire(new URL('../package.json', import.meta.url));
const {neonConfig} = require('@neondatabase/serverless');
const {getTableConfig, PgDialect} = require('drizzle-orm/pg-core');
const schemaModule = await import(new URL('../lib/db/scamwin-schema.ts', import.meta.url).href);
const storeModule = await import(new URL('../lib/scamwin/store.ts', import.meta.url).href);
const schema = schemaModule.default ?? schemaModule, {PostgresStore} = storeModule.default ?? storeModule;
test('PostgresStore executes the real schema and SQL without a network database', async t => {
  const oldFetch = neonConfig.fetchFunction;
  let externalRequests = 0;
  neonConfig.fetchFunction = async () => { externalRequests++; throw Error('Unexpected external SQL request'); };
  const db = new PGlite();
  try {
    const dialect = new PgDialect(), configs = Object.values(schema).map(getTableConfig);
    const quote = name => '"' + name.replaceAll('"', '""') + '"';
    for (const table of configs) {
      const columns = table.columns.map(c => {
        let def = '';
        if (c.default !== undefined) def = ' DEFAULT ' + (typeof c.default === 'string' ? "'" + c.default.replaceAll("'", "''") + "'" : typeof c.default === 'object' ? dialect.sqlToQuery(c.default).sql : String(c.default));
        return `${quote(c.name)} ${c.getSQLType()}${c.notNull ? ' NOT NULL' : ''}${c.primary ? ' PRIMARY KEY' : ''}${def}`;
      });
      await db.exec(`CREATE TABLE ${quote(table.name)} (${columns.join(',')})`);
    }
    for (const table of configs) {
      for (const key of table.foreignKeys) {
        const r = key.reference();
        await db.exec(`ALTER TABLE ${quote(table.name)} ADD CONSTRAINT ${quote(key.getName())} FOREIGN KEY (${r.columns.map(c => quote(c.name))}) REFERENCES ${quote(getTableConfig(r.foreignTable).name)} (${r.foreignColumns.map(c => quote(c.name))})${key.onDelete ? ' ON DELETE ' + key.onDelete : ''}`);
      }
      for (const index of table.indexes) {
        const c = index.config;
        await db.exec(`CREATE ${c.unique ? 'UNIQUE ' : ''}INDEX ${quote(c.name)} ON ${quote(table.name)} (${c.columns.map(c => quote(c.name))})${c.where ? ' WHERE ' + dialect.sqlToQuery(c.where).sql : ''}`);
      }
      for (const constraint of table.checks) {
        await db.exec(`ALTER TABLE ${quote(table.name)} ADD CONSTRAINT ${quote(constraint.name)} CHECK (${dialect.sqlToQuery(constraint.value).sql})`);
      }
    }
    let queryCount = 0;
    async function execute(descriptor, tx = db) {
      queryCount++;
      try { return (await tx.query(descriptor.text, descriptor.values)).rows; }
      catch (error) { console.log('SQL ERROR', error.code, error.message); throw error; }
    }
    const sql = (strings, ...values) => {
      const descriptor = { text: strings.reduce((s, part, i) => s + (i ? '$' + i : '') + part, ''), values };
      return {...descriptor, then(resolve, reject) { return execute(descriptor).then(resolve, reject); }};
    };
    sql.transaction = async queries => db.transaction(async tx => { const out = []; for (const q of queries) out.push(await execute(q, tx)); return out; });
    const store = new PostgresStore('postgresql://synthetic:synthetic@invalid.invalid/not-used', {trustedAdminSubjects: ['reviewer']});
    store.sql = sql;
    const reset = () => db.exec(`TRUNCATE ${configs.map(c => quote(c.name)).join(',')} CASCADE`);
    const input = {url:'https://example.com',message:'Synthetic offer',promisedBenefit:'Refund',intendedAction:'Receive money',images:[]};
    async function run(name, fn) { await t.test(name, async () => { await reset(); await fn(); }); }
    async function seedTestAllowance(ownerId, overrides = {}) {
      const day = new Date().toISOString().slice(0, 10), next = new Date(day + 'T00:00:00.000Z'); next.setUTCDate(next.getUTCDate() + 1);
      const key = 'scamwin-test-allowance:' + createHash('sha256').update(ownerId).digest('hex');
      const record = { schemaVersion: 1, ownerId, dailyLimit: 5, utcDay: day, expiresAt: next.toISOString(), ...overrides };
      await db.query('INSERT INTO scamwin_registry_sync(id,deployment,record) VALUES($1,$1,$2::jsonb)', [key, JSON.stringify(record)]);
    }
    await run('test SQL allowance permits only the scoped five admissions, retaining canceled/deleted starts and global caps',async()=>{
      await seedTestAllowance('alice');
      for(let i=0;i<5;i++){const c=await store.createCheck('alice',input,String(i));await store.deleteCheck('alice',c.id);}
      await assert.rejects(store.createCheck('alice',input,'sixth'),/owner_daily_quota/);
      for(let i=0;i<3;i++){const c=await store.createCheck('bob',input,String(i));await store.deleteCheck('bob',c.id);}
      await assert.rejects(store.createCheck('bob',input,'fourth'),/owner_daily_quota/);
      for(let i=0;i<2;i++){const owner='remaining-'+i,c=await store.createCheck(owner,input,'first');await store.deleteCheck(owner,c.id);}
      await assert.rejects(store.createCheck('over-global',input,'first'),/global_daily_quota/);
    });
    await run('expired, foreign and malformed SQL allowance records leave the default at three',async()=>{
      for(const overrides of [{utcDay:'2000-01-01'},{expiresAt:'not-a-date'},{expiresAt:'2099-01-01T00:00:00.000Z'},{ownerId:'mallory'},{dailyLimit:6},{dailyLimit:'5'},{schemaVersion:2},{extra:true}]){
        await reset();await seedTestAllowance('alice',overrides);
        for(let i=0;i<3;i++){const c=await store.createCheck('alice',input,String(i));await store.deleteCheck('alice',c.id);}
        await assert.rejects(store.createCheck('alice',input,'fourth'),/owner_daily_quota/);
      }
    });
    await run('terminal SQL storage paths finish running stages and skip unstarted work atomically',async()=>{
      for(const action of ['queued_cancel','cancel','deadline_read','deadline_admission','deadline_purge','delete','terminal_failed','terminal_canceled','expiry']){
        await reset();const c=await store.createCheck('alice',input,action),oldFinish='2026-11-08T11:59:59.000Z';let current=c;
        if(action!=='queued_cancel')current=await store.updateRun(c.id,1,c.revision,{state:'collecting',stages:[
          {id:'intake',label:'Intake',status:'completed',finishedAt:oldFinish},
          {id:'browser',label:'Browser',status:'running',startedAt:c.createdAt},
          {id:'trust',label:'Trust',status:'pending'},
        ]});
        const before=Date.now();
        if(['queued_cancel','cancel'].includes(action))await store.requestCancel('alice',c.id);
        if(action.startsWith('deadline'))await db.query("UPDATE scamwin_checks SET created_at=now()-interval '301 seconds' WHERE id=$1",[c.id]);
        if(action==='deadline_read')await store.getInternalCheck(c.id);
        if(action==='deadline_admission')await store.createCheck('bob',input,'next');
        if(action==='deadline_purge')await store.purgeExpired();
        if(action==='delete')await store.deleteCheck('alice',c.id);
        if(action==='terminal_failed'||action==='terminal_canceled')await store.updateRun(c.id,1,current.revision,{state:action==='terminal_failed'?'failed':'canceled'});
        if(action==='expiry'){await db.query("UPDATE scamwin_checks SET expires_at=now()-interval '1 second' WHERE id=$1",[c.id]);await store.purgeExpired();}
        const saved=(await db.query('SELECT record FROM scamwin_checks WHERE id=$1',[c.id])).rows[0].record;
        assert.ok(saved.stages.every(s=>!['pending','running'].includes(s.status)),action);
        if(action==='queued_cancel'){assert.ok(saved.stages.every(s=>s.status==='skipped'&&!s.startedAt&&!s.finishedAt));continue;}
        assert.equal(saved.stages[0].status,'completed',action);assert.equal(saved.stages[0].finishedAt,oldFinish,action);
        assert.equal(saved.stages[1].status,action.startsWith('deadline')||action==='terminal_failed'?'unavailable':'canceled',action);
        assert.ok(Date.parse(saved.stages[1].finishedAt)>=before&&Date.parse(saved.stages[1].finishedAt)<=Date.now(),action);
        assert.equal(saved.stages[2].status,'skipped',action);assert.equal(saved.stages[2].finishedAt,undefined,action);
      }
    });
    async function liveFixture() {
      const c=await store.createCheck('alice',input,'live');
      await store.updateRun(c.id,1,c.revision,{state:'collecting',stages:[{id:'browser',label:'Browser',status:'running'}]});
      const scope={ownerId:'alice',checkId:c.id,runId:c.runId,generation:1};
      const record={sessionId:'session',scope,status:'ready',encryptedLocator:'sealed',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30000).toISOString()};
      return {c,scope,record};
    }
    await run('live SQL protects owner/run/session boundaries and cannot resurrect a terminal session',async()=>{
      const {c,scope,record}=await liveFixture();
      assert.equal(await store.putLiveView({...scope,generation:2},{...record,scope:{...scope,generation:2}}),false);
      assert.equal(await store.putLiveView(scope,record),true);
      assert.equal(await store.putLiveView(scope,{...record,sessionId:'replacement'}),false);
      assert.equal(await store.getLiveView('bob',c.id,scope),null);
      assert.equal(await store.getLiveView('alice',c.id,{...scope,runId:'old'}),null);
      assert.equal((await store.getLiveView('alice',c.id,scope)).encryptedLocator,'sealed');
      assert.equal(await store.updateLiveView(scope,'old-session',{status:'ended'}),false);
      assert.equal(await store.updateLiveView(scope,'session',{status:'connected'}),true);
      assert.equal(await store.updateLiveView(scope,'session',{status:'ended'}),true);
      assert.equal((await store.getLiveView('alice',c.id,scope)).encryptedLocator,null);
      assert.equal(await store.updateLiveView(scope,'session',{status:'connected'}),false);
      assert.equal(await store.putLiveView(scope,record),false);
      assert.equal(JSON.stringify((await db.query('SELECT record FROM scamwin_checks')).rows).includes('sealed'),false);
    });
    await run('live SQL accepts an initial unavailable session only without secrets and within current browser scope',async()=>{
      const {c,scope,record}=await liveFixture();
      const unavailable={...record,status:'unavailable',encryptedLocator:null,reasonCode:'provider_unavailable',endedAt:record.createdAt};
      for(const changed of [
        {...unavailable,encryptedLocator:'forbidden-ciphertext'}, {...unavailable,connectedAt:record.createdAt},
        {...unavailable,reasonCode:undefined}, {...unavailable,endedAt:new Date(Date.parse(record.createdAt)-1000).toISOString()},
        {...unavailable,endedAt:new Date(Date.now()+10000).toISOString()}, {...unavailable,status:'ended'}, {...unavailable,status:'connected'},
      ]) assert.equal(await store.putLiveView(scope,changed),false);
      await assert.rejects(store.putLiveView(scope,{...unavailable,reasonCode:'https://private.example/secret'}));
      assert.equal(await store.putLiveView({...scope,generation:2},{...unavailable,scope:{...scope,generation:2}}),false);
      assert.equal(await store.putLiveView({...scope,ownerId:'bob'},{...unavailable,scope:{...scope,ownerId:'bob'}}),false);
      await db.query("UPDATE scamwin_checks SET record=jsonb_set(record,'{stages,0,status}','\"completed\"') WHERE id=$1",[c.id]);
      assert.equal(await store.putLiveView(scope,unavailable),false);
      await db.query("UPDATE scamwin_checks SET record=jsonb_set(record,'{stages,0,status}','\"running\"') WHERE id=$1",[c.id]);
      assert.equal(await store.putLiveView(scope,unavailable),true);
      const saved=await store.getLiveView('alice',c.id,scope);
      assert.equal(saved.status,'unavailable'); assert.equal(saved.encryptedLocator,null); assert.equal(saved.reasonCode,'provider_unavailable'); assert.equal(saved.endedAt,unavailable.endedAt);
      assert.equal(await store.putLiveView(scope,{...unavailable,sessionId:'second'}),false);
      assert.equal(await store.updateLiveView(scope,'session',{status:'connected'}),false);
    });
    await run('expired SQL viewer retains bounded owner metadata without a locator',async()=>{
      const {c,scope,record}=await liveFixture();
      assert.equal(await store.putLiveView(scope,record),true);
      await db.query("UPDATE scamwin_live_views SET expires_at=now()-interval '1 second' WHERE session_id='session'");
      const expired=await store.getLiveView('alice',c.id,scope);
      assert.ok(expired); assert.equal(expired.status,'ended'); assert.equal(expired.reasonCode,'expired'); assert.equal(expired.encryptedLocator,null);
      assert.equal(await store.getLiveView('bob',c.id,scope),null);
      assert.equal(await store.getLiveView('alice',c.id,{...scope,generation:2}),null);
    });
    await run('live SQL cancellation/save races and every retirement path clear ciphertext',async()=>{
      for(const action of ['race','terminal','delete','overdue','admission','purge','expiry']) {
        await reset(); const {c,scope,record}=await liveFixture();
        if(action==='race') {
          await Promise.all([store.putLiveView(scope,record),store.requestCancel('alice',c.id)]);
        } else {
          assert.equal(await store.putLiveView(scope,record),true);
          if(action==='terminal') { const current=await store.getCheck('alice',c.id); await store.updateRun(c.id,1,current.revision,{state:'analyzing'}); }
          if(action==='delete') await store.deleteCheck('alice',c.id);
          if(['overdue','admission','purge'].includes(action)) await db.query("UPDATE scamwin_checks SET created_at=now()-interval '301 seconds' WHERE id=$1",[c.id]);
          if(action==='overdue') await store.getCheck('alice',c.id);
          if(action==='admission') await store.createCheck('bob',input,'new');
          if(action==='expiry') await db.query("UPDATE scamwin_live_views SET expires_at=now()-interval '1 second' WHERE session_id='session'");
          if(['purge','expiry'].includes(action)) await store.purgeExpired();
        }
        const result=await store.getLiveView('alice',c.id,scope);
        if(action==='expiry') {assert.ok(result);assert.equal(result.encryptedLocator,null);assert.equal(result.reasonCode,'expired');}
        else assert.equal(result,null,action);
        assert.equal(await store.putLiveView(scope,record),false,action);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM scamwin_live_views WHERE encrypted_locator IS NOT NULL')).rows[0].n,0,action);
      }
    });
    await run('old SQL session finalizers cannot end a new generation and inactive stages deny reads',async()=>{
      const {c,scope,record}=await liveFixture();
      assert.equal(await store.putLiveView(scope,record),true);
      await db.query("UPDATE scamwin_checks SET generation=2,record=record||jsonb_build_object('generation',2,'runId','new-run') WHERE id=$1",[c.id]);
      await db.query("INSERT INTO scamwin_runs(id,check_id,generation,state,deadline,owner_id) VALUES('new-run',$1,2,'collecting',now()+interval '300 seconds','alice')",[c.id]);
      const next={...scope,runId:'new-run',generation:2};
      assert.equal(await store.putLiveView(next,{...record,sessionId:'new-session',scope:next,encryptedLocator:'new-cipher'}),true);
      assert.equal(await store.updateLiveView(scope,'new-session',{status:'ended'}),false);
      assert.equal(await store.updateLiveView(scope,'session',{status:'ended'}),true);
      assert.equal((await store.getLiveView('alice',c.id,next)).encryptedLocator,'new-cipher');
      await db.query("UPDATE scamwin_checks SET record=jsonb_set(record,'{stages,0,status}','\"completed\"') WHERE id=$1",[c.id]);
      assert.equal(await store.getLiveView('alice',c.id,next),null);
      assert.equal(await store.updateLiveView(next,'new-session',{status:'connected'}),false);
    });
    async function warningFixture(decision='approve') {
      const c = await store.createCheck('alice', input, 'first');
      await store.saveObservation('alice',{id:'e1',checkId:c.id,runId:c.runId,kind:'origin',status:'observed',sourceKind:'origin_probe',sourceRef:input.url,observedAt:new Date().toISOString(),data:{synthetic:true},collectorVersion:'1',policyVersion:'1'});
      const w = await store.submitWarning('alice',{checkId:c.id,hostname:'example.com',summary:'Reviewed synthetic domain-wide warning',category:'payment',evidenceIds:['e1'],consent:true});
      const reviewed=await store.reviewWarning('reviewer',w.id,{decision,reason:'Reviewed',expectedRevision:1});
      return {c,w:await store.getWarning(w.id),reviewed};
    }
    await run('admission idempotency, atomic rows and owner isolation',async()=>{
      const [a,b]=await Promise.all([store.createCheck('alice',input,'same'),store.createCheck('alice',input,'same')]);
      assert.equal(a.id,b.id);assert.equal(await store.getCheck('bob',a.id),null);
      assert.equal((await store.listChecks('alice',{})).total,1);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM scamwin_runs')).rows[0].n,1);
      assert.equal((await store.leaseOutbox()).length,1);
      await assert.rejects(store.createCheck('alice',input,'other'),/active_check/);
    });
    await run('global active admission is serialized across owners and releases completed capacity',async()=>{
      const results=await Promise.allSettled(['alice','bob','carol'].map(owner=>store.createCheck(owner,input,'first')));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
      assert.equal(results.find(r=>r.status==='rejected').reason.code,'global_active_quota');
      const first=results[0].value,claimed=await store.claimRun(first.id,1),canceled=await store.requestCancel('alice',first.id);
      assert.equal(canceled.state,'cancel_requested');
      await assert.rejects(store.createCheck('carol',input,'second'),/global_active_quota/);
      assert.equal(await store.updateRun(first.id,1,claimed.revision,{state:'completed'}),null);
      await store.updateRun(first.id,1,canceled.revision,{state:'canceled'});
      assert.ok(await store.createCheck('carol',input,'second'));
    });
    await run('global admission expires overdue foreign checks under the admission lock',async()=>{
      const first=await store.createCheck('alice',input,'first'),second=await store.createCheck('bob',input,'second');
      await db.query("UPDATE scamwin_checks SET created_at=now()-interval '5 minutes' WHERE id IN($1,$2)",[first.id,second.id]);
      assert.ok(await store.createCheck('carol',input,'third'));
      const states=(await db.query('SELECT state FROM scamwin_checks WHERE id IN($1,$2)',[first.id,second.id])).rows;
      assert.deepEqual(states.map(row=>row.state),['failed','failed']);
    });
    await run('claim/revision/cancellation and immutable owned evidence',async()=>{
      const c=await store.createCheck('alice',input,'first'), claimed=await store.claimRun(c.id,1);
      assert.ok(claimed);assert.equal(await store.claimRun(c.id,1),null);assert.equal(await store.updateRun(c.id,1,0,{state:'completed'}),null);
      const o={id:'e1',checkId:c.id,runId:c.runId,kind:'origin',status:'observed',sourceKind:'origin_probe',sourceRef:input.url,observedAt:new Date().toISOString(),data:{synthetic:true},collectorVersion:'1',policyVersion:'1'};
      await store.saveObservation('alice',o);assert.equal(await store.getObservation('bob','e1'),null);
      await assert.rejects(store.saveObservation('alice',o));await store.requestCancel('alice',c.id);
      assert.equal(await store.updateRun(c.id,1,claimed.revision,{state:'completed'}),null);
      const current=await store.getCheck('alice',c.id);assert.ok(await store.updateRun(c.id,1,current.revision,{state:'canceled'}));
    });
    await run('artifact/message SQL, expiry reads and deletion',async()=>{
      const c=await store.createCheck('alice',input,'first');
      const a=await store.saveArtifact('alice',{checkId:c.id,name:'fixture.png',kind:'input',mediaType:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'});
      assert.ok(await store.getArtifact('alice',a.id));assert.equal(await store.getArtifact('bob',a.id),null);assert.equal((await store.listArtifacts('alice',c.id)).length,1);
      await store.appendMessage('alice',{checkId:c.id,role:'user',content:'Synthetic question'});assert.equal((await store.listMessages('alice',c.id)).length,1);
      await store.deleteCheck('alice',c.id);assert.equal(await store.getCheck('alice',c.id),null);assert.equal((await store.listMessages('alice',c.id)).length,0);
    });
    await run('review -> signing lease -> fee reservation -> signed persistence -> finality -> retraction',async()=>{
      const {w}=await warningFixture(), leased=await store.leasePublication(w.id,w.revision);
      assert.ok(leased);assert.equal(await store.leasePublication(w.id,w.revision),null);
      assert.equal(await store.reservePublicationFee(w.id,w.revision,'1000',leased.leaseToken),true);
      const tx='0x'+'ab'.repeat(32);
      assert.ok(await store.updatePublication(w.id,w.revision,{status:'signed',signedRawTransaction:'0x1234',transactionHash:tx,nonce:0,leaseToken:leased.leaseToken}));
      assert.equal((await store.getWarning(w.id)).publication.signedRawTransaction,undefined);
      assert.equal((await store.getPublication(w.id,w.revision)).signedRawTransaction,'0x1234');
      await assert.rejects(store.retractWarning('reviewer',w.id,{reason:'Correction',expectedRevision:w.revision}));
      await store.updatePublication(w.id,w.revision,{status:'finalized',leaseUntil:new Date().toISOString()});
      const retracted=await store.retractWarning('reviewer',w.id,{reason:'Correction',expectedRevision:w.revision});
      assert.equal(retracted.status,'retracted');assert.ok(await store.leasePublication(w.id,retracted.revision,'retract'));
    });
    await run('delete before lease revokes unsigned publication; delete after lease preserves signed boundary',async()=>{
      const first=await warningFixture();await store.deleteCheck('alice',first.c.id);assert.equal(await store.leasePublication(first.w.id,first.w.revision),null);
      await reset();const second=await warningFixture(),leased=await store.leasePublication(second.w.id,second.w.revision);assert.ok(leased);
      await store.deleteCheck('alice',second.c.id);assert.equal(await store.reservePublicationFee(second.w.id,second.w.revision,'1000',leased.leaseToken),true);
      assert.ok(await store.updatePublication(second.w.id,second.w.revision,{status:'signed',signedRawTransaction:'0x1234',transactionHash:'0x'+'ab'.repeat(32),nonce:0,leaseToken:leased.leaseToken}));
    });
    await run('outbox attempts fenced and purge executes retention SQL',async()=>{
      const c=await store.createCheck('alice',input,'first');
      assert.deepEqual(await store.leaseOutbox(10,[]),[]);
      assert.deepEqual(await store.leaseOutbox(10,['publish_warning','retract_warning']),[]);
      const [job]=await store.leaseOutbox(10,['investigate']);assert.ok(job);assert.equal(job.kind,'investigate');
      assert.equal(await store.finishOutbox(job.id,job.attempts+1,'dispatched'),false);assert.equal(await store.finishOutbox(job.id,job.attempts,'dispatched'),true);
      await db.query("UPDATE scamwin_checks SET created_at=now()-interval '10 minutes' WHERE id=$1",[c.id]);
      assert.equal((await store.purgeExpired()).runs,1);
      await db.query("UPDATE scamwin_checks SET expires_at=now()-interval '1 minute' WHERE id=$1",[c.id]);
      assert.equal((await store.purgeExpired()).checks,1);assert.equal(await store.getCheck('alice',c.id),null);
    });
    await run('local-only withdrawal never enters chain reconciliation',async()=>{
      const {w}=await warningFixture();
      const r=await store.retractWarning('reviewer',w.id,{reason:'Never published',expectedRevision:w.revision});
      assert.equal(r.publication.status,'local_only');assert.equal((await store.listPendingPublications()).length,0);
    });
    await run('intake images persist separately and private review expiry hides selected evidence',async()=>{
      const image={name:'fixture.png',mediaType:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'};
      const c=await store.createCheck('alice',{...input,images:[image]},'image');
      assert.equal((await db.query('SELECT record FROM scamwin_checks WHERE id=$1',[c.id])).rows[0].record.input.images[0].dataUrl,'');
      assert.equal((await store.getCheck('alice',c.id)).input.images[0].dataUrl,image.dataUrl);
      await reset(); const {w}=await warningFixture();
      assert.equal((await store.listWarnings('alice'))[0].evidence.length,1);
      const expired=new Date(Date.now()-86400000).toISOString();
      await db.query("UPDATE scamwin_warning_submissions SET expires_at=$1::timestamptz,record=record||jsonb_build_object('expiresAt',$2::text) WHERE id=$3",[expired,expired,w.id]);
      assert.deepEqual((await store.listWarnings('alice'))[0].evidence,[]);
      assert.equal((await store.listPendingPublications()).length,0);
      await store.purgeExpired();
      assert.deepEqual((await db.query('SELECT record FROM scamwin_warning_submissions WHERE id=$1',[w.id])).rows[0].record.evidence,[]);
    });
    await run('admission quotas still count canceled/deleted starts and roles use server-side grants',async()=>{
      for(let i=0;i<3;i++){const c=await store.createCheck('alice',input,String(i));await store.deleteCheck('alice',c.id);}
      await assert.rejects(store.createCheck('alice',input,'fourth'),/owner_daily_quota/);
      for(let i=0;i<7;i++){const c=await store.createCheck('owner'+i,input,'first');await store.updateRun(c.id,c.generation,c.revision,{state:'completed'});}
      await assert.rejects(store.createCheck('owner-last',input,'first'),/global_daily_quota/);
      await store.grantRole('reviewer','new-reviewer','reviewer');
      assert.equal(await store.hasRole('new-reviewer','reviewer'),true);assert.equal(await store.hasRole('outsider','reviewer'),false);
      await assert.rejects(store.grantRole('outsider','intruder','admin'),/forbidden/);
    });
    await run('exact-indicator SQL joins only owner cases, deduplicates bounded fingerprints and stores no raw values',async()=>{
      const indicator={kind:'recipient',fingerprint:'a'.repeat(64)};
      const first=await store.createCheck('alice',input,'first');await store.saveIndicators('alice',first.id,[indicator,indicator]);
      const claimed=await store.claimRun(first.id,1);await store.updateRun(first.id,1,claimed.revision,{state:'completed'});
      const second=await store.createCheck('alice',input,'second'),foreign=await store.createCheck('bob',input,'foreign');
      await store.saveIndicators('bob',foreign.id,[indicator]);await store.saveIndicators('alice',second.id,[indicator]);
      assert.deepEqual(await store.findRelatedCases('alice',second.id,[indicator]),[{checkId:first.id,kind:'recipient'}]);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM scamwin_indicators WHERE value<>''")).rows[0].n,0);
      const tooMany=Array.from({length:20},(_,i)=>({kind:'recipient',fingerprint:(i+1).toString(16).padStart(64,'0')}));
      await assert.rejects(store.saveIndicators('alice',second.id,tooMany),/indicator_case_cap/);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM scamwin_indicators WHERE check_id=$1',[second.id])).rows[0].n,1);
      await store.deleteCheck('alice',first.id);assert.deepEqual(await store.findRelatedCases('alice',second.id,[indicator]),[]);
    });
    await run('operational pauses require admin, fence new work and leave signed reconciliation available',async()=>{
      assert.deepEqual(await store.getOperationalState(),{investigationPaused:false,publicationPaused:false});
      const {c,w}=await warningFixture();
      await store.grantRole('reviewer','limited-reviewer','reviewer');
      await assert.rejects(store.setOperationalPause('limited-reviewer','investigation',true),/forbidden/);
      await store.setOperationalPause('reviewer','investigation',true);
      const paused=await store.getOperationalState();assert.equal(paused.investigationPaused,true);assert.equal(paused.publicationPaused,false);
      await assert.rejects(store.createCheck('bob',input,'new'),/investigation_paused/);
      assert.equal((await store.createCheck('alice',input,'first')).id,c.id);
      assert.equal((await store.getCheck('alice',c.id)).id,c.id);
      await store.setOperationalPause('reviewer','investigation',false);
      assert.ok(await store.createCheck('bob',input,'new'));
      await store.setOperationalPause('reviewer','publication',true);
      assert.equal(await store.leasePublication(w.id,w.revision),null);
      await store.setOperationalPause('reviewer','publication',false);
      const lease=await store.leasePublication(w.id,w.revision);assert.ok(lease);
      assert.equal(await store.reservePublicationFee(w.id,w.revision,'1000',lease.leaseToken),true);
      assert.ok(await store.updatePublication(w.id,w.revision,{status:'signed',signedRawTransaction:'0x1234',transactionHash:'0x'+'ab'.repeat(32),nonce:0,leaseToken:lease.leaseToken}));
      await store.setOperationalPause('reviewer','publication',true);
      assert.ok(await store.updatePublication(w.id,w.revision,{status:'included',leaseUntil:new Date().toISOString()}));
      const reconciliation=await store.leasePublication(w.id,w.revision);assert.equal(reconciliation.signedRawTransaction,'0x1234');
      assert.ok(await store.updatePublication(w.id,w.revision,{status:'finalized',leaseUntil:new Date().toISOString()}));
      const correction=await store.retractWarning('reviewer',w.id,{reason:'Reviewed correction',expectedRevision:w.revision});
      assert.equal(await store.leasePublication(w.id,correction.revision,'retract'),null);
      const audit=await db.query("SELECT actor_class,object_id,code FROM scamwin_audit_events WHERE action LIKE 'pause_%'");
      assert.equal(audit.rows.length,5);assert.ok(audit.rows.every(row=>row.actor_class==='admin'&&row.object_id==='scamwin-operations'&&['paused','resumed'].includes(row.code)));
      assert.equal((await db.query("SELECT count(*)::int AS n FROM scamwin_registry_sync WHERE id='scamwin-operations' AND deployment='scamwin-operations'")).rows[0].n,1);
    });
    await run('requests for more review information preserve privacy without creating publication effects',async()=>{
      const {c,reviewed}=await warningFixture('request_information');
      assert.equal(reviewed.status,'needs_information');assert.equal(reviewed.revision,2);assert.equal(reviewed.reviewReason,'Reviewed');
      assert.equal(await store.getWarning(reviewed.id),null);assert.deepEqual(await store.getPublicWarnings(),[]);
      assert.deepEqual(await store.getReviewQueue('reviewer'),[]);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM scamwin_publications')).rows[0].n,0);
      assert.deepEqual(await store.leaseOutbox(10,['publish_warning','retract_warning']),[]);
      assert.equal((await store.listWarnings('alice'))[0].status,'needs_information');
      await store.deleteCheck('alice',c.id);
      const withdrawn=(await store.listWarnings('alice'))[0];assert.equal(withdrawn.status,'withdrawn');assert.deepEqual(withdrawn.evidence,[]);
    });
    assert.equal(externalRequests,0);
    t.diagnostic(JSON.stringify({tables:configs.length,queries:queryCount,externalRequests,engine:'PGlite/PostgreSQL, in memory; no real connection'}));
  } finally { await db.close(); neonConfig.fetchFunction = oldFetch; }
});
