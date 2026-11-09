"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function useAvatarActivity(paused: boolean) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [intersection, setIntersection] = useState({ visible: false, entered: false });
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => true,
  );
  const documentVisible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => false,
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      setIntersection((previous) => ({
        visible: entry.isIntersecting,
        entered: previous.entered || entry.isIntersecting,
      }));
    }, { threshold: 0.05 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return {
    containerRef,
    entered: intersection.entered,
    reducedMotion,
    active: intersection.visible && documentVisible && !reducedMotion && !paused,
  };
}
