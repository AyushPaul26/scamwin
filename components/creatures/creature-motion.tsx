"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type CreatureMotion = {
  paused: boolean;
  setDialogOpen: (id: string, open: boolean) => void;
};

const CreatureMotionContext = createContext<CreatureMotion>({
  paused: false,
  setDialogOpen: () => {},
});

export function CreatureMotionProvider({ children }: { children: ReactNode }) {
  const [openDialogs, setOpenDialogs] = useState<ReadonlySet<string>>(() => new Set());
  const setDialogOpen = useCallback((id: string, open: boolean) => {
    setOpenDialogs((previous) => {
      if (previous.has(id) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ paused: openDialogs.size > 0, setDialogOpen }), [openDialogs, setDialogOpen]);

  return <CreatureMotionContext.Provider value={value}>{children}</CreatureMotionContext.Provider>;
}

/** A dialog's own avatar stays active while the avatars behind it are paused. */
export function CreatureMotionForeground({ children }: { children: ReactNode }) {
  const { setDialogOpen } = useContext(CreatureMotionContext);
  const value = useMemo(() => ({ paused: false, setDialogOpen }), [setDialogOpen]);
  return <CreatureMotionContext.Provider value={value}>{children}</CreatureMotionContext.Provider>;
}

export function useCreatureMotion() {
  return useContext(CreatureMotionContext);
}
