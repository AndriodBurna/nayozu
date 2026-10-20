"use client";

import Link from "next/link";
import { Flame, Bell, Sparkles, PanelRight } from "lucide-react";
import SearchBar from "@/components/search-bar";
import AccentSettings from "@/components/accent-settings";
import { useShell } from "@/components/shell-context";

export default function Header() {
  const { user, toggleRight } = useShell();

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-[#1a1f30] bg-[#0b0e17]/95 px-4 backdrop-blur-md md:px-6">
      {/* Logo & Category shortcuts */}
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md transition-colors">
            <Flame className="h-5 w-5 fill-current" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            NAYOZU
          </span>
        </Link>

        {/* Quick Nav Pills (AnimeX style) */}
        <nav className="hidden lg:flex items-center gap-1 text-sm font-medium">
          <Link
            href="/"
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors"
          >
            Home
          </Link>
          <Link
            href="/anime"
            className="rounded-full px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Series
          </Link>
          <Link
            href="/movies"
            className="rounded-full px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Movies
          </Link>
          <Link
            href="/coming-soon"
            className="rounded-full px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Coming Soon
          </Link>
          <Link
            href="/community"
            className="rounded-full px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Community
          </Link>
        </nav>
      </div>

      {/* Center Search Bar */}
      <div className="hidden flex-1 max-w-md mx-4 md:block">
        <SearchBar />
      </div>

      {/* Right Action Icons & User Controls */}
      <div className="flex items-center gap-2">
        {/* Star / Release Badge */}
        <button
          type="button"
          className="relative rounded-xl p-2 text-zinc-400 hover:bg-[#151a2a] hover:text-white transition-colors"
          aria-label="New updates"
        >
          <Sparkles className="h-4 w-4" />
          <span className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            9+
          </span>
        </button>

        {/* Notification Bell */}
        <button
          type="button"
          className="relative rounded-xl p-2 text-zinc-400 hover:bg-[#151a2a] hover:text-white transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            9+
          </span>
        </button>

        {/* Accent Color Settings Dropdown */}
        <AccentSettings />

        {/* Toggle Right Panel Button */}
        <button
          type="button"
          onClick={toggleRight}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-[#151a2a] hover:text-white transition-colors"
          title="Toggle Community Panel"
        >
          <PanelRight className="h-5 w-5" />
        </button>

        {/* Authentication or Avatar */}
        {user ? (
          <button
            type="button"
            onClick={toggleRight}
            className="h-8 w-8 ml-1 overflow-hidden rounded-full border border-primary/40 bg-zinc-800 transition-colors"
          >
            <img
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
              alt="User"
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <div className="flex items-center gap-2 ml-1">
            <Link
              href="/auth/login"
              className="text-xs font-semibold text-zinc-300 hover:text-white px-2 py-1"
            >
              Sign in
            </Link>
            <Link
              href="/auth/sign-up"
              className="rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 shadow-md shadow-primary/20"
            >
              Get started
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}