"use client";

import { useState } from "react";
import { ArrowLeftIcon, PauseIcon, PlayIcon } from "lucide-react";
import { CreatureAvatar } from "@/components/creatures/creature-avatar";
import { AVAILABLE_CREATURE_IDS, CREATURE_CATALOG, CREATURE_IDS, CREATURE_VARIANTS, type CreatureId, type CreatureVariant } from "@/lib/creatures/catalog";
import { Button } from "@/components/ui/button";
import { CreepyButton } from "@/components/ui/creepy-button";
import { DiagonalCarousel } from "@/components/ui/diagonal-carousel";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function CreatureReview({ capture = false, initialSpecies = "moss-otter" }: { capture?: boolean; initialSpecies?: CreatureId }) {
  const [species, setSpecies] = useState<CreatureId>(capture || AVAILABLE_CREATURE_IDS.includes(initialSpecies) ? initialSpecies : "moss-otter");
  const [variant, setVariant] = useState<CreatureVariant>("fern");
  const [paused, setPaused] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const creature = CREATURE_CATALOG[species];

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6 py-6 sm:px-10 sm:py-8">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
        <a href="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Dashboard
        </a>
        <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">Meet the creatures · {String(CREATURE_IDS.indexOf(species) + 1).padStart(2, "0")} / {String(CREATURE_IDS.length).padStart(2, "0")}</span>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center py-10 text-center sm:py-14" aria-labelledby="creature-title">
        {capture ? <div className="flex size-80 items-center justify-center" data-review-stage>
          <CreatureAvatar seed="collection-review" species={species} variant={variant} portraitCapture className="size-80" alt={creature.name} />
        </div> : <DiagonalCarousel
          items={AVAILABLE_CREATURE_IDS.map((id) => ({ id, title: CREATURE_CATALOG[id].name, src: `/creatures/v1/${id}-${variant}.webp` }))}
          activeIndex={AVAILABLE_CREATURE_IDS.indexOf(species)}
          onActiveIndexChange={(index) => setSpecies(AVAILABLE_CREATURE_IDS[index])}
          disabled={dialogOpen}
          renderActive={<div className="flex size-[200px] items-center justify-center sm:size-[240px]" data-review-stage>
            <CreatureAvatar seed="collection-review" species={species} variant={variant} animated paused={paused || dialogOpen} className="size-full" alt={creature.name} />
          </div>}
        />}

        <p className="mb-3 text-xs font-medium tracking-[0.22em] text-[#a3c787] uppercase">A curious little companion</p>
        <h1 id="creature-title" className="text-5xl leading-tight tracking-tight [font-family:var(--font-instrument-serif)] sm:text-6xl">Meet your {creature.name.toLowerCase()}.</h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base">{creature.description}<br />Move your pointer to catch its eye. Tap to say hello.</p>

        <div role="group" aria-label="Creature color" className="mt-7 flex items-center gap-3">
          {CREATURE_VARIANTS.map((item) => (
            <button key={item} type="button" aria-pressed={variant === item} aria-label={`${item} colors`} onClick={() => setVariant(item)} className="group flex min-h-11 min-w-11 flex-col items-center gap-2 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-[#a3c787]">
              <span className="block size-7 rounded-full border-4 border-background ring-1 ring-white/20 transition-shadow group-aria-pressed:ring-2 group-aria-pressed:ring-white" style={{ background: creature.palettes[item].body }} />
              <span className="text-[11px] text-muted-foreground capitalize group-aria-pressed:text-foreground">{creature.labels[item]}</span>
            </button>
          ))}
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<CreepyButton />}>See the smaller view</DialogTrigger>
            <DialogContent className="dark dashboard-theme sm:max-w-md">
              <DialogHeader className="items-center py-4 text-center">
                <CreatureAvatar seed="collection-review" species={species} variant={variant} animated paused={paused} className="size-36" alt={`${creature.name} in dialog`} />
                <DialogTitle>Your next teammate</DialogTitle>
                <DialogDescription>The same personality, at home in your creation dialog.</DialogDescription>
              </DialogHeader>
              <DialogClose render={<Button variant="secondary" />}>Back to the collection</DialogClose>
            </DialogContent>
          </Dialog>
          <Button variant="ghost" onClick={() => setPaused(!paused)} aria-pressed={paused}>
            {paused ? <PlayIcon /> : <PauseIcon />}{paused ? "Resume motion" : "Pause motion"}
          </Button>
        </div>
      </section>

      {!capture && <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-white/10 py-5 text-left">
        <div className="flex items-center gap-3">
          <CreatureAvatar seed="collection-review" species={species} variant={variant} className="size-10" alt={`${creature.name} portrait`} />
          <div><p className="text-sm">Small size. Same character.</p><p className="mt-1 text-xs text-muted-foreground">Your bot’s portrait, wherever it goes.</p></div>
        </div>
        <span className="text-xs text-muted-foreground">{creature.name} · {creature.greeting}</span>
      </footer>}
    </div>
  );
}
