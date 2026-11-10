'use client';
import Link from 'next/link';
import {Bell} from 'lucide-react';
import {useEffect,useState} from 'react';
export function PrivateAlertBell(){
 const [count,setCount]=useState<number|null>(null);
 useEffect(()=>{let controller:AbortController|null=null,sequence=0;function refresh(){controller?.abort();controller=new AbortController();const seq=++sequence;fetch('/api/scamwin/alerts',{method:'POST',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({filter:'unread'})}).then(async r=>{if(r.ok){const data=await r.json();if(seq===sequence&&Number.isInteger(data.unreadCount))setCount(data.unreadCount);}}).catch(()=>{});}refresh();window.addEventListener('focus',refresh);window.addEventListener('scamwin-alerts-changed',refresh);return()=>{sequence++;controller?.abort();window.removeEventListener('focus',refresh);window.removeEventListener('scamwin-alerts-changed',refresh);};},[]);
 return <Link className="sw-bell" href="/account/alerts" aria-label={count===null?'Private alerts':`Private alerts, ${count} unread`}><Bell size={18}/>{count!==null&&count>0&&<span className="sw-bell-count" aria-hidden="true">{count>99?'99+':count}</span>}</Link>;
}
