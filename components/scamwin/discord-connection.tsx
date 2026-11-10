'use client';
import { startTransition, useActionState, useId } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { beginExpandedAuthorization } from '@/lib/scamwin/connectors/expanded-actions';
import { selectDiscordMessageContexts } from '@/lib/scamwin/connectors/discord-actions';
import { discordSelectionSchema, discordContexts, discordContextLabels } from '@/lib/scamwin/connectors/discord-ui';
type Values = z.infer<typeof discordSelectionSchema>;
/** Existing Account card owns the route, status and saved connection refresh. */
export function DiscordConnectionSetup({ connection, available = false, onSaved }: {
    connection?: {
        id: string;
        epoch: number;
    };
    available?: boolean;
    onSaved?: () => void;
}) {
    const id = useId(), form = useForm<Values>({ resolver: zodResolver(discordSelectionSchema), defaultValues: { contexts: [], consent: false } });
    const [result, dispatch, pending] = useActionState<{
        error?: string;
        message?: string;
        installationUrl?: string;
    }, 'authorize' | 'save'>(async (_previous, operation) => { if (operation === 'authorize') {
        const r = await beginExpandedAuthorization({ provider: 'discord', ...(connection ? { reconnect: connection } : {}) });
        if (!r.ok)
            return { error: r.error };
        window.location.assign(r.authorizationUrl);
        return { message: 'Opening Discord authorization.' };
    } if (!connection)
        return { error: 'Connect Discord before choosing message actions.' }; const r = await selectDiscordMessageContexts({ ...connection, ...form.getValues() }); if (!r.ok)
        return { error: r.error }; return { message: 'Manual message actions saved. Install the command in Discord, then choose one message to check.', installationUrl: r.installationUrl }; }, {});
    return <section className="sw-stack" aria-label="Discord setup"><p className="sw-muted">Link your Discord identity, then allow messages you explicitly select with Apps → Check with Scamwin. Identity permission does not read your inbox or message history.</p><p className="sw-muted">Manual only. Automatic server monitoring is unavailable.</p>{!available && <p role="status">Discord setup is unavailable. You can still start a manual check.</p>}<div><Button disabled={pending || !available} onClick={() => startTransition(() => dispatch('authorize'))}>{connection ? 'Reconnect Discord' : 'Connect Discord'}</Button></div>
 {connection && <form noValidate onSubmit={form.handleSubmit(() => startTransition(() => dispatch('save')))}><FieldGroup><Field><FieldLabel id={`${id}-contexts-label`}>Messages I may select</FieldLabel><Controller control={form.control} name="contexts" render={({ field }) => <div role="group" aria-labelledby={`${id}-contexts-label`} className="grid gap-2">{discordContexts.map(context => <label key={context} className="flex min-h-11 items-center gap-2"><input type="checkbox" ref={field.ref} name={field.name} onBlur={field.onBlur} disabled={pending || !available || !!result.installationUrl} checked={field.value.includes(context)} onChange={e => field.onChange(e.target.checked ? [...field.value, context] : field.value.filter(v => v !== context))} aria-invalid={!!form.formState.errors.contexts} aria-describedby={`${id}-contexts-error`}/>{discordContextLabels[context]}</label>)}</div>}/><FieldError id={`${id}-contexts-error`}>{form.formState.errors.contexts?.message}</FieldError></Field><Field><Controller control={form.control} name="consent" render={({ field }) => <label className="flex min-h-11 items-start gap-2"><input type="checkbox" ref={field.ref} name={field.name} onBlur={field.onBlur} className="mt-1" checked={field.value} disabled={pending || !available || !!result.installationUrl} onChange={e => field.onChange(e.target.checked)} aria-invalid={!!form.formState.errors.consent} aria-describedby={`${id}-consent-error`}/><span>Allow Scamwin to save and check the message I select, including supported images and links. Body content expires within 30 days, images within seven days, and activity within 90 days. Checks use the existing investigation limits.</span></label>}/><FieldError id={`${id}-consent-error`}>{form.formState.errors.consent?.message}</FieldError></Field><Button type="submit" className="relative" disabled={pending || !available || !!result.installationUrl}><span className={pending ? 'invisible' : undefined}>Save manual message actions</span>{pending && <span className="absolute inset-0 grid place-items-center">Saving…</span>}</Button></FieldGroup></form>}
 {result.installationUrl && <div className="sw-safe-links"><a className="sw-evidence-link" href={result.installationUrl}>Install the message command in Discord</a>{onSaved&&<Button type="button" className="sw-btn sw-btn-outline" onClick={onSaved}>Refresh connection status</Button>}</div>}<p className="sw-muted">The command checks only the message you select where Discord makes it available. Other messages and unsupported or expired files are not checked. Open Connected apps to follow the private check.</p>{result.error && <Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert>}{result.message && <p role="status">{result.message}</p>}</section>;
}
