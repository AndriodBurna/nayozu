"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Users, Tv, MessageSquare, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/shell-context";

export default function RightPanel() {
  const { user, rightOpen, closeRight } = useShell();

  useEffect(() => {
    if (!rightOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRight();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rightOpen, closeRight]);

  const userName =
    (user?.user_metadata?.username as string | undefined) ??
    user?.email?.split("@")[0] ??
    "ShadowNeko";

  return (
    <>
      {/* Backdrop overlay when open */}
      {rightOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={closeRight}
          aria-hidden="true"
        />
      )}

      {/* Slide-out Panel: Hidden off-screen by default, slides out when rightOpen is true */}
      <aside
        aria-label="Side panel"
        className={`fixed inset-y-0 right-0 z-50 w-80 max-w-[90vw] overflow-y-auto border-l border-[#1a1f30] bg-[#0b0e17] p-5 transition-transform duration-300 ease-in-out ${
          rightOpen ? "translate-x-0" : "translate-x-full"
        } flex flex-col gap-5`}
      >
        {/* Header with Close Button */}
        <div className="flex items-center justify-between pb-1 border-b border-white/5">
          <span className="font-semibold text-white text-sm">Community & Activity</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={closeRight}
            aria-label="Close side panel"
            className="text-zinc-400 hover:text-white h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* User Status / Profile Card */}
        <div className="rounded-2xl border border-[#1c2236] bg-[#121624] p-4">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-primary/40">
              <Image
                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                alt="Avatar"
                fill
                className="object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="truncate text-sm font-semibold text-white">{userName}</h4>
              <div className="flex items-center justify-between text-xs text-zinc-400 mt-0.5">
                <span>Level 5</span>
                <span>2.4k XP</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full w-3/4 rounded-full bg-primary" />
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs italic text-zinc-400 text-center">
            &ldquo;Anime makes life better.&rdquo;
          </p>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="mt-3 w-full border-[#232a42] bg-[#161b2d] text-xs hover:bg-[#1f263e] hover:text-white"
          >
            <Link href="/profile">Edit Profile</Link>
          </Button>
        </div>

        {/* Friends Online */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <Users className="h-3.5 w-3.5 text-zinc-400" />
              <span>Friends Online</span>
            </div>
            <Link href="/friends" className="text-zinc-400 hover:text-white flex items-center">
              See All <ChevronRight className="h-3 w-3 ml-0.5" />
            </Link>
          </div>

          <div className="space-y-2.5">
            {[
              {
                name: "LunaRin",
                action: "Watching One Piece · 12m",
                img: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=60&auto=format&fit=crop&q=80",
              },
              {
                name: "Kaito",
                action: "Reading Solo Leveling · 15m",
                img: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=60&auto=format&fit=crop&q=80",
              },
              {
                name: "Mochi",
                action: "Watching Jujutsu Kaisen · 22m",
                img: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=60&auto=format&fit=crop&q=80",
              },
              {
                name: "ZenitsuFan",
                action: "Online",
                img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=60&auto=format&fit=crop&q=80",
              },
            ].map((friend) => (
              <div key={friend.name} className="flex items-center gap-3">
                <div className="relative h-8 w-8 shrink-0 rounded-full overflow-hidden">
                  <Image src={friend.img} alt={friend.name} fill className="object-cover" />
                  <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-[#0b0e17]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-white">{friend.name}</p>
                  <p className="truncate text-[11px] text-zinc-400">{friend.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Watch Together Widget */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <Tv className="h-3.5 w-3.5 text-primary" />
              <span>Watch Together</span>
            </div>
            <Link href="/watch-together" className="text-zinc-400 hover:text-white flex items-center">
              See All <ChevronRight className="h-3 w-3 ml-0.5" />
            </Link>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#1e253b] bg-[#121626] p-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                <Image
                  src="https://images.unsplash.com/photo-1563089145-599997674d42?w=80&auto=format&fit=crop&q=80"
                  alt="Room"
                  fill
                  className="object-cover"
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">One Piece – Ep 1128</p>
                <p className="text-[11px] text-zinc-400">Hosted by Kaito · 👥 6/10</p>
              </div>
            </div>
            <Button
              size="sm"
              className="h-7 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:brightness-110"
            >
              Join
            </Button>
          </div>
        </div>

        {/* Trending in Community */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <MessageSquare className="h-3.5 w-3.5 text-zinc-400" />
              <span>Trending in Community</span>
            </div>
            <Link href="/community" className="text-zinc-400 hover:text-white flex items-center">
              See All <ChevronRight className="h-3 w-3 ml-0.5" />
            </Link>
          </div>

          <div className="space-y-2 text-xs">
            {[
              { title: "Anime of the Year 2025?", replies: "3.4k replies · 12h ago" },
              { title: "Best Anime for Beginners", replies: "2.1k replies · 1d ago" },
              { title: "Who's your favorite character?", replies: "1.8k replies · 1d ago" },
              { title: "Manga vs Anime - What's better?", replies: "1.5k replies · 2d ago" },
            ].map((topic) => (
              <div
                key={topic.title}
                className="rounded-lg bg-[#121624] p-2 hover:bg-[#171d30] transition-colors cursor-pointer"
              >
                <p className="font-medium text-white truncate">{topic.title}</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">{topic.replies}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}