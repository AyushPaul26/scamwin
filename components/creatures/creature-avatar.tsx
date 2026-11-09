"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { Component, useCallback, useRef, useState, type ReactNode } from "react";
import { resolveCreature, type CreatureId, type CreatureVariant } from "@/lib/creatures/catalog";
import { cn } from "@/lib/utils";
import { useAvatarActivity } from "./use-avatar-activity";

const CreatureScene = dynamic(() => import("./creature-scene"), { ssr: false });

export type CreatureAvatarProps = {
  seed: string;
  animated?: boolean;
  /** Disable the greeting button when the avatar is inside another control. */
  interactive?: boolean;
  className?: string;
  alt?: string;
  paused?: boolean;
  variant?: CreatureVariant;
  /** Explicit selection is used by the artwork review and portrait tools only. */
  species?: CreatureId;
  /** Render a neutral, transparent frame for the portrait asset build. */
  portraitCapture?: boolean;
};

type Creature = ReturnType<typeof resolveCreature>;

class SceneBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function AnimatedCreature({
  creature,
  interactive = true,
  className,
  alt,
  paused = false,
  portraitCapture = false,
}: {
  creature: Creature;
  interactive?: boolean;
  className?: string;
  alt: string;
  paused?: boolean;
  portraitCapture?: boolean;
}) {
  const { containerRef, entered, active, reducedMotion } = useAvatarActivity(paused);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [greeting, setGreeting] = useState(false);
  const [greetingRequest, setGreetingRequest] = useState(0);
  const greetingInProgress = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const canRender = (entered || portraitCapture) && (!reducedMotion || portraitCapture) && !failed;
  const canInteract = active && ready && !failed && !portraitCapture;
  const showPortrait = !ready || failed || (reducedMotion && !portraitCapture);

  const onReady = useCallback(() => setReady(true), []);
  const onNotReady = useCallback(() => {
    setReady(false);
    greetingInProgress.current = false;
    setGreeting(false);
    setGreetingRequest(0);
  }, []);
  const onFailure = useCallback(() => setFailed(true), []);
  const onGreetingFinished = useCallback(() => {
    greetingInProgress.current = false;
    setGreeting(false);
  }, []);

  const greet = () => {
    if (!canInteract || greetingInProgress.current) return;
    greetingInProgress.current = true;
    setGreeting(true);
    setGreetingRequest((request) => request + 1);
  };

  const status = failed ? "fallback" : reducedMotion && !portraitCapture ? "reduced-motion" : ready ? "ready" : "loading";

  return (
    <span
      ref={containerRef}
      className={cn("relative inline-block size-8 shrink-0 align-middle", className)}
      data-creature={creature.id}
      data-creature-variant={creature.variant}
      data-renderer-status={status}
      data-creature-state={portraitCapture ? "still" : !active ? "paused" : greeting ? "greeting" : "idle"}
      role={!interactive ? "img" : undefined}
      aria-label={!interactive ? alt : undefined}
    >
      {!portraitCapture && (
        <Image
          src={creature.portraitUrl}
          alt=""
          width={256}
          height={256}
          unoptimized
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-0 size-full object-contain", !showPortrait && "invisible")}
        />
      )}
      {canRender && (
        <span className="pointer-events-none absolute inset-0" aria-hidden="true">
          <SceneBoundary onFailure={onFailure}>
            <CreatureScene
              creature={creature}
              active={active && !portraitCapture}
              portraitCapture={portraitCapture}
              pointer={pointer}
              greeting={greeting}
              greetingRequest={greetingRequest}
              onReady={onReady}
              onNotReady={onNotReady}
              onFailure={onFailure}
              onGreetingFinished={onGreetingFinished}
            />
          </SceneBoundary>
        </span>
      )}
      {!portraitCapture && interactive && (
        <button
          type="button"
          aria-label={`${alt}. Say hello`}
          aria-disabled={!canInteract}
          tabIndex={canInteract ? 0 : -1}
          className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          style={{ cursor: canInteract ? "pointer" : "default", touchAction: "manipulation" }}
          onClick={greet}
          onPointerMove={(event) => {
            if (!canInteract || event.pointerType === "touch") return;
            const bounds = event.currentTarget.getBoundingClientRect();
            pointer.current = {
              x: Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1)),
              y: Math.max(-1, Math.min(1, 1 - ((event.clientY - bounds.top) / bounds.height) * 2)),
            };
          }}
          onPointerLeave={() => { pointer.current = { x: 0, y: 0 }; }}
          onPointerCancel={() => { pointer.current = { x: 0, y: 0 }; }}
          onBlur={() => { pointer.current = { x: 0, y: 0 }; }}
        />
      )}
    </span>
  );
}

export function CreatureAvatar({
  seed,
  animated = false,
  interactive = true,
  className,
  alt = "Bot avatar",
  paused = false,
  variant,
  species,
  portraitCapture = false,
}: CreatureAvatarProps) {
  const creature = resolveCreature(seed, variant, species);

  if (!animated && !portraitCapture) {
    return (
      <Image
        src={creature.portraitUrl}
        alt={alt}
        width={32}
        height={32}
        unoptimized
        className={cn("size-8 shrink-0 object-contain", className)}
        data-creature={creature.id}
        data-creature-variant={creature.variant}
        data-renderer-status="portrait"
      />
    );
  }

  return (
    <AnimatedCreature
      key={`${creature.id}:${creature.variant}:${portraitCapture}`}
      creature={creature}
      interactive={interactive}
      className={className}
      alt={alt}
      paused={paused}
      portraitCapture={portraitCapture}
    />
  );
}
