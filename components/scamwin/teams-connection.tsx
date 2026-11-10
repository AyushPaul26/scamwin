'use client';
import {startTransition,useActionState,useEffect,useId,useRef,useState,useTransition} from 'react';
import {Controller,useForm,useWatch} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {Button} from '@/components/ui/button';
import {Field,FieldError,FieldGroup,FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {teamsStatusAction,discoverTeamsChatsAction,saveTeamsSettingsAction,importTeamsMessageAction} from '@/app/scamwin/teams-actions';
import {teamsFormSchema,teamsMessageInput,type TeamsMessageValues,type TeamsSettingsValues,type TeamsSetupStatus,type TeamsResourceChoice} from '@/lib/scamwin/connectors/teams-ui';
import {Notice} from './core';

/** The Account connection remains the single dataset; this section owns only selected Teams resources and their settings. */
export function TeamsConnectionSetup(props:{connectionId:string;epoch:number;onSaved?:()=>void}){return <TeamsSetup key={`${props.connectionId}:${props.epoch}`} {...props}/>;}
function TeamsSetup({connectionId,epoch,onSaved}:{connectionId:string;epoch:number;onSaved?:()=>void}){
 const id=useId(),[status,setStatus]=useState<TeamsSetupStatus|null>(null),[choices,setChoices]=useState<TeamsResourceChoice[]>([]),[page,setPage]=useState<string|null>(null),[error,setError]=useState(''),[loading,transition]=useTransition();
 const current=useRef({active:true,version:0});
 const form=useForm<TeamsSettingsValues>({resolver:zodResolver(teamsFormSchema),defaultValues:{id:connectionId,epoch,scope:[],mode:'manual',contains:'',consent:false,paused:false,automaticDailyLimit:1}});
 const mode=useWatch({control:form.control,name:'mode'});
 useEffect(()=>{
  const generation={active:true,version:0};current.current=generation;
  teamsStatusAction({id:connectionId,epoch}).then(result=>{
   if(!generation.active||generation.version!==0)return;
   if(!result.ok){setError(result.error);return;}
   setStatus(result.data);setChoices(result.data.resources);form.reset({id:connectionId,epoch:result.data.epoch,scope:result.data.resources.filter(r=>r.selected).map(r=>r.handle),mode:result.data.mode,contains:result.data.contains,consent:false,paused:result.data.paused,automaticDailyLimit:result.data.automaticDailyLimit});
  }).catch(()=>{if(generation.active&&generation.version===0)setError('Teams setup could not load. Refresh to retry.');});
  return()=>{generation.active=false;};
 },[connectionId,epoch,form]);
 const [saved,dispatch,pending]=useActionState(async(_previous:{ok:boolean;error?:string}|null,values:TeamsSettingsValues)=>{
  const generation=current.current,version=generation.version;
  try{
   const result=await saveTeamsSettingsAction(values);if(!generation.active||generation.version!==version)return null;
   if(!result.ok)return {ok:false,error:result.error};generation.version++;
   form.reset({...values,epoch:result.data.epoch,consent:false});setStatus(previous=>previous?{...previous,...result.data,contains:values.contains,subscriptions:0,resources:choices.map(c=>({...c,selected:values.scope.includes(c.handle)}))}:previous);setError('');setPage(null);onSaved?.();
   return {ok:true,error:result.data.cleanupPending?'Saved locally. Removing old subscriptions is pending; permission remains limited to this saved selection.':undefined};
  }catch{return {ok:false,error:'Teams settings could not be saved. Your selections are preserved.'};}
 },null);
 function reload(){const generation=current.current,version=generation.version;transition(async()=>{try{const result=await teamsStatusAction({id:connectionId,epoch:form.getValues('epoch')});if(!generation.active||generation.version!==version)return;if(!result.ok){setError(result.error);return;}if(!status){setChoices(result.data.resources);form.reset({id:connectionId,epoch:result.data.epoch,scope:result.data.resources.filter(r=>r.selected).map(r=>r.handle),mode:result.data.mode,contains:result.data.contains,consent:false,paused:result.data.paused,automaticDailyLimit:result.data.automaticDailyLimit});}setStatus(result.data);setError('');}catch{if(generation.active&&generation.version===version)setError('Teams setup could not load. Refresh to retry.');}});}
 function discover(more=false){const generation=current.current,version=generation.version;transition(async()=>{
  try{const result=await discoverTeamsChatsAction({id:connectionId,epoch:form.getValues('epoch'),...(more&&page?{pageHandle:page}:{})});if(!generation.active||generation.version!==version)return;if(!result.ok){setError(result.error);return;}
   setChoices(previous=>{const merged=new Map(previous.map(c=>[c.handle,c]));for(const choice of result.data.items)merged.set(choice.handle,choice);return [...merged.values()];});setPage(result.data.nextHandle);setError('');
  }catch{if(generation.active&&generation.version===version)setError('Permitted chats could not load. Try again.');}
 });}
 const busy=loading||pending,enabled=!!status?.enabled;
 return <section aria-label="Teams selected chat setup">
  <p>Read messages from chats you choose in your Microsoft work or school account. Microsoft’s delegated Chat.Read permission can read your chats; Scamwin applies the smaller saved chat selection.</p>
  <p>Channels, resource-specific installations, personal accounts and cross-tenant chats are unavailable. Hosted images and files are metadata only. Automatic checking needs an accepted subscription and recovery pilot.</p>
  <p role="status">{!status?error?'Teams status unavailable.':'Loading Teams setup…':`${status.resources.filter(r=>r.selected).length} selected chats · ${status.subscriptions} saved subscriptions. This does not mean every message was checked.`}</p>
  <div className="sw-safe-links"><Button className="sw-btn sw-btn-outline" type="button" disabled={busy||!enabled} onClick={()=>discover()} aria-busy={loading}>Find permitted chats</Button><Button className="sw-btn sw-btn-outline" type="button" disabled={busy} onClick={reload}>Refresh Teams status</Button>{page&&<Button className="sw-btn sw-btn-outline" type="button" disabled={busy} onClick={()=>discover(true)}>More permitted chats</Button>}</div>
  {error&&<Notice title="Teams setup unavailable" error>{error}</Notice>}
  <form noValidate onSubmit={form.handleSubmit(values=>startTransition(()=>dispatch(values)))}><FieldGroup>
   <Field><fieldset disabled={busy||!enabled} aria-describedby={`${id}-scope-help ${id}-scope-error`}><legend>Selected chats</legend><p id={`${id}-scope-help`}>{choices.length?'Only checked chats are eligible for import.':'No chats selected. Find permitted chats to choose a source.'}</p>
    {choices.map(choice=><label className="sw-consent" key={choice.handle}><input type="checkbox" {...form.register('scope')} value={choice.handle} aria-invalid={!!form.formState.errors.scope} aria-describedby={`${id}-scope-error`}/>{choice.label}</label>)}
   </fieldset><FieldError id={`${id}-scope-error`} errors={[form.formState.errors.scope]}/></Field>
   <Field><FieldLabel htmlFor={`${id}-mode`}>Teams selection mode</FieldLabel><select id={`${id}-mode`} {...form.register('mode')} disabled={busy||!enabled}><option value="manual">Manual</option><option value="selective" disabled={!status?.automaticEnabled}>Selective automatic</option><option value="all_new" disabled={!status?.automaticEnabled}>All new items</option></select></Field>
   {mode==='selective'&&<Field><FieldLabel htmlFor={`${id}-contains`}>Matching phrases (one per line)</FieldLabel><textarea className="resize-none" id={`${id}-contains`} rows={3} {...form.register('contains')} disabled={busy} aria-invalid={!!form.formState.errors.contains} aria-describedby={`${id}-contains-error`}/><FieldError id={`${id}-contains-error`} errors={[form.formState.errors.contains]}/></Field>}
   <Field><FieldLabel htmlFor={`${id}-limit`}>Your daily automatic maximum</FieldLabel><select id={`${id}-limit`} {...form.register('automaticDailyLimit',{valueAsNumber:true})} disabled={busy||!enabled}><option value={1}>1 per day</option><option value={2}>2 per day</option></select></Field>
   <Field><label className="sw-consent"><input type="checkbox" {...form.register('paused')} disabled={busy||!enabled}/>Pause new Teams imports</label></Field>
   <Field><label className="sw-consent"><input type="checkbox" {...form.register('consent')} disabled={busy||!enabled} aria-invalid={!!form.formState.errors.consent} aria-describedby={`${id}-consent-error`}/>I confirm the selected chats and AI processing. All new items includes routine messages and all senders in this selection. Context is kept up to 30 days and bounded activity up to 90 days. Nothing is automatically published.</label><FieldError id={`${id}-consent-error`} errors={[form.formState.errors.consent]}/></Field>
  </FieldGroup>{saved&&<Notice title={saved.ok?'Teams settings saved':'Teams settings were not saved'} error={!saved.ok}>{saved.error??'Coverage starts at the saved boundary. Subscription gaps remain visible; no older chat history was imported.'}</Notice>}
  <Button className="sw-btn sw-btn-primary" type="submit" disabled={busy||!enabled} aria-busy={pending}>{pending?'Saving…':'Save Teams settings'}</Button></form>
  {status&&<TeamsManualMessage key={status.epoch} connectionId={connectionId} epoch={status.epoch} resources={status.resources.filter(r=>r.selected)} disabled={busy||!enabled||status.paused}/>}
 </section>;
}
function TeamsManualMessage({connectionId,epoch,resources,disabled}:{connectionId:string;epoch:number;resources:TeamsResourceChoice[];disabled:boolean}){
 const id=useId(),alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const form=useForm<TeamsMessageValues>({resolver:zodResolver(teamsMessageInput),defaultValues:{id:connectionId,epoch,resourceHandle:resources[0]?.handle??'',messageLink:''}});
 const [result,dispatch,pending]=useActionState(async(_previous:{ok:boolean;error?:string}|null,values:TeamsMessageValues)=>{try{const saved=await importTeamsMessageAction(values);if(!alive.current)return null;if(!saved.ok)return {ok:false,error:saved.error};form.reset({...values,messageLink:''});return {ok:true};}catch{return {ok:false,error:'This message could not be imported. Your link is preserved.'};}},null);
 return <form noValidate onSubmit={form.handleSubmit(values=>startTransition(()=>dispatch(values)))} aria-label="Import selected Teams message"><h3>Check one selected message</h3><p>Copy its message link in Teams and choose the saved chat. Only that exact message is fetched; recent chat bodies are not listed or cached.</p><FieldGroup>
  <Field><FieldLabel htmlFor={`${id}-chat`}>Saved chat</FieldLabel><select id={`${id}-chat`} {...form.register('resourceHandle')} disabled={disabled||pending||!resources.length} aria-invalid={!!form.formState.errors.resourceHandle} aria-describedby={`${id}-chat-error`}><option value="">Choose a saved chat</option>{resources.map(r=><option value={r.handle} key={r.handle}>{r.label}</option>)}</select><FieldError id={`${id}-chat-error`} errors={[form.formState.errors.resourceHandle]}/></Field>
  <Field><FieldLabel htmlFor={`${id}-link`}>Teams message link</FieldLabel><Controller control={form.control} name="messageLink" render={({field,fieldState})=><Input id={`${id}-link`} {...field} disabled={disabled||pending||!resources.length} autoComplete="off" aria-invalid={fieldState.invalid} aria-describedby={`${id}-link-error`}/>}/><FieldError id={`${id}-link-error`} errors={[form.formState.errors.messageLink]}/></Field>
 </FieldGroup>{result&&<Notice title={result.ok?'Selected message imported':'Message was not imported'} error={!result.ok}>{result.ok?<>Preparation is queued. <a className="sw-text-link" href={`/account/connections/${encodeURIComponent(connectionId)}`}>Open the source inbox</a> to see coverage.</>:result.error}</Notice>}<Button className="sw-btn sw-btn-outline" type="submit" disabled={disabled||pending||!resources.length} aria-busy={pending}>{pending?'Importing…':'Import selected message'}</Button></form>;
}
