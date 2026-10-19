"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AnimeGrid from "@/components/anime-grid";
import ErrorState from "@/components/error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAnimePage, getGenres, PAGE_SIZE, type MediaType } from "@/lib/services/animeService";
import type { Anime } from "@/lib/services/normalizeAnime";
import type { LibraryEntry } from "@/lib/libraryMap";
import { AUTH_ENABLED } from "@/lib/features";
import { createClient } from "@/lib/supabase/client";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function GridSkeleton() {
  return (
    <div className="anime-grid">
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

interface MediaBrowserProps {
  mediaType?: MediaType;
}

function BrowserContent({ mediaType = "anime" }: MediaBrowserProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the single source of truth for filters.
  const search = searchParams.get("search") ?? searchParams.get("q") ?? "";
  const genre = searchParams.get("genre") ?? "";
  const sort = searchParams.get("sort") ?? "popularity";
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);

  const [text, setText] = useState(search); // what the user is typing
  const [items, setItems] = useState<Anime[]>([]);
  const [total, setTotal] = useState(0);
  const [genres, setGenres] = useState<Array<{ id: string; name: string }>>([]);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[] | undefined>();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const isManga = mediaType === "manga";
  const title = isManga ? "Manga Discovery" : "Anime Discovery";
  const searchPlaceholder = isManga ? "Search manga..." : "Search anime...";
  const emptyText = isManga ? "No manga found." : "No anime found.";
  const errorText = isManga ? "Failed to load manga data" : "Failed to load anime data";

  const update = (changes: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value && !(key === "page" && value === "1")) params.set(key, value);
      else params.delete(key);
    }
    if (!("page" in changes)) params.delete("page"); // filters reset to page 1
    router.push(`/${mediaType}?${params.toString()}`, { scroll: false });
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
    if (!AUTH_ENABLED) return; // public view: no session or library lookups
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
    getAnimePage({
      page,
      pageSize: PAGE_SIZE,
      search: search || undefined,
      genre: genre || undefined,
      sort,
      mediaType,
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
  }, [page, search, genre, sort, mediaType]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">{title}</h1>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="sm:w-64"
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
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => update({ sort: e.target.value })}
            className={selectClass}
          >
            <option value="popularity">Most popular</option>
            <option value="score">Top rated</option>
            <option value="newest">Newest</option>
          </select>
        </div>
      </div>

      {failed ? (
        <ErrorState message={errorText} />
      ) : loading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{emptyText}</p>
      ) : (
        <AnimeGrid anime={items} libraryEntries={libraryEntries} userId={userId} columns={3} />
      )}

      {!failed && total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3">
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

export default function MediaBrowser({ mediaType = "anime" }: MediaBrowserProps) {
  return (
    <Suspense fallback={<GridSkeleton />}>
      <BrowserContent mediaType={mediaType} />
    </Suspense>
  );
}
