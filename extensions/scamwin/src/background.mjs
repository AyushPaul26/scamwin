import {createExtensionController} from './controller.mjs';
const controller=createExtensionController(chrome);
chrome.runtime.onMessage.addListener((message,sender,respond)=>{controller.message(message,sender).then(respond,error=>respond({error:error.message}));return true;});
// No external listener, content-script receiver, page postMessage bridge, timer, or page-body offline queue.
const capture=()=>controller.capture('automatic').catch(()=>{});
chrome.tabs.onActivated.addListener(capture);
chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.status==='complete')capture();});
chrome.windows.onFocusChanged.addListener(id=>{if(id!==chrome.windows.WINDOW_ID_NONE)capture();});
chrome.permissions.onRemoved.addListener(()=>controller.permissionsRemoved().catch(()=>{}));
