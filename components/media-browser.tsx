"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Clapperboard, Clock, Film, Flame, Sparkles, Star, Tv } from "lucide-react";
import AnimeGrid from "@/components/anime-grid";
import ErrorState from "@/components/error";
import { GridSkeleton } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getAnimePage,
  getGenres,
  MOVIE_FORMAT,
  PAGE_SIZE,
  SERIES_FORMATS,
  type MediaType,
} from "@/lib/services/animeService";
import type { Anime } from "@/lib/services/normalizeAnime";
import type { LibraryEntry } from "@/lib/libraryMap";
import { AUTH_ENABLED } from "@/lib/features";
import { createClient } from "@/lib/supabase/client";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export type BrowserMode = "anime" | "series" | "movies" | "manga";

interface MediaBrowserProps {
  mediaType?: MediaType;
  mode?: BrowserMode;
}

const ANIME_DISCOVERY_LINKS = [
  { label: "All Anime", href: "/anime", mode: "anime" as const, icon: Film },
  { label: "Series", href: "/series", mode: "series" as const, icon: Tv },
  { label: "Movies", href: "/movies", mode: "movies" as const, icon: Clapperboard },
  { label: "Coming Soon", href: "/coming-soon", mode: "coming-soon" as const, icon: Clock },
];

function BrowserContent({ mediaType = "anime", mode }: MediaBrowserProps) {
  const resolvedMode: BrowserMode = mode ?? (mediaType === "manga" ? "manga" : "anime");
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the single source of truth for filters.
  const search = searchParams.get("search") ?? searchParams.get("q") ?? "";
  const genre = searchParams.get("genre") ?? "";
  const rawFilter = searchParams.get("filter") ?? "";
  const sortParam = searchParams.get("sort");
  const sort =
    sortParam === "latest"
      ? "newest"
      : sortParam ?? (rawFilter === "top" ? "score" : "popularity");
  const subtypeFormat = searchParams.get("format") ?? "";
  const statusFilter =
    searchParams.get("status") ?? (rawFilter === "trending" || rawFilter === "airing" ? "RELEASING" : "");
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);

  const [text, setText] = useState(search);
  const [items, setItems] = useState<Anime[]>([]);
  const [total, setTotal] = useState(0);
  const [genres, setGenres] = useState<Array<{ id: string; name: string }>>([]);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[] | undefined>();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const isManga = resolvedMode === "manga";
  const isSeries = resolvedMode === "series";
  const isMovies = resolvedMode === "movies";

  const basePath =
    resolvedMode === "series"
      ? "/series"
      : resolvedMode === "movies"
        ? "/movies"
        : `/${mediaType}`;

  const title = isManga
    ? "Manga Discovery"
    : isSeries
      ? "Anime Series"
      : isMovies
        ? "Anime Movies"
        : "Anime Discovery";

  const subtitle = isManga
    ? "Explore popular manga series, chapters, and genres."
    : isSeries
      ? "Discover television anime series, OVAs, ONAs, and episodic specials."
      : isMovies
        ? "Explore feature-length anime films with ratings, release years, genres, and synopses."
        : "Browse the complete anime catalog across series, films, and specials.";

  const searchPlaceholder = isManga
    ? "Search manga..."
    : isSeries
      ? "Search anime series..."
      : isMovies
        ? "Search anime movies..."
        : "Search anime...";

  const emptyText = isManga
    ? "No manga found matching your filters."
    : isSeries
      ? "No anime series found matching your filters."
      : isMovies
        ? "No anime movies found matching your filters."
        : "No anime found matching your filters.";

  const errorText = isManga
    ? "Failed to load manga data"
    : isSeries
      ? "Failed to load anime series data"
      : isMovies
        ? "Failed to load anime movie data"
        : "Failed to load anime data";

  const update = (changes: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("filter");
    for (const [key, value] of Object.entries(changes)) {
      if (value && !(key === "page" && value === "1")) params.set(key, value);
      else params.delete(key);
    }
    if (!("page" in changes)) params.delete("page"); // filters reset to page 1
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  };

  const resetFilters = () => {
    setText("");
    router.push(basePath, { scroll: false });
  };

  // Keep the box in sync when the URL changes (back button, header search).
  useEffect(() => setText(search), [search]);

  // Debounce typing -> URL.
  useEffect(() => {
    if (text === search) return;
    const timer = setTimeout(() => update({ search: text.trim() }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Genres + user + library, once.
  useEffect(() => {
    getGenres().then(setGenres).catch(() => {});
    if (!AUTH_ENABLED) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      setUserId(user ? user.id : null);
      if (!user) return;
      const { data } = await supabase.from("user_anime_library").select("*").eq("user_id", user.id);
      setLibraryEntries((data as LibraryEntry[] | null) ?? undefined);
    });
  }, []);

  // Items for the current filters.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    const queryFormat = isMovies
      ? MOVIE_FORMAT
      : isSeries && subtypeFormat && SERIES_FORMATS.includes(subtypeFormat as (typeof SERIES_FORMATS)[number])
        ? subtypeFormat
        : undefined;

    const queryFormats = isSeries && !queryFormat ? SERIES_FORMATS : undefined;
    const excludeStatuses =
      isSeries || isMovies ? (["NOT_YET_RELEASED", "CANCELLED"] as const) : undefined;

    getAnimePage({
      page,
      pageSize: PAGE_SIZE,
      search: search || undefined,
      genre: genre || undefined,
      sort,
      mediaType,
      format: queryFormat,
      formats: queryFormats,
      status: statusFilter || undefined,
      excludeStatuses,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [page, search, genre, sort, mediaType, isMovies, isSeries, subtypeFormat, statusFilter]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const hasActiveFilters = Boolean(
    search || genre || subtypeFormat || statusFilter || sort !== "popularity"
  );

  // Featured hero item on page 1 of Series or Movies when not actively searching
  const spotlightItem =
    (isSeries || isMovies) && page === 1 && !search && items.length > 0 ? items[0] : null;
  const spotlightScore =
    spotlightItem?.averageScore && spotlightItem.averageScore > 0
      ? (spotlightItem.averageScore > 10
          ? spotlightItem.averageScore / 10
          : spotlightItem.averageScore
        ).toFixed(1)
      : null;

  return (
    <div className="space-y-7 pb-10">
      {/* Category Discovery Switcher for Anime Routes */}
      {!isManga && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2238] pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {ANIME_DISCOVERY_LINKS.map((item) => {
              const Icon = item.icon;
              const active = item.mode === resolvedMode;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                    active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "border border-[#1b2238] bg-[#121624] text-zinc-400 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
          {!loading && !failed && (
            <span className="text-xs text-zinc-400">
              Showing <strong className="text-zinc-200">{total.toLocaleString()}</strong>{" "}
              {isMovies ? "movies" : isSeries ? "series" : "titles"}
            </span>
          )}
        </div>
      )}

      {/* Spotlight Showcase for Series & Movies */}
      {spotlightItem && (
        <section className="relative overflow-hidden rounded-2xl border border-[#1e253d] bg-[#121625] p-5 md:p-7">
          {spotlightItem.bannerImage || spotlightItem.image ? (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-25 blur-[2px]"
              style={{
                backgroundImage: `url(${spotlightItem.bannerImage || spotlightItem.image})`,
              }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b0e17] via-[#0b0e17]/90 to-[#0b0e17]/60" />

          <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center">
            {spotlightItem.image && (
              <Link
                href={`/anime/${spotlightItem.slug}`}
                className="relative h-44 w-32 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#181d30] shadow-lg"
              >
                <Image
                  src={spotlightItem.image}
                  alt={spotlightItem.title}
                  fill
                  sizes="128px"
                  className="object-cover"
                />
              </Link>
            )}

            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/20 border border-primary/40 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3 w-3" />
                  Featured {isMovies ? "Movie" : "Series"}
                </span>
                {spotlightItem.format && (
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-zinc-200">
                    {spotlightItem.format === "TV_SHORT" ? "TV Short" : spotlightItem.format}
                  </span>
                )}
                {spotlightItem.year && (
                  <span className="text-xs font-medium text-zinc-400">
                    {spotlightItem.year}
                  </span>
                )}
                {spotlightScore && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">
                    <Star className="h-3.5 w-3.5 fill-amber-400 stroke-none" />
                    {spotlightScore}
                  </span>
                )}
                {!isMovies && spotlightItem.episodes ? (
                  <span className="text-xs text-zinc-400">
                    • {spotlightItem.episodes} episodes
                  </span>
                ) : null}
              </div>

              <h2 className="text-xl md:text-2xl font-bold text-white leading-snug">
                <Link
                  href={`/anime/${spotlightItem.slug}`}
                  className="hover:text-primary transition-colors"
                >
                  {spotlightItem.title}
                </Link>
              </h2>

              {spotlightItem.synopsis && (
                <p className="line-clamp-2 max-w-3xl text-xs md:text-sm text-zinc-300 leading-relaxed">
                  {spotlightItem.synopsis}
                </p>
              )}

              {spotlightItem.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {spotlightItem.genres.slice(0, 5).map((g) => (
                    <button
                      key={g.name}
                      type="button"
                      onClick={() => update({ genre: g.name })}
                      className="rounded-full border border-white/10 bg-black/40 px-2.5 py-0.5 text-[11px] text-zinc-300 hover:border-primary/50 hover:text-primary transition-colors"
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0">
              <Button
                asChild
                className="rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:brightness-110"
              >
                <Link href={`/anime/${spotlightItem.slug}`}>View Details</Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Header & Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold text-white">{title}</h1>
          <p className="text-xs md:text-sm text-zinc-400">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full sm:w-60"
          />

          <select
            aria-label="Genre"
            value={genre}
            onChange={(e) => update({ genre: e.target.value })}
            className={selectClass}
          >
            <option value="">All Genres</option>
            {genres.map((g) => (
              <option key={g.id} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>

          {isSeries && (
            <>
              <select
                aria-label="Series Format"
                value={subtypeFormat}
                onChange={(e) => update({ format: e.target.value })}
                className={selectClass}
              >
                <option value="">All Series Formats</option>
                <option value="TV">TV Series</option>
                <option value="ONA">ONA (Web Series)</option>
                <option value="OVA">OVA</option>
                <option value="TV_SHORT">TV Short</option>
                <option value="SPECIAL">Special</option>
              </select>

              <select
                aria-label="Airing Status"
                value={statusFilter}
                onChange={(e) => update({ status: e.target.value })}
                className={selectClass}
              >
                <option value="">All Statuses</option>
                <option value="RELEASING">Currently Airing</option>
                <option value="FINISHED">Completed</option>
              </select>
            </>
          )}

          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => update({ sort: e.target.value })}
            className={selectClass}
          >
            <option value="popularity">Most Popular</option>
            <option value="score">Top Rated</option>
            <option value="newest">Newest Releases</option>
          </select>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-xs text-zinc-400 hover:text-white"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Quick Discovery Presets for Series */}
      {isSeries && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => update({ status: "", sort: "popularity" })}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !statusFilter && sort === "popularity"
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-[#121624] text-zinc-400 border border-[#1b2238] hover:text-white"
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            Popular Series
          </button>
          <button
            type="button"
            onClick={() => update({ status: "RELEASING", sort: "popularity" })}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "RELEASING"
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-[#121624] text-zinc-400 border border-[#1b2238] hover:text-white"
            }`}
          >
            <Tv className="h-3.5 w-3.5" />
            Trending / Currently Airing
          </button>
          <button
            type="button"
            onClick={() => update({ status: "", sort: "score" })}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !statusFilter && sort === "score"
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-[#121624] text-zinc-400 border border-[#1b2238] hover:text-white"
            }`}
          >
            <Star className="h-3.5 w-3.5" />
            Top Rated Series
          </button>
        </div>
      )}

      {/* Results Grid / States */}
      {failed ? (
        <ErrorState message={errorText} />
      ) : loading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-16 px-4 text-center space-y-3">
          <p className="text-sm text-zinc-300 font-medium">{emptyText}</p>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Clear all filters
            </Button>
          )}
        </div>
      ) : (
        <AnimeGrid
          anime={items}
          libraryEntries={libraryEntries}
          userId={userId}
          columns={3}
          showExtendedMeta={isMovies || isSeries}
        />
      )}

      {/* Pagination */}
      {!failed && total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => update({ page: String(page + 1) })}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export default function MediaBrowser({ mediaType = "anime", mode }: MediaBrowserProps) {
  return (
    <Suspense fallback={<GridSkeleton />}>
      <BrowserContent mediaType={mediaType} mode={mode} />
    </Suspense>
  );
}
