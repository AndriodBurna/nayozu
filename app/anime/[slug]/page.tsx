"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAnimeBySlug } from "@/lib/services/animeService";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import AnimeCard from "@/components/anime-card";
import Loading from "@/components/loading";
import Error from "@/components/error";
import Empty from "@/components/empty";

export default function AnimeDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [anime, setAnime] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [libraryEntry, setLibraryEntry] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("planned");
  const [newProgress, setNewProgress] = useState<number>(0);

  // Fetch user session and library entry for this anime
  useEffect(() => {
    async function fetchSessionAndLibrary() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        setUserId(user ? user.id : null);

        if (user && anime) {
          // Fetch library entry for this user and anime
          const { data, error } = await supabase
            .from("user_anime_library")
            .select("*")
            .eq("user_id", user.id)
            .eq("anime_id", String(anime.external_id))
            .single();

          if (error && error.code !== "PGRST116") {
            // PGRST116 means no rows returned, which is fine
            console.error("Failed to fetch library entry:", error);
          }
          setLibraryEntry(data);
        } else {
          setLibraryEntry(null);
        }
      } catch (err) {
        console.error("Failed to fetch session or library:", err);
        setLibraryEntry(null);
        setUserId(null);
      }
    }

    fetchSessionAndLibrary();
  }, [anime]);

  // Fetch anime data by slug
  useEffect(() => {
    async function fetchAnime() {
      if (!slug) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAnimeBySlug(slug);
        setAnime(data);
        setLoading(false);
      } catch (err: any) {
        console.error("Failed to fetch anime by slug:", err);
        setError("Failed to load anime details");
        setLoading(false);
      }
    }

    fetchAnime();
  }, [slug]);

  // Handle adding to library
  const handleAddToLibrary = async () => {
    setIsAdding(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth/login");
        return;
      }

      const { error } = await supabase
        .from("user_anime_library")
        .insert({
          user_id: user.id,
          anime_id: String(anime.external_id),
          status: "planned",
          progress: 0,
        });

      if (error) throw error;

      // Refetch library entry
      const { data } = await supabase
        .from("user_anime_library")
        .select("*")
        .eq("user_id", user.id)
        .eq("anime_id", String(anime.external_id))
        .single();

      setLibraryEntry(data);
      setIsAdding(false);
    } catch (err) {
      console.error("Failed to add to library:", err);
      setIsAdding(false);
    }
  };

  // Handle updating library entry
  const handleUpdateLibrary = async () => {
    setIsUpdating(true);
    try {
      if (!libraryEntry) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("user_anime_library")
        .update({
          status: newStatus,
          progress: newProgress,
          updated_at: new Date().toISOString(),
        })
        .eq("id", libraryEntry.id);

      if (error) throw error;

      // Update local library entry
      setLibraryEntry((prev: any) => {
        if (!prev) return prev;
        return { ...prev, status: newStatus, progress: newProgress };
      });

      setIsUpdating(false);
    } catch (err) {
      console.error("Failed to update library entry:", err);
      setIsUpdating(false);
    }
  };

  // Handle removing from library
  const handleRemoveFromLibrary = async () => {
    if (!libraryEntry) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("user_anime_library")
        .delete()
        .eq("id", libraryEntry.id);

      if (error) throw error;

      setLibraryEntry(null);
    } catch (err) {
      console.error("Failed to remove from library:", err);
    }
  };

  if (loading) return <Loading />;
  if (error) return <Error message={error} />;
  if (!anime) return <Empty />;

  return (
    <div className="min-h-screen bg-[#080D18] text-[#F4F6FC] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Link href="/anime" className="text-sm text-gray-400 hover:underline">
            ← Back to Anime List
          </Link>
          <h1 className="text-2xl font-bold text-white mt-2">{anime.title}</h1>
          <p className="text-sm text-gray-400">
            {anime.releaseYear} • {anime.genres?.map((g: any) => (typeof g === "string" ? g : g?.name)).filter(Boolean).join(", ")}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Image and basic info */}
          <div className="lg:row-span-2">
            <div className="aspect-w-16 aspect-h-9 mb-4">
              <Image
                src={anime.coverImage}
                alt={anime.title}
                fill
                style={{ objectFit: "cover", objectPosition: "center" }}
                className="rounded-lg"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center text-sm text-gray-400">
                {anime.averageScore}/100
              </div>

              {anime.synopsis && (
                <p className="text-sm text-gray-300">{anime.synopsis}</p>
              )}

              <div className="flex flex-wrap gap-2 mb-4">
                {anime.genres?.map((genre: any) => {
                  const name = typeof genre === "string" ? genre : genre?.name;
                  if (!name) return null;
                  return (
                    <span key={name} className="bg-[#101827/60] px-2 py-0.5 rounded">
                      {name}
                    </span>
                  );
                })}
              </div>

              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-400">
                  {anime.episodeCount} episodes
                </span>
                <span className="text-sm text-gray-400">
                  {anime.releaseSeason} {anime.releaseYear}
                </span>
              </div>
            </div>
          </div>

          {/* Right column: Library controls and additional info */}
          <div className="space-y-6">
            {/* Library Controls */}
            <div className="bg-[#101827/80] rounded-lg p-4">
              <h2 className="text-lg font-bold text-white mb-4">My Library</h2>

              {!userId ? (
                // Not authenticated
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    router.push("/auth/login");
                  }}
                  className="w-full"
                >
                  Sign in to add to library
                </Button>
              ) : libraryEntry ? (
                // In library
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm text-gray-400">
                    <span>Status: {libraryEntry.status}</span>
                    <span>Progress: {libraryEntry.progress}</span>
                  </div>

                  {!isUpdating ? (
                    <div className="flex justify-end space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsUpdating(true);
                          setNewStatus(libraryEntry.status);
                          setNewProgress(libraryEntry.progress);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        onClick={handleRemoveFromLibrary}
                        className="bg-red-500 hover:bg-red-600"
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <>
                      <form
                        className="space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleUpdateLibrary();
                        }}
                      >
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-400">
                            Status
                          </label>
                          <select
                            value={newStatus}
                            onChange={(e) => setNewStatus(e.target.value)}
                            className="block w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
                          >
                            <option value="planned">Planned</option>
                            <option value="watching">Watching</option>
                            <option value="completed">Completed</option>
                            <option value="on_hold">On Hold</option>
                            <option value="dropped">Dropped</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-400">
                            Progress (Episodes Watched)
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={newProgress}
                            onChange={(e) => setNewProgress(parseInt(e.target.value) || 0)}
                            className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
                          />
                          <p className="text-xs text-gray-400 mt-1">
                            Maximum episodes: {anime.episodeCount}
                          </p>
                        </div>

                        <div className="flex justify-end space-x-2 mt-4">
                          <Button
                            variant="outline"
                            onClick={() => {
                              setIsUpdating(false);
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            className="bg-[#7047F5] hover:bg-[#5a37f5]"
                          >
                            Save Changes
                          </Button>
                        </div>
                      </form>
                    </>
                  )}
                </div>
              ) : (
                // Not in library
                <Button
                  onClick={handleAddToLibrary}
                  disabled={isAdding}
                  className="w-full"
                >
                  {isAdding ? "Adding..." : "+ Add to Library"}
                </Button>
              )}
            </div>

            {/* Additional Info (if any) */}
            <div className="bg-[#101827/80] rounded-lg p-4">
              <h2 className="text-lg font-bold text-white mb-4">Details</h2>
              <div className="space-y-2 text-sm text-gray-300">
                <div>
                  <span className="font-medium">Title (English): </span>
                  {anime.titleEnglish || "N/A"}
                </div>
                <div>
                  <span className="font-medium">Average Score: </span>
                  {anime.averageScore}/100
                </div>
                <div>
                  <span className="font-medium">Popularity: </span>
                  {anime.popularity}
                </div>
                <div>
                  <span className="font-medium">Trending: </span>
                  {anime.trending}
                </div>
                <div>
                  <span className="font-medium">Episodes: </span>
                  {anime.episodeCount}
                </div>
                <div>
                  <span className="font-medium">Season: </span>
                  {anime.releaseSeason} {anime.releaseYear}
                </div>
                <div>
                  <span className="font-medium">Banner Image: </span>
                  {anime.bannerImage ? (
                    <Image
                      src={anime.bannerImage}
                      alt={`${anime.title} banner`}
                      width={400}
                      height={100}
                      style={{ objectFit: "cover", objectPosition: "center" }}
                      className="rounded-lg mt-1"
                    />
                  ) : (
                    <span className="italic">N/A</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Similar Anime Section */}
        <div className="mt-10">
          <h2 className="text-xl font-bold text-white mb-4">You Might Also Like</h2>
          {/* We'll fetch some similar anime based on genres or popularity */}
          {/* For now, we'll just show some popular anime */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Placeholder: we'll fetch data in a separate effect */}
            {/* We'll implement this later if time permits */}
            {/* For now, we'll leave it empty or show a message */}
            <p className="col-span-4 text-center text-gray-400">
              Similar anime recommendations coming soon.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}