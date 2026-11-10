import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=new URL(process.argv[2]||'http://127.0.0.1:3013');if(base.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw new Error('Local preview required');
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];let checks=0;
const watchdog=setTimeout(()=>{void browser.close();},120000);watchdog.unref();
const connection='11111111-1111-4111-8111-111111111111',item='22222222-2222-4222-8222-222222222222',now='2026-11-10T12:00:00Z';
const counts={discovered:3,checked:1,pending:1,unsupported:1};
const source={id:item,connectionId:connection,epoch:1,state:'partial',latestRevisionId:'revision',receivedAt:now,expiresAt:'2027-02-01T12:00:00Z',counts,coverage:'partial'};
const detail={item:source,provider:'gmail',selectionReason:'user_selected',risk:'high_risk',coverage:'partial',counts,gaps:[{reason:'unsupported_format',count:1}],targets:[{id:'body-0',kind:'text',state:'partial',reason:null,checkHref:'/checks/synthetic-child',risk:'high_risk',generation:1,dueAt:null},{id:'url-0',kind:'url',state:'unavailable',reason:'main_check_unavailable',checkHref:null,risk:null,generation:1,dueAt:null}],context:{text:'Synthetic private source evidence only.',urls:['javascript:alert(1)'],attachmentNames:[],expiresAt:'2026-12-01T12:00:00Z'}};
await mkdir('.superpowers/sdd/2026-11-10-scamwin-connected-apps/task-9-artifacts',{recursive:true});
try{for(const width of [320,375,1440]){
 const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});
 await context.addInitScript(({unsupported})=>{if(unsupported)delete window.PushManager;else{window.__syntheticPermissionRequests=0;Notification.requestPermission=async()=>{window.__syntheticPermissionRequests++;return 'denied';};}},{unsupported:width===320});
 await context.route('**/api/scamwin/bootstrap',r=>r.fulfill({json:{configured:true,user:{name:'Synthetic account fixture',sub:'synthetic-only'},role:'user',readiness:[]}}));
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));let sourceReads=0,fail=false;
 await context.route('**/api/scamwin/sources',r=>{sourceReads++;const input=r.request().postDataJSON();return fail?r.fulfill({status:503,json:{error:'Synthetic interrupted read'}}):r.fulfill({json:input.itemId?detail:{items:[source],nextCursor:null,connection:{id:connection,epoch:1,provider:'gmail',mode:'manual',status:'active'},enabled:true}});});
 await context.route('**/api/scamwin/alerts',r=>r.fulfill({json:{items:[{id:'33333333-3333-4333-8333-333333333333',connectionId:connection,epoch:1,revisionId:'revision',itemId:item,kind:'coverage',reason:'partial',counts,revision:1,seenAt:null,createdAt:now,expiresAt:'2027-02-01T12:00:00Z'}],nextCursor:null,allResults:false,unreadCount:1}}));
 await context.route('**/api/scamwin/push-configuration',r=>r.fulfill({json:{publicKey:'B'.repeat(87)}}));
 await context.route('**/api/scamwin/activity',r=>r.fulfill({json:{items:r.request().postDataJSON().filter==='manual'?[{id:'manual-ref',connectionId:'',epoch:0,kind:'manual',reason:'partial',count:1,createdAt:now,expiresAt:'2026-12-01T12:00:00Z',checkHref:'/checks/synthetic-manual'}]:[],nextCursor:null}}));
 await page.goto(new URL(`/account/connections/${connection}`,base).href,{waitUntil:'domcontentloaded'});
 await page.getByRole('link',{name:'Inspect source and checks',exact:true}).waitFor();
 assert.equal(sourceReads,1);await page.getByRole('button',{name:'List provider metadata',exact:true}).click();
 await page.getByText('Sign in to manage your connected apps.',{exact:true}).waitFor();checks+=2;
 fail=true;await page.getByLabel('Search imported item state').fill('partial');await page.getByText('Synthetic interrupted read',{exact:false}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Inspect source and checks',exact:true}).count(),1,'Previous records remain after a read failure');checks++;
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Inbox fits ${width}`);
 fail=false;await page.getByRole('link',{name:'Inspect source and checks',exact:true}).click();await page.getByRole('heading',{name:'Targets and saved checks'}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Open saved check',exact:true}).count(),1);assert.equal(await page.locator('a[href^="javascript:"]').count(),0);checks+=2;
 await page.screenshot({path:`.superpowers/sdd/2026-11-10-scamwin-connected-apps/task-9-artifacts/source-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Detail fits ${width}`);
 await page.goto(new URL('/account/alerts',base).href,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Mark as read',exact:true}).waitFor();
 if(width===320){await page.getByText('This browser does not support device push in this context. Private alerts still work.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Enable device notifications',exact:true}).isDisabled(),true);}else{await page.getByRole('button',{name:'Enable device notifications',exact:true}).click();await page.getByText('Device notifications are not allowed.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.__syntheticPermissionRequests),1,'Permission only after explicit click');}
 await page.getByRole('button',{name:'Mark as read',exact:true}).click();await page.getByText('Sign in to manage your connected apps.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Mark as read',exact:true}).count(),1);checks+=3;
 if(width!==320){
  let revocationConfirmed=false,revocationRequests=0;
  await page.route('**/account/alerts',r=>{if(!r.request().headers()['next-action'])return r.fallback();revocationRequests++;return revocationConfirmed?r.fulfill({contentType:'text/x-component',body:'0:{"a":{"ok":true,"data":{"registered":false}}}\n'}):r.fulfill({status:503,contentType:'text/plain',body:'Synthetic revocation request failure'});});
  await page.getByRole('button',{name:'Turn off device notifications',exact:true}).click();
  await page.getByText('Device notifications could not be turned off. Try again. Your previous subscriptions may still be active.',{exact:true}).waitFor();assert.equal(revocationRequests,1);assert.equal(await page.getByText('Device notifications are revoked on the server.',{exact:false}).count(),0);
  revocationConfirmed=true;await page.evaluate(()=>{navigator.serviceWorker.getRegistration=async()=>({pushManager:{getSubscription:async()=>({unsubscribe:async()=>{throw new Error('Synthetic browser unsubscribe failure');}})}});});
  await page.getByRole('button',{name:'Retry turning off device notifications',exact:true}).click();await page.getByText('Device notifications are revoked on the server. Browser cleanup could not be confirmed.',{exact:true}).waitFor();assert.equal(revocationRequests,2);checks+=4;
 }else{
  assert.equal(await page.getByRole('button',{name:'Turn off device notifications',exact:true}).isDisabled(),false,'Account-wide revocation remains available on an unsupported browser');
  let revoked=0;await page.route('**/account/alerts',r=>{if(!r.request().headers()['next-action'])return r.fallback();revoked++;return r.fulfill({contentType:'text/x-component',body:'0:{"a":{"ok":true,"data":{"registered":false}}}\n'});});
  await page.getByRole('button',{name:'Turn off device notifications',exact:true}).click();await page.getByText('Device notifications turned off for your account. Private alerts remain available.',{exact:true}).waitFor();assert.equal(revoked,1);checks+=2;
 }
 await page.screenshot({path:`.superpowers/sdd/2026-11-10-scamwin-connected-apps/task-9-artifacts/alerts-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Alerts fit ${width}`);
 await page.goto(new URL('/account/activity',base).href,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Manual check history',exact:true}).click();await page.getByRole('link',{name:'Open saved check',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Open saved check',exact:true}).getAttribute('href'),'/checks/synthetic-manual');checks++;
 await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement?.tagName!=='BODY'));checks++;await context.close();
 }
 assert.deepEqual(errors,[]);console.log(`PASS ${checks} notification/source UI assertions at 320/375/1440. Synthetic read fixtures; real signed-out action rejection. Device delivery not piloted.`);
}finally{clearTimeout(watchdog);await browser.close();}
