'use client';
import {startTransition,useActionState,useEffect,useId,useRef,useState,useTransition} from 'react';
import {useForm,useWatch} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {Button} from '@/components/ui/button';
import {Field,FieldError,FieldGroup,FieldLabel} from '@/components/ui/field';
import {driveStatusAction,saveDriveSettingsAction,importDriveFileAction} from '@/app/scamwin/drive-actions';
import {driveFormSchema,driveImportInput,type DriveImportValues,type DriveSettings,type DriveSetupStatus} from '@/lib/scamwin/connectors/drive-ui';
import {Notice} from './core';
export function DriveConnectionSetup(props:{connectionId:string;epoch:number;onSaved?:()=>void}){return <DriveSetup key={`${props.connectionId}:${props.epoch}`} {...props}/>;}
function DriveSetup({connectionId,epoch,onSaved}:{connectionId:string;epoch:number;onSaved?:()=>void}){
 const id=useId(),[status,setStatus]=useState<DriveSetupStatus|null>(null),[error,setError]=useState(''),[loading,transition]=useTransition();const generation=useRef({active:true,version:0});
 const form=useForm<DriveSettings>({resolver:zodResolver(driveFormSchema),defaultValues:{id:connectionId,epoch,scope:[],mode:'manual',contains:'',consent:false,paused:false,automaticDailyLimit:1}}),mode=useWatch({control:form.control,name:'mode'});
 function install(next:DriveSetupStatus){setStatus(next);form.reset({id:connectionId,epoch:next.epoch,scope:next.resources.filter(r=>r.selected).map(r=>r.handle),mode:next.mode,contains:next.contains,consent:false,paused:next.paused,automaticDailyLimit:next.automaticDailyLimit});}
 useEffect(()=>{const current={active:true,version:0};generation.current=current;driveStatusAction({id:connectionId,epoch}).then(result=>{if(!current.active||current.version)return;if(result.ok){setStatus(result.data);form.reset({id:connectionId,epoch:result.data.epoch,scope:result.data.resources.filter(r=>r.selected).map(r=>r.handle),mode:result.data.mode,contains:result.data.contains,consent:false,paused:result.data.paused,automaticDailyLimit:result.data.automaticDailyLimit});}else setError(result.error);}).catch(()=>{if(current.active)setError('Drive setup could not load. Refresh to retry.');});return()=>{current.active=false;};},[connectionId,epoch,form]);
 function refresh(){const current=generation.current,version=current.version;transition(async()=>{try{const result=await driveStatusAction({id:connectionId,epoch:form.getValues('epoch')});if(!current.active||current.version!==version)return;if(result.ok){if(!status)install(result.data);else setStatus(result.data);setError('');}else setError(result.error);}catch{if(current.active&&current.version===version)setError('Drive setup could not load. Your selections are preserved.');}});}
 const [saved,dispatch,pending]=useActionState(async(_previous:{ok:boolean;error?:string}|null,values:DriveSettings)=>{const current=generation.current,version=current.version;try{const result=await saveDriveSettingsAction(values);if(!current.active||current.version!==version)return null;if(!result.ok)return {ok:false,error:result.error};current.version++;form.reset({...values,epoch:result.data.epoch,consent:false});setStatus(previous=>previous?{...previous,...result.data,contains:values.contains,resources:previous.resources.map(r=>({...r,selected:values.scope.includes(r.handle)}))}:previous);setError('');onSaved?.();return {ok:true};}catch{return {ok:false,error:'Drive settings could not be saved. Your selections are preserved.'};}},null);
 const busy=loading||pending,enabled=!!status?.enabled;
 return <section aria-label="Drive selected file setup"><p>In Google Drive, choose a file and use <strong>Open with → Scamwin</strong>. Return here, refresh, and explicitly save the files you want to check. Folders never include their children.</p>
  <p>Google’s per-file permission permits reading and writing opened files. This adapter only reads. The installation permission adds Scamwin to Open with. No browser OAuth token or Picker key is used.</p>
  <p>Plain text, PNG/JPEG/WebP, and bounded Google Docs/Sheets/Slides text exports are supported. Exports omit formatting, embedded media, comments and some structure. PDF, Office, folders and shortcuts remain unsupported. Drive changes expose current state; intermediate edits and old versions are not an archive.</p>
  <p role="status">{status?`${status.resources.filter(r=>r.selected).length} selected files. Permission does not mean every file was checked.`:error?'Drive status unavailable.':'Loading Drive setup…'}</p>
  <Button className="sw-btn sw-btn-outline" type="button" disabled={busy} aria-busy={loading} onClick={refresh}>Refresh opened files</Button>
  {error&&<Notice title="Drive setup unavailable" error>{error}</Notice>}
  <form noValidate onSubmit={form.handleSubmit(values=>startTransition(()=>dispatch(values)))}><FieldGroup>
   <Field><fieldset disabled={busy||!enabled} aria-describedby={`${id}-scope-error`}><legend>Files opened with Scamwin</legend>{status?.resources.length?status.resources.map(r=><label key={r.handle} className="sw-consent"><input type="checkbox" value={r.handle} {...form.register('scope')} aria-invalid={!!form.formState.errors.scope} aria-describedby={`${id}-scope-error`}/><span>{r.label} <small>({r.mimeType})</small></span></label>):<p>No files opened yet. Use the Drive Open with menu in your connected Google account.</p>}</fieldset><FieldError id={`${id}-scope-error`} errors={[form.formState.errors.scope]}/></Field>
   <Field><FieldLabel htmlFor={`${id}-mode`}>Drive selection mode</FieldLabel><select id={`${id}-mode`} {...form.register('mode')} disabled={busy||!enabled}><option value="manual">Manual</option><option value="selective" disabled={!status?.automaticEnabled}>Selective automatic</option><option value="all_new" disabled={!status?.automaticEnabled}>All new items</option></select></Field>
   {mode==='selective'&&<Field><FieldLabel htmlFor={`${id}-phrases`}>Matching phrases (one per line)</FieldLabel><textarea className="resize-none" id={`${id}-phrases`} rows={3} {...form.register('contains')} disabled={busy} aria-invalid={!!form.formState.errors.contains} aria-describedby={`${id}-phrases-error`}/><FieldError id={`${id}-phrases-error`} errors={[form.formState.errors.contains]}/></Field>}
   <Field><FieldLabel htmlFor={`${id}-daily`}>Your daily automatic maximum</FieldLabel><select id={`${id}-daily`} {...form.register('automaticDailyLimit',{valueAsNumber:true})} disabled={busy||!enabled}><option value={1}>1 per day</option><option value={2}>2 per day</option></select></Field>
   <Field><label className="sw-consent"><input type="checkbox" {...form.register('paused')} disabled={busy||!enabled}/>Pause new Drive imports</label></Field>
   <Field><label className="sw-consent"><input type="checkbox" {...form.register('consent')} disabled={busy||!enabled} aria-invalid={!!form.formState.errors.consent} aria-describedby={`${id}-consent-error`}/>I confirm the selected files and AI processing. All new items includes every observed changed file in this selection, including routine content. History stays off; automatic coverage starts at the saved boundary. Context is kept up to 30 days, images seven days and bounded activity 90 days. Nothing is automatically published.</label><FieldError id={`${id}-consent-error`} errors={[form.formState.errors.consent]}/></Field>
  </FieldGroup>{saved&&<Notice title={saved.ok?'Drive settings saved':'Drive settings were not saved'} error={!saved.ok}>{saved.error??'Selection saved. Automatic coverage begins at the new boundary; earlier and intermediate edits remain unavailable.'}</Notice>}<Button className="sw-btn sw-btn-primary" type="submit" disabled={busy||!enabled} aria-busy={pending}>{pending?'Saving…':'Save Drive settings'}</Button></form>
  {status&&<DriveManualFile key={status.epoch} connectionId={connectionId} status={status} disabled={busy||!enabled||status.paused}/>}
 </section>;
}
function DriveManualFile({connectionId,status,disabled}:{connectionId:string;status:DriveSetupStatus;disabled:boolean}){
 const id=useId(),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const form=useForm<DriveImportValues>({resolver:zodResolver(driveImportInput),defaultValues:{id:connectionId,epoch:status.epoch,resourceHandle:''}});
 const choices=status.resources.filter(r=>r.selected);
 const [result,dispatch,pending]=useActionState(async(_previous:{ok:boolean;error?:string}|null,values:DriveImportValues)=>{
  try{const r=await importDriveFileAction(values);if(!alive.current)return null;return r.ok?{ok:true}:{ok:false,error:r.error};}
  catch{return {ok:false,error:'The file could not be imported. Refresh and try again.'};}
 },null);
 return <form noValidate aria-label="Import selected Drive file" onSubmit={form.handleSubmit(values=>startTransition(()=>dispatch(values)))}>
  <h3>Check one selected file</h3>
  <FieldGroup><Field><FieldLabel htmlFor={`${id}-file`}>Saved file</FieldLabel>
   <select id={`${id}-file`} {...form.register('resourceHandle')} disabled={disabled||pending||!choices.length} aria-invalid={!!form.formState.errors.resourceHandle} aria-describedby={`${id}-file-error`}>
    <option value="">Choose a saved file</option>{choices.map(r=><option key={r.handle} value={r.handle}>{r.label}</option>)}
   </select><FieldError id={`${id}-file-error`} errors={[form.formState.errors.resourceHandle]}/>
  </Field></FieldGroup>
  {result&&<Notice title={result.ok?'File imported':'File was not imported'} error={!result.ok}>{result.ok?<>Preparation is queued. <a className="sw-text-link" href={`/account/connections/${encodeURIComponent(connectionId)}`}>Open the source inbox</a> for coverage.</>:result.error}</Notice>}
  <Button className="sw-btn sw-btn-outline" type="submit" disabled={disabled||pending||!choices.length} aria-busy={pending}>{pending?'Importing…':'Import selected file'}</Button>
 </form>;
}
