"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { AUTH_ENABLED } from "@/lib/features";
import { createClient } from "@/lib/supabase/client";
import { signOutUserAction } from "@/lib/actions/authActions";

export type ShellUserRole = "user" | "moderator" | "admin" | null;

interface ShellState {
  user: User | null;
  userRole: ShellUserRole;
  authLoading: boolean;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
  rightOpen: boolean;
  toggleRight: () => void;
  closeRight: () => void;
  leftOpen: boolean;
  toggleLeft: () => void;
  closeLeft: () => void;
}

const ShellContext = createContext<ShellState | null>(null);
const STORAGE_KEY = "nayozu:right-panel";

export function isMobileOrTabletViewport(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(max-width: 1023px)").matches;
}

export function coordinateDrawerState(
  prev: { leftOpen: boolean; rightOpen: boolean },
  action: "toggleLeft" | "closeLeft" | "toggleRight" | "closeRight",
  isMobileOrTablet: boolean
): { leftOpen: boolean; rightOpen: boolean } {
  switch (action) {
    case "closeLeft":
      return { ...prev, leftOpen: false };
    case "closeRight":
      return { ...prev, rightOpen: false };
    case "toggleLeft": {
      const nextLeft = !prev.leftOpen;
      return {
        leftOpen: nextLeft,
        rightOpen: nextLeft && isMobileOrTablet ? false : prev.rightOpen,
      };
    }
    case "toggleRight": {
      const nextRight = !prev.rightOpen;
      return {
        leftOpen: nextRight && isMobileOrTablet ? false : prev.leftOpen,
        rightOpen: nextRight,
      };
    }
  }
}

export function ShellProvider({
  children,
  initialUser = null,
  initialUserRole = null,
}: {
  children: React.ReactNode;
  initialUser?: User | null;
  initialUserRole?: ShellUserRole;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [userRole, setUserRole] = useState<ShellUserRole>(initialUserRole);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);

  const initialUserId = initialUser?.id ?? null;
  const initialDisplayName =
    (initialUser?.user_metadata?.display_name as string | undefined) ?? null;
  const initialUsername =
    (initialUser?.user_metadata?.username as string | undefined) ?? null;
  const initialAvatarUrl =
    (initialUser?.user_metadata?.avatar_url as string | undefined) ?? null;

  useEffect(() => {
    setUser(initialUser);
    setUserRole(initialUserRole);
  }, [
    initialUser,
    initialUserId,
    initialDisplayName,
    initialUsername,
    initialAvatarUrl,
    initialUserRole,
  ]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        setRightOpen(saved === "1");
      }
    } catch {
      /* storage unavailable: stay closed */
    }
  }, []);

  const refreshUser = useCallback(async () => {
    if (!AUTH_ENABLED) {
      setUser(null);
      setUserRole(null);
      setAuthLoading(false);
      return;
    }
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) {
        setUser(null);
        setUserRole(null);
      } else {
        setUser(data.user);
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (roleRow?.role === "admin" || roleRow?.role === "moderator") {
          setUserRole(roleRow.role);
        } else {
          setUserRole("user");
        }
      }
    } catch {
      setUser(null);
      setUserRole(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!AUTH_ENABLED) {
      setAuthLoading(false);
      return;
    }
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setUserRole(null);
        setAuthLoading(false);
        return;
      }
      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        if (session?.user) {
          setUser(session.user);
          void refreshUser();
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshUser]);

  const signOut = useCallback(async () => {
    try {
      const supabase = createClient();
      await Promise.allSettled([
        signOutUserAction(),
        supabase.auth.signOut(),
      ]);
    } finally {
      setUser(null);
      setUserRole(null);
    }
  }, []);

  const persistRightOpen = useCallback((open: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRight = useCallback(() => {
    const next = coordinateDrawerState(
      { leftOpen, rightOpen },
      "toggleRight",
      isMobileOrTabletViewport()
    );
    setLeftOpen(next.leftOpen);
    setRightOpen(next.rightOpen);
    persistRightOpen(next.rightOpen);
  }, [leftOpen, rightOpen, persistRightOpen]);

  const closeRight = useCallback(() => {
    const next = coordinateDrawerState(
      { leftOpen, rightOpen },
      "closeRight",
      isMobileOrTabletViewport()
    );
    setRightOpen(next.rightOpen);
    persistRightOpen(false);
  }, [leftOpen, rightOpen, persistRightOpen]);

  const toggleLeft = useCallback(() => {
    const next = coordinateDrawerState(
      { leftOpen, rightOpen },
      "toggleLeft",
      isMobileOrTabletViewport()
    );
    setLeftOpen(next.leftOpen);
    if (next.rightOpen !== rightOpen) {
      setRightOpen(next.rightOpen);
    }
  }, [leftOpen, rightOpen]);

  const closeLeft = useCallback(() => {
    setLeftOpen(false);
  }, []);

  const value = useMemo<ShellState>(
    () => ({
      user,
      userRole,
      authLoading,
      refreshUser,
      signOut,
      rightOpen,
      toggleRight,
      closeRight,
      leftOpen,
      toggleLeft,
      closeLeft,
    }),
    [
      user,
      userRole,
      authLoading,
      refreshUser,
      signOut,
      rightOpen,
      toggleRight,
      closeRight,
      leftOpen,
      toggleLeft,
      closeLeft,
    ]
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}
