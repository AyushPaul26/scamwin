import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import * as tables from '../lib/db/scamwin-slack-schema';
import {ExpandedAuthorizationService,PostgresExpandedAuthorizationPersistence,type ExpandedAuthorizationDriver} from '../lib/scamwin/connectors/expanded-auth';
import {sealConnectorSecret} from '../lib/scamwin/connectors/crypto';
import {SlackStore} from '../lib/scamwin/connectors/slack-store';
import {SlackWebhookService,slackWebhook} from '../lib/scamwin/connectors/slack-webhook';
import {ConnectorRuntimeStore} from '../lib/scamwin/connectors/runtime-store';
import type {SavedConnection} from '../lib/scamwin/connectors/contracts';
import {purgeSupplementalData,supplementalTables} from '../lib/scamwin/connectors/supplemental-data';

const start=Date.parse('2026-11-10T12:00:00Z');
async function fixture(){
 const t=await createConnectorTestStore(Object.values(tables));
 let clock=start;
 const now=()=>new Date(clock);
 const persistence=new PostgresExpandedAuthorizationPersistence(t.database,{keyring:t.keyring,now});
 const store=new SlackStore(t.database,t.keyring,t.store,persistence,now);
 const runtime=new ConnectorRuntimeStore(t.database,t.keyring,now);
 const service=new SlackWebhookService({store,core:t.store,runtime,appId:'A1',automaticEnabled:true});
 const initial=await t.store.createConnection('owner',{provider:'slack',providerAccountId:'installation',scope:['unselected']});
 await t.store.saveGrant(initial,{accessToken:'private-token',scopes:['channels:read','channels:history']});
 const resource=await store.saveResource(initial,{channelId:'C1',label:'General',kind:'public'});
 const connection=await t.store.configureConnection(initial,{mode:'all_new',scope:[resource.handle],rules:{},consent:true,paused:false,automaticDailyLimit:1});
 const saveIdentity=async(c:SavedConnection,authorizedAt:string)=>{
  const identity={accountId:'installation',label:'Workspace',metadata:{teamId:'T1',appId:'A1',botUserId:'UBOT',botId:'B1',authorizedAt,workspaceHost:'workspace.slack.com'}};
  await t.database.query('UPDATE connector_connections SET encrypted_identity=$1 WHERE id=$2',[sealConnectorSecret(JSON.stringify(identity),{ownerId:c.ownerId,connectionId:`${c.id}:identity`,epoch:c.epoch,purpose:'grant'},t.keyring),c.id]);
  await store.bindInstallation(c);
 };
 await saveIdentity(connection,new Date(start-1000).toISOString());
 const deliver=async(value:unknown)=>{
  const stamp=String(Math.floor(clock/1000)),body=JSON.stringify(value);
  const signature='v0='+createHmac('sha256','signing').update(`v0:${stamp}:${body}`).digest('hex');
  return slackWebhook(new Request('https://app.example/slack',{method:'POST',headers:{'content-type':'application/json','x-slack-request-timestamp':stamp,'x-slack-signature':signature},body}),{secret:'signing',appId:'A1',now:()=>clock,handle:v=>service.handle(v)});
 };
 const lifecycle=(kind:string,id:string,eventTime=Math.floor(clock/1000))=>({type:'event_callback',api_app_id:'A1',team_id:'T1',event_id:id,event_time:eventTime,event:{type:kind}});
 return {...t,core:t.store,store,runtime,connection,resource,saveIdentity,deliver,lifecycle,advanceClock:(ms:number)=>{clock+=ms;t.advance(ms);}};
}

test('Slack signed uninstall fences stored preparation, pending references and grants once before acknowledging retries',async()=>{
 const t=await fixture();try{
  const c=t.connection;
  const message={id:`${t.resource.handle}:1794312000.000001`,receivedAt:'2026-11-10T12:00:00.000Z'};
  const selected=await t.core.saveSelectedRevision(c,{providerItemId:message.id,revisionHash:'a'.repeat(64),receivedAt:message.receivedAt,text:'Stored private evidence',urls:[],attachments:[]});
  await t.runtime.stageRevision(c,selected.revision.id);
  const target=selected.revision.manifest.targets[0];assert.ok(target);
  const job=await t.core.enqueueTarget(c,{revisionId:selected.revision.id,targetId:target.id,generation:1,input:{message:'Stored private evidence',url:null,images:[]}});
  const lease=await t.core.leaseConnection(c);assert.ok(lease);
  await t.core.persistProviderPage(c,lease,{items:[message],pageState:null,complete:true,finalCursor:'{}',gaps:[]});
  await t.store.event(c,'queued-before-revocation',message,'1794312000.000001');
  const notification=t.lifecycle('app_uninstalled','uninstall');
  assert.equal((await t.deliver(notification)).status,200);
  assert.equal((await t.deliver(notification)).status,200);
  const row=(await t.database.query('SELECT epoch,status,encrypted_grant,encrypted_identity FROM connector_connections WHERE id=$1',[c.id])).rows[0];
  assert.equal(row.status,'disconnected');assert.equal(row.epoch,c.epoch+1);
  assert.equal(row.encrypted_grant,null);assert.equal(row.encrypted_identity,null);
  assert.equal((await t.core.listPendingProviderItems(c)).items.length,0);
  assert.equal(await t.runtime.claimPreparation(['slack']),null);
  assert.equal((await t.database.query('SELECT state FROM connector_jobs WHERE id=$1',[job.id])).rows[0].state,'canceled');
  const warnings=(await t.database.query("SELECT reason FROM connector_activity WHERE connection_id=$1 AND reason='slack_app_uninstalled_reconnect_required'",[c.id])).rows;
  assert.equal(warnings.length,1);
 }finally{await t.close();}
});

test('Slack token revocation distinguishes bot user identity and ignores stale uninstall after reconnect',async()=>{
 const t=await fixture();try{
  const other={...t.lifecycle('tokens_revoked','other-token'),event:{type:'tokens_revoked',tokens:{oauth:['UBOT'],bot:['UOTHER']}}};
  assert.equal((await t.deliver(other)).status,200);
  assert.equal((await t.database.query('SELECT status FROM connector_connections WHERE id=$1',[t.connection.id])).rows[0].status,'active');
  const revoked={...t.lifecycle('tokens_revoked','bot-token'),event:{type:'tokens_revoked',tokens:{oauth:[],bot:['UBOT']}}};
  assert.equal((await t.deliver(revoked)).status,200);
  let row=(await t.database.query('SELECT status,epoch FROM connector_connections WHERE id=$1',[t.connection.id])).rows[0];
  assert.equal(row.status,'disconnected');
  t.advanceClock(2000);
  // Use the public reconnect contract to establish a new local authority generation.
  const {PostgresConnectorStore}=await import('../lib/scamwin/connectors/store');
  const core=new PostgresConnectorStore(t.database,{keyring:t.keyring,now:()=>new Date(start+2000)});
  const reconnected=await core.reconnectConnection('owner',t.connection.id,Number(row.epoch),'installation',{accessToken:'replacement',scopes:['channels:read','channels:history']});
  await t.saveIdentity(reconnected,new Date(start+2000).toISOString());
  assert.equal((await t.deliver(t.lifecycle('app_uninstalled','old-uninstall',Math.floor(start/1000)))).status,200);
  assert.equal((await t.deliver(revoked)).status,200);
  row=(await t.database.query('SELECT status,epoch FROM connector_connections WHERE id=$1',[t.connection.id])).rows[0];
  assert.equal(row.status,'active');assert.equal(row.epoch,reconnected.epoch);
 }finally{await t.close();}
});

test('Slack top-level rate-limit notification records one bounded recovery gap before ACK',async()=>{
 const t=await fixture();try{
  const notice={type:'app_rate_limited',api_app_id:'A1',team_id:'T1',minute_rate_limited:1794312000};
  assert.equal((await t.deliver(notice)).status,200);assert.equal((await t.deliver(notice)).status,200);
  const gaps=(await t.database.query("SELECT reason FROM connector_activity WHERE connection_id=$1 AND reason='slack_event_delivery_rate_limited'",[t.connection.id])).rows;
  assert.equal(gaps.length,1);
 }finally{await t.close();}
});

test('Slack completed, Manual and previous-epoch delivery metadata do not exhaust live reference capacity',async()=>{
 const t=await fixture();try{
  const c=t.connection;
  await t.database.query("INSERT INTO connector_slack_events(id,connection_id,owner_id,epoch,item_key,version,deleted,encrypted_reference,created_at,expires_at) SELECT 'retained-'||n,$1,$2,CASE WHEN n%2=0 THEN $3 ELSE 1 END,'metadata','1',0,NULL,$4,$5 FROM generate_series(1,1000) n",[c.id,c.ownerId,c.epoch,new Date(start).toISOString(),new Date(start+90*86400000).toISOString()]);
  const reference={id:`${t.resource.handle}:1794312000.000001`,receivedAt:'2026-11-10T12:00:00.000Z'};
  assert.equal(await t.store.event(c,'new-reference',reference,'1794312000.000001'),true);
  assert.equal((await t.store.events(c,null)).items.length,1);
 }finally{await t.close();}
});

test('Slack selected authority survives day 90 purge while historical deliveries and unused channels expire',async()=>{
 const t=await fixture();try{
  const unused=await t.store.saveResource(t.connection,{channelId:'C2',label:'Unused',kind:'public'});
  await t.store.event(t.connection,'old-history',null,'1');
  t.advanceClock(91*86400000);
  assert.equal((await t.store.installations('T1','A1')).length,1);
  assert.equal((await t.store.resource(t.connection,t.resource.handle)).channelId,'C1');
  await t.store.purge();
  assert.equal((await t.store.installations('T1','A1')).length,1);
  assert.equal((await t.store.resource(t.connection,t.resource.handle)).channelId,'C1');
  assert.equal(await t.store.selectedHandle(t.connection,'C1'),t.resource.handle);
  await assert.rejects(t.store.resource(t.connection,unused.handle),/selection_unavailable/);
  assert.equal((await t.database.query('SELECT id FROM connector_slack_events')).rows.length,0);
 }finally{await t.close();}
});

test('Slack backlog overflow persists one warning and completed cursor handoff releases intake capacity',async()=>{
 const t=await fixture();try{
  const c=t.connection;
  for(let n=0;n<1000;n++)await t.store.event(c,`pending-${n}`,{id:`${t.resource.handle}:1794312000.${String(n).padStart(6,'0')}`,receivedAt:'2026-11-10T12:00:00.000Z'},'1');
  const next={id:`${t.resource.handle}:1794312001.000001`,receivedAt:'2026-11-10T12:00:01.000Z'};
  await assert.rejects(t.store.event(c,'overflow',next,'1'),/queue_capacity/);
  await assert.rejects(t.store.event(c,'overflow',next,'1'),/queue_capacity/);
  assert.equal((await t.database.query("SELECT id FROM connector_activity WHERE reason='slack_event_backlog_capacity' AND connection_id=$1",[c.id])).rows.length,1);
  const page=await t.store.events(c,null),lease=await t.core.leaseConnection(c);assert.ok(lease);
  await t.core.persistProviderPage(c,lease,{items:page.items,pageState:null,complete:true,finalCursor:JSON.stringify({v:1,epoch:c.epoch,after:page.after}),gaps:[]});
  for(const reference of page.items)await t.core.acknowledgeProviderItem(c,reference);
  assert.equal(await t.store.event(c,'overflow',next,'1'),true);
  assert.equal((await t.database.query("SELECT id FROM connector_activity WHERE reason='slack_event_backlog_recovered' AND connection_id=$1",[c.id])).rows.length,1);
  assert.equal(await t.store.event(c,'pending-0',page.items[0],'1'),false);
 }finally{await t.close();}
});

test('Slack authorization atomically routes lifecycle deliveries before discovery or channel selection',async()=>{
 const t=await createConnectorTestStore(Object.values(tables));try{
  const now=()=>new Date(start),persistence=new PostgresExpandedAuthorizationPersistence(t.database,{keyring:t.keyring,now});
  const driver:ExpandedAuthorizationDriver={provider:'slack',authorizationUrl:input=>`https://slack.com/oauth/v2/authorize?state=${input.state}`,exchange:async()=>({identity:{accountId:'verified-installation',label:'Workspace',metadata:{appId:'A1',teamId:'T1',botUserId:'UBOT',authorizedAt:new Date(start-1000).toISOString()}},grant:{accessToken:'private-grant',scopes:['channels:read','channels:history']}}),refresh:async grant=>grant};
  const auth=new ExpandedAuthorizationService(t.store,persistence,{origin:'https://app.example',enabled:true,drivers:[driver],now:()=>start});
  const begun=await auth.begin('owner',{provider:'slack'}),state=new URL(begun.authorizationUrl).searchParams.get('state')!;
  const c=await auth.complete('owner','slack',new URLSearchParams({state,code:'code'}),begun.browserBindingSecret);
  const store=new SlackStore(t.database,t.keyring,t.store,persistence,now),runtime=new ConnectorRuntimeStore(t.database,t.keyring,now);
  const service=new SlackWebhookService({store,core:t.store,runtime,appId:'A1',automaticEnabled:true});
  await service.handle({type:'event_callback',api_app_id:'A1',team_id:'T1',event_id:'before-discovery',event_time:start/1000,event:{type:'app_uninstalled'}});
  assert.equal((await t.store.getConnection('owner',c.id))?.status,'disconnected');
  assert.equal((await t.database.query("SELECT id FROM connector_activity WHERE connection_id=$1 AND reason='slack_app_uninstalled_reconnect_required'",[c.id])).rows.length,1);
 }finally{await t.close();}
});

test('generic supplemental cleanup preserves current Slack routing and selected resources at day 90',async()=>{
 const t=await createConnectorTestStore(supplementalTables);try{
  let clock=start;const now=()=>new Date(clock);
  const persistence=new PostgresExpandedAuthorizationPersistence(t.database,{keyring:t.keyring,now}),store=new SlackStore(t.database,t.keyring,t.store,persistence,now);
  const c=await t.store.createConnection('owner',{provider:'slack',providerAccountId:'current-routing',scope:['unselected']});
  await t.store.saveGrant(c,{accessToken:'current-grant',scopes:['channels:read','channels:history']});
  const identity={accountId:'current-routing',label:'Workspace',metadata:{teamId:'T1',appId:'A1'}};
  await t.database.query('UPDATE connector_connections SET encrypted_identity=$1 WHERE id=$2',[sealConnectorSecret(JSON.stringify(identity),{ownerId:c.ownerId,connectionId:`${c.id}:identity`,epoch:c.epoch,purpose:'grant'},t.keyring),c.id]);
  const selected=await store.saveResource(c,{channelId:'C1',label:'Selected',kind:'public'}),unused=await store.saveResource(c,{channelId:'C2',label:'Unused',kind:'public'});
  const current=await t.store.configureConnection(c,{mode:'all_new',scope:[selected.handle],rules:{},consent:true,paused:false,automaticDailyLimit:1});
  await store.bindInstallation(current);await store.event(current,'old-delivery',null,'1');
  clock+=91*86400000;t.advance(91*86400000);
  await purgeSupplementalData({query:t.database.query.bind(t.database)},now());
  assert.equal((await store.installations('T1','A1')).length,1);
  assert.equal((await store.resource(current,selected.handle)).channelId,'C1');
  await assert.rejects(store.resource(current,unused.handle),/selection_unavailable/);
  assert.equal((await t.database.query('SELECT id FROM connector_slack_events')).rows.length,0);
 }finally{await t.close();}
});

test('failed Slack routing insertion rolls back the OAuth grant and connection attachment',async()=>{
 const t=await createConnectorTestStore(Object.values(tables));try{
  const database={query:t.database.query.bind(t.database),transaction:<T>(fn:(sql:import('../lib/scamwin/connectors/store').ConnectorSql)=>Promise<T>)=>t.database.transaction(sql=>fn({query:async(text,values)=>{
   if(text.startsWith('INSERT INTO connector_slack_installations'))throw Error('synthetic_routing_write_failed');
   return sql.query(text,values);
  }}))};
  const persistence=new PostgresExpandedAuthorizationPersistence(database,{keyring:t.keyring,now:()=>new Date(start)});
  const driver:ExpandedAuthorizationDriver={provider:'slack',authorizationUrl:input=>`https://slack.com/oauth/v2/authorize?state=${input.state}`,exchange:async()=>({identity:{accountId:'routing-failure',label:'Workspace',metadata:{appId:'A1',teamId:'T1'}},grant:{accessToken:'private-grant',scopes:['channels:read','channels:history']}}),refresh:async grant=>grant};
  const auth=new ExpandedAuthorizationService(t.store,persistence,{origin:'https://app.example',enabled:true,drivers:[driver],now:()=>start});
  const begun=await auth.begin('owner',{provider:'slack'}),state=new URL(begun.authorizationUrl).searchParams.get('state')!;
  await assert.rejects(auth.complete('owner','slack',new URLSearchParams({state,code:'code'}),begun.browserBindingSecret),/synthetic_routing_write_failed/);
  assert.equal((await t.database.query('SELECT id FROM connector_connections')).rows.length,0);
  assert.equal((await t.database.query('SELECT connection_id FROM connector_slack_installations')).rows.length,0);
 }finally{await t.close();}
});
