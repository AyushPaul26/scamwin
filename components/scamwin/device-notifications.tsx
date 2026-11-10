'use client';
import {useEffect,useState,useSyncExternalStore,useTransition} from 'react';
import {Button} from '@/components/ui/button';
import {registerDevicePushAction,revokeDevicePushAction} from '@/app/scamwin/notification-actions';
const subscribe=()=>()=>{};
function support(){return window.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window?'supported':'unsupported';}
export function DeviceNotifications(){
 const supported=useSyncExternalStore(subscribe,support,()=> 'checking'),[key,setKey]=useState<string|null>(null),[message,setMessage]=useState(''),[revokeUnconfirmed,setRevokeUnconfirmed]=useState(false),[pending,start]=useTransition();
 useEffect(()=>{const controller=new AbortController();fetch('/api/scamwin/push-configuration',{method:'POST',cache:'no-store',signal:controller.signal}).then(async r=>{if(r.ok){const data=await r.json();if(!controller.signal.aborted)setKey(data.publicKey);}}).catch(()=>{});return()=>{controller.abort();};},[]);
 function enable(){
  if(supported!=='supported'||!key)return;
  // Browser permission is requested only in this explicit user gesture.
  const permission=Notification.requestPermission();
  start(async()=>{try{if(await permission!=='granted'){setMessage('Device notifications are not allowed. Private alerts remain available here; change your browser permission to try again.');return;}
   const registration=await navigator.serviceWorker.register('/scamwin-notifications.js',{scope:'/'});await navigator.serviceWorker.ready;
   const bytes=Uint8Array.from(atob(key.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
   const existing=await registration.pushManager.getSubscription(),subscription=existing??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
   const result=await registerDevicePushAction(subscription.toJSON());if(!result.ok){if(!existing)await subscription.unsubscribe();setMessage(result.error);return;}setMessage('Device notifications enabled for this browser. Delivery depends on your browser and connection; private alerts remain available here.');
  }catch{setMessage('Device notifications could not be enabled. Private alerts continue to work. Try again when this browser supports push.');}});
 }
 function revoke(){start(async()=>{
  let result:Awaited<ReturnType<typeof revokeDevicePushAction>>;
  try{result=await revokeDevicePushAction();}catch{setRevokeUnconfirmed(true);setMessage('Device notifications could not be turned off. Try again. Your previous subscriptions may still be active.');return;}
  if(!result.ok){setRevokeUnconfirmed(true);setMessage(`${result.error} Revocation was not confirmed. Try again.`);return;}
  setRevokeUnconfirmed(false);
  // Account-wide revocation is already confirmed. Local cleanup is optional and separate.
  try{if(supported==='supported'){const registration=await navigator.serviceWorker.getRegistration('/scamwin-notifications.js'),subscription=await registration?.pushManager.getSubscription();if(subscription&&!await subscription.unsubscribe())throw new Error('browser_cleanup_unconfirmed');}setMessage('Device notifications turned off for your account. Private alerts remain available.');}catch{setMessage('Device notifications are revoked on the server. Browser cleanup could not be confirmed.');}
 });}
 return <div className="sw-device-notifications"><h3>Optional device notifications</h3><p>Only a generic account update appears on your device. Provider names, subjects, message text, URLs and risk details stay inside your signed-in account.</p>{supported==='unsupported'&&<p>This browser does not support device push in this context. Private alerts still work.</p>}{supported==='supported'&&!key&&<p>Device push is not configured. Private alerts still work.</p>}<div className="sw-safe-links"><Button className="sw-btn sw-btn-outline" disabled={pending||supported!=='supported'||!key} onClick={enable}>{pending?'Updating…':'Enable device notifications'}</Button><Button className="sw-btn sw-btn-outline" disabled={pending} aria-busy={pending} onClick={revoke}>{revokeUnconfirmed?'Retry turning off device notifications':'Turn off device notifications'}</Button></div>{message&&<p role="status">{message}</p>}</div>;
}
