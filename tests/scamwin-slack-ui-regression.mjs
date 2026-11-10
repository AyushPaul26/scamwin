import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('Slack conversation selection reaches a permitted later page after an empty page and retry',async()=>{
 const bundle=await build({absWorkingDir:process.cwd(),stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import {SlackConnectionSetup} from './components/scamwin/slack-connection';createRoot(document.getElementById('app')).render(<SlackConnectionSetup available connection={{id:'00000000-0000-4000-8000-000000000001',epoch:2}}/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{
  name:'synthetic-server-actions',setup(plugin){
   plugin.onResolve({filter:/\/(slack-actions|expanded-actions)$/},args=>({path:args.path,namespace:'server-action-fixture'}));
   plugin.onLoad({filter:/.*/,namespace:'server-action-fixture'},()=>({loader:'js',contents:`
    let moreAttempts=0;
    export async function beginExpandedAuthorization(){return {ok:false,error:'Unused authorization fixture'};}
    export async function discoverSlackConversations(input){
     if(!input.page)return {ok:true,resources:[],nextPage:'00000000-0000-4000-8000-000000000003'};
     if(input.page!=='00000000-0000-4000-8000-000000000003')throw new Error('Wrong saved page handle');
     if(moreAttempts++===0)return {ok:false,error:'Conversation discovery interrupted. Try again.'};
     return {ok:true,resources:[{handle:'00000000-0000-4000-8000-000000000002',label:'#later-channel',kind:'public'}],nextPage:null};
    }
    export async function selectSlackConversations(input){globalThis.savedSelection=input;return {ok:true};}
    export async function selectSlackMessage(){throw new Error('Unused manual fixture');}
   `}));
  }
 }]});
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:375,height:850}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html><body><main id="app"></main></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('button',{name:'Load conversations',exact:true}).click();
  await page.getByRole('button',{name:'More conversations',exact:true}).waitFor({timeout:1500});
  assert.equal(await page.getByText(/Invite the app in Slack/).count(),0);
  await page.getByRole('button',{name:'More conversations',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByText('Conversation discovery interrupted. Try again.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'More conversations',exact:true}).click();
  await page.getByLabel('#later-channel',{exact:false}).check();
  await page.getByLabel('Allow Scamwin to read items I choose from these conversations.',{exact:true}).check();
  await page.getByRole('button',{name:'Save conversations in Manual',exact:true}).click();
  await page.getByText('Conversations saved. This connection is in Manual.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>globalThis.savedSelection),{id:'00000000-0000-4000-8000-000000000001',epoch:2,handles:['00000000-0000-4000-8000-000000000002'],consent:true});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();}
});
