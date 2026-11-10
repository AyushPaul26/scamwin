'use client';
import {startTransition,useActionState,useId} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Field,FieldLabel,FieldError} from '@/components/ui/field';
import {selectSlackMessage} from '@/lib/scamwin/connectors/slack-actions';
import {Notice} from './core';
const schema=z.object({permalink:z.string().trim().url('Paste a Slack message link.').max(2000)});
export function SlackManualImport({connection}:{connection:{id:string;epoch:number}}){
 const id=useId(),form=useForm<z.infer<typeof schema>>({resolver:zodResolver(schema),defaultValues:{permalink:''}});
 const [result,dispatch,pending]=useActionState(async(_previous:{ok:boolean;error?:string}|null,value:z.infer<typeof schema>)=>{try{return await selectSlackMessage({...connection,...value});}catch{return {ok:false,error:'Import could not be confirmed. Keep this link and try again.'};}},null);
 return <form noValidate onSubmit={form.handleSubmit(v=>startTransition(()=>dispatch(v)))}><h3>Check one Slack message</h3><p>Choose a message in a selected conversation. Import reads only that message and sends its content for private AI checking.</p><Field><FieldLabel htmlFor={id}>Slack message link</FieldLabel><Input id={id} {...form.register('permalink')} disabled={pending} aria-invalid={!!form.formState.errors.permalink} aria-describedby={`${id}-error`}/><FieldError id={`${id}-error`} errors={[form.formState.errors.permalink]}/></Field><Button type="submit" className="sw-btn sw-btn-outline" disabled={pending}>{pending?'Importing…':'Import and check message'}</Button>{result&&<Notice title={result.ok?'Message queued':'Import unavailable'} error={!result.ok}>{result.ok?'The source is saved. Checking may wait for the available allowance.':result.error}</Notice>}</form>;
}
