"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_MAIN, NAV_LIBRARY, NAV_SETTINGS } from "@/lib/nav";
import { useShell } from "@/components/shell-context";

export default function Sidebar() {
  const pathname = usePathname();
  const { leftOpen, closeLeft } = useShell();

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
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const SettingsIcon = NAV_SETTINGS.icon;
  const settingsActive = isLinkActive(NAV_SETTINGS.href);

  const navContent = (
    <>
      <div className="space-y-6">
        {/* Main Navigation */}
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

        {/* My Library */}
        <div>
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            My Library
          </p>
          <nav aria-label="My Library" className="flex flex-col gap-1">
            {LIBRARY_NAV_ITEMS.map((item) => {
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

        {/* Settings */}
        <div className="pt-2">
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
          <span className="text-sm font-bold tracking-tight text-white">Navigation</span>
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

const LIBRARY_NAV_ITEMS = NAV_LIBRARY;
