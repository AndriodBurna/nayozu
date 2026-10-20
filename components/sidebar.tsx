"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Film,
  BookOpen,
  Compass,
  Users,
  Tv,
  Calendar,
  Bookmark,
  Glasses,
  History,
  Heart,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MAIN_NAV = [
  { label: "Home", href: "/", icon: Home },
  { label: "Anime", href: "/anime", icon: Film },
  { label: "Manga", href: "/manga", icon: BookOpen },
  { label: "Manhwa", href: "/manhwa", icon: Compass },
  { label: "Community", href: "/community", icon: Users },
  { label: "Watch Together", href: "/watch-together", icon: Tv },
  { label: "Calendar", href: "/calendar", icon: Calendar },
];

const LIBRARY_NAV = [
  { label: "Watchlist", href: "/watchlist", icon: Bookmark },
  { label: "Reading List", href: "/reading-list", icon: Glasses },
  { label: "History", href: "/history", icon: History },
  { label: "Favorites", href: "/favorites", icon: Heart },
];

export default function Sidebar() {
  const pathname = usePathname();

  const isLinkActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 self-start overflow-y-auto border-r border-[#1a1f30] bg-[#0b0e17] p-4 md:flex md:flex-col justify-between">
      <div className="space-y-6">
        {/* Main Navigation */}
        <nav className="flex flex-col gap-1">
          {MAIN_NAV.map((item) => {
            const active = isLinkActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-[#6d44f6] text-white shadow-lg shadow-[#6d44f6]/30 font-semibold"
                    : "text-zinc-400 hover:text-white hover:bg-[#141928]"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* My Library Section */}
        <div>
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            My Library
          </p>
          <nav className="flex flex-col gap-1">
            {LIBRARY_NAV.map((item) => {
              const active = isLinkActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-150",
                    active
                      ? "bg-[#6d44f6] text-white font-semibold"
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
            href="/settings"
            className="flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-[#141928] transition-all"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      </div>

      {/* Sidebar Footer Artwork Card */}
      <div className="relative mt-6 overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-t from-black/80 via-purple-950/40 to-transparent p-4">
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
    </aside>
  );
}