"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { PlusIcon } from "lucide-react";
import { nanoid } from "nanoid";
import { BotForm } from "./bot-form";
import { createBot } from "@/app/dashboard/actions";
import { AVATAR_SEED_LENGTH } from "@/lib/bot-form-schema";
import { resolveCreature } from "@/lib/creatures/catalog";
import { seedForCreature } from "@/lib/creatures/selection";
import { CreatureMotionForeground, useCreatureMotion } from "@/components/creatures/creature-motion";
import { CreepyButton } from "@/components/ui/creepy-button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

export function CreateBotDialog({ initialAvatarSeed, trigger, finalFocus }: {
  initialAvatarSeed?: string;
  trigger?: ReactNode;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [avatarSeed, setAvatarSeed] = useState<string | null>(null);
  const currentSeed = useRef<string | null>(null);
  const dialogId = useId();
  const { setDialogOpen } = useCreatureMotion();

  useEffect(() => () => setDialogOpen(dialogId, false), [dialogId, setDialogOpen]);

  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen && !open) {
      const randomSeed = nanoid(AVATAR_SEED_LENGTH);
      const preferred = initialAvatarSeed ? resolveCreature(initialAvatarSeed) : null;
      const seed = preferred ? seedForCreature(randomSeed, preferred.id, preferred.variant) : randomSeed;
      currentSeed.current = seed;
      setAvatarSeed(seed);
    } else if (!nextOpen) {
      currentSeed.current = null;
    }
    setOpen(nextOpen);
    setDialogOpen(dialogId, nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {trigger ?? <DialogTrigger render={<CreepyButton />}>
        <PlusIcon data-icon="inline-start" />
        Create a new bot
      </DialogTrigger>}
      <DialogContent className="dark dashboard-theme max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" finalFocus={finalFocus}>
        <CreatureMotionForeground>
          {avatarSeed && <BotForm saveAction={createBot} key={avatarSeed} avatarSeed={avatarSeed} onSaved={() => {
            if (currentSeed.current === avatarSeed) changeOpen(false);
          }} />}
        </CreatureMotionForeground>
      </DialogContent>
    </Dialog>
  );
}
