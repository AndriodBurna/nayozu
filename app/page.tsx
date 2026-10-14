"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import AnimeCarousel from "@/components/anime-carousel";
import Loading from "@/components/loading";
import Empty from "@/components/empty";
import Error from "@/components/error";
import { getAllAnime, getGenres } from "@/lib/services/animeService";
import { createClient } from "@/lib/supabase/client";

export default function Home() {
  const [animeData, setAnimeData] = useState<any[]>([]);
  const [genreData, setGenreData] = useState<any[]>([]);
  const [libraryEntries, setLibraryEntries] = useState<any[] | undefined>(undefined);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Fetch all anime, genres, and user session/library concurrently
        const [animeData, genreData, { user, libraryData }] = await Promise.all([
          getAllAnime(),
          getGenres(),
          (async () => {
            const supabase = createClient();
            const {
              data: { user },
            } = await supabase.auth.getUser();
            let libraryData = undefined;
            if (user) {
              const { data, error } = await supabase
                .from("user_anime_library")
                .select("*")
                .eq("user_id", user.id);
              if (error) throw error;
              libraryData = data;
            }
            return { user, libraryData };
          })(),
        ]);
        setAnimeData(animeData);
        setGenreData(genreData);
        setUserId(user ? user.id : null);
        setLibraryEntries(libraryData);
        setLoading(false);
      } catch (err) {
        setError("Failed to load data");
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) return <Loading />;
  if (error) return <Error message={error} />;
  if (animeData.length === 0) return <Empty />;

  // For the homepage, we'll show different sections
  const featuredAnime = animeData.slice(0, 4); // first 4 for featured
  const trendingAnime = animeData.slice(0, 6); // first 6 for trending
  const newReleases = animeData.slice(4, 10); // next 6 for new releases (mock)

  return (
    <main className="min-h-screen bg-[#080D18] text-[#F4F6FC]">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-b from-[#080D18] to-[#080D18/90] py-20">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h1 className="mb-4 text-5xl font-extrabold tracking-tighter">
            Welcome to <span className="text-[#7047F5]">NAYOZU</span>
          </h1>
          <p className="mb-6 text-xl text-gray-300 max-w-2xl mx-auto">
            Discover, watch, and discuss your favorite anime with a passionate community.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/anime"
              className="rounded-lg bg-[#7047F5] px-6 py-3 font-semibold hover:bg-[#5D35DF] transition-colors"
            >
              Explore Anime
            </Link>
            <Link
              href="#"
              className="rounded-lg border border-white/20 px-6 py-3 font-semibold hover:bg-white/5 transition-colors"
            >
              Learn More
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Anime Carousel */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-6">
          <AnimeCarousel
            title="Featured Anime"
            anime={featuredAnime}
            libraryEntries={libraryEntries}
            userId={userId}
          />
        </div>
      </section>

      {/* Trending Now */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-6">
          <AnimeCarousel
            title="Trending Now"
            anime={trendingAnime}
            libraryEntries={libraryEntries}
            userId={userId}
          />
        </div>
      </section>

      {/* New Releases */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-6">
          <AnimeCarousel
            title="New Releases"
            anime={newReleases}
            libraryEntries={libraryEntries}
            userId={userId}
          />
        </div>
      </section>

      {/* Discovery by Genre */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="mb-6 text-xl font-bold text-white">Discover by Genre</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {genreData.map((genre) => (
              <Link
                key={genre.id}
                href="#"
                className="flex flex-col items-center justify-center p-4 border border-white/10 rounded-lg hover:border-[#7047F5] transition-colors bg-[#101827/50]"
              >
                <span className="mb-2 text-sm font-medium text-white">{genre.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="bg-[#101827/50] py-12">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white">Ready to dive in?</h2>
          <p className="mb-6 text-gray-300 max-w-2xl mx-auto">
            Start your anime journey today. Explore thousands of titles, join discussions, and build your watchlist.
          </p>
          <Link
            href="/anime"
            className="inline-block rounded-lg bg-[#7047F5] px-6 py-3 font-semibold hover:bg-[#5D35DF] transition-colors"
          >
            Start Exploring
          </Link>
        </div>
      </section>
    </main>
  );
}