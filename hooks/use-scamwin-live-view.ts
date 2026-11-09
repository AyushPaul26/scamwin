"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveViewClient, liveRunKey, type LiveViewIdentity, type LiveViewSnapshot } from "@/lib/scamwin/live-view-client";

const empty: LiveViewSnapshot = { response: null, error: "" };
export function useScamwinLiveView({ checkId, runId, generation, active }: LiveViewIdentity & { active: boolean }) {
  const key = liveRunKey({ checkId, runId, generation });
  const [saved, setSaved] = useState<{ key: string; snapshot: LiveViewSnapshot }>({ key, snapshot: empty });
  const client = useRef<{ key: string; value: LiveViewClient } | null>(null);
  useEffect(() => {
    if (!active) return;
    const value = new LiveViewClient({ checkId, runId, generation }, {
      isVisible: () => document.visibilityState !== "hidden",
      publish: snapshot => setSaved({ key, snapshot }),
    });
    client.current = { key, value };
    const visibility = () => value.visibilityChanged();
    document.addEventListener("visibilitychange", visibility);
    value.start();
    return () => { value.dispose(); document.removeEventListener("visibilitychange", visibility); if (client.current?.value === value) client.current = null; };
  }, [checkId, runId, generation, key, active]);
  const reconnect = useCallback(() => { if (client.current?.key === key) client.current.value.reconnect(); }, [key]);
  return { ...(active && saved.key === key ? saved.snapshot : empty), reconnect };
}
