'use client';
import {startTransition,useActionState,useState} from 'react';
import {useForm,Controller} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Field,FieldLabel,FieldError,FieldGroup} from '@/components/ui/field';
import {Alert,AlertDescription} from '@/components/ui/alert';
import {beginExpandedAuthorization} from '@/lib/scamwin/connectors/expanded-actions';
import {discoverSlackConversations,selectSlackConversations} from '@/lib/scamwin/connectors/slack-actions';
const schema=z.object({handles:z.array(z.string().uuid()).min(1,'Choose at least one conversation.').max(50),consent:z.boolean().refine(Boolean,'Confirm your selected conversations.')});
type Values=z.infer<typeof schema>;
/** Mount once within the existing Account connection card; no second account dataset. */
export function SlackConnectionSetup({connection,available=false,onSaved}:{connection?:{id:string;epoch:number};available?:boolean;onSaved?:()=>void}){
 const [resources,setResources]=useState<{handle:string;label:string;kind:string}[]>([]),[nextPage,setNextPage]=useState<string|null>(null);
 const form=useForm<Values>({resolver:zodResolver(schema),defaultValues:{handles:[],consent:false}});
 const [result,dispatch,pending]=useActionState<{error?:string;message?:string},'authorize'|'discover'|'more'|'save'>(async(_previous:{error?:string;message?:string},operation:'authorize'|'discover'|'more'|'save')=>{
  if(operation==='authorize'){const r=await beginExpandedAuthorization({provider:'slack',...(connection?{reconnect:connection}:{})});if(r.ok){window.location.assign(r.authorizationUrl);return {message:'Opening Slack authorization.'};}return {error:r.error};}
  if(!connection)return {error:'Connect Slack before choosing conversations.'};
  if(operation==='discover'||operation==='more'){const r=await discoverSlackConversations({...connection,page:operation==='more'?nextPage:null});if(!r.ok)return {error:r.error};setResources(previous=>operation==='more'?[...previous,...r.resources]:r.resources);setNextPage(r.nextPage);return {message:r.resources.length?'Choose the conversations you want to check.':r.nextPage?'No permitted conversations on this page. Load more conversations to continue.':operation==='more'?'No more permitted conversations found.':'No permitted conversations found. Invite the app in Slack, then refresh.'};}
  const values=form.getValues();const r=await selectSlackConversations({...connection,...values});if(!r.ok)return {error:r.error};onSaved?.();return {message:'Conversations saved. This connection is in Manual.'};
 },{});
 return <section className="sw-stack" aria-label="Slack setup"><p className="sw-muted">Connect a Slack app installation, then choose conversations where the app is a member. This does not connect your whole Slack inbox.</p><p className="sw-muted">Starts in Manual. Automatic checking remains unavailable until workspace coverage is verified.</p>
 {!available&&<p role="status">Slack setup is unavailable. You can still start a manual check.</p>}
 <div className="flex flex-wrap gap-2"><Button disabled={pending||!available} onClick={()=>startTransition(()=>dispatch('authorize'))}>{connection?'Reconnect Slack':'Connect Slack'}</Button>{connection&&<Button variant="outline" disabled={pending||!available} onClick={()=>startTransition(()=>dispatch('discover'))}>Load conversations</Button>}</div>
 {resources.length>0&&<form onSubmit={form.handleSubmit(()=>startTransition(()=>dispatch('save')))}><FieldGroup><Field><FieldLabel>Selected conversations</FieldLabel><Controller control={form.control} name="handles" render={({field})=><div className="grid gap-2">{resources.map(r=><label key={r.handle} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={field.value.includes(r.handle)} disabled={pending} onChange={e=>field.onChange(e.target.checked?[...field.value,r.handle]:field.value.filter(v=>v!==r.handle))} aria-invalid={!!form.formState.errors.handles} aria-describedby="slack-selection-error"/>{r.label}<span className="sw-muted">{r.kind==='public'?'Public channel':r.kind==='private'?'Private channel':'Bot conversation'}</span></label>)}</div>}/><FieldError id="slack-selection-error">{form.formState.errors.handles?.message}</FieldError></Field>
 <Field><Controller control={form.control} name="consent" render={({field})=><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={field.value} disabled={pending} onChange={e=>field.onChange(e.target.checked)} aria-invalid={!!form.formState.errors.consent} aria-describedby="slack-consent-error"/>Allow Scamwin to read items I choose from these conversations.</label>}/><FieldError id="slack-consent-error">{form.formState.errors.consent?.message}</FieldError></Field><div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>Save conversations in Manual</Button></div></FieldGroup></form>}
 {nextPage&&<Button type="button" variant="outline" disabled={pending} onClick={()=>startTransition(()=>dispatch('more'))}>More conversations</Button>}
 {result.error&&<Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert>}{result.message&&<p role="status">{result.message}</p>}</section>;
}

import {Input} from '@/components/ui/input';
import {selectSlackMessage} from '@/lib/scamwin/connectors/slack-actions';
const messageSchema=z.object({permalink:z.string().trim().min(1,'Paste a Slack message link.').max(2000,'This link is too long.')});
/** Explicit Manual source selector; browsing never imports recent conversation bodies. */
export function SlackManualSelection({connection}:{connection:{id:string;epoch:number}}){
 const form=useForm<z.infer<typeof messageSchema>>({resolver:zodResolver(messageSchema),defaultValues:{permalink:''}});
 const [result,dispatch,pending]=useActionState<{error?:string;message?:string;itemId?:string},z.infer<typeof messageSchema>>(async(_previous,values)=>{const r=await selectSlackMessage({...connection,...values});return r.ok?{message:'Message selected. Its private check is queued.',itemId:r.itemId}:{error:`${r.error}${r.retryAfterSeconds?` Wait ${r.retryAfterSeconds} seconds.`:''}`};},{});
 return <form className="sw-stack" onSubmit={form.handleSubmit(values=>startTransition(()=>dispatch(values)))}><FieldGroup><Field><FieldLabel htmlFor={`slack-link-${connection.id}`}>Slack message link</FieldLabel><p className="sw-muted">In a selected Slack conversation, copy the message link. Only that message is selected for this private check.</p><Input id={`slack-link-${connection.id}`} type="url" {...form.register('permalink')} disabled={pending} aria-invalid={!!form.formState.errors.permalink} aria-describedby={`slack-link-error-${connection.id}`} placeholder="https://your-workspace.slack.com/archives/…"/><FieldError id={`slack-link-error-${connection.id}`}>{form.formState.errors.permalink?.message}</FieldError></Field><Button type="submit" disabled={pending}>{pending?'Selecting message…':'Check this Slack message'}</Button></FieldGroup>{result.error&&<Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert>}{result.message&&<p role="status">{result.message}</p>}</form>;
}
