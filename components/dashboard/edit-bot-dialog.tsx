"use client";

import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { updateBot } from "@/app/dashboard/actions";
import type { EditableBot } from "@/lib/bot-form-schema";
import { CreatureMotionForeground, useCreatureMotion } from "@/components/creatures/creature-motion";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotForm } from "./bot-form";
import { DeleteBotDialog } from "./delete-bot-dialog";

export function EditBotDialog({ bot, trigger }: { bot: EditableBot; trigger: ReactElement }) {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const activeGeneration = useRef<number | null>(null);
  const sequence = useRef(0);
  const dialogId = useId();
  const { setDialogOpen } = useCreatureMotion();
  const router = useRouter();
  useEffect(() => () => setDialogOpen(dialogId, false), [dialogId, setDialogOpen]);

  function changeOpen(nextOpen: boolean) {
    if (nextOpen && !open) {
      activeGeneration.current = ++sequence.current;
      setGeneration(sequence.current);
    } else if (!nextOpen) {
      activeGeneration.current = null;
    }
    setOpen(nextOpen);
    setDialogOpen(dialogId, nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="dark dashboard-theme max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <CreatureMotionForeground>
          <BotForm key={generation} avatarSeed={bot.avatar} initialValues={{ name: bot.name, job: bot.job, instructions: bot.instructions }} saveAction={updateBot.bind(null, bot.id)} footerStart={(pending) => <DeleteBotDialog bot={bot} disabled={pending} />} onSaved={() => {
            if (activeGeneration.current !== generation) return;
            changeOpen(false);
            router.refresh();
          }} />
        </CreatureMotionForeground>
      </DialogContent>
    </Dialog>
  );
}
