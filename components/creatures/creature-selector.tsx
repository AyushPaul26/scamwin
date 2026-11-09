"use client";

import { ChatAvatar } from "@/components/chat-avatar";
import { DiagonalCarousel } from "@/components/ui/diagonal-carousel";
import { CREATURE_CATALOG, CREATURE_IDS, resolveCreature } from "@/lib/creatures/catalog";
import { seedForCreature } from "@/lib/creatures/selection";
import { cn } from "@/lib/utils";
import { useCreatureMotion } from "./creature-motion";

export function CreatureSelector({ seed, onSeedChange, compact = false, disabled = false, avatarAlt = "Bot avatar" }: {
  seed: string;
  onSeedChange: (seed: string) => void;
  compact?: boolean;
  disabled?: boolean;
  avatarAlt?: string;
}) {
  const creature = resolveCreature(seed);
  const { paused } = useCreatureMotion();
  const items = CREATURE_IDS.map((id) => ({
    id,
    title: CREATURE_CATALOG[id].name,
    src: resolveCreature(seed, creature.variant, id).portraitUrl,
  }));

  return (
    <div className="flex w-full min-w-0 flex-col items-center" data-creature-selector data-selected-creature={creature.id}>
      <DiagonalCarousel
        items={items}
        activeIndex={CREATURE_IDS.indexOf(creature.id)}
        onActiveIndexChange={(index) => onSeedChange(seedForCreature(seed, CREATURE_IDS[index]))}
        compact={compact}
        disabled={disabled || paused}
        renderActive={<ChatAvatar seed={seed} animated className={compact ? "size-36" : "size-[200px] sm:size-[240px]"} alt={avatarAlt} />}
      />
      <p className={cn("mt-1 text-sm font-medium", compact && "text-xs")} aria-live="polite" aria-atomic="true">
        {creature.name}<span aria-hidden="true" className="mx-2 text-muted-foreground/50">/</span>
        <span className="font-normal text-muted-foreground">{CREATURE_IDS.indexOf(creature.id) + 1} of {CREATURE_IDS.length}</span>
      </p>
    </div>
  );
}
