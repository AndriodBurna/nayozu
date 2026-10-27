"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Bookmark,
  Check,
  CheckCircle2,
  Eye,
  Heart,
  History,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  Moon,
  Palette,
  PanelRight,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Sun,
  Trash2,
  User as UserIcon,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShell } from "@/components/shell-context";
import {
  clearAccountDataAction,
  updatePasswordAction,
  updateProfileSettingsAction,
  updateUserPreferencesAction,
  type AccentColorId,
  type ProfileSettingsData,
  type ThemeModeId,
  type UserPreferences,
} from "./actions";

type SettingsTab =
  | "profile"
  | "appearance"
  | "privacy"
  | "notifications"
  | "security";

const ACCENT_PRESETS: Array<{
  id: AccentColorId;
  label: string;
  hex: string;
  description: string;
}> = [
  {
    id: "purple",
    label: "Electric Purple",
    hex: "#8b5cf6",
    description: "Nayozu signature neon violet",
  },
  {
    id: "emerald",
    label: "Cyber Emerald",
    hex: "#10b981",
    description: "Fresh mint & emerald glow",
  },
  {
    id: "blue",
    label: "Cobalt Blue",
    hex: "#3b82f6",
    description: "Crisp ocean & sky highlights",
  },
  {
    id: "pink",
    label: "Sakura Pink",
    hex: "#ec4899",
    description: "Vibrant magenta & sakura accents",
  },
  {
    id: "amber",
    label: "Solar Amber",
    hex: "#f59e0b",
    description: "Warm gold & sunset contrast",
  },
  {
    id: "red",
    label: "Crimson Red",
    hex: "#ef4444",
    description: "High-energy action crimson",
  },
  {
    id: "white",
    label: "Monochrome White",
    hex: "#f8fafc",
    description: "Minimalist high-contrast monochrome",
  },
];

const AVATAR_PRESETS = [
  {
    label: "Cyber Neon",
    url: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=240&auto=format&fit=crop&q=80",
  },
  {
    label: "Tokyo Night",
    url: "https://images.unsplash.com/photo-1563089145-599997674d42?w=240&auto=format&fit=crop&q=80",
  },
  {
    label: "Astral Prism",
    url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=240&auto=format&fit=crop&q=80",
  },
  {
    label: "Violet Horizon",
    url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80",
  },
];

const DEFAULT_GUEST_PREFS: UserPreferences = {
  accentColor: "purple",
  themeMode: "dark",
  reducedMotion: false,
  defaultSpoilerProtection: true,
  showActivityInCommunity: true,
  notifyEpisodeReleases: true,
  notifyCommunityReplies: true,
  notifyWatchTogetherInvites: true,
};

interface SettingsClientProps {
  initialData: ProfileSettingsData | null;
}

export default function SettingsClient({ initialData }: SettingsClientProps) {
  const router = useRouter();
  const { rightOpen, toggleRight } = useShell();

  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialData ? "profile" : "appearance"
  );
  const [isPending, startTransition] = useTransition();

  // Banner feedback state
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Profile fields
  const [username, setUsername] = useState(initialData?.username ?? "");
  const [displayName, setDisplayName] = useState(
    initialData?.displayName ?? ""
  );
  const [avatarUrl, setAvatarUrl] = useState(initialData?.avatarUrl ?? "");
  const [bio, setBio] = useState(initialData?.bio ?? "");
  const [lastUpdated, setLastUpdated] = useState<string | null>(
    initialData?.updatedAt ?? null
  );

  // Account counts
  const [counts, setCounts] = useState({
    library: initialData?.libraryCount ?? 0,
    ratings: initialData?.ratingsCount ?? 0,
    reviews: initialData?.reviewsCount ?? 0,
    comments: initialData?.commentsCount ?? 0,
  });

  // Preferences state
  const [prefs, setPrefs] = useState<UserPreferences>(
    initialData?.preferences ?? DEFAULT_GUEST_PREFS
  );

  // Password form state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Danger zone state
  const [clearConfirmation, setClearConfirmation] = useState("");
  const [signingOutScope, setSigningOutScope] = useState<
    "local" | "global" | null
  >(null);

  // Hydrate browser-stored accent & theme on mount
  useEffect(() => {
    try {
      const savedAccent = localStorage.getItem(
        "nayozu-accent"
      ) as AccentColorId | null;
      const savedTheme = localStorage.getItem(
        "nayozu-theme"
      ) as ThemeModeId | null;
      const savedMotion = localStorage.getItem("nayozu-reduced-motion");

      setPrefs((prev) => {
        const resolvedAccent =
          savedAccent && ACCENT_PRESETS.some((a) => a.id === savedAccent)
            ? savedAccent
            : prev.accentColor;
        const resolvedTheme =
          savedTheme && ["dark", "light", "system"].includes(savedTheme)
            ? savedTheme
            : prev.themeMode;
        const resolvedMotion =
          savedMotion !== null ? savedMotion === "1" : prev.reducedMotion;

        document.documentElement.setAttribute("data-accent", resolvedAccent);
        applyThemeToDocument(resolvedTheme);

        return {
          ...prev,
          accentColor: resolvedAccent,
          themeMode: resolvedTheme,
          reducedMotion: resolvedMotion,
        };
      });
    } catch {
      /* ignore storage errors */
    }
  }, []);

  function applyThemeToDocument(mode: ThemeModeId) {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const useDark = mode === "dark" || (mode === "system" && prefersDark);
    root.classList.toggle("dark", useDark);
    root.classList.toggle("light", !useDark);
  }

  function handleSelectAccent(accent: AccentColorId) {
    setFeedback(null);
    setPrefs((prev) => ({ ...prev, accentColor: accent }));
    try {
      localStorage.setItem("nayozu-accent", accent);
      document.documentElement.setAttribute("data-accent", accent);
    } catch {
      /* ignore */
    }

    if (initialData) {
      startTransition(async () => {
        const res = await updateUserPreferencesAction({ accentColor: accent });
        if (!res.success) {
          setFeedback({
            type: "error",
            text: res.error || "Could not sync accent color to account.",
          });
        } else {
          setFeedback({
            type: "success",
            text: `Accent color updated to ${
              ACCENT_PRESETS.find((a) => a.id === accent)?.label ?? accent
            } and synced to your account.`,
          });
        }
      });
    } else {
      setFeedback({
        type: "success",
        text: `Accent color updated to ${
          ACCENT_PRESETS.find((a) => a.id === accent)?.label ?? accent
        } in this browser.`,
      });
    }
  }

  function handleSelectThemeMode(mode: ThemeModeId) {
    setFeedback(null);
    setPrefs((prev) => ({ ...prev, themeMode: mode }));
    try {
      localStorage.setItem("nayozu-theme", mode);
      applyThemeToDocument(mode);
    } catch {
      /* ignore */
    }

    if (initialData) {
      startTransition(async () => {
        const res = await updateUserPreferencesAction({ themeMode: mode });
        if (!res.success) {
          setFeedback({
            type: "error",
            text: res.error || "Could not sync theme preference.",
          });
        } else {
          setFeedback({
            type: "success",
            text: `Theme preference set to ${mode.toUpperCase()} and saved.`,
          });
        }
      });
    } else {
      setFeedback({
        type: "success",
        text: `Theme preference set to ${mode.toUpperCase()} in this browser.`,
      });
    }
  }

  function handleTogglePreference(
    key: keyof Omit<UserPreferences, "accentColor" | "themeMode">,
    nextValue: boolean
  ) {
    setFeedback(null);
    setPrefs((prev) => ({ ...prev, [key]: nextValue }));

    if (key === "reducedMotion") {
      try {
        localStorage.setItem("nayozu-reduced-motion", nextValue ? "1" : "0");
      } catch {
        /* ignore */
      }
    }

    if (!initialData) {
      setFeedback({
        type: "success",
        text: "Preference saved locally in this browser. Sign in to sync across devices.",
      });
      return;
    }

    startTransition(async () => {
      const res = await updateUserPreferencesAction({ [key]: nextValue });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Failed to save preference.",
        });
      } else {
        setFeedback({
          type: "success",
          text: res.message || "Preference saved to your account.",
        });
      }
    });
  }

  function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!initialData) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await updateProfileSettingsAction({
        username,
        displayName,
        avatarUrl,
        bio,
      });

      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Failed to update profile.",
        });
        return;
      }

      if (res.profile) {
        setUsername(res.profile.username);
        setDisplayName(res.profile.displayName);
        setAvatarUrl(res.profile.avatarUrl);
        setBio(res.profile.bio);
        setLastUpdated(res.profile.updatedAt);
      }

      setFeedback({
        type: "success",
        text: res.message || "Profile updated.",
      });
      router.refresh();
    });
  }

  function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!initialData) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await updatePasswordAction({
        newPassword,
        confirmPassword,
      });

      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Failed to update password.",
        });
        return;
      }

      setNewPassword("");
      setConfirmPassword("");
      setFeedback({
        type: "success",
        text: res.message || "Password updated.",
      });
    });
  }

  async function handleSignOut(scope: "local" | "global") {
    setSigningOutScope(scope);
    setFeedback(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut({ scope });
      if (error) {
        setFeedback({
          type: "error",
          text: error.message || "Failed to sign out.",
        });
        setSigningOutScope(null);
        return;
      }
      router.push("/auth/login");
      router.refresh();
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to sign out.",
      });
      setSigningOutScope(null);
    }
  }

  function handleClearAccountData(e: React.FormEvent) {
    e.preventDefault();
    if (!initialData) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await clearAccountDataAction({
        confirmationText: clearConfirmation,
      });

      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Failed to clear account data.",
        });
        return;
      }

      setClearConfirmation("");
      setBio("");
      setAvatarUrl("");
      setCounts({ library: 0, ratings: 0, reviews: 0, comments: 0 });
      setFeedback({
        type: "success",
        text:
          res.message ||
          "Your personal library and activity data have been cleared.",
      });
      router.refresh();
    });
  }

  const tabs: Array<{
    id: SettingsTab;
    label: string;
    icon: typeof UserIcon;
    description: string;
    requiresAuth?: boolean;
  }> = [
    {
      id: "profile",
      label: "Profile & Account",
      icon: UserIcon,
      description: "Display name, @username, avatar & bio",
      requiresAuth: true,
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: Palette,
      description: "Accent colors, theme mode & layout",
    },
    {
      id: "privacy",
      label: "Privacy & Visibility",
      icon: Eye,
      description: "Library RLS, spoilers & activity visibility",
      requiresAuth: true,
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: Bell,
      description: "In-app release & community alerts",
      requiresAuth: true,
    },
    {
      id: "security",
      label: "Security & Sessions",
      icon: Shield,
      description: "Password, active sessions & data controls",
      requiresAuth: true,
    },
  ];

  const renderAuthGate = (sectionTitle: string, sectionSummary: string) => (
    <div className="rounded-3xl border border-[#1f263d] bg-[#101422] p-8 md:p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary border border-primary/30">
        <Lock className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-bold text-white mb-2">
        Sign in to manage {sectionTitle}
      </h2>
      <p className="mx-auto max-w-lg text-sm text-zinc-400 leading-relaxed mb-6">
        {sectionSummary} Appearance preferences remain available without an
        account and are saved locally in your browser.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/auth/login"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110 transition-all"
        >
          Sign In to Nayozu
        </Link>
        <Link
          href="/auth/sign-up"
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#151a2a] px-5 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-[#1c2236] hover:text-white transition-colors"
        >
          Create Free Account
        </Link>
        <button
          type="button"
          onClick={() => setActiveTab("appearance")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
        >
          <Palette className="h-3.5 w-3.5" />
          Customize Appearance
        </button>
      </div>
    </div>
  );

  return (
    <div className="w-full space-y-6 pb-10">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1e2438] bg-gradient-to-br from-[#13192b] via-[#0e1320] to-[#0b0e17] p-6 md:p-8 shadow-xl">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Settings className="h-3.5 w-3.5" />
              Account &amp; Application Preferences
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              Settings
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Manage your public Nayozu profile, customize your accent theme,
              configure spoiler &amp; notification preferences, and control
              active authentication sessions.
            </p>
          </div>

          {initialData ? (
            <div className="flex items-center gap-3.5 rounded-2xl border border-white/10 bg-[#141929]/90 px-4 py-3">
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-primary/40 bg-[#1c2338] flex items-center justify-center text-sm font-bold text-white">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName || username}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (displayName || username || "U").charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-bold text-white">
                    {displayName || username}
                  </p>
                  <span className="rounded-md bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    {initialData.role}
                  </span>
                </div>
                <p className="truncate text-xs text-zinc-400">
                  @{username} {initialData.email ? `· ${initialData.email}` : ""}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              <Sparkles className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Browsing as Guest · Appearance settings save to this browser
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Status Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs font-medium",
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/30 bg-red-500/10 text-red-200"
          )}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 text-red-400" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] underline opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Layout Grid: Left Category Rail + Right Content Area */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Category Navigation Rail */}
        <nav
          aria-label="Settings sections"
          className="flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setActiveTab(tab.id);
                }}
                className={cn(
                  "flex shrink-0 items-start gap-3 rounded-2xl border p-3.5 text-left transition-all",
                  active
                    ? "border-primary/50 bg-primary/15 text-white shadow-md shadow-primary/10"
                    : "border-[#1c2236] bg-[#101422] text-zinc-400 hover:border-white/10 hover:bg-[#14192a] hover:text-zinc-200"
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-[#171d30] text-zinc-400"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="text-xs font-bold leading-snug">
                      {tab.label}
                    </p>
                    {tab.requiresAuth && !initialData && (
                      <Lock className="h-3 w-3 shrink-0 text-zinc-500" />
                    )}
                  </div>
                  <p className="mt-0.5 hidden text-[11px] text-zinc-500 lg:block line-clamp-1">
                    {tab.description}
                  </p>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Active Tab Panel */}
        <div className="space-y-6 min-w-0">
          {/* ============================================================== */}
          {/* TAB 1: PROFILE & ACCOUNT                                       */}
          {/* ============================================================== */}
          {activeTab === "profile" &&
            (!initialData ? (
              renderAuthGate(
                "Profile & Account Settings",
                "Sign in to customize your public @username, display name, avatar, and bio stored in Supabase."
              )
            ) : (
              <>
                <form
                  onSubmit={handleSaveProfile}
                  className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-6"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-4">
                    <div>
                      <h2 className="text-lg font-bold text-white">
                        Public Profile
                      </h2>
                      <p className="text-xs text-zinc-400">
                        Stored in{" "}
                        <code className="text-zinc-300">public.profiles</code>{" "}
                        and synced with your Supabase Auth metadata.
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Persisted to Database
                    </span>
                  </div>

                  {/* Live Profile Card Preview */}
                  <div className="rounded-2xl border border-white/10 bg-[#151a2c] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                      Live Profile Preview
                    </p>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-primary/40 bg-[#1d243b] flex items-center justify-center text-xl font-extrabold text-white">
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt={displayName || username}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (displayName || username || "U")
                            .charAt(0)
                            .toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-bold text-white">
                            {displayName || username}
                          </h3>
                          <span className="text-xs text-zinc-400">
                            @{username}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-300 line-clamp-2">
                          {bio ||
                            "No bio added yet. Tell the community what anime or manga you're currently enjoying!"}
                        </p>
                      </div>
                      <Link
                        href="/profile"
                        className="self-start sm:self-center shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        View Profile Page →
                      </Link>
                    </div>
                  </div>

                  {/* Form Fields */}
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="settings-display-name"
                        className="block text-xs font-semibold text-zinc-300"
                      >
                        Display Name
                      </label>
                      <input
                        id="settings-display-name"
                        type="text"
                        required
                        maxLength={60}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your display name"
                        className="w-full rounded-xl border border-[#232a42] bg-[#151a2a] px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-primary focus:outline-none"
                      />
                      <p className="text-[11px] text-zinc-500">
                        Shown on community discussions, reviews, and Watch
                        Together rooms (1–60 chars).
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="settings-username"
                        className="block text-xs font-semibold text-zinc-300"
                      >
                        Username (@handle)
                      </label>
                      <div className="relative flex items-center">
                        <span className="pointer-events-none absolute left-3.5 text-sm text-zinc-500">
                          @
                        </span>
                        <input
                          id="settings-username"
                          type="text"
                          required
                          maxLength={30}
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="username"
                          className="w-full rounded-xl border border-[#232a42] bg-[#151a2a] pl-8 pr-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-primary focus:outline-none"
                        />
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Unique 3–30 character handle (letters, numbers,{" "}
                        <code>_</code>, or <code>-</code>).
                      </p>
                    </div>
                  </div>

                  {/* Avatar URL + Quick Presets */}
                  <div className="space-y-2.5">
                    <label
                      htmlFor="settings-avatar-url"
                      className="block text-xs font-semibold text-zinc-300"
                    >
                      Avatar Image URL
                    </label>
                    <input
                      id="settings-avatar-url"
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://images.unsplash.com/..."
                      className="w-full rounded-xl border border-[#232a42] bg-[#151a2a] px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-primary focus:outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-[11px] font-medium text-zinc-400 mr-1">
                        Quick presets:
                      </span>
                      {AVATAR_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setAvatarUrl(preset.url)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                            avatarUrl === preset.url
                              ? "border-primary bg-primary/20 text-white"
                              : "border-white/10 bg-[#151a2a] text-zinc-300 hover:bg-white/10"
                          )}
                        >
                          <img
                            src={preset.url}
                            alt={preset.label}
                            className="h-4 w-4 rounded-full object-cover"
                          />
                          {preset.label}
                        </button>
                      ))}
                      {avatarUrl && (
                        <button
                          type="button"
                          onClick={() => setAvatarUrl("")}
                          className="rounded-lg border border-white/10 bg-[#151a2a] px-2.5 py-1 text-[11px] text-zinc-400 hover:text-white"
                        >
                          Clear Avatar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Bio */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="settings-bio"
                        className="block text-xs font-semibold text-zinc-300"
                      >
                        Bio / About You
                      </label>
                      <span className="text-[11px] text-zinc-500">
                        {bio.length}/500
                      </span>
                    </div>
                    <textarea
                      id="settings-bio"
                      rows={3}
                      maxLength={500}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Share your favorite genres, top 3 anime, or current reading list..."
                      className="w-full rounded-xl border border-[#232a42] bg-[#151a2a] px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5">
                    <div className="text-[11px] text-zinc-500">
                      {lastUpdated ? (
                        <>
                          Last updated:{" "}
                          <span className="text-zinc-300">
                            {new Date(lastUpdated).toLocaleString()}
                          </span>
                        </>
                      ) : (
                        "Changes update your public profile immediately."
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setUsername(initialData.username);
                          setDisplayName(initialData.displayName);
                          setAvatarUrl(initialData.avatarUrl);
                          setBio(initialData.bio);
                          setFeedback(null);
                        }}
                        className="rounded-xl border border-white/10 bg-[#151a2a] px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-[#1c2338] hover:text-white transition-colors disabled:opacity-50"
                      >
                        Reset
                      </button>
                      <button
                        type="submit"
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110 transition-all disabled:opacity-50"
                      >
                        {isPending && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        Save Profile Changes
                      </button>
                    </div>
                  </div>
                </form>

                {/* Account Summary & Quick Library Links */}
                <div className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-4">
                  <h3 className="text-sm font-bold text-white">
                    Account Identifiers &amp; Library Overview
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/5 bg-[#151a2a] p-3.5">
                      <p className="text-[11px] text-zinc-400">Account Email</p>
                      <p className="mt-1 truncate text-xs font-semibold text-white">
                        {initialData.email || "Not provided"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-[#151a2a] p-3.5">
                      <p className="text-[11px] text-zinc-400">Account Role</p>
                      <p className="mt-1 text-xs font-semibold uppercase text-primary">
                        {initialData.role}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-[#151a2a] p-3.5">
                      <p className="text-[11px] text-zinc-400">Member Since</p>
                      <p className="mt-1 text-xs font-semibold text-white">
                        {initialData.createdAt
                          ? new Date(initialData.createdAt).toLocaleDateString()
                          : "Recently joined"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-1">
                    <Link
                      href="/watchlist"
                      className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#151a2a] p-3.5 hover:border-primary/40 transition-colors"
                    >
                      <div>
                        <p className="text-[11px] text-zinc-400">
                          Library Entries
                        </p>
                        <p className="text-lg font-extrabold text-white">
                          {counts.library}
                        </p>
                      </div>
                      <Bookmark className="h-4 w-4 text-primary" />
                    </Link>
                    <Link
                      href="/history"
                      className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#151a2a] p-3.5 hover:border-primary/40 transition-colors"
                    >
                      <div>
                        <p className="text-[11px] text-zinc-400">Ratings</p>
                        <p className="text-lg font-extrabold text-white">
                          {counts.ratings}
                        </p>
                      </div>
                      <Heart className="h-4 w-4 text-pink-400" />
                    </Link>
                    <Link
                      href="/community"
                      className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#151a2a] p-3.5 hover:border-primary/40 transition-colors"
                    >
                      <div>
                        <p className="text-[11px] text-zinc-400">Reviews</p>
                        <p className="text-lg font-extrabold text-white">
                          {counts.reviews}
                        </p>
                      </div>
                      <Sparkles className="h-4 w-4 text-amber-400" />
                    </Link>
                    <Link
                      href="/community"
                      className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#151a2a] p-3.5 hover:border-primary/40 transition-colors"
                    >
                      <div>
                        <p className="text-[11px] text-zinc-400">Comments</p>
                        <p className="text-lg font-extrabold text-white">
                          {counts.comments}
                        </p>
                      </div>
                      <History className="h-4 w-4 text-emerald-400" />
                    </Link>
                  </div>
                </div>
              </>
            ))}

          {/* ============================================================== */}
          {/* TAB 2: APPEARANCE                                              */}
          {/* ============================================================== */}
          {activeTab === "appearance" && (
            <div className="space-y-6">
              {/* Accent Color Picker */}
              <div className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      Accent Color
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Choose your primary highlight color across buttons, active
                      navigation, badges, and focus rings.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {initialData
                      ? "Browser + Account Synced"
                      : "Saved in Browser"}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {ACCENT_PRESETS.map((preset) => {
                    const isSelected = prefs.accentColor === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectAccent(preset.id)}
                        className={cn(
                          "flex items-center gap-3.5 rounded-2xl border p-3.5 text-left transition-all",
                          isSelected
                            ? "border-primary bg-primary/15 shadow-md shadow-primary/10"
                            : "border-white/5 bg-[#151a2a] hover:border-white/15 hover:bg-[#192036]"
                        )}
                      >
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-inner"
                          style={{ backgroundColor: preset.hex }}
                        >
                          {isSelected && (
                            <Check
                              className={cn(
                                "h-4 w-4 stroke-[3]",
                                preset.id === "white"
                                  ? "text-zinc-900"
                                  : "text-white"
                              )}
                            />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white">
                            {preset.label}
                          </p>
                          <p className="truncate text-[11px] text-zinc-400">
                            {preset.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Theme Mode Selection */}
              <div className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      Color Theme Mode
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Select how CSS theme tokens (<code>--background</code>,{" "}
                      <code>--card</code>, <code>--foreground</code>) are
                      applied to the document root.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(
                    [
                      {
                        id: "dark" as ThemeModeId,
                        label: "Cinema Dark (Default)",
                        desc: "Deep slate surfaces built for anime streaming",
                        icon: Moon,
                      },
                      {
                        id: "light" as ThemeModeId,
                        label: "Light Tokens",
                        desc: "Applies light CSS token variables where supported",
                        icon: Sun,
                      },
                      {
                        id: "system" as ThemeModeId,
                        label: "System Preference",
                        desc: "Follows your OS dark/light appearance",
                        icon: Laptop,
                      },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    const active = prefs.themeMode === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectThemeMode(item.id)}
                        className={cn(
                          "flex flex-col justify-between gap-3 rounded-2xl border p-4 text-left transition-all",
                          active
                            ? "border-primary bg-primary/15 text-white"
                            : "border-white/5 bg-[#151a2a] text-zinc-300 hover:border-white/15"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <Icon
                            className={cn(
                              "h-5 w-5",
                              active ? "text-primary" : "text-zinc-400"
                            )}
                          />
                          {active && (
                            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                              Active
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-white">
                            {item.label}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-400">
                            {item.desc}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-2xl border border-white/5 bg-[#141828] px-4 py-3 text-[11px] text-zinc-400">
                  <strong className="text-zinc-200">Design Note:</strong>{" "}
                  Nayozu&apos;s primary application shell uses a dedicated
                  Cinema Dark palette for media legibility. Token-based dialogs
                  and theme-aware components automatically follow your selected
                  mode.
                </div>
              </div>

              {/* Interface & Accessibility Controls */}
              <div className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-4">
                <h2 className="text-lg font-bold text-white border-b border-white/5 pb-3">
                  Interface &amp; Layout Controls
                </h2>

                <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#151a2a] p-4">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <PanelRight className="h-4 w-4 text-primary" />
                      <p className="text-xs font-bold text-white">
                        Right Community &amp; Activity Panel
                      </p>
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Show or hide the right-hand community &amp; Watch Together
                      sidebar panel.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleRight}
                    className={cn(
                      "rounded-xl px-4 py-2 text-xs font-bold transition-colors",
                      rightOpen
                        ? "bg-primary text-primary-foreground"
                        : "border border-white/10 bg-[#1c2338] text-zinc-300 hover:text-white"
                    )}
                  >
                    {rightOpen ? "Visible" : "Hidden"}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#151a2a] p-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-white">
                      Prefer Reduced Motion
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      Minimize non-essential hover animations and carousel
                      transitions.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs.reducedMotion}
                    onClick={() =>
                      handleTogglePreference(
                        "reducedMotion",
                        !prefs.reducedMotion
                      )
                    }
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      prefs.reducedMotion ? "bg-primary" : "bg-zinc-700"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
                        prefs.reducedMotion ? "translate-x-5" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: PRIVACY & VISIBILITY                                    */}
          {/* ============================================================== */}
          {activeTab === "privacy" &&
            (!initialData ? (
              renderAuthGate(
                "Privacy & Visibility Controls",
                "Sign in to configure spoiler blur defaults and community activity visibility for your Nayozu account."
              )
            ) : (
              <div className="space-y-6">
                {/* Enforced RLS Guarantees */}
                <div className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-4">
                    <div>
                      <h2 className="text-lg font-bold text-white">
                        Privacy &amp; Content Visibility
                      </h2>
                      <p className="text-xs text-zinc-400">
                        Manage your account-wide spoiler and activity settings
                        alongside Supabase Row Level Security policies.
                      </p>
                    </div>
                  </div>

                  {/* RLS Protected Library Status */}
                  <div className="flex items-start justify-between gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-emerald-400" />
                        <p className="text-xs font-bold text-white">
                          Personal Library Privacy (Watchlist, Reading List
                          &amp; Favorites)
                        </p>
                      </div>
                      <p className="text-[11px] text-zinc-300 leading-relaxed">
                        Strictly private to your account. Enforced on the server
                        by Supabase Row Level Security (
                        <code className="text-emerald-300">
                          auth.uid() = user_id
                        </code>{" "}
                        on <code>public.user_anime_library</code>). Other users
                        cannot query your personal lists.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                      RLS Enforced
                    </span>
                  </div>

                  {/* Working Toggle 1: Default Spoiler Blur */}
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#151a2a] p-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-white">
                          Blur Spoiler-Tagged Community Posts by Default
                        </p>
                        <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Persisted
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        Require an explicit click before revealing posts marked
                        with a spoiler warning in Community and episode threads.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={prefs.defaultSpoilerProtection}
                      disabled={isPending}
                      onClick={() =>
                        handleTogglePreference(
                          "defaultSpoilerProtection",
                          !prefs.defaultSpoilerProtection
                        )
                      }
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50",
                        prefs.defaultSpoilerProtection
                          ? "bg-primary"
                          : "bg-zinc-700"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
                          prefs.defaultSpoilerProtection
                            ? "translate-x-5"
                            : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>

                  {/* Working Toggle 2: Community Activity Preference */}
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#151a2a] p-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-white">
                          Display Active Status in Community &amp; Watch
                          Together
                        </p>
                        <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Persisted
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        Allow your profile badge to appear in the community
                        sidebar when participating in public rooms.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={prefs.showActivityInCommunity}
                      disabled={isPending}
                      onClick={() =>
                        handleTogglePreference(
                          "showActivityInCommunity",
                          !prefs.showActivityInCommunity
                        )
                      }
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50",
                        prefs.showActivityInCommunity
                          ? "bg-primary"
                          : "bg-zinc-700"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
                          prefs.showActivityInCommunity
                            ? "translate-x-5"
                            : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>

                  {/* Honest Unavailable Feature: Private Profile Mode */}
                  <div className="flex items-start justify-between gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 opacity-90">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-zinc-200">
                          Private Profile &amp; Hidden Reviews Mode
                        </p>
                        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          Requires Schema Migration
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        The current database schema defines{" "}
                        <code>public.profiles</code>,{" "}
                        <code>public.anime_reviews</code>, and{" "}
                        <code>public.anime_comments</code> with public{" "}
                        <code>SELECT</code> RLS policies so community threads
                        can resolve author attribution. Hiding public profiles
                        requires adding an <code>is_private</code> column and
                        updating RLS policies.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled
                      className="shrink-0 cursor-not-allowed rounded-xl border border-white/10 bg-zinc-800/70 px-3 py-1.5 text-[11px] font-semibold text-zinc-500"
                    >
                      Public Only
                    </button>
                  </div>
                </div>
              </div>
            ))}

          {/* ============================================================== */}
          {/* TAB 4: NOTIFICATIONS                                           */}
          {/* ============================================================== */}
          {activeTab === "notifications" &&
            (!initialData ? (
              renderAuthGate(
                "Notification Preferences",
                "Sign in to save your in-app notification preferences to your Nayozu account."
              )
            ) : (
              <div className="space-y-6">
                {/* Working In-App Preferences */}
                <div className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-4">
                    <div>
                      <h2 className="text-lg font-bold text-white">
                        In-App Notification Preferences
                      </h2>
                      <p className="text-xs text-zinc-400">
                        Persisted in your Supabase Auth{" "}
                        <code className="text-zinc-300">
                          user_metadata.preferences
                        </code>
                        .
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Account Persisted
                    </span>
                  </div>

                  {(
                    [
                      {
                        key: "notifyEpisodeReleases" as const,
                        title: "Episode Release & Calendar Highlights",
                        desc: "Highlight newly aired episodes and upcoming premieres for titles in your Watchlist.",
                      },
                      {
                        key: "notifyCommunityReplies" as const,
                        title: "Community Discussion Replies",
                        desc: "Show in-app indicators when members reply to your discussion threads or questions.",
                      },
                      {
                        key: "notifyWatchTogetherInvites" as const,
                        title: "Watch Together Room Activity",
                        desc: "Show alerts when active Watch Together rooms are hosted in the community panel.",
                      },
                    ] as const
                  ).map((item) => {
                    const checked = prefs[item.key];
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#151a2a] p-4"
                      >
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-white">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-zinc-400">
                            {item.desc}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          disabled={isPending}
                          onClick={() =>
                            handleTogglePreference(item.key, !checked)
                          }
                          className={cn(
                            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50",
                            checked ? "bg-primary" : "bg-zinc-700"
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
                              checked ? "translate-x-5" : "translate-x-0"
                            )}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Unavailable External Delivery Channels */}
                <div className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        External Delivery Channels
                      </h3>
                      <p className="text-xs text-zinc-400">
                        Features below require external mailer or push worker
                        infrastructure not yet connected.
                      </p>
                    </div>
                    <span className="rounded-full border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-[10px] font-semibold text-zinc-400">
                      Unavailable
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#141826] p-4 opacity-75">
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-zinc-300">
                        Email Digests &amp; Episode Alerts
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        Requires a transactional email provider (SMTP / Resend)
                        and scheduled cron worker.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-lg border border-white/10 bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-400">
                      Not Configured
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#141826] p-4 opacity-75">
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-zinc-300">
                        Browser Web Push Notifications
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        Requires a Web Push service worker and VAPID key pair
                        registration.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-lg border border-white/10 bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-400">
                      Not Configured
                    </span>
                  </div>
                </div>
              </div>
            ))}

          {/* ============================================================== */}
          {/* TAB 5: SECURITY & SESSIONS                                     */}
          {/* ============================================================== */}
          {activeTab === "security" &&
            (!initialData ? (
              renderAuthGate(
                "Security & Session Management",
                "Sign in to update your password, inspect active sessions, sign out across devices, or clear your account data."
              )
            ) : (
              <div className="space-y-6">
                {/* Change Password */}
                <form
                  onSubmit={handleUpdatePassword}
                  className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                        <KeyRound className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-white">
                          Update Password
                        </h2>
                        <p className="text-xs text-zinc-400">
                          Managed securely via Supabase Auth (
                          <code>supabase.auth.updateUser</code>).
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="settings-new-password"
                        className="block text-xs font-semibold text-zinc-300"
                      >
                        New Password
                      </label>
                      <input
                        id="settings-new-password"
                        type="password"
                        required
                        minLength={8}
                        maxLength={128}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full rounded-xl border border-[#232a42] bg-[#151a2a] px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="settings-confirm-password"
                        className="block text-xs font-semibold text-zinc-300"
                      >
                        Confirm New Password
                      </label>
                      <input
                        id="settings-confirm-password"
                        type="password"
                        required
                        minLength={8}
                        maxLength={128}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        className="w-full rounded-xl border border-[#232a42] bg-[#151a2a] px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={isPending || !newPassword || !confirmPassword}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      {isPending && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      Update Password
                    </button>
                  </div>
                </form>

                {/* Active Session & Sign-Out Controls */}
                <div className="rounded-3xl border border-[#1e2438] bg-[#101422] p-6 space-y-5">
                  <div className="border-b border-white/5 pb-4">
                    <h2 className="text-lg font-bold text-white">
                      Active Session &amp; Device Management
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Inspect your current authenticated session or sign out of
                      Nayozu on this browser or across all signed-in devices.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/5 bg-[#151a2a] p-3.5">
                      <p className="text-[11px] text-zinc-400">Auth Provider</p>
                      <p className="mt-1 text-xs font-bold uppercase text-white">
                        {initialData.authProvider}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-[#151a2a] p-3.5">
                      <p className="text-[11px] text-zinc-400">Last Sign-In</p>
                      <p className="mt-1 text-xs font-semibold text-white">
                        {initialData.lastSignInAt
                          ? new Date(initialData.lastSignInAt).toLocaleString()
                          : "Active session"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-[#151a2a] p-3.5">
                      <p className="text-[11px] text-zinc-400">User UUID</p>
                      <p className="mt-1 truncate font-mono text-[11px] text-zinc-300">
                        {initialData.id}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      disabled={signingOutScope !== null}
                      onClick={() => handleSignOut("local")}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#151a2a] px-4 py-2.5 text-xs font-bold text-zinc-200 hover:bg-[#1c2338] hover:text-white transition-colors disabled:opacity-50"
                    >
                      {signingOutScope === "local" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <LogOut className="h-4 w-4" />
                      )}
                      Sign Out (This Device)
                    </button>

                    <button
                      type="button"
                      disabled={signingOutScope !== null}
                      onClick={() => handleSignOut("global")}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-200 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                    >
                      {signingOutScope === "global" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Sign Out All Devices (Global Revoke)
                    </button>
                  </div>
                </div>

                {/* Danger Zone: Clear Account Data & Account Deletion Disclosure */}
                <div className="rounded-3xl border border-red-500/30 bg-[#14111d] p-6 space-y-5">
                  <div className="flex items-start gap-3 border-b border-red-500/20 pb-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-400">
                      <ShieldAlert className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white">
                        Danger Zone
                      </h2>
                      <p className="text-xs text-zinc-400">
                        Irreversible actions that wipe your personal library,
                        activity history, and profile data.
                      </p>
                    </div>
                  </div>

                  {/* Working Server-Side Data Wipe */}
                  <form
                    onSubmit={handleClearAccountData}
                    className="rounded-2xl border border-red-500/20 bg-[#191424] p-4 space-y-4"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-white">
                          Clear All Personal Library &amp; Activity Data
                        </h3>
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          Server-Side Enforced
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Permanently deletes all of your Watchlist, Reading List,
                        and Favorites entries (
                        <code>public.user_anime_library</code>), ratings (
                        <code>public.anime_ratings</code>), reviews (
                        <code>public.anime_reviews</code>), and comments (
                        <code>public.anime_comments</code>), and resets your
                        profile bio and avatar.
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-1.5">
                        <label
                          htmlFor="settings-clear-confirm"
                          className="block text-[11px] font-semibold text-zinc-300"
                        >
                          Type{" "}
                          <code className="text-red-300 font-bold">
                            CLEAR MY DATA
                          </code>{" "}
                          to confirm:
                        </label>
                        <input
                          id="settings-clear-confirm"
                          type="text"
                          value={clearConfirmation}
                          onChange={(e) => setClearConfirmation(e.target.value)}
                          placeholder="CLEAR MY DATA"
                          className="w-full rounded-xl border border-red-500/30 bg-[#120e1a] px-3.5 py-2 text-xs text-white placeholder-zinc-600 focus:border-red-400 focus:outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={
                          isPending ||
                          clearConfirmation.trim() !== "CLEAR MY DATA"
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Clear Account Data
                      </button>
                    </div>
                  </form>

                  {/* Honest Disclosure for Full auth.users Deletion */}
                  <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#161320] p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                        <p className="text-xs font-bold text-zinc-200">
                          Permanent Auth Account Deletion (
                          <code>auth.users</code>)
                        </p>
                        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          Requires Admin Edge Function
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        Deleting a root identity row in <code>auth.users</code>{" "}
                        requires Supabase&apos;s privileged{" "}
                        <code>service_role</code> key (
                        <code>supabase.auth.admin.deleteUser</code>), which is
                        never exposed to client or standard session contexts.
                        You can use <strong>Clear Account Data</strong> above to
                        erase all personal data and then sign out globally.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
