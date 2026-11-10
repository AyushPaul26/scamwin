'use client';
import {startTransition,useActionState,useEffect,useId,useRef,useState,useTransition} from 'react';
import {useForm,useWatch} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import type {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Field,FieldError,FieldGroup,FieldLabel} from '@/components/ui/field';
import {beginTelegramLinkAction,telegramStatusAction,saveTelegramSettingsAction} from '@/app/scamwin/telegram-actions';
import {telegramFormSchema,telegramSetupLabels} from '@/lib/scamwin/connectors/telegram-ui';
import {Notice} from './core';
type Status=Awaited<ReturnType<typeof telegramStatusAction>>;
type Values=z.infer<typeof telegramFormSchema>;

export function TelegramConnectionSetup({connectionId,epoch,onSaved}:{connectionId:string;epoch:number;onSaved?:()=>void}){
 const [status,setStatus]=useState<Status|null>(null),[refreshing,refresh]=useTransition(),[error,setError]=useState(''),[deepLink,setDeepLink]=useState<{deepLink:string;expiresAt:string}|null>(null),id=useId();
 const generation=useRef({version:0,active:true});
 const [identity,setIdentity]=useState({id:connectionId,epoch});
 if(identity.id!==connectionId||identity.epoch!==epoch){setIdentity({id:connectionId,epoch});setStatus(null);setDeepLink(null);setError('');}
 const form=useForm<Values>({resolver:zodResolver(telegramFormSchema),defaultValues:{id:connectionId,epoch,mode:'manual',contains:'',consent:false,paused:false,automaticDailyLimit:1}});
 const mode=useWatch({control:form.control,name:'mode'});
 useEffect(()=>{
  const current={version:0,active:true};generation.current=current;
  form.reset({id:connectionId,epoch,mode:'manual',contains:'',consent:false,paused:false,automaticDailyLimit:1});
  telegramStatusAction({id:connectionId,epoch}).then(result=>{
   if(!current.active||current.version!==0)return;
   setStatus(result);
   if(result.ok)form.reset({id:connectionId,epoch:result.data.epoch,mode:result.data.mode,paused:result.data.paused,contains:result.data.contains,automaticDailyLimit:result.data.automaticDailyLimit,consent:false});
  }).catch(()=>{if(current.active&&current.version===0)setError('Connection status is unavailable. Refresh status to retry.');});
  return()=>{current.active=false;};
 },[connectionId,epoch,form]);
 const [saved,dispatch,pending]=useActionState(async(_previous:{ok:boolean;error?:string}|null,values:Values)=>{
  const current=generation.current,version=current.version;
  try{
   const result=await saveTelegramSettingsAction(values);
   if(!current.active||version!==current.version)return {ok:false,error:'The connection changed while saving. Refresh status before continuing.'};
   if(result.ok){
    current.version++;
    form.reset({...values,epoch:result.data.epoch,mode:result.data.mode,paused:result.data.paused,consent:false});
    setStatus(previous=>previous?.ok?{ok:true,data:{...previous.data,...result.data,contains:values.contains,automaticDailyLimit:values.automaticDailyLimit}}:previous);
    setDeepLink(null);setError('');onSaved?.();return {ok:true};
   }
   return {ok:false,error:result.error};
  }catch{return {ok:false,error:'Settings could not be saved. Your selections are preserved.'};}
 },null);
 function reload(){const current=generation.current,version=current.version;refresh(async()=>{try{const result=await telegramStatusAction({id:form.getValues('id'),epoch:form.getValues('epoch')});if(!current.active||version!==current.version)return;setStatus(result);if(result.ok)setError('');}catch{if(current.active&&version===current.version)setError('Connection status is unavailable. Try again.');}});}
 function link(){const current=generation.current,version=current.version;setError('');refresh(async()=>{try{const result=await beginTelegramLinkAction({id:form.getValues('id'),epoch:form.getValues('epoch')});if(!current.active||version!==current.version)return;if(result.ok)setDeepLink(result.data);else setError(result.error);}catch{if(current.active&&version===current.version)setError('Bot linking could not start. Try again.');}});}
 const ready=status?.ok&&status.data.state==='automation_connected',busy=pending||refreshing;
 return <section aria-label="Telegram account automation"><p role="status">{status?.ok?telegramSetupLabels[status.data.state as keyof typeof telegramSetupLabels]:status&&!status.ok?status.error:'Loading Telegram setup…'}</p>
 <p>In Telegram, link the service bot, select it in Chat Automation, and choose the private chats it may receive. Keep reply, delete, mark-as-read, profile and payment permissions off. Message receipt with these minimal permissions still needs the controlled pilot.</p>
 <p>No inbox history or group/channel coverage. Messages delivered during Manual, pauses or service interruptions cannot be recovered. Bot-to-bot coverage remains unverified until a controlled test.</p>
 <div className="sw-safe-links"><Button className="sw-btn sw-btn-outline" type="button" disabled={busy||!status?.ok||!status.data.enabled||status.data.mode!=='manual'} onClick={link}>Link service bot</Button><Button className="sw-btn sw-btn-outline" type="button" disabled={busy} onClick={reload}>{refreshing?'Refreshing…':'Refresh status'}</Button></div>
 {deepLink&&<p><a className="sw-text-link" href={deepLink.deepLink} target="_blank" rel="noreferrer">Open Telegram to link this account</a> · Link expires in 10 minutes.</p>}
 {error&&<Notice title="Telegram setup unavailable" error>{error}</Notice>}
 <form noValidate onSubmit={form.handleSubmit(values=>startTransition(()=>dispatch(values)))}><FieldGroup>
 <Field><FieldLabel htmlFor={`${id}-mode`}>Telegram selection mode</FieldLabel><select id={`${id}-mode`} {...form.register('mode')} disabled={busy||!status?.ok||!status.data.enabled}><option value="manual">Manual</option><option value="selective" disabled={!ready||!status?.ok||!status.data.automaticEnabled}>Selective automatic</option><option value="all_new" disabled={!ready||!status?.ok||!status.data.automaticEnabled}>All new items</option></select></Field>
 {mode==='selective'&&<Field><FieldLabel htmlFor={`${id}-phrases`}>Matching phrases (one per line)</FieldLabel><textarea id={`${id}-phrases`} rows={2} {...form.register('contains')} disabled={busy} aria-invalid={!!form.formState.errors.contains} aria-describedby={`${id}-phrases-error`}/><FieldError id={`${id}-phrases-error`} errors={[form.formState.errors.contains]}/></Field>}
 <Field><FieldLabel htmlFor={`${id}-limit`}>Your daily automatic maximum</FieldLabel><select id={`${id}-limit`} {...form.register('automaticDailyLimit',{valueAsNumber:true})} disabled={busy}><option value={1}>1 per day</option><option value={2}>2 per day</option></select></Field>
 <Field><label className="sw-consent"><input type="checkbox" {...form.register('paused')} disabled={busy}/>Pause new Telegram imports</label></Field>
 <Field><label className="sw-consent"><input type="checkbox" {...form.register('consent')} disabled={busy} aria-invalid={!!form.formState.errors.consent} aria-describedby={`${id}-consent-error`}/>I confirm the private chats chosen in Telegram and AI processing. All new items includes routine messages and bot senders in that scope. Body/context is kept up to 30 days and bounded activity up to 90 days. Nothing is automatically published.</label><FieldError id={`${id}-consent-error`} errors={[form.formState.errors.consent]}/></Field>
 </FieldGroup>{saved&&<Notice title={saved.ok?'Telegram settings saved':'Telegram settings were not saved'} error={!saved.ok}>{saved.ok?'The saved selection applies from the new coverage boundary. Previous gaps remain unavailable.':saved.error}</Notice>}
 <Button className="sw-btn sw-btn-primary" type="submit" disabled={busy||!status?.ok||!status.data.enabled} aria-busy={pending}>{pending?'Saving…':'Save Telegram settings'}</Button></form></section>;
}
