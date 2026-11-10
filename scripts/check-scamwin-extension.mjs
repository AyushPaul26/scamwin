import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {captureVisiblePage} from '../extensions/scamwin/src/capture.mjs';
const root=process.cwd(),extension=path.join(root,'extensions/scamwin');
const output=path.join(root,'.superpowers/sdd/2026-11-10-scamwin-connected-apps/task-12c-artifacts');
await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.host_permissions,['https://scamwin.vercel.app/*']);assert.ok(!manifest.content_scripts);assert.ok(!manifest.externally_connectable);assert.ok(!manifest.web_accessible_resources);
const context=await chromium.launchPersistentContext(path.join(output,`profile-${Date.now()}`),{headless:true,channel:'chromium',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const errors=[];let assertions=5;
try{
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  let [worker]=context.serviceWorkers();if(!worker)worker=await context.waitForEvent('serviceworker',{timeout:15000});const id=new URL(worker.url()).hostname;
  await context.route('https://scamwin.vercel.app/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>.hidden{display:none}</style><h1>Visible offer</h1><p>Pay only after checking.</p><input value="PRIVATE_INPUT"><textarea>PRIVATE_TEXTAREA</textarea><form>PRIVATE_PAYMENT<label>Card<input value="4111111111111111"></label></form><div contenteditable>PRIVATE_EDITABLE</div><p class="hidden">PRIVATE_HIDDEN</p><a href="https://example.com/pay">Public destination</a><a href="javascript:alert(1)">Bad protocol</a><script>window.pageScriptExecuted=true;window.postMessage({action:"setServer",origin:"https://attacker.com",grant:"stolen"},"*");</script>'}));
  const page=await context.newPage();await page.goto('https://scamwin.vercel.app/extension-fixture');await page.bringToFront();
  // Deliberately exercise the collector directly in Chrome's isolated world on an intercepted fixture.
  // This does not grant a source site or claim to automate the native toolbar permission gesture.
  const result=await worker.evaluate(`(async()=>{const captureVisiblePage=${captureVisiblePage.toString()};const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});return chrome.scripting.executeScript({target:{tabId:tabs[0].id,frameIds:[0]},world:'ISOLATED',func:captureVisiblePage});})()`);
  assert.equal(result.length,1);assert.equal(result[0].frameId,0);const captured=result[0].result;assert.match(captured.text,/Visible offer/);assert.ok(!captured.text.includes('PRIVATE_'));assert.ok(!captured.text.includes('4111111111111111'));assert.deepEqual(captured.urls,['https://example.com/pay']);assertions+=6;
  const state=await worker.evaluate(async()=>chrome.storage.local.get('state'));assert.equal(state.state?.grant,undefined);assertions++;

  // Test the popup's genuine renderer at narrow width. A tab is intentionally not a trusted popup sender.
  const popup=await context.newPage();await popup.setViewportSize({width:360,height:850});await popup.goto(`chrome-extension://${id}/src/popup.html`);await popup.getByRole('heading',{name:'Check this page'}).waitFor();const rejected=await popup.evaluate(()=>chrome.runtime.sendMessage({action:'capture'}));assert.equal(rejected.error,'Untrusted extension message');assertions++;assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assertions++;await popup.screenshot({path:path.join(output,'popup-360.png'),fullPage:true});
  // Native action.openPopup opens the actual popup surface where supported; no user profile is used.
  await page.bringToFront();await worker.evaluate(()=>chrome.action.openPopup()).catch(()=>{});const tabSession=await context.newCDPSession(popup),tabTarget=(await tabSession.send('Target.getTargetInfo')).targetInfo.targetId;const session=await context.newCDPSession(page);const nativeTarget=(await session.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/src/popup.html`&&t.targetId!==tabTarget);assert.ok(nativeTarget);const {sessionId}=await session.send('Target.attachToTarget',{targetId:nativeTarget.targetId,flatten:false});let commandId=0;
  async function nativeCommand(method,params={}){const messageId=++commandId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{session.off('Target.receivedMessageFromTarget',listener);reject(Error('native_popup_timeout'));},5000);const listener=e=>{if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.id!==messageId)return;clearTimeout(timer);session.off('Target.receivedMessageFromTarget',listener);if(m.error)reject(Error(m.error.message));else resolve(m.result);};session.on('Target.receivedMessageFromTarget',listener);session.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:messageId,method,params})}).catch(reject);});}
  const nativeResult=await nativeCommand('Runtime.evaluate',{expression:`(async()=>{for(let n=0;n<40&&!document.querySelector('#status').textContent.includes('Pair this browser to start');n++)await new Promise(r=>setTimeout(r,50));document.querySelector('#pairing').open=true;document.querySelector('#pair').click();for(let n=0;n<40&&document.querySelector('#ticket').value.length!==76;n++)await new Promise(r=>setTimeout(r,50));return {width:innerWidth,ticket:document.querySelector('#ticket').value,disabled:document.querySelector('#capture').disabled};})()`,awaitPromise:true,returnByValue:true,userGesture:true});assert.ok(nativeResult.result.value.width>=320,'Native popup has readable width');assert.match(nativeResult.result.value.ticket,new RegExp(`^${id}\\.[A-Za-z0-9_-]{43}$`));assert.equal(nativeResult.result.value.disabled,true);assertions+=4;const shot=await nativeCommand('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'native-popup-pairing.png'),Buffer.from(shot.data,'base64'));await session.send('Target.closeTarget',{targetId:nativeTarget.targetId});await session.detach();await tabSession.detach();

  assert.deepEqual(errors,[]);assertions++;
  console.log(JSON.stringify({ok:true,assertions,extensionId:id,evidence:output,limits:'Synthetic fixture only. Native manual activeTab and permission grant/revoke still require the authorized unpacked/Edge pilot.'}));
}finally{await context.close();}
