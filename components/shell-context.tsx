"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AUTH_ENABLED } from "@/lib/features";
import { createClient } from "@/lib/supabase/client";

interface ShellState {
  user: User | null;
  rightOpen: boolean;
  toggleRight: () => void;
  closeRight: () => void;
}

const ShellContext = createContext<ShellState | null>(null);
const STORAGE_KEY = "nayozu:right-panel";

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [rightOpen, setRightOpen] = useState(false);

  // Remembered choice; first visit: open only on wide screens.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      setRightOpen(saved !== null ? saved === "1" : window.matchMedia("(min-width: 1280px)").matches);
    } catch {
      /* storage unavailable: stay closed */
    }
  }, []);

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const setAndSave = useCallback((open: boolean) => {
    setRightOpen(open);
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ShellState>(
    () => ({
      user,
      rightOpen,
      toggleRight: () => setAndSave(!rightOpen),
      closeRight: () => setAndSave(false),
    }),
    [user, rightOpen, setAndSave],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}