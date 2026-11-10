import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Real React/RHF/primitives, with only authenticated server actions replaced.
// A successful parent reload changes the same epoch-based key as Connections.
const bundled=await build({
  stdin:{contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {DiscordConnectionSetup} from './components/scamwin/discord-connection';
    function Fixture(){
      const [epoch,setEpoch]=useState(1);
      return <DiscordConnectionSetup key={epoch} available connection={{id:'11111111-1111-4111-8111-111111111111',epoch}} onSaved={()=>{window.reloads++;setEpoch(e=>e+1);}}/>;
    }
    window.reloads=0;window.selectionCalls=0;window.rejectSelection=true;
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `,resolveDir:process.cwd(),loader:'tsx'},
  bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'authenticated-action-fixture',setup(builder){
    builder.onResolve({filter:/scamwin\/connectors\/(?:discord-actions|expanded-actions)$/},args=>({path:args.path,namespace:'fixture-actions'}));
    builder.onLoad({filter:/.*/,namespace:'fixture-actions'},()=>({contents:`
      export async function beginExpandedAuthorization(){return {ok:false,error:'Authorization fixture does not grant access.'};}
      export async function selectDiscordMessageContexts(value){
        window.selectionCalls++;
        if(value.id!=='11111111-1111-4111-8111-111111111111'||value.epoch!==1||value.contexts[0]!=='server_messages'||value.consent!==true)throw Error('Invalid fixture request');
        if(window.rejectSelection)return {ok:false,error:'Selection could not be saved; retry.'};
        return {ok:true,id:value.id,epoch:2,mode:'manual',installationUrl:'https://discord.com/oauth2/authorize?client_id=100000000000000001&scope=applications.commands&integration_type=1'};
      }
    `,loader:'js'}));
  }}],
});
const browser=await chromium.launch({headless:true,channel:'chromium'});
try{
  const page=await browser.newPage({viewport:{width:375,height:900}}),errors=[];
  page.setDefaultTimeout(5000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://scamwin-fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('https://scamwin-fixture.invalid/');
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  await page.getByLabel('Messages I select in servers',{exact:true}).check();
  await page.getByLabel('Allow Scamwin to save and check the message I select',{exact:false}).check();
  const save=page.getByRole('button',{name:'Save manual message actions',exact:true});
  await save.click();
  await page.getByText('Selection could not be saved; retry.',{exact:true}).waitFor({timeout:5000});
  assert.equal(await page.getByLabel('Messages I select in servers',{exact:true}).isChecked(),true);
  assert.equal(await page.getByRole('link',{name:'Install the message command in Discord'}).count(),0);
  assert.equal(await page.evaluate(()=>window.reloads),0);
  await page.evaluate(()=>{window.rejectSelection=false;});
  await save.click();
  const install=page.getByRole('link',{name:'Install the message command in Discord'});
  await install.waitFor({timeout:5000});
  // Wait for the action's parent callback/render cycle; the link must stay usable.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await install.count(),1,'The install link survives a successful selection save');
  assert.match(await install.getAttribute('href'),/^https:\/\/discord\.com\/oauth2\/authorize\?/);
  assert.equal(await page.evaluate(()=>window.reloads),0,'Do not remount the card before the owner can use the install link');
  assert.equal(await save.isDisabled(),true,'Prevent a second save with the stale connection epoch');
  const refresh=page.getByRole('button',{name:'Refresh connection status',exact:true});
  await refresh.focus();assert.equal(await refresh.evaluate(element=>element===document.activeElement),true);
  await refresh.click();
  await install.waitFor({state:'detached',timeout:5000});
  assert.equal(await page.evaluate(()=>window.reloads),1);
  assert.equal(await page.evaluate(()=>window.selectionCalls),2);
  assert.deepEqual(errors,[]);
  console.log('PASS Discord setup: rejected save preserves choices; successful save retains install link until explicit refresh. Synthetic server actions; no provider authorization.');
}finally{await browser.close();}
