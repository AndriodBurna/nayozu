"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Flame,
  Bell,
  PanelRight,
  Menu,
  User as UserIcon,
  Bookmark,
  Glasses,
  Heart,
  History,
  Settings,
  LogOut,
  Loader2,
  Library,
  Star,
  MessageSquare,
  MessageCircle,
  ShieldAlert,
  Globe,
} from "lucide-react";
import SearchBar from "@/components/search-bar";
import AccentSettings from "@/components/accent-settings";
import { useShell } from "@/components/shell-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Header() {
  const router = useRouter();
  const { user, userRole, signOut, rightOpen, toggleRight, toggleLeft } = useShell();
  const [signingOut, setSigningOut] = useState(false);

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ||
    (user?.user_metadata?.username as string | undefined) ||
    user?.email?.split("@")[0] ||
    "Account";
  const username =
    (user?.user_metadata?.username as string | undefined) ||
    user?.email?.split("@")[0] ||
    "user";
  const avatarUrl =
    (user?.user_metadata?.avatar_url as string | undefined) || "";
  const canModerate = userRole === "moderator" || userRole === "admin";

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-[#1a1f30] bg-[#0b0e17]/95 px-4 backdrop-blur-md md:px-6">
      {/* Mobile Menu Toggle & Logo */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleLeft}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-[#151a2a] hover:text-white transition-colors md:hidden"
          aria-label="Toggle navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md transition-colors">
            <Flame className="h-5 w-5 fill-current" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            NAYOZU
          </span>
        </Link>
      </div>

      {/* Center Search Bar */}
      <div className="hidden flex-1 max-w-md mx-4 md:block">
        <SearchBar />
      </div>

      {/* Right Action Icons & User Controls */}
      <div className="flex items-center gap-2">
        {/* Notifications Bell: Strictly Displayed Only for Authenticated Users */}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="relative rounded-xl p-2 text-zinc-400 hover:bg-[#151a2a] hover:text-white transition-colors"
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64 rounded-2xl border border-[#1e253d] bg-[#101423] p-2 text-zinc-200 shadow-2xl"
            >
              <DropdownMenuLabel className="px-2 py-1.5 text-xs font-bold text-white">
                Activity &amp; Notifications
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link
                  href="/profile?tab=my-discussions"
                  className="flex items-center gap-2"
                >
                  <MessageSquare className="h-3.5 w-3.5 text-primary" />
                  <span>Check Discussion Replies</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link
                  href="/profile?tab=my-comments"
                  className="flex items-center gap-2"
                >
                  <MessageCircle className="h-3.5 w-3.5 text-primary" />
                  <span>Check Episode &amp; Chapter Comments</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link
                  href="/settings"
                  className="flex items-center gap-2 text-zinc-400"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>Notification Preferences</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Accent Color Settings Dropdown */}
        <AccentSettings />

        {/* Toggle Right Panel Button */}
        <button
          type="button"
          onClick={toggleRight}
          data-right-panel-trigger="true"
          aria-expanded={rightOpen}
          aria-controls="community-activity-panel"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-[#151a2a] hover:text-white transition-colors"
          title="Toggle Community Panel"
          aria-label="Toggle Community Panel"
        >
          <PanelRight className="h-5 w-5" />
        </button>

        {/* Authentication or Account Menu */}
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-1 flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-primary/40 bg-[#151a2a] text-xs font-bold text-white transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Open account menu"
                title={displayName}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{displayName.charAt(0).toUpperCase()}</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-60 rounded-2xl border border-[#1e253d] bg-[#101423] p-1.5 text-zinc-200 shadow-2xl"
            >
              <DropdownMenuLabel className="px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-bold text-white">
                    {displayName}
                  </p>
                  {userRole && userRole !== "user" && (
                    <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
                      {userRole}
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px] font-normal text-zinc-400">
                  @{username}
                </p>
                {user.email && (
                  <p className="truncate text-[10px] font-normal text-zinc-500 mt-0.5">
                    {user.email}
                  </p>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link href="/profile" className="flex items-center gap-2">
                  <UserIcon className="h-3.5 w-3.5 text-primary" />
                  My Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link
                  href={`/u/${encodeURIComponent(username)}`}
                  className="flex items-center gap-2"
                >
                  <Globe className="h-3.5 w-3.5 text-zinc-400" />
                  Public Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link href="/library" className="flex items-center gap-2">
                  <Library className="h-3.5 w-3.5 text-zinc-400" />
                  My Library
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link href="/watchlist" className="flex items-center gap-2">
                  <Bookmark className="h-3.5 w-3.5 text-zinc-400" />
                  Watchlist
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link href="/reading-list" className="flex items-center gap-2">
                  <Glasses className="h-3.5 w-3.5 text-zinc-400" />
                  Reading List
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link href="/favorites" className="flex items-center gap-2">
                  <Heart className="h-3.5 w-3.5 text-zinc-400" />
                  Favorites
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link href="/history" className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-zinc-400" />
                  History
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link
                  href="/profile?tab=my-reviews"
                  className="flex items-center gap-2"
                >
                  <Star className="h-3.5 w-3.5 text-amber-400" />
                  My Reviews
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link
                  href="/profile?tab=my-discussions"
                  className="flex items-center gap-2"
                >
                  <MessageSquare className="h-3.5 w-3.5 text-primary" />
                  My Discussions
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link
                  href="/profile?tab=my-comments"
                  className="flex items-center gap-2"
                >
                  <MessageCircle className="h-3.5 w-3.5 text-sky-400" />
                  My Comments
                </Link>
              </DropdownMenuItem>
              {canModerate && (
                <DropdownMenuItem
                  asChild
                  className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
                >
                  <Link href="/moderation" className="flex items-center gap-2">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
                    Moderation
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                asChild
                className="rounded-xl text-xs cursor-pointer focus:bg-[#181e33] focus:text-white"
              >
                <Link href="/settings" className="flex items-center gap-2">
                  <Settings className="h-3.5 w-3.5 text-zinc-400" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  void handleSignOut();
                }}
                disabled={signingOut}
                className="rounded-xl text-xs text-red-400 cursor-pointer focus:bg-red-500/15 focus:text-red-300"
              >
                {signingOut ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5" />
                )}
                <span>{signingOut ? "Signing out..." : "Sign out"}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2 ml-1">
            <Link
              href="/login"
              className="rounded-xl px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-[#151a2a] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 shadow-md shadow-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Get started
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
