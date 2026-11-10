'use client';
import Link from 'next/link';
import {useEffect,useState,useTransition} from 'react';
import {Button} from '@/components/ui/button';
import {setPrivateAlertReadAction,savePrivateAlertPreferenceAction} from '@/app/scamwin/notification-actions';
import {connectorStateLabel} from '@/lib/scamwin/connectors/ui';
import type {PrivateAlertPage} from '@/lib/scamwin/connectors/notification-ui';
import {DeviceNotifications} from './device-notifications';
import {Badge,Empty,Notice,PageHead,dateLabel} from './core';
import {AccountAccess,PrivateFeedback,PrivatePagination,PrivateToolbar,usePrivatePage} from './private-list';
export function PrivateAlerts(){return <><PageHead eyebrow="Private by default" title="Private alerts." description="Result, coverage and connection updates for your account. An alert is not a safety verdict."/><AccountAccess><AlertsList/></AccountAccess></>;}
function AlertsList(){const state=usePrivatePage<PrivateAlertPage>('alerts'),[error,setError]=useState(''),[message,setMessage]=useState('');const [pending,start]=useTransition();
 useEffect(()=>{window.dispatchEvent(new Event('scamwin-alerts-changed'));},[state.data?.unreadCount]);
 function preference(allResults:boolean){start(async()=>{setError('');try{const r=await savePrivateAlertPreferenceAction({allResults});if(r.ok){setMessage(allResults?'All results enabled. Complete results also create private alerts.':'Actionable alerts enabled. Risk, gaps, delays and connection issues still appear.');state.reload();}else setError(r.error);}catch{setError('Alert preference could not be saved. Your saved choice remains active.');}});}
 return <>
 <section className="sw-panel sw-section"><h2>Alert preferences</h2><p>Risk, coverage gaps, quota delays and reconnect notices are on by default.</p><label className="sw-consent"><input type="checkbox" checked={state.data?.allResults??false} disabled={pending||state.busy||!state.data} onChange={e=>preference(e.target.checked)}/>Also alert me about every completed result</label>{message&&<p role="status">{message}</p>}<DeviceNotifications/></section>
 <PrivateToolbar state={state} label="Search alert kind or reason" filters={[["all","All"],["unread","Unread"],["read","Read"]]}/><PrivateFeedback state={state}/>{error&&<Notice title="Alert could not be updated" error>{error}</Notice>}
 {!state.busy&&state.data&&!state.data.items.length&&<Empty title={state.query||state.filter!=='all'?'No matching alerts':'No private alerts yet'}>Updates appear here when connected items are processed. Check your connection readiness in Connected apps.</Empty>}
 <div className="sw-panel sw-private-records" aria-busy={state.busy}>{state.data?.items.map(a=><article key={a.id}><div className="sw-section-head"><h2>{connectorStateLabel(a.reason)}</h2><Badge value={a.seenAt?'read':'unread'}/></div><p>{connectorStateLabel(a.kind)} · {dateLabel(a.createdAt)}</p>{a.revisionId&&<p>Checked {a.counts.checked} / {a.counts.discovered} targets · {a.counts.pending} pending · {a.counts.unsupported} unsupported</p>}<div className="sw-safe-links"><Link className="sw-text-link" href={a.itemId?`/account/connections/${encodeURIComponent(a.connectionId)}/items/${encodeURIComponent(a.itemId)}`:`/account/connections/${encodeURIComponent(a.connectionId)}`}>{a.itemId?'Inspect source and checks':'Inspect connection'}</Link><Button className="sw-btn sw-btn-outline" disabled={pending||state.busy} onClick={()=>start(async()=>{setError('');try{const r=await setPrivateAlertReadAction({id:a.id,expectedRevision:a.revision,read:!a.seenAt});if(r.ok)state.reload();else setError(r.error);}catch{setError('Read status could not be saved. Try again.');}})}>{a.seenAt?'Mark as unread':'Mark as read'}</Button></div></article>)}</div><PrivatePagination state={state}/>
 </>;}
