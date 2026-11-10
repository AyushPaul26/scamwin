import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=new URL(process.argv[2]||'http://127.0.0.1:3013');
if(base.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('Local preview required');
const browser=await chromium.launch({channel:'chrome',headless:true});
let checks=0;
try{for(const width of [320,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],submissions=[];
 page.on('pageerror',error=>errors.push(error.message));
 const id='11111111-1111-4111-8111-111111111111';let currentEpoch=1,mode='manual',handoff=false;
 const card={id,epoch:1,provider:'telegram',mode:'manual',status:'active',scope:['identity'],scopeVersion:1,rules:{},activationAt:null,automaticDailyLimit:1,createdAt:'2026-11-10T12:00:00Z',updatedAt:'2026-11-10T12:00:00Z',revision:'fixed-fixture',readiness:'identity_verified',cancellationPending:false};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname==='gc.kis.v2.scr.kaspersky-labs.com')return route.fulfill({contentType:'application/javascript',body:''});
  if(url.pathname==='/api/scamwin/bootstrap')return route.fulfill({json:{configured:true,user:{sub:'synthetic-fixture',name:'Synthetic'},role:'user',readiness:[]}});
  // Keep props/key unchanged when the parent reloads: both saves must use the
  // same mounted component and its locally accepted server epoch.
  if(url.pathname==='/api/scamwin/connections')return route.fulfill({json:{items:[card],nextCursor:null,enabled:true,providers:[]}});
  if(request.method()==='POST'&&request.headers()['next-action']){
   const values=JSON.parse(request.postData())[0];let result;
   if(values.mode){submissions.push(values);if(values.epoch!==currentEpoch)result={ok:false,code:'connection_unavailable',error:'Synthetic stale connection epoch'};else{currentEpoch++;mode=values.mode;result={ok:true,data:{epoch:currentEpoch,mode,paused:values.paused}};}}
   else if(handoff){handoff=false;result={ok:true,data:{deepLink:'https://t.me/scamwin_fixture_bot?start=synthetic_handoff',expiresAt:'2026-11-10T12:10:00Z'}};}
   else result={ok:true,data:{state:'automation_connected',epoch:currentEpoch,mode,paused:false,contains:'',automaticDailyLimit:1,enabled:true,automaticEnabled:true,coverage:'Synthetic private-chat fixture'}};
   return route.fulfill({contentType:'text/x-component',body:`0:${JSON.stringify({a:result})}\n`});
  }
  return route.continue();
 });
 await page.goto(new URL('/account/connections',base).href,{waitUntil:'domcontentloaded'});
 const section=page.getByRole('region',{name:'Telegram account automation'});
 await section.getByText('Chat Automation connected',{exact:true}).waitFor();
 const original=await section.elementHandle();
 handoff=true;await section.getByRole('button',{name:'Link service bot',exact:true}).click();
 await section.getByRole('link',{name:'Open Telegram to link this account',exact:true}).waitFor();
 await section.getByLabel('Telegram selection mode',{exact:true}).selectOption('all_new');
 await section.getByRole('checkbox',{name:/I confirm the private chats/}).check();
 await section.getByRole('button',{name:'Save Telegram settings',exact:true}).click();
 await section.getByText('Telegram settings saved',{exact:true}).waitFor();
 assert.equal(submissions.length,1);assert.equal(submissions[0].epoch,1);checks+=2;
 await section.getByLabel('Telegram selection mode',{exact:true}).selectOption('manual');
 await section.getByRole('button',{name:'Save Telegram settings',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Telegram account automation"] button[type="submit"]')?.textContent==='Save Telegram settings');
 assert.deepEqual(submissions.map(v=>v.epoch),[1,2]);assert.equal(currentEpoch,3);checks+=2;
 assert.equal(await section.getByRole('link',{name:'Open Telegram to link this account',exact:true}).count(),0);checks++;
 assert.equal(await original.evaluate(node=>node.isConnected&&node===document.querySelector('[aria-label="Telegram account automation"]')),true,'No remount between saves');checks++;
 assert.equal(await section.getByText('Synthetic stale connection epoch',{exact:true}).count(),0);checks++;
 await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement?.tagName!=='BODY'));checks++;
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks++;
 assert.deepEqual(errors,[]);checks++;await context.close();
 }
 console.log(`PASS ${checks} Telegram browser assertions at 320/1440: two consecutive saves without remount, accepted epoch, cleared handoff, keyboard and layout. Synthetic authenticated action/read fixtures only; no real account access.`);
}finally{await browser.close();}
