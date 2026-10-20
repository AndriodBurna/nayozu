import Link from "next/link";
import AnimeCarousel from "@/components/anime-carousel";
import Empty from "@/components/empty";
import ErrorState from "@/components/error";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { AUTH_ENABLED } from "@/lib/features";
import { normalizeAnime, type AnimeRow } from "@/lib/services/normalizeAnime";

const WITH_GENRES = "*, anime_genres(genres(name))";

const toList = (data: unknown) => ((data ?? []) as AnimeRow[]).map(normalizeAnime);

export default async function Home() {
  const supabase = await createClient();

  try {
    const [popular, fresh, genresRes, userRes] = await Promise.all([
      // ranks 1-10 by popularity: first 4 = Featured, next 6 = Trending
      supabase
        .from("anime")
        .select(WITH_GENRES)
        .eq("media_type", "anime")
        .order("popularity", { ascending: false, nullsFirst: false })
        .order("id")
        .range(0, 9),
      supabase
        .from("anime")
        .select(WITH_GENRES)
        .eq("media_type", "anime")
        .not("season_year", "is", null)
        .neq("status", "NOT_YET_RELEASED")
        .order("season_year", { ascending: false, nullsFirst: false })
        .order("popularity", { ascending: false, nullsFirst: false })
        .order("id")
        .limit(6),
      supabase.from("genres").select("id, name").order("name"),
      AUTH_ENABLED
        ? supabase.auth.getUser()
        : Promise.resolve({ data: { user: null } }),
    ]);

    for (const res of [popular, fresh, genresRes]) {
      if (res.error) throw res.error;
    }

    const popularList = toList(popular.data);
    const featuredAnime = popularList.slice(0, 4);
    const trendingAnime = popularList.slice(4, 10);
    const newReleases = toList(fresh.data);
    const genreData = genresRes.data ?? [];

    const user = userRes.data.user;
    const userId = user ? user.id : null;
    let libraryEntries;
    if (user) {
      const { data, error } = await supabase
        .from("user_anime_library")
        .select("*")
        .eq("user_id", user.id);
      if (error) throw error;
      libraryEntries = data;
    }

    if (popularList.length === 0 && newReleases.length === 0) {
      return <Empty />;
    }

    return (
      <div className="flex flex-col gap-14">
        <section className="hero">
          <h1>
            Welcome to <span className="text-gradient">NAYOZU</span>
          </h1>
          <p>
            Discover, track and discuss your favorite anime and manga with a passionate community.
          </p>
          <div className="hero-actions">
            <Button asChild size="lg">
              <Link href="/anime">Explore Anime</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/anime">Learn More</Link>
            </Button>
          </div>
        </section>

        <AnimeCarousel
          title="Featured Anime"
          anime={featuredAnime}
          libraryEntries={libraryEntries}
          userId={userId}
        />
        <AnimeCarousel
          title="Trending Now"
          anime={trendingAnime}
          libraryEntries={libraryEntries}
          userId={userId}
        />
        <AnimeCarousel
          title="New Releases"
          anime={newReleases}
          libraryEntries={libraryEntries}
          userId={userId}
        />

        <section>
          <h2 className="section-title">Discover by Genre</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {genreData.map((genre) => (
              <Link
                key={genre.id}
                href={`/anime?genre=${encodeURIComponent(genre.name)}`}
                className="flex items-center justify-center rounded-lg border bg-card px-4 py-5 text-sm font-medium text-card-foreground transition-colors hover:border-primary hover:bg-accent"
              >
                {genre.name}
              </Link>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-center gap-4 rounded-xl border bg-card px-6 py-12 text-center">
          <h2 className="text-3xl font-bold">Ready to dive in?</h2>
          <p className="max-w-2xl text-muted-foreground">
            Start your anime journey today. Explore thousands of titles, join
            discussions, and build your watchlist.
          </p>
          <Button asChild size="lg">
            <Link href="/anime">Start Exploring</Link>
          </Button>
        </section>
      </div>
    );
  } catch (err) {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    console.error("Failed to load home page data:", e?.message, e?.code, e?.details, e?.hint);
    return <ErrorState message="Failed to load data" />;
  }
}