import assert from 'node:assert/strict';
import { createConnectorTestStore } from '../tests/utils/scamwin-connector-test-db';
import { ConnectorRuntimeStore } from '../lib/scamwin/connectors/runtime-store';

/** Synthetic persisted-state interruption drill. No env, cloud, mailbox or production database access. */
async function main(){
  if(process.argv.includes('--live'))throw new Error('live_pilot_not_authorized');
  const f=await createConnectorTestStore();let now=Date.parse('2026-11-10T12:00:00.000Z');
  try{
    const c=await f.store.createConnection('fixture-owner',{provider:'gmail',providerAccountId:'fixture-account',scope:['inbox']});
    await f.store.configureConnection(c,{mode:'all_new',scope:['inbox'],rules:{},consent:true,paused:false,automaticDailyLimit:1},{cursor:'fixture-activation',capturedAt:new Date(now).toISOString()});
    const first=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    const abandoned=await first.claimDue(['gmail']);assert.ok(abandoned);
    now+=56000;f.advance(56000);
    const restarted=new ConnectorRuntimeStore(f.database,f.keyring,()=>new Date(now));
    const recovered=await restarted.claimDue(['gmail']);assert.ok(recovered);assert.notEqual(recovered.token,abandoned.token);
    assert.equal(await first.finishSync(abandoned,{reason:'ready',delayMs:0}),false);
    await restarted.finishSync(recovered,{reason:'ready',delayMs:900000,successful:true});
    for(let day=0;day<3;day++){
      assert.equal((await restarted.reserveUsage({calls:2,bytes:1024,computeMs:1000})).allowed,true);
      now+=86400000;f.advance(86400000);
      const lease=await restarted.claimDue(['gmail']);assert.ok(lease);await restarted.finishSync(lease,{reason:'ready',delayMs:900000,successful:true});
    }
    console.log(JSON.stringify({status:'synthetic_recovery_verified',abandonedLeaseFenced:true,simulatedUtcDays:3,liveConnectionVerified:false,realResourceUsageMeasured:false}));
  }finally{await f.close();}
}
main().catch(()=>{console.error('connector_runtime_drill_failed');process.exitCode=1;});
