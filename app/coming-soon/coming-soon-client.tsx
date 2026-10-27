"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Clapperboard, Clock, Film, Flame, Tv, Users } from "lucide-react";
import AnimeCard from "@/components/anime-card";
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
} from "@/lib/services/animeService";
import type { Anime } from "@/lib/services/normalizeAnime";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const ANIME_DISCOVERY_LINKS = [
  { label: "All Anime", href: "/anime", active: false, icon: Film },
  { label: "Series", href: "/series", active: false, icon: Tv },
  { label: "Movies", href: "/movies", active: false, icon: Clapperboard },
  { label: "Coming Soon", href: "/coming-soon", active: true, icon: Clock },
];

function formatReleaseDate(season?: string | null, year?: number | null): string {
  const prettySeason = season
    ? season.charAt(0).toUpperCase() + season.slice(1).toLowerCase()
    : null;
  if (prettySeason && year) return `${prettySeason} ${year}`;
  if (year) return `${year} (Season TBA)`;
  if (prettySeason) return `${prettySeason} (Year TBA)`;
  return "Release Date TBA";
}

function ComingSoonContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const search = searchParams.get("search") ?? searchParams.get("q") ?? "";
  const genre = searchParams.get("genre") ?? "";
  const formatFilter = searchParams.get("format") ?? ""; // "" | "series" | "MOVIE"
  const sort = searchParams.get("sort") ?? "release_date"; // "release_date" | "popularity"
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);

  const [text, setText] = useState(search);
  const [items, setItems] = useState<Anime[]>([]);
  const [total, setTotal] = useState(0);
  const [genres, setGenres] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const update = (changes: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value && !(key === "page" && value === "1")) params.set(key, value);
      else params.delete(key);
    }
    if (!("page" in changes)) params.delete("page");
    const qs = params.toString();
    router.push(qs ? `/coming-soon?${qs}` : "/coming-soon", { scroll: false });
  };

  const resetFilters = () => {
    setText("");
    router.push("/coming-soon", { scroll: false });
  };

  useEffect(() => setText(search), [search]);

  useEffect(() => {
    if (text === search) return;
    const timer = setTimeout(() => update({ search: text.trim() }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    getGenres().then(setGenres).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    const format = formatFilter === "MOVIE" ? MOVIE_FORMAT : undefined;
    const formats = formatFilter === "series" ? SERIES_FORMATS : undefined;

    getAnimePage({
      page,
      pageSize: PAGE_SIZE,
      search: search || undefined,
      genre: genre || undefined,
      sort,
      mediaType: "anime",
      status: "NOT_YET_RELEASED",
      format,
      formats,
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
  }, [page, search, genre, formatFilter, sort]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const hasActiveFilters = Boolean(
    search || genre || formatFilter || sort !== "release_date"
  );

  const featuredUpcoming =
    page === 1 && !search && items.length > 0 ? items[0] : null;

  return (
    <div className="space-y-7 pb-10">
      {/* Category Discovery Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2238] pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {ANIME_DISCOVERY_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                  item.active
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
            Showing <strong className="text-zinc-200">{total.toLocaleString()}</strong> upcoming
            titles
          </span>
        )}
      </div>

      {/* Featured Upcoming Spotlight */}
      {featuredUpcoming && (
        <section className="relative overflow-hidden rounded-2xl border border-[#1e253d] bg-[#121625] p-5 md:p-7">
          {featuredUpcoming.bannerImage || featuredUpcoming.image ? (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-25 blur-[2px]"
              style={{
                backgroundImage: `url(${featuredUpcoming.bannerImage || featuredUpcoming.image})`,
              }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b0e17] via-[#0b0e17]/90 to-[#0b0e17]/60" />

          <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center">
            {featuredUpcoming.image && (
              <Link
                href={`/anime/${featuredUpcoming.slug}`}
                className="relative h-44 w-32 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#181d30] shadow-lg"
              >
                <Image
                  src={featuredUpcoming.image}
                  alt={featuredUpcoming.title}
                  fill
                  sizes="128px"
                  className="object-cover"
                />
              </Link>
            )}

            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
                  <Clock className="h-3 w-3" />
                  Upcoming Release
                </span>
                {featuredUpcoming.format && (
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-zinc-200">
                    {featuredUpcoming.format === "TV_SHORT"
                      ? "TV Short"
                      : featuredUpcoming.format === "MOVIE"
                        ? "Movie"
                        : featuredUpcoming.format}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  <Calendar className="h-3 w-3" />
                  {formatReleaseDate(featuredUpcoming.season, featuredUpcoming.year)}
                </span>
                {featuredUpcoming.popularity ? (
                  <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                    <Users className="h-3.5 w-3.5" />
                    {featuredUpcoming.popularity.toLocaleString()} interested
                  </span>
                ) : null}
              </div>

              <h2 className="text-xl md:text-2xl font-bold text-white leading-snug">
                <Link
                  href={`/anime/${featuredUpcoming.slug}`}
                  className="hover:text-primary transition-colors"
                >
                  {featuredUpcoming.title}
                </Link>
              </h2>

              {featuredUpcoming.synopsis && (
                <p className="line-clamp-2 max-w-3xl text-xs md:text-sm text-zinc-300 leading-relaxed">
                  {featuredUpcoming.synopsis}
                </p>
              )}

              {featuredUpcoming.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {featuredUpcoming.genres.slice(0, 5).map((g) => (
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
                <Link href={`/anime/${featuredUpcoming.slug}`}>View Details</Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Header & Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold text-white">Coming Soon</h1>
          <p className="text-xs md:text-sm text-zinc-400">
            Upcoming anime series and feature films officially announced and awaiting release.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            type="search"
            placeholder="Search upcoming titles..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full sm:w-60"
          />

          <select
            aria-label="Format"
            value={formatFilter}
            onChange={(e) => update({ format: e.target.value })}
            className={selectClass}
          >
            <option value="">All Formats</option>
            <option value="series">Upcoming Series</option>
            <option value="MOVIE">Upcoming Movies</option>
          </select>

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

          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => update({ sort: e.target.value })}
            className={selectClass}
          >
            <option value="release_date">Nearest Release Date</option>
            <option value="popularity">Most Anticipated</option>
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

      {/* Quick Sort / Format Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => update({ sort: "release_date" })}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            sort === "release_date"
              ? "bg-primary/15 text-primary border border-primary/30"
              : "bg-[#121624] text-zinc-400 border border-[#1b2238] hover:text-white"
          }`}
        >
          <Calendar className="h-3.5 w-3.5" />
          Nearest Release Date First
        </button>
        <button
          type="button"
          onClick={() => update({ sort: "popularity" })}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            sort === "popularity"
              ? "bg-primary/15 text-primary border border-primary/30"
              : "bg-[#121624] text-zinc-400 border border-[#1b2238] hover:text-white"
          }`}
        >
          <Flame className="h-3.5 w-3.5" />
          Most Anticipated
        </button>
      </div>

      {/* Results Grid / States */}
      {failed ? (
        <ErrorState message="Failed to load upcoming anime releases" />
      ) : loading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-16 px-4 text-center space-y-3">
          <p className="text-sm text-zinc-300 font-medium">
            No upcoming releases found matching your filters.
          </p>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Clear all filters
            </Button>
          )}
        </div>
      ) : (
        <div className="anime-grid">
          {items.map((item) => {
            const releaseWindow = formatReleaseDate(item.season, item.year);
            return (
              <AnimeCard
                key={item.id}
                externalId={item.external_id}
                title={item.title}
                image={item.image}
                averageScore={item.averageScore}
                episodes={item.episodes}
                slug={item.slug}
                mediaType="anime"
                format={item.format}
                year={item.year}
                season={item.season}
                status={item.status}
                genres={item.genres?.map((g) => g.name)}
                synopsis={item.synopsis}
                subtitle={
                  item.popularity
                    ? `• ${item.popularity.toLocaleString()} waiting`
                    : releaseWindow === "Release Date TBA"
                      ? "• Date TBA"
                      : undefined
                }
                showExtendedMeta
              />
            );
          })}
        </div>
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

export default function ComingSoonClient() {
  return (
    <Suspense fallback={<GridSkeleton />}>
      <ComingSoonContent />
    </Suspense>
  );
}
