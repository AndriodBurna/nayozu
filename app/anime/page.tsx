"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AnimeGrid from "@/components/anime-grid";
import Loading from "@/components/loading";
import Empty from "@/components/empty";
import Error from "@/components/error";
import { getAllAnime, getGenres } from "@/lib/services/animeService";
import { createClient } from "@/lib/supabase/client";

export default function AnimePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [animeData, setAnimeData] = useState<Array<any>>([]);
  const [genreData, setGenreData] = useState<Array<any>>([]);
  const [libraryEntries, setLibraryEntries] = useState<Array<any> | undefined>(undefined);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("popularity"); // options: popularity, rating, year

  // Initialize selectedGenre and sortBy from URL params
  useEffect(() => {
    const genreParam = searchParams.get("genre") || "";
    const sortParam = searchParams.get("sort") || "popularity";
    setSelectedGenre(genreParam);
    setSortBy(sortParam);
  }, [searchParams]);

  // Fetch user session and library entries
  useEffect(() => {
    async function fetchSessionAndLibrary() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        setUserId(user ? user.id : null);

        if (user) {
          // Fetch library entries for the user
          const { data, error } = await supabase
            .from("user_anime_library")
            .select("*")
            .eq("user_id", user.id);

          if (error) throw error;
          setLibraryEntries(data);
        } else {
          setLibraryEntries(undefined);
        }
      } catch (err) {
        console.error("Failed to fetch session or library:", err);
        setLibraryEntries(undefined);
        setUserId(null);
      }
    }

    fetchSessionAndLibrary();
  }, []); // Run once on mount; we could also run on auth state changes, but for simplicity we'll do it once

  // Fetch genres and all anime on mount and when search params change
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Fetch genres and all anime concurrently
        const [genres, allAnime] = await Promise.all([
          getGenres(),
          getAllAnime(),
        ]);
        setGenreData(genres);
        setAnimeData(allAnime);
        setLoading(false);
      } catch (err) {
        setError("Failed to load data");
        setLoading(false);
      }
    };

    fetchData();
  }, [searchParams]); // Refetch when search params change (search, genre, sort)

  // Filter and sort anime based on search query, selected genre, and sortBy
  const filteredAndSortedAnime = useMemo(() => {
    const searchQuery = searchParams.get("search") || "";
    let results = [...animeData];

    // Filter by search query (title or alternative titles)
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.trim().toLowerCase();
      results = results.filter(
        (anime) =>
          anime.title.toLowerCase().includes(lowerQuery) ||
          (anime.alternativeTitles?.some((alt: string) =>
            alt.toLowerCase().includes(lowerQuery)
          ) ?? false)
      );
    }

    // Filter by selected genre
    if (selectedGenre) {
      results = results.filter((anime) =>
        anime.genres?.includes(selectedGenre) ?? false
      );
    }

    // Sort
    if (sortBy === "rating") {
      results.sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0));
    } else if (sortBy === "year") {
      results.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
    } else {
      // popularity: sort by popularity descending
      results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }

    return results;
  }, [animeData, searchParams, selectedGenre, sortBy]);

  // Handlers for changing genre and sort
  const handleGenreChange = (genre: string) => {
    setSelectedGenre(genre);
    const params = new URLSearchParams(searchParams.toString());
    if (genre) {
      params.set("genre", genre);
    } else {
      params.delete("genre");
    }
    router.push(`/anime?${params.toString()}`);
  };

  const handleSortChange = (sort: string) => {
    setSortBy(sort);
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", sort);
    router.push(`/anime?${params.toString()}`);
  };

  if (loading) return <Loading />;
  if (error) return <Error message={error} />;
  if (animeData.length === 0) return <Empty />;

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center justify-between flex-wrap md:flex-row md:items-start">
        <h1 className="text-3xl font-bold text-white">Anime Discovery</h1>
        <div className="flex flex-col items-center justify-center flex-wrap md:flex-row md:space-x-4 mt-4 md:mt-0">
          {/* Search input is in the header; we don't duplicate it here */}
          <div className="flex space-x-3 mt-4 md:mt-0">
            <select
              value={selectedGenre}
              onChange={(e) => handleGenreChange(e.target.value)}
              className="rounded-lg bg-[#101827/80] border border-white/20 px-4 py-2 text-sm text-[#F4F6FC] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5] focus:border-transparent"
            >
              <option value="">All Genres</option>
              {genreData.map((genre) => (
                <option key={genre.id} value={genre.name}>
                  {genre.name}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value)}
              className="rounded-lg bg-[#101827/80] border border-white/20 px-4 py-2 text-sm text-[#F4F6FC] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5] focus:border-transparent"
            >
              <option value="popularity">Sort by Popularity</option>
              <option value="rating">Sort by Rating</option>
              <option value="year">Sort by Year (Newest)</option>
            </select>
          </div>
        </div>
      </div>

      {filteredAndSortedAnime.length > 0 ? (
        <AnimeGrid
          anime={filteredAndSortedAnime}
          libraryEntries={libraryEntries}
          userId={userId}
          columns={3}
        />
      ) : (
        <Empty title="No anime found" description="Try changing your filters or search term." />
      )}
    </div>
  );
}