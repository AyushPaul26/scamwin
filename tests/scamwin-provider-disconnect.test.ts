import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {createConnectorTestStore} from './utils/scamwin-connector-test-db';
import {TeamsStore} from '../lib/scamwin/connectors/teams-store';
import {ConnectorRuntimeStore} from '../lib/scamwin/connectors/runtime-store';
import {ConnectorAccountService} from '../lib/scamwin/connectors/account-service';
import {ConnectorOAuthService,oauthConfiguration} from '../lib/scamwin/connectors/oauth';
import {ConnectorCredentialService} from '../lib/scamwin/connectors/credentials';
import {ConnectorStoreError} from '../lib/scamwin/connectors/store';
import * as integration from '../lib/scamwin/connectors/integration';
import {eraseSupplementalConnection,supplementalTables} from '../lib/scamwin/connectors/supplemental-data';

const now=()=>new Date('2026-11-10T12:00:00Z');

for(const {gatesEnabled,failDelete} of [{gatesEnabled:true,failDelete:false},{gatesEnabled:false,failDelete:false},{gatesEnabled:false,failDelete:true}])test(`Account Teams disconnect captures subscriptions and DELETEs only after local fencing with gates ${gatesEnabled?'on':'off'}${failDelete?' and provider failure':''}`,async()=>{
  const fixture=await createConnectorTestStore(supplementalTables);
  try{
    const original=await fixture.store.createConnection('owner',{provider:'teams',providerAccountId:'verified-teams-identity',scope:['unselected']});
    // Cleanup must use only this saved authority, even when refreshing is impossible.
    await fixture.store.saveGrant(original,{accessToken:'saved-expired-token',refreshToken:'must-never-refresh',expiresAt:'2026-11-01T12:00:00Z',scopes:['Chat.Read']});
    const teams=new TeamsStore(fixture.database,fixture.keyring,now);
    const resource=await teams.saveResource(original,{chatId:'chat-1',label:'Selected chat',tenantId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
    const connection=await teams.configure(original,{mode:'all_new',scope:[resource.handle],rules:{},paused:false,consent:true,automaticDailyLimit:1},{cursor:'0',capturedAt:now().toISOString()});
    const selected=(await teams.resources(connection))[0];
    await teams.saveSubscription(connection,selected,{id:'saved-subscription',clientState:'s'.repeat(43),expiresAt:'2026-11-12T12:00:00Z'});
    let remoteCalls=0,transportError:unknown;
    const transport:typeof fetch=async(input,init)=>{
      remoteCalls++;
      try{
      assert.equal(String(input),'https://graph.microsoft.com/v1.0/subscriptions/saved-subscription');
      assert.equal(init?.method,'DELETE','Disconnect cannot refresh a token or fetch a source');
      assert.equal(new Headers(init?.headers).get('authorization'),'Bearer saved-expired-token');
      const current=await fixture.store.getConnection('owner',connection.id);
      assert.equal(current?.status,'disconnected','Remote cleanup must start after the local epoch fence');
      assert.ok(current&&current.epoch>connection.epoch);
      assert.equal(await fixture.store.readGrant(current),null);
      assert.equal(Number((await fixture.database.query('SELECT count(*) AS n FROM connector_teams_subscriptions')).rows[0].n),0,'Captured cleanup survives supplemental row erasure');
      return failDelete?Response.json({error:'Provider temporarily unavailable'},{status:503}):new Response(null,{status:204});
      }catch(error){transportError=error;throw error;}
    };
    const environment={APP_BASE_URL:'https://scamwin.example',SCAMWIN_TEAMS_CLIENT_ID:'test-client',SCAMWIN_TEAMS_CLIENT_SECRET:'test-secret',SCAMWIN_CONNECTORS_ENABLED:String(gatesEnabled),SCAMWIN_CONNECTOR_TEAMS_ENABLED:String(gatesEnabled)};
    const runtime=new ConnectorRuntimeStore(fixture.database,fixture.keyring,now);
    const context={connectorStore:fixture.store,database:fixture.database,keyring:fixture.keyring,runtime,meteredFetch:transport};
    // Run the production Account composition with only the session and infrastructure
    // factories supplied. Core, credential service, TeamsStore and cleanup are real.
    const dependencies:Record<string,unknown>={
      'server-only':{},'zod':{z},'@/lib/auth0':{getOptionalSession:async()=>({user:{sub:'owner'}})},
      '../repository':{getScamwinStore:()=>({requestCancel:async()=>{throw Error('Unexpected admitted check');}})},
      './repository':{getConnectorStore:()=>fixture.store},'./store':{ConnectorStoreError},
      './account-service':{ConnectorAccountService},'./oauth':{ConnectorOAuthService,oauthConfiguration:()=>oauthConfiguration(environment)},
      './credentials':{ConnectorCredentialService},'./supplemental-data':{eraseSupplementalConnection},
      './integration':{...integration,createExpandedAuthorization:(c:integration.IntegrationContext)=>integration.createExpandedAuthorization(c,environment),prepareIntegratedDisconnect:(c:integration.IntegrationContext,ref:Parameters<typeof integration.prepareIntegratedDisconnect>[1])=>integration.prepareIntegratedDisconnect(c,ref,environment)},
      './runtime-server':{connectorRuntimeContext:()=>context,connectorRuntimeServices:()=>{throw Error('Unexpected activation');}},
    };
    const exports:{connectorAccount?:()=>Promise<{subject:string;service:ConnectorAccountService}>}={};
    const source=await readFile('lib/scamwin/connectors/account-server.ts','utf8');
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>{if(!(name in dependencies))throw Error(`Unexpected dependency ${name}`);return dependencies[name];},process:{env:environment},fetch:transport,AbortSignal});
    const account=await exports.connectorAccount!();
    assert.equal(account.subject,'owner');
    const card=await account.service.disconnect(account.subject,connection.id,connection.epoch);
    assert.equal(card.status,'disconnected');
    assert.equal(remoteCalls,1,'Account disconnect must revoke the saved Teams subscription');
    assert.ifError(transportError);
    await assert.rejects(teams.receive({value:[{subscriptionId:'saved-subscription',clientState:'s'.repeat(43),tenantId:selected.tenantId,resource:'chats/chat-1/messages/123',changeType:'created',resourceData:{id:'123','@odata.type':'#Microsoft.Graph.chatMessage'}}]},true));
    assert.equal(Number((await fixture.database.query('SELECT count(*) AS n FROM connector_teams_events')).rows[0].n),0);
    assert.equal(Number((await fixture.database.query('SELECT count(*) AS n FROM connector_items')).rows[0].n),0);
  }finally{await fixture.close();}
});
