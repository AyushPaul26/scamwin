'use client';
import { startTransition, useActionState, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldLabel, FieldGroup, FieldError } from '@/components/ui/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { extensionApprovalSchema, type ExtensionApproval } from '@/lib/scamwin/connectors/extension-ui';
import { approveExtensionPairing } from '@/lib/scamwin/connectors/extension-actions';
/** Mounted by the existing Connections surface; no separate preview/production route. */
export function ExtensionConnectionSetup({ available = false, automaticAvailable = false, onSaved }: {
    available?: boolean;
    automaticAvailable?: boolean;
    onSaved?: () => void;
}) {
    const id = useId(), [show, setShow] = useState(false), [originsText, setOriginsText] = useState(''), [containsText, setContainsText] = useState(''), form = useForm<ExtensionApproval>({ resolver: zodResolver(extensionApprovalSchema), defaultValues: { ticket: '', mode: 'manual', origins: [], contains: [], automaticDailyLimit: 1 } });
    const [result, dispatch, pending] = useActionState<{
        error?: string;
        code?: string;
        expiresAt?: string;
    }, ExtensionApproval>(async (_previous, input) => { const r = await approveExtensionPairing(input); if (!r.ok)
        return { error: r.error }; return { code: r.code, expiresAt: r.expiresAt }; }, {});
    const disabled = pending || !available;
    return <section className="sw-stack" aria-label="Browser extension setup"><p className="sw-muted">Install the unpacked pilot in Chrome or Edge, create a ticket in its popup, and paste it here. Only approve a ticket you just created in your own browser. Opening a link never pairs a browser.</p>{!available && <p role="status">Browser pairing is unavailable. You can still use New check.</p>}
  <form noValidate onSubmit={form.handleSubmit(v => startTransition(() => dispatch(v)))}><FieldGroup>
  <Field><FieldLabel htmlFor={`${id}-ticket`}>Pairing ticket from your extension</FieldLabel><Controller control={form.control} name="ticket" render={({ field }) => <Input {...field} id={`${id}-ticket`} autoComplete="off" spellCheck={false} disabled={disabled} aria-invalid={!!form.formState.errors.ticket} aria-describedby={`${id}-ticket-error`}/>}/><FieldError id={`${id}-ticket-error`}>{form.formState.errors.ticket?.message}</FieldError></Field>
  <Field><FieldLabel htmlFor={`${id}-mode`}>Page checking mode</FieldLabel><Controller control={form.control} name="mode" render={({ field }) => <select {...field} id={`${id}-mode`} className="sw-select min-h-11" disabled={disabled}><option value="manual">Manual — only when I click Check visible page</option><option value="selective" disabled={!automaticAvailable}>Selective automatic — matching visible text</option><option value="all_new" disabled={!automaticAvailable}>All new visible pages on approved sites</option></select>}/></Field>
  <Field><FieldLabel htmlFor={`${id}-origins`}>Approved sites for automatic checks</FieldLabel><Controller control={form.control} name="origins" render={({ field }) => <Textarea ref={field.ref} name={field.name} onBlur={field.onBlur} id={`${id}-origins`} className="resize-none" rows={3} value={originsText} onChange={e => { setOriginsText(e.target.value); field.onChange(e.target.value.split('\n').filter(Boolean)); }} placeholder="https://example.com" disabled={disabled} aria-invalid={!!form.formState.errors.origins} aria-describedby={`${id}-origins-help ${id}-origins-error`}/>}/><p id={`${id}-origins-help`} className="sw-muted">One exact origin per line, without a path or wildcard. Enable each site separately in the extension’s browser permission prompt. scamwin.vercel.app is excluded to prevent checking its own results.</p><FieldError id={`${id}-origins-error`}>{form.formState.errors.origins?.message ?? form.formState.errors.origins?.find?.(e => e?.message)?.message}</FieldError></Field>
  <Field><FieldLabel htmlFor={`${id}-contains`}>Phrases for Selective automatic</FieldLabel><Controller control={form.control} name="contains" render={({ field }) => <Textarea ref={field.ref} name={field.name} onBlur={field.onBlur} id={`${id}-contains`} className="resize-none" rows={2} value={containsText} onChange={e => { setContainsText(e.target.value); field.onChange(e.target.value.split('\n').filter(Boolean)); }} disabled={disabled} aria-invalid={!!form.formState.errors.contains} aria-describedby={`${id}-contains-error`}/>}/><FieldError id={`${id}-contains-error`}>{form.formState.errors.contains?.message ?? form.formState.errors.contains?.find?.(e => e?.message)?.message}</FieldError><p className="sw-muted">All new pages applies no phrase or suspicion filter. Manual clicks always remain available.</p></Field>
  <Field><FieldLabel htmlFor={`${id}-daily`}>Automatic daily maximum</FieldLabel><Controller control={form.control} name="automaticDailyLimit" render={({ field }) => <select {...field} onChange={e => field.onChange(Number(e.target.value))} id={`${id}-daily`} className="sw-select min-h-11" disabled={disabled}><option value={1}>1 check per day</option><option value={2}>2 checks per day</option></select>}/></Field>
  <Field><Controller control={form.control} name="consent" render={({ field }) => <label className="flex min-h-11 items-start gap-2"><input ref={field.ref} name={field.name} onBlur={field.onBlur} type="checkbox" checked={field.value === true} onChange={e => field.onChange(e.target.checked)} disabled={disabled} aria-invalid={!!form.formState.errors.consent} aria-describedby={`${id}-consent-error`}/><span>Allow Scamwin and its checking services to process visible page text and public links from this browser. Form values, passwords, other frames and images are excluded. Bodies expire within 30 days and activity within 90 days. Global manual and automatic limits apply.</span></label>}/><FieldError id={`${id}-consent-error`}>{form.formState.errors.consent?.message && 'Review and accept page checking before pairing.'}</FieldError></Field>
  <Button type="submit" disabled={disabled} aria-busy={pending}>{pending ? 'Approving…' : 'Approve my browser ticket'}</Button></FieldGroup></form>
  {result.error && <Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert>}
  {result.code && <div className="sw-stack"><p role="status">Approved for five minutes. Paste this code into the same extension popup to finish pairing.</p><Field><FieldLabel htmlFor={`${id}-code`}>One-use approval code</FieldLabel><Input id={`${id}-code`} readOnly type={show ? 'text' : 'password'} value={result.code} autoComplete="off"/><Button variant="outline" onClick={() => setShow(v => !v)} aria-pressed={show}>{show ? 'Hide approval code' : 'Show approval code'}</Button></Field>{onSaved && <Button variant="outline" onClick={onSaved}>Refresh connection status</Button>}</div>}
  <p className="sw-muted">Only visible top-frame content is captured on page loads, tab switches or a manual click. Browser suspension, hidden tabs, offline time and closed browsers create coverage gaps; missed pages are not replayed. To change sites or modes, unlink and pair again. Changing saved connection settings invalidates this browser’s grant.</p></section>;
}
