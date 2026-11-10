'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Empty,Loading,Notice,SearchBox,useBootstrap} from './core';
import type {BoundedPage} from '@/lib/scamwin/connectors/contracts';

// Unlike the check Gate, connector reads must remain available during a main-worker outage.
export function AccountAccess({children}:{children:ReactNode}){
 const {data,error,reload}=useBootstrap();
 if(error)return <Notice title="Account status unavailable" error>{error}<Button className="sw-btn sw-btn-outline" onClick={reload}>Try again</Button></Notice>;
 if(!data)return <Loading label="Checking account access…"/>;
 if(!data.user)return <Empty title="Sign in to manage connected apps" action={<a className="sw-btn sw-btn-primary" href={data.loginHref||'/auth/login?returnTo=/account/connections'}>Sign in</a>}>Connections, alerts and activity belong to your account. Manual checks are available at New check.</Empty>;
 return children;
}
export function usePrivatePage<T extends {items:unknown[];nextCursor:string|null}>(kind:string,selectors:Record<string,string>={}){
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[cursors,setCursors]=useState<(string|undefined)[]>([undefined]),[data,setData]=useState<T|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[version,setVersion]=useState(0);
 const sequence=useRef(0);const before=cursors.at(-1);const page=cursors.length;const selection=JSON.stringify(selectors);
 useEffect(()=>{const seq=++sequence.current,controller=new AbortController();
  const timer=setTimeout(async()=>{setBusy(true);setError('');try{
   const response=await fetch(`/api/scamwin/${kind}`,{method:'POST',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(selection),query,filter,...(before?{before}:{})})});
   const body=await response.json();if(seq!==sequence.current)return;if(!response.ok)throw new Error(body.error||'Private records could not be loaded.');
   if(!body.items.length&&page>1){setCursors(c=>c.slice(0,-1));return;}setData(body);
  }catch(e){if(seq===sequence.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Private records could not be loaded.');}
  finally{if(seq===sequence.current)setBusy(false);}},query?300:0);
  return()=>{sequence.current=seq+1;clearTimeout(timer);controller.abort();};
 },[kind,selection,query,filter,before,page,version]);
 return {query,filter,data,error,busy,page,setQuery:(v:string)=>{if(v===query&&page===1)return;setBusy(true);setQuery(v);setCursors([undefined]);},setFilter:(v:string)=>{if(v===filter&&page===1)return;setBusy(true);setFilter(v);setCursors([undefined]);},reload:()=>{setBusy(true);setVersion(v=>v+1);},previous:()=>{if(page===1)return;setBusy(true);setCursors(c=>c.slice(0,-1));},next:()=>{if(data?.nextCursor){setBusy(true);setCursors(c=>[...c,data.nextCursor!]);}}};
}
export function PrivateToolbar({state,label,filters}:{state:ReturnType<typeof usePrivatePage<BoundedPage<unknown>>>;label:string;filters:[string,string][]}){return <div className="sw-list-toolbar"><SearchBox value={state.query} onChange={state.setQuery} label={label}/><div className="sw-private-filters" aria-label="Filter records">{filters.map(([value,label])=><button key={value} aria-pressed={state.filter===value} onClick={()=>state.setFilter(value)}>{label}</button>)}</div></div>;}
export function PrivateFeedback({state}:{state:{busy:boolean;error:string;data:unknown;reload:()=>void}}){return <>{state.error&&<Notice title="Private records unavailable" error>{state.error} Previous records may be out of date. <Button className="sw-btn sw-btn-outline" onClick={state.reload}>Try again</Button></Notice>}{state.busy&&<Loading label="Updating private records…"/>}</>;}
export function PrivatePagination({state}:{state:{busy:boolean;page:number;data:{items:unknown[];nextCursor:string|null}|null;previous:()=>void;next:()=>void}}){return <nav className="sw-pagination" aria-label="Private records pages"><span>{state.data?.items.length||0} records on this page · up to 20 per page</span><div><Button className="sw-btn sw-btn-outline" disabled={state.busy||state.page===1} onClick={state.previous}>Previous</Button><span aria-current="page">Page {state.page}</span><Button className="sw-btn sw-btn-outline" disabled={state.busy||!state.data?.nextCursor} onClick={state.next}>Next</Button></div></nav>;}
