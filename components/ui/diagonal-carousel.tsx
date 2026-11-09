"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DiagonalCarouselItem = { id: string; src: string; title: string };

export type DiagonalCarouselProps = {
  items: readonly DiagonalCarouselItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  renderActive?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
};

// Adapted from the Vengeance UI diagonal carousel supplied in the design reference.
const spring: Transition = { type: "spring", bounce: 0.16, duration: 0.85 };

export function DiagonalCarousel({
  items,
  activeIndex,
  onActiveIndexChange,
  renderActive,
  compact = false,
  disabled = false,
  className,
}: DiagonalCarouselProps) {
  const currentIndex = Math.min(Math.max(activeIndex, 0), Math.max(0, items.length - 1));
  const reducedMotion = useReducedMotion();
  const hover = useRef<{ index: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const lastSelection = useRef(0);
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);

  const clearHover = useCallback(() => {
    if (hover.current) clearTimeout(hover.current.timer);
    hover.current = null;
  }, []);

  useEffect(() => {
    clearHover();
    return clearHover;
  }, [currentIndex, disabled, clearHover]);

  const select = useCallback((index: number) => {
    clearHover();
    if (disabled || !items.length) return;
    const nextIndex = Math.min(Math.max(index, 0), items.length - 1);
    if (nextIndex === currentIndex) return;
    lastSelection.current = performance.now();
    onActiveIndexChange(nextIndex);
  }, [clearHover, currentIndex, disabled, items.length, onActiveIndexChange]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.defaultPrevented || (event.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
    const next = {
      ArrowLeft: currentIndex - 1,
      ArrowRight: currentIndex + 1,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    // The active avatar is replaced on selection. Keep keyboard browsing in
    // the carousel when its greeting button is about to unmount.
    if ((event.target as HTMLElement).closest("[data-carousel-active]")) {
      event.currentTarget.focus({ preventScroll: true });
    }
    select(next);
  };

  if (!items.length) return null;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Choose your creature"
      tabIndex={disabled ? -1 : 0}
      data-diagonal-carousel=""
      data-active-creature={items[currentIndex].id}
      onKeyDown={handleKeyDown}
      onPointerLeave={clearHover}
      onPointerDownCapture={(event) => {
        if (disabled || event.pointerType === "mouse" || !event.isPrimary || (event.target as HTMLElement).closest("[data-carousel-controls]")) return;
        swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerCancel={() => { swipe.current = null; }}
      onPointerUpCapture={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start || start.id !== event.pointerId) return;
        const distance = event.clientX - start.x;
        if (Math.abs(distance) < 40 || Math.abs(distance) < Math.abs(event.clientY - start.y) * 1.3) return;
        suppressClickUntil.current = performance.now() + 400;
        event.preventDefault();
        select(currentIndex + (distance < 0 ? 1 : -1));
      }}
      onClickCapture={(event) => {
        if (performance.now() < suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      className={cn(
        "relative isolate mx-auto w-full max-w-[720px] touch-pan-y overflow-hidden rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "h-[252px] [--slide-size:144px]" : "h-[356px] [--slide-size:200px] sm:h-[396px] sm:[--slide-size:240px]",
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 bottom-16 overflow-hidden" data-carousel-viewport="">
        {items.map((item, index) => {
          const distance = index - currentIndex;
          const isActive = distance === 0;
          const isNearby = Math.abs(distance) <= 1;
          return (
            <motion.div
              key={item.id}
              initial={false}
              animate={{
                x: `${distance * (compact ? 88 : 82)}%`,
                y: distance * (compact ? 46 : 76),
                rotate: distance * 30,
                scale: isActive ? 1 : 0.62,
                opacity: isNearby ? (isActive ? 1 : 0.68) : 0,
              }}
              transition={reducedMotion ? { duration: 0 } : spring}
              style={{ marginLeft: "calc(var(--slide-size) / -2)", marginTop: "calc(var(--slide-size) / -2)", zIndex: isActive ? 2 : 1 }}
              className={cn("absolute top-1/2 left-1/2 size-[var(--slide-size)]", !isNearby && "pointer-events-none")}
              aria-hidden={!isNearby || undefined}
              inert={!isNearby || disabled}
              data-carousel-slide={item.id}
              data-active={isActive ? "true" : "false"}
            >
              {isActive && renderActive ? (
                <div className="flex size-full items-center justify-center" data-carousel-active="">{renderActive}</div>
              ) : (
                <button
                  type="button"
                  aria-label={`Preview ${item.title}`}
                  aria-current={isActive ? "true" : undefined}
                  tabIndex={-1}
                  disabled={disabled}
                  onClick={() => select(index)}
                  onPointerMove={(event) => {
                    // Only physical mouse movement can arm hover. Slides moving
                    // under a stationary pointer must not advance the collection.
                    if (disabled || reducedMotion || isActive || event.pointerType !== "mouse" || (!event.movementX && !event.movementY) || performance.now() - lastSelection.current < 900 || hover.current?.index === index) return;
                    clearHover();
                    hover.current = { index, timer: setTimeout(() => select(index), 160) };
                  }}
                  onPointerLeave={() => { if (hover.current?.index === index) clearHover(); }}
                  className="block size-full cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                >
                  <Image src={item.src} alt="" width={256} height={256} unoptimized draggable={false} className="pointer-events-none size-full select-none object-contain" />
                </button>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="absolute inset-x-2 bottom-3 mx-auto flex w-fit max-w-full items-center gap-1 rounded-full border border-border bg-background/80 p-1.5 backdrop-blur-sm" data-carousel-controls="">
        <Button type="button" variant="ghost" size="icon" aria-label="Previous creature" disabled={disabled || currentIndex === 0} onClick={() => select(currentIndex - 1)}>
          <ChevronLeftIcon />
        </Button>
        <div className="flex items-center" role="group" aria-label="Creature choices">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Choose ${item.title}`}
              aria-pressed={currentIndex === index}
              disabled={disabled}
              onClick={() => select(index)}
              className={cn("group flex h-8 w-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40", compact ? "sm:w-7" : "sm:w-8")}
            >
              <span className={cn("block h-1.5 rounded-full bg-foreground transition-[width,opacity] duration-300 motion-reduce:transition-none", currentIndex === index ? "w-5 opacity-90" : "w-1.5 opacity-25 group-hover:opacity-60")} />
            </button>
          ))}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Next creature" disabled={disabled || currentIndex === items.length - 1} onClick={() => select(currentIndex + 1)}>
          <ChevronRightIcon />
        </Button>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{items[currentIndex].title}, {currentIndex + 1} of {items.length}</p>
    </div>
  );
}
