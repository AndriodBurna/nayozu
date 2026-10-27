export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-white/20 border-t-transparent rounded-full animate-spin"></div>
      <p className="mt-3 text-sm text-gray-400">Loading...</p>
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div className="anime-grid" role="status" aria-label="Loading media grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="anime-card animate-pulse">
          <div className="anime-card-poster" />
          <div className="anime-card-body">
            <div className="h-4 w-3/4 rounded bg-secondary" />
            <div className="h-3 w-1/2 rounded bg-secondary" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DiscoveryPageSkeleton() {
  return (
    <div className="space-y-7 pb-10" role="status" aria-label="Loading discovery page">
      {/* Category Discovery Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2238] pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-8 w-28 animate-pulse rounded-xl bg-[#121624] border border-[#1b2238]"
            />
          ))}
        </div>
        <div className="h-4 w-36 animate-pulse rounded bg-[#121624]" />
      </div>

      {/* Spotlight Showcase Banner */}
      <div className="h-52 w-full animate-pulse rounded-2xl border border-[#1e253d] bg-[#121625]" />

      {/* Header & Filter Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-[#121624]" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-[#121624]" />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="h-9 w-60 animate-pulse rounded-md bg-[#121624]" />
          <div className="h-9 w-32 animate-pulse rounded-md bg-[#121624]" />
          <div className="h-9 w-36 animate-pulse rounded-md bg-[#121624]" />
        </div>
      </div>

      <GridSkeleton />
    </div>
  );
}
