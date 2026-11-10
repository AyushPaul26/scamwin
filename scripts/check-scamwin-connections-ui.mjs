import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
// Every identity, record and grant-readiness label below is a browser-only synthetic fixture.
// Actions reach the real signed-out server; no provider grants or database writes are performed.
const base=new URL(process.argv[2]||'http://127.0.0.1:3013');
if(base.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw new Error('Synthetic checks require local HTTP.');
const output=resolve('.trigger/connections-ui/screenshots');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;const errors=[];
const stamp='2026-11-10T12:00:00.000Z';
const expect=(a,b,message)=>{assert.equal(a,b,message);checks++;};
const fixture=Array.from({length:21},(_,i)=>({id:`synthetic-${21-i}`,provider:i===20?'outlook':'gmail',epoch:1,scopeVersion:1,scope:['inbox'],rules:{},mode:'manual',status:'active',automaticDailyLimit:1,activationAt:null,createdAt:stamp,updatedAt:stamp,revision:stamp,readiness:i===0?'partial_grant':'accepted'}));
try{
 for(const width of [1440,375,320]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(15000);
  let enabled=true,signedIn=true,pendingCancellation=false,reads=[],resourceMetadataRequest=false;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('401 (Unauthorized)'))errors.push(m.text());});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.hostname==='gc.kis.v2.scr.kaspersky-labs.com')return route.fulfill({contentType:'application/javascript',body:'// Environment injection disabled in synthetic UI checks.'});
   if(resourceMetadataRequest&&request.method()==='POST'&&request.headers()['next-action']){
    resourceMetadataRequest=false;
    const result={ok:true,data:{resources:[{handle:'11111111-1111-4111-8111-111111111111',label:'Inbox',selected:false}],partial:false,description:'Synthetic mailbox metadata only.'}};
    return route.fulfill({contentType:'text/x-component',body:`0:${JSON.stringify({a:result})}\n`});
   }
   if(url.pathname==='/api/scamwin/bootstrap')return route.fulfill({json:{configured:true,user:signedIn?{sub:'synthetic-account-fixture',name:'Ayush Synthetic'}:null,role:'user',readiness:[]}});
   if(['/api/scamwin/connections','/api/scamwin/alerts','/api/scamwin/activity'].includes(url.pathname)){
    expect(request.method(),'POST','Private search uses request body');expect(url.search,'','Private search stays out of URL');
    const body=request.postDataJSON();reads.push(body);
    if(url.pathname.endsWith('connections')){
     let items=fixture.map((c,i)=>pendingCancellation&&i===0?{...c,status:'disconnected',epoch:2,cancellationPending:true}:c).filter(c=>(body.filter==='all'||c.status===body.filter)&&(!body.query||`${c.provider} ${c.status} ${c.mode}`.includes(body.query)));
     if(body.query==='old'){await new Promise(r=>setTimeout(r,900));items=[{...fixture[0],id:'synthetic-stale',provider:'outlook'}];}
     if(body.query==='fresh')items=[{...fixture[0],id:'synthetic-fresh',provider:'gmail'}];
     const start=body.before?items.findIndex(c=>c.id===body.before)+1:0;
     const records=items.slice(start,start+20);
     return route.fulfill({json:{items:records,nextCursor:start+20<items.length?records.at(-1).id:null,enabled,providers:[{provider:'gmail',status:'ready',automaticAvailable:true,message:'Synthetic authorization readiness only; no provider connected.'},{provider:'outlook',status:'unavailable',automaticAvailable:false,message:'Synthetic setup fixture: provider authorization is not available yet.'}]}}).catch(()=>{});
    }
    if(url.pathname.endsWith('alerts'))return route.fulfill({json:{items:[{id:'synthetic-alert',connectionId:'synthetic-21',epoch:1,revisionId:'synthetic-revision',kind:'coverage',reason:'unsupported',counts:{checked:0,discovered:1,pending:0,unsupported:1},seenAt:null,createdAt:stamp,expiresAt:'2026-12-10T12:00:00Z'}],nextCursor:null}});
    return route.fulfill({json:{items:['queued','quota_paused','unsupported'].map((reason,i)=>({id:`synthetic-activity-${i}`,connectionId:'synthetic-21',epoch:1,kind:'job',reason,count:1,createdAt:stamp,expiresAt:'2026-12-10T12:00:00Z'})),nextCursor:null}});
   }
   return route.continue();
  });
  await page.goto(new URL('/account/connections',base).href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByText('Read permission incomplete',{exact:true}).waitFor();
  expect(await page.locator('.sw-connection-card').count(),20,'First page contains 20 records');
  await page.getByRole('button',{name:'All',exact:true}).click();await page.waitForTimeout(400);expect(await page.locator('.sw-connection-list').getAttribute('aria-busy'),'false','Selecting active filter must not strand list busy');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width}: document fits`);
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('heading',{name:'Outlook',exact:true}).first().waitFor();
  expect(await page.locator('.sw-connection-card').count(),1,'Second page contains 21st record');
  await page.getByRole('button',{name:'Previous',exact:true}).click();await page.getByText('Read permission incomplete',{exact:true}).waitFor();
  const search=page.getByRole('searchbox',{name:'Search provider, mode or status'});await search.fill('outlook');
  await page.waitForFunction(()=>document.querySelectorAll('.sw-connection-card').length===1&&document.querySelector('.sw-connection-card h2')?.textContent==='Outlook');
  expect(page.url(),new URL('/account/connections',base).href,'Search does not navigate');
  expect(await page.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0,'No private query storage');
  await page.getByRole('button',{name:'Clear search',exact:true}).click();await page.getByText('Read permission incomplete',{exact:true}).waitFor();
  expect(await search.evaluate(el=>document.activeElement===el),true,'Clear restores search focus');
  if(width===375){
   await search.fill('old');await page.waitForTimeout(350);await search.fill('fresh');
   await page.waitForFunction(()=>document.querySelectorAll('.sw-connection-card').length===1&&document.querySelector('.sw-connection-card h2')?.textContent==='Gmail');await page.waitForTimeout(1100);
   expect(await page.locator('.sw-connection-card h2').innerText(),'Gmail','Superseded response cannot replace current query');
   await page.getByRole('button',{name:'Clear search',exact:true}).click();await page.getByText('Read permission incomplete',{exact:true}).waitFor();
  }
  await page.getByRole('button',{name:'Disconnect',exact:true}).first().click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();expect(await dialog.getByRole('button',{name:'Keep connection',exact:true}).isVisible(),true,'Disconnect has correct cancel label');
  expect(await dialog.getByText('Keep check',{exact:true}).count(),0,'No deletion copy in disconnect');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  expect(await page.getByRole('button',{name:'Disconnect',exact:true}).first().evaluate(el=>document.activeElement===el),true,'Escape restores disconnect trigger');
  await page.getByRole('button',{name:'Change mode',exact:true}).first().click();
  resourceMetadataRequest=true;await page.getByRole('button',{name:'Load or refresh resources',exact:true}).click();
  const scope=page.getByRole('checkbox',{name:'Inbox',exact:true});await scope.waitFor();await page.getByRole('button',{name:'Save mode',exact:true}).click();
  expect(await scope.evaluate(el=>document.activeElement===el),true,'First invalid scope receives focus');
  const scopeError=await scope.getAttribute('aria-describedby');expect(scopeError?.includes('-scope-error'),true,'Scope error is associated with the resource choice');await scope.check();
  await page.getByRole('combobox',{name:'Selection mode'}).selectOption('all_new');
  await page.getByRole('button',{name:'Save mode',exact:true}).click();
  await page.getByText('Confirm the scope and AI processing before enabling automatic checks.',{exact:true}).waitFor();
  expect(await page.getByRole('checkbox',{name:/I confirm these app resources/}).isChecked(),false,'Automatic consent starts clear');
  const ids=await page.locator('input[id],select[id],textarea[id]').evaluateAll(nodes=>nodes.map(n=>n.id));expect(new Set(ids).size,ids.length,'Input IDs are unique');
  await page.getByRole('checkbox',{name:/I confirm these app resources/}).check();await page.getByRole('button',{name:'Save mode',exact:true}).click();
  await page.getByRole('dialog').getByText('Sign in to manage your connected apps.',{exact:false}).waitFor();
  expect(await page.getByRole('combobox',{name:'Selection mode'}).inputValue(),'all_new','Failed save preserves values');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Ayush account menu',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('menuitem',{name:'Activity',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.locator('.sw-bell').click();await page.getByRole('heading',{name:'Private alerts.',exact:true}).waitFor();
  await page.getByRole('button',{name:'All',exact:true}).click();await page.waitForTimeout(400);expect(await page.locator('.sw-private-records:visible').getAttribute('aria-busy'),'false','Active alert filter stays ready');
  await page.getByRole('button',{name:'Mark as read'}).click();await page.getByText('Sign in to manage your connected apps.',{exact:true}).waitFor();
  await page.getByRole('navigation',{name:'Account navigation'}).getByRole('link',{name:'Activity',exact:true}).click();
  for(const name of ['Queued','Quota paused','Unsupported item'])await page.getByRole('heading',{name,exact:true}).waitFor();
  await page.getByRole('button',{name:'Connected activity',exact:true}).click();await page.waitForTimeout(400);expect(await page.locator('.sw-private-records:visible').getAttribute('aria-busy'),'false','Active activity filter stays ready');
  expect(await page.getByRole('link',{name:'View My checks',exact:true}).first().getAttribute('href'),'/checks','Existing checks remain canonical');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width}: activity fits`);
  await page.screenshot({path:resolve(output,`activity-${width}.png`),fullPage:true});
  enabled=false;await page.goto(new URL('/account/connections',base).href,{waitUntil:'domcontentloaded'});await page.getByText('Connected apps are paused',{exact:true}).waitFor();
  expect(await page.getByRole('button',{name:'Change mode',exact:true}).first().isDisabled(),true,'Disabled feature prevents new work');expect(await page.getByRole('button',{name:'Disconnect',exact:true}).first().isEnabled(),true,'Disconnect stays available');
  await page.screenshot({path:resolve(output,`connections-${width}.png`),fullPage:true});
  pendingCancellation=true;await page.goto(new URL('/account/connections',base).href,{waitUntil:'domcontentloaded'});
  const retry=page.getByRole('button',{name:'Retry cancellation',exact:true}).first();await retry.waitFor();expect(await retry.isEnabled(),true,'Disconnected pending cancellation remains retryable with feature off');await retry.click();
  await page.getByRole('dialog').getByRole('button',{name:'Retry cancellation',exact:true}).click();await page.getByRole('dialog').getByText('Sign in to manage your connected apps.',{exact:true}).waitFor();
  expect(await page.getByRole('dialog').getByRole('button',{name:'Retry cancellation',exact:true}).isEnabled(),true,'Failed retry remains available');await page.getByRole('dialog').getByRole('button',{name:'Keep disconnected',exact:true}).click();
  signedIn=false;await page.goto(new URL('/account/privacy',base).href,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Private, with clear boundaries',exact:true}).waitFor();
  await page.goto(new URL('/account/connections',base).href,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Sign in to manage connected apps',exact:true}).waitFor();
  expect(reads.some(r=>r.query==='outlook'),true,'Search reached bounded read request');
  await context.close();
 }
 const request=await browser.newContext();
 for(const path of ['connections','alerts','activity']){const response=await request.request.post(new URL(`/api/scamwin/${path}`,base).href,{data:{query:'synthetic-secret',filter:'all'}});expect(response.status(),401,'Real server rejects unauthenticated reads');expect(response.headers()['cache-control'],'private, no-store','Private reads never cache');}
 await request.close();assert.deepEqual(errors,[],'No browser runtime or console errors');
 console.log(JSON.stringify({status:'passed',checks,coverage:'Synthetic Account reads; real signed-out action/read rejection; 320/375/1440; 21-record paging; private search; stale cancellation; keyboard; consent; disconnect; unavailable/partial-grant/queued/quota-paused/unsupported; public privacy.',screenshots:output},null,2));
}finally{await browser.close();}
