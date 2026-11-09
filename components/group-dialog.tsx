'use client';
import { useActionState, useEffect, useRef, useState, startTransition, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UsersIcon } from 'lucide-react';
import { groupFormSchema, type GroupValues, type GroupMember } from '@/lib/group-form-schema';
import { saveGroup, deleteGroup, listGroupBots, type GroupState } from '@/app/chats/group-actions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
export function GroupDialog({ group, trigger }: { trigger?: ReactElement; group?: { id: string; name: string; members: GroupMember[] } }) {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const active = useRef(0);
  const router = useRouter();
  return <Dialog open={open} onOpenChange={value => { active.current++; setGeneration(active.current); setOpen(value); }}>
    <DialogTrigger render={trigger ?? <Button variant="outline" size="sm" />}><UsersIcon /><span className="group-data-[collapsible=icon]:hidden">{group ? 'Edit group' : 'New group'}</span></DialogTrigger>
    <DialogContent className="dark dashboard-theme max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      {open && <GroupForm key={generation} group={group} onSaved={id => {
        if (active.current !== generation) return;
        setOpen(false); active.current++; router.push(id ? `/chats/${encodeURIComponent(id)}` : '/dashboard'); router.refresh();
      }} />}
    </DialogContent>
  </Dialog>;
}
function GroupForm({ group, onSaved }: { group?: { id: string; name: string; members: GroupMember[] }; onSaved: (id?: string) => void }) {
  const [available, setAvailable] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [state, dispatch, pending] = useActionState(saveGroup.bind(null, group?.id ?? null), {} as GroupState);
  const { control, handleSubmit, setError, formState: { errors } } = useForm<GroupValues>({ resolver: zodResolver(groupFormSchema), defaultValues: { name: group?.name ?? '', botIds: group?.members.map(m => m.id) ?? [] } });
  const busy = pending || deleting;
  useEffect(() => { let mounted = true; void listGroupBots().then(items => { if (mounted) setAvailable(items); }).catch(() => { if (mounted) setLoadError('Could not load your bots. Close and reopen to retry.'); }).finally(() => { if (mounted) setLoading(false); }); return () => { mounted = false; }; }, []);
  useEffect(() => {
    if (state.success) onSaved(state.chatId);
    if (state.errors?.name) setError('name', { message: state.errors.name }, { shouldFocus: true });
    if (state.errors?.botIds) setError('botIds', { message: state.errors.botIds }, { shouldFocus: !state.errors.name });
  }, [state, onSaved, setError]);
  return <form onSubmit={handleSubmit(values => { const data = new FormData(); data.set('name', values.name); values.botIds.forEach(id => data.append('botIds', id)); startTransition(() => dispatch(data)); })}>
    <DialogHeader><DialogTitle>{group ? 'Edit group' : 'Create a group'}</DialogTitle><DialogDescription>Choose teammates to work together in one conversation.</DialogDescription></DialogHeader>
    <FieldGroup className="my-4">
      <Field><FieldLabel htmlFor="group-name">Name</FieldLabel><Controller name="name" control={control} render={({ field }) => <Input {...field} id="group-name" disabled={busy} maxLength={50} aria-invalid={!!errors.name} aria-describedby="group-name-error" />} /><FieldError id="group-name-error">{errors.name?.message}</FieldError></Field>
      <Field><FieldLabel>Teammates</FieldLabel>{loading && <p role="status">Loading bots…</p>}
        <Controller name="botIds" control={control} render={({ field }) => <div className="grid max-h-52 gap-2 overflow-y-auto" role="group" aria-label="Teammates" aria-describedby="group-bots-error">
          {available.map((bot, index) => <label key={bot.id} className="flex items-center gap-3 rounded-lg border p-2"><input ref={index === 0 ? field.ref : undefined} type="checkbox" aria-invalid={!!errors.botIds} value={bot.id} checked={field.value.includes(bot.id)} disabled={busy} onBlur={field.onBlur} onChange={event => field.onChange(event.target.checked ? [...field.value, bot.id] : field.value.filter(id => id !== bot.id))} /><span className="min-w-0"><span className="block truncate">{bot.name}</span><span className="block truncate text-xs text-muted-foreground">{bot.job}</span></span></label>)}
        </div>} /><FieldError id="group-bots-error">{errors.botIds?.message}</FieldError>
        {!loading && available.length < 2 && <p className="text-sm text-muted-foreground">Create at least two bots before creating a group.</p>}
      </Field>
    </FieldGroup>
    {(state.error || loadError || deleteError) && <Alert className="mb-4" variant="destructive"><AlertDescription>{state.error || loadError || deleteError}</AlertDescription></Alert>}
    <DialogFooter>
      {group && <Button type="button" variant="destructive" disabled={busy} onClick={() => {
        if (!confirmDelete) { setConfirmDelete(true); return; }
        setDeleting(true); void deleteGroup(group.id).then(result => { if (result.success) onSaved(); else setDeleteError(result.error ?? 'Could not delete group.'); }).catch(() => setDeleteError('Could not delete group.')).finally(() => setDeleting(false));
      }}>{confirmDelete ? 'Confirm delete group' : 'Delete group'}</Button>}
      <Button type="submit" disabled={busy || loading || !!loadError}>{pending ? 'Saving…' : 'Save group'}</Button>
    </DialogFooter>
  </form>;
}
