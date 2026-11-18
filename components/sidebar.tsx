"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  X,
  User as UserIcon,
  Users,
  Star,
  MessageSquare,
  MessageCircle,
  ShieldAlert,
  Library,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_MAIN, NAV_LIBRARY, NAV_SETTINGS } from "@/lib/nav";
import { useShell } from "@/components/shell-context";

export default function Sidebar() {
  const pathname = usePathname();
  const { user, userRole, leftOpen, closeLeft } = useShell();

  useEffect(() => {
    closeLeft();
  }, [pathname, closeLeft]);

  useEffect(() => {
    if (!leftOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeLeft();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftOpen, closeLeft]);

  const isLinkActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  const SettingsIcon = NAV_SETTINGS.icon;
  const settingsActive = isLinkActive(NAV_SETTINGS.href);
  const canModerate = userRole === "moderator" || userRole === "admin";

  const MY_ACTIVITY_ITEMS = [
    { label: "My Profile", href: "/profile", icon: UserIcon },
    { label: "My Friends", href: "/profile?tab=friends", icon: Users },
    { label: "My Reviews", href: "/profile?tab=my-reviews", icon: Star },
    {
      label: "My Discussions",
      href: "/profile?tab=my-discussions",
      icon: MessageSquare,
    },
    {
      label: "My Comments",
      href: "/profile?tab=my-comments",
      icon: MessageCircle,
    },
  ];

  const navContent = (
    <>
      <div className="space-y-6">
        {/* Main Navigation (Public & Authenticated) */}
        <nav aria-label="Main navigation" className="flex flex-col gap-1">
          {NAV_MAIN.map((item) => {
            const active = isLinkActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={closeLeft}
                className={cn(
                  "flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 font-semibold"
                    : "text-zinc-400 hover:text-white hover:bg-[#141928]"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Personal Screens: Strictly Hidden for Guests, Displayed for Authenticated Users */}
        {user && (
          <>
            {/* My Library */}
            <div>
              <p className="px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                My Library
              </p>
              <nav aria-label="My Library" className="flex flex-col gap-1">
                <Link
                  href="/library"
                  aria-current={isLinkActive("/library") ? "page" : undefined}
                  onClick={closeLeft}
                  className={cn(
                    "flex items-center gap-3.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-150",
                    isLinkActive("/library")
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-zinc-400 hover:text-white hover:bg-[#141928]"
                  )}
                >
                  <Library className="h-4 w-4" />
                  My Library
                </Link>
                {NAV_LIBRARY.map((item) => {
                  const active = isLinkActive(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={closeLeft}
                      className={cn(
                        "flex items-center gap-3.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-150",
                        active
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-zinc-400 hover:text-white hover:bg-[#141928]"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* My Activity (Profile, Reviews, Discussions, Comments) */}
            <div>
              <p className="px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                My Activity
              </p>
              <nav aria-label="My Activity" className="flex flex-col gap-1">
                {MY_ACTIVITY_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/profile" && pathname === "/profile";
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={closeLeft}
                      className={cn(
                        "flex items-center gap-3.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-150",
                        active
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-zinc-400 hover:text-white hover:bg-[#141928]"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Moderation & Settings */}
            <div className="pt-2 space-y-1">
              {canModerate && (
                <Link
                  href="/moderation"
                  aria-current={isLinkActive("/moderation") ? "page" : undefined}
                  onClick={closeLeft}
                  className={cn(
                    "flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                    isLinkActive("/moderation")
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 font-semibold"
                      : "text-amber-300 hover:text-white hover:bg-[#141928]"
                  )}
                >
                  <ShieldAlert className="h-4 w-4" />
                  Moderation
                </Link>
              )}

              <Link
                href={NAV_SETTINGS.href}
                aria-current={settingsActive ? "page" : undefined}
                onClick={closeLeft}
                className={cn(
                  "flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                  settingsActive
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 font-semibold"
                    : "text-zinc-400 hover:text-white hover:bg-[#141928]"
                )}
              >
                <SettingsIcon className="h-4 w-4" />
                {NAV_SETTINGS.label}
              </Link>
            </div>
          </>
        )}
      </div>

      {/* Sidebar Artwork Card */}
      <div className="relative mt-6 overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-t from-black/80 via-primary/10 to-transparent p-4">
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center opacity-30"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=60')",
          }}
        />
        <p className="text-xs font-semibold leading-relaxed text-zinc-300">
          Same passion. <br /> Different stories. <br />
          <span className="text-white">One community.</span>
        </p>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop & Tablet Sidebar */}
      <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 self-start overflow-y-auto border-r border-[#1a1f30] bg-[#0b0e17] p-4 md:flex md:flex-col justify-between">
        {navContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {leftOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={closeLeft}
          aria-hidden="true"
        />
      )}

      {/* Mobile Slide-out Sidebar */}
      <aside
        aria-label="Mobile navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col justify-between overflow-y-auto border-r border-[#1a1f30] bg-[#0b0e17] p-4 transition-transform duration-300 ease-in-out md:hidden",
          leftOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between pb-3 mb-2 border-b border-white/5">
          <span className="text-sm font-bold tracking-tight text-white">
            Navigation
          </span>
          <button
            type="button"
            onClick={closeLeft}
            aria-label="Close navigation menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-[#151a2a] hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {navContent}
      </aside>
    </>
  );
}
