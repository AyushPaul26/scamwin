"use client";

import { useRef, useState, type ComponentPropsWithRef } from "react";
import { motion, useMotionValue, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

// Adapted from Vengeance UI's Creepy Button for the project's Base UI triggers.
export function CreepyButton({
  children,
  className,
  disabled,
  type = "button",
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  onPointerCancel,
  onFocus,
  onBlur,
  ...props
}: ComponentPropsWithRef<"button">) {
  const eyesRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reduceMotion = useReducedMotion();
  const pupilX = useMotionValue(0);
  const pupilY = useMotionValue(0);
  const animate = !disabled && !reduceMotion && (hovered || focused);

  function resetEyes() {
    pupilX.set(0);
    pupilY.set(0);
    setHovered(false);
  }

  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      data-slot="creepy-button"
      className={cn(
        "relative isolate inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl bg-background text-sm font-medium whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (event.pointerType !== "touch" && !disabled) setHovered(true);
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        if (disabled || reduceMotion || event.pointerType === "touch" || !eyesRef.current) return;
        const rect = eyesRef.current.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const distance = Math.hypot(dx, dy) || 1;
        const travel = Math.min(distance / 25, 3);
        pupilX.set((dx / distance) * travel);
        pupilY.set((dy / distance) * travel);
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        resetEyes();
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        resetEyes();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        setFocused(event.currentTarget.matches(":focus-visible"));
      }}
      onBlur={(event) => {
        onBlur?.(event);
        setFocused(false);
      }}
    >
      <span ref={eyesRef} aria-hidden="true" className="pointer-events-none absolute right-4 bottom-2 flex h-3 items-center gap-1.5">
        {[0, 1].map((eye) => (
          <motion.span
            key={eye}
            data-slot="creepy-eye"
            className="relative size-3 overflow-hidden rounded-full bg-foreground"
            initial={false}
            animate={{ scaleY: animate ? [1, 1, 0.05, 1] : 1 }}
            transition={animate ? { duration: 3, times: [0, 0.92, 0.96, 1], repeat: Infinity, ease: "linear" } : { duration: 0 }}
          >
            <motion.span
              data-slot="creepy-pupil"
              className="absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full bg-background"
              style={{ x: reduceMotion ? 0 : pupilX, y: reduceMotion ? 0 : pupilY }}
            />
          </motion.span>
        ))}
      </span>
      <motion.span
        data-slot="creepy-cover"
        className="pointer-events-none absolute inset-0 flex origin-[1.25rem_50%] items-center justify-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-secondary-foreground"
        initial={false}
        animate={{ rotate: animate ? -12 : 0 }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 20, mass: 0.8 }}
      >
        {children}
      </motion.span>
      <span aria-hidden="true" className="pointer-events-none invisible inline-flex items-center justify-center gap-2 px-4 py-2">
        {children}
      </span>
    </button>
  );
}
