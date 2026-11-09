"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Trash2Icon } from "lucide-react";
import { deleteBot } from "@/app/dashboard/actions";
import type { EditableBot } from "@/lib/bot-form-schema";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

export function DeleteBotDialog({ bot, disabled }: { bot: EditableBot; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [state, action, pending] = useActionState(async () => {
    try {
      return await deleteBot(bot.id);
    } catch (error) {
      unstable_rethrow(error);
      return { error: "We couldn’t delete your bot. Please try again." };
    } finally {
      submitting.current = false;
    }
  }, {} as { error?: string });

  return (
    <AlertDialog.Root open={open} onOpenChange={(nextOpen) => {
      if (!submitting.current) setOpen(nextOpen);
    }}>
      <AlertDialog.Trigger render={<Button type="button" variant="destructive" disabled={disabled} aria-label="Delete bot" title="Delete bot" />}>
        <Trash2Icon data-icon="inline-start" />
        <span className="hidden sm:inline">Delete bot</span>
      </AlertDialog.Trigger>
      <DialogContent showCloseButton={false} initialFocus={cancelRef} className="dark dashboard-theme max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <AlertDialog.Title className="text-base font-medium wrap-anywhere">Delete {bot.name}?</AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground">
            This permanently deletes this bot and its direct chats, and removes it from group chats. Group chats will remain. This cannot be undone.
          </AlertDialog.Description>
        </DialogHeader>
        {state.error && <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
        <DialogFooter>
          <AlertDialog.Close render={<Button type="button" ref={cancelRef} variant="outline" disabled={pending} />}>Keep bot</AlertDialog.Close>
          <Button type="button" variant="destructive" disabled={pending} onClick={() => {
            if (submitting.current) return;
            submitting.current = true;
            startTransition(action);
          }}>
            {pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </AlertDialog.Root>
  );
}
