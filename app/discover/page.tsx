import Link from "next/link";
import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import AnimeCarousel from "@/components/anime-carousel";
import { createClient } from "@/lib/supabase/server";
import { AUTH_ENABLED } from "@/lib/features";
import { normalizeAnime, type AnimeRow } from "@/lib/services/normalizeAnime";
import type { MediaType } from "@/lib/services/animeService";

export const metadata: Metadata = {
  title: "Discover | Nayozu",
  description: "Discover top rated, trending, and new anime and manga on Nayozu.",
};

const WITH_GENRES = "*, anime_genres(genres(name))";

const toList = (data: unknown) =>
  ((data ?? []) as AnimeRow[]).map(normalizeAnime);

type Props = {
  searchParams: Promise<{ type?: string }>;
};

export default async function DiscoverPage({ searchParams }: Props) {
  const { type } = await searchParams;
  const mediaType: MediaType = type === "manga" ? "manga" : "anime";
  const isManga = mediaType === "manga";

  const supabase = await createClient();

  const [topRatedRes, trendingRes, newSeasonRes, genresRes, userRes] =
    await Promise.all([
      // 1. Top rated: average_score desc, nulls last, score > 0
      supabase
        .from("anime")
        .select(WITH_GENRES)
        .eq("media_type", mediaType)
        .gt("average_score", 0)
        .order("average_score", { ascending: false, nullsFirst: false })
        .order("popularity", { ascending: false, nullsFirst: false })
        .order("id")
        .limit(12),

      // 2. Trending now: popularity desc
      supabase
        .from("anime")
        .select(WITH_GENRES)
        .eq("media_type", mediaType)
        .order("popularity", { ascending: false, nullsFirst: false })
        .order("id")
        .limit(12),

      // 3. New this season: status = 'RELEASING', season_year desc, then popularity desc
      supabase
        .from("anime")
        .select(WITH_GENRES)
        .eq("media_type", mediaType)
        .eq("status", "RELEASING")
        .order("season_year", { ascending: false, nullsFirst: false })
        .order("popularity", { ascending: false, nullsFirst: false })
        .order("id")
        .limit(12),

      // Genres
      supabase.from("genres").select("id, name").order("name"),

      // Auth user
      AUTH_ENABLED
        ? supabase.auth.getUser()
        : Promise.resolve({ data: { user: null } }),
    ]);

  const topRated = toList(topRatedRes.data);
  const trending = toList(trendingRes.data);
  const newSeason = toList(newSeasonRes.data);
  const genres = genresRes.data ?? [];

  const user = userRes.data.user;
  const userId = user ? user.id : null;
  let libraryEntries;
  if (user) {
    const { data } = await supabase
      .from("user_anime_library")
      .select("*")
      .eq("user_id", user.id);
    libraryEntries = data ?? undefined;
  }

  return (
    <div className="flex flex-col gap-12">
      {/* Header with Title, Media Type Toggle, and Surprise Me */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Discover</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Explore the highest rated, trending, and latest {isManga ? "manga" : "anime"}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Two-link toggle: Anime | Manga */}
          <div className="inline-flex rounded-lg border border-border bg-muted p-1">
            <Link
              href="/discover?type=anime"
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                !isManga
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Anime
            </Link>
            <Link
              href="/discover?type=manga"
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                isManga
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Manga
            </Link>
          </div>

          {/* Surprise Me button */}
          <Link
            href={`/discover/random?type=${mediaType}`}
            prefetch={false}
            className="inline-flex items-center gap-2 rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors shadow-sm"
          >
            <Sparkles className="h-4 w-4 text-primary" />
            <span>Surprise me</span>
          </Link>
        </div>
      </div>

      {/* Carousels */}
      <div className="flex flex-col gap-10">
        {/* 1. Top rated */}
        {topRated.length > 0 && (
          <AnimeCarousel
            title={`Top Rated ${isManga ? "Manga" : "Anime"}`}
            anime={topRated}
            libraryEntries={libraryEntries}
            userId={userId}
          />
        )}

        {/* 2. Trending now */}
        {trending.length > 0 && (
          <AnimeCarousel
            title={`Trending ${isManga ? "Manga" : "Anime"}`}
            anime={trending}
            libraryEntries={libraryEntries}
            userId={userId}
          />
        )}

        {/* 3. New this season */}
        {newSeason.length > 0 && (
          <AnimeCarousel
            title={`New This Season (${isManga ? "Publishing" : "Releasing"})`}
            anime={newSeason}
            libraryEntries={libraryEntries}
            userId={userId}
          />
        )}
      </div>

      {/* Browse by genre */}
      {genres.length > 0 && (
        <section className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Browse by Genre</h2>
            <Link
              href={`/${mediaType}`}
              className="text-sm text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {genres.map((g) => (
              <Link
                key={g.id}
                href={`/${mediaType}?genre=${encodeURIComponent(g.name)}`}
                className="flex items-center justify-center rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition-colors hover:border-primary hover:bg-accent text-center"
              >
                {g.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
