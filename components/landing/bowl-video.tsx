"use client";

import { useEffect, useRef } from "react";
import { FRONT_VIDEO } from "./hero-content";

export function BowlVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const video = element;

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let playbackRequest = 0;
    let failed = false;
    let hovered = false;

    function enabled() {
      return finePointer.matches && !reducedMotion.matches && !document.hidden;
    }

    function stop() {
      hovered = false;
      playbackRequest += 1;
      video.pause();
      video.style.opacity = "0";
    }

    function play(event?: PointerEvent) {
      if (!enabled() || failed || hovered || event?.pointerType === "touch") return;
      hovered = true;
      const request = ++playbackRequest;
      video.play().then(() => {
        if (request !== playbackRequest) return;
        if (enabled() && video.matches(":hover")) video.style.opacity = "1";
        else stop();
      }).catch(() => {
        if (request === playbackRequest) {
          hovered = false;
          video.style.opacity = "0";
        }
      });
    }

    function syncPlayback() {
      if (enabled() && video.matches(":hover")) play();
      else stop();
    }

    function onError() {
      failed = true;
      stop();
    }

    video.addEventListener("pointerenter", play);
    // Also cover a cursor already inside the jar when hydration finishes.
    video.addEventListener("pointermove", play);
    video.addEventListener("pointerleave", stop);
    video.addEventListener("pointercancel", stop);
    video.addEventListener("error", onError);
    finePointer.addEventListener("change", syncPlayback);
    reducedMotion.addEventListener("change", syncPlayback);
    document.addEventListener("visibilitychange", syncPlayback);
    window.addEventListener("blur", stop);
    window.addEventListener("focus", syncPlayback);
    syncPlayback();

    return () => {
      stop();
      video.removeEventListener("pointerenter", play);
      video.removeEventListener("pointermove", play);
      video.removeEventListener("pointerleave", stop);
      video.removeEventListener("pointercancel", stop);
      video.removeEventListener("error", onError);
      finePointer.removeEventListener("change", syncPlayback);
      reducedMotion.removeEventListener("change", syncPlayback);
      document.removeEventListener("visibilitychange", syncPlayback);
      window.removeEventListener("blur", stop);
      window.removeEventListener("focus", syncPlayback);
    };
  }, []);

  return (
    <div className="bowl-scene" aria-hidden="true">
      <video
        ref={videoRef}
        className="bowl-video"
        src={FRONT_VIDEO}
        loop
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
      />
    </div>
  );
}
