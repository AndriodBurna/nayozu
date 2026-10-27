import { Flame, MessageSquare } from "lucide-react";

export default function CommunityLoading() {
  return (
    <div className="flex flex-col gap-6 pb-12 animate-pulse">
      {/* Hero Skeleton */}
      <section className="rounded-3xl border border-[#1e253d] bg-[#121625] p-6 md:p-8 space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <Flame className="h-3.5 w-3.5" />
          <span>Loading Community Hub...</span>
        </div>
        <div className="h-8 w-72 max-w-full rounded-lg bg-[#1a2034]" />
        <div className="h-4 w-96 max-w-full rounded-lg bg-[#1a2034]" />
      </section>

      {/* Tabs Skeleton */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1a2034] pb-4">
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 w-28 rounded-xl bg-[#121625]" />
          ))}
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-48 rounded-xl bg-[#121625]" />
          <div className="h-9 w-36 rounded-xl bg-[#121625]" />
        </div>
      </div>

      {/* Post Cards Skeleton */}
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#1c2236] bg-[#121624] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-[#1a2034]" />
                <div className="space-y-1.5">
                  <div className="h-3.5 w-28 rounded bg-[#1a2034]" />
                  <div className="h-2.5 w-20 rounded bg-[#1a2034]" />
                </div>
              </div>
              <div className="h-5 w-20 rounded-full bg-[#1a2034]" />
            </div>

            <div className="space-y-2">
              <div className="h-4 w-3/4 rounded bg-[#1a2034]" />
              <div className="h-3.5 w-full rounded bg-[#1a2034]" />
              <div className="h-3.5 w-5/6 rounded bg-[#1a2034]" />
            </div>

            <div className="flex items-center gap-4 pt-2 border-t border-white/5 text-zinc-500">
              <MessageSquare className="h-4 w-4" />
              <div className="h-3 w-20 rounded bg-[#1a2034]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
