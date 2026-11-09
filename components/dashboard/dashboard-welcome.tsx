"use client";

import { useState } from "react";
import { CreatureSelector } from "@/components/creatures/creature-selector";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { CreateBotDialog } from "./create-bot-dialog";

export function DashboardWelcome({ initialSeed }: { initialSeed: string }) {
  const [seed, setSeed] = useState(initialSeed);

  return (
    <Empty className="max-w-3xl flex-none gap-5 px-0 py-10">
      <CreatureSelector seed={seed} onSeedChange={setSeed} />
      <EmptyHeader className="max-w-md gap-3">
        <EmptyDescription>Find a face you like. Hover, tap, or use the arrows to explore.<br className="hidden sm:block" /> Then give your new teammate a name and a purpose.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><CreateBotDialog initialAvatarSeed={seed} /></EmptyContent>
    </Empty>
  );
}
