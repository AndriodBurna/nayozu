"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getAnimesByExternalIds } from "@/lib/services/animeService";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function LibraryPage() {
  const [library, setLibrary] = useState<Array<any>>([]); // each item: { library_entry: any, anime: any }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updateLibraryId, setUpdateLibraryId] = useState<string | null>(null); // which library entry is being updated
  const [updateStatus, setUpdateStatus] = useState<string>(""); // new status for the entry being updated
  const [updateProgress, setUpdateProgress] = useState<number>(0); // new progress for the entry being updated
  const router = useRouter();

  // Fetch library entries and anime data
  async function fetchLibrary() {
    setLoading(true);
    const supabase = createClient();
    try {
      // Get the current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth/login");
        return;
      }

      // Fetch library entries for the user
      const { data: libraryData, error: libraryError } = await supabase
        .from("user_anime_library")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (libraryError) throw libraryError;

      if (!libraryData || libraryData.length === 0) {
        setLibrary([]);
        setLoading(false);
        return;
      }

      // Extract anime IDs (stored as text AniList external_ids)
      const animeIds = libraryData.map((entry) => entry.anime_id);

      // Fetch anime data for these external IDs
      const animeData = await getAnimesByExternalIds(animeIds);
      // Create a map for quick lookup
      const animeMap = new Map();
      animeData.forEach((anime) => {
        animeMap.set(String(anime.external_id), anime);
      });

      // Combine library entry with anime data
      const combined = libraryData
        .map((entry) => {
          const anime = animeMap.get(String(entry.anime_id));
          return { library_entry: entry, anime: anime };
        })
        .filter((item) => item.anime !== undefined); // filter out if anime not found

      setLibrary(combined);
    } catch (err: any) {
      setError(err.message || "Failed to load library");
    } finally {
      setLoading(false);
    }
  }

  // Update library entry status and/or progress
  async function updateLibraryEntry(libraryId: string) {
    setUpdateLibraryId(libraryId);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("user_anime_library")
        .update({
          status: updateStatus,
          progress: updateProgress,
          updated_at: new Date().toISOString(),
        })
        .eq("id", libraryId);

      if (error) throw error;

      // Reset update state
      setUpdateLibraryId(null);
      setUpdateStatus("");
      setUpdateProgress(0);

      // Refetch library to show updated data
      await fetchLibrary();
    } catch (err: any) {
      setError(err.message || "Failed to update library entry");
      setUpdateLibraryId(null);
    }
  }

  // Remove library entry
  async function removeLibraryEntry(libraryId: string) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("user_anime_library")
        .delete()
        .eq("id", libraryId);

      if (error) throw error;

      // Refetch library
      await fetchLibrary();
    } catch (err: any) {
      setError(err.message || "Failed to remove library entry");
    }
  }

  // Fetch on mount
  useEffect(() => {
    fetchLibrary();
  }, []);

  if (loading) {
    return <div className="flex h-[60vh] items-center justify-center">Loading...</div>;
  }

  if (error) {
    return <div className="flex h-[60vh] items-center justify-center">{error}</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col items-center mb-6">
          <h1 className="text-3xl font-bold text-foreground">My Library</h1>
        </div>

        {library.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center text-card-foreground">
            <p className="text-muted-foreground">Your library is empty. Add anime to your library from the anime discovery page.</p>
            <div className="mt-6">
              <Link href="/anime" className="text-primary hover:underline">
                Browse Anime
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-6">
            {/* Responsive grid: 1 column on mobile, 2 on tablet, 3 on desktop */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6`}>
              {library.map((item) => {
                const entry = item.library_entry;
                const anime = item.anime;
                const isUpdating = updateLibraryId === entry.id;
                return (
                  <div key={entry.id} className="rounded-lg border bg-card p-4 text-card-foreground">
                    <div className="flex flex-col items-center">
                      {/* Anime Cover */}
                      <div className="mb-4">
                        <Link href={`/anime/${anime.slug || anime.id}`} className="block">
                          <img
                            src={anime.coverImage}
                            alt={anime.title}
                            className="w-48 h-72 object-cover rounded-lg shadow-lg hover:shadow-xl transition-shadow"
                          />
                        </Link>
                      </div>

                      {/* Anime Title */}
                      <h2 className="text-xl font-bold text-foreground mb-2">
                        <Link href={`/anime/${anime.slug || anime.id}`} className="hover:underline">
                          {anime.title}
                        </Link>
                      </h2>

                      {/* Status and Progress */}
                      <div className="space-y-3 w-full">
                        {!isUpdating ? (
                          <>
                            <div className="flex items-center justify-between text-sm text-muted-foreground">
                              <span>Status: {entry.status}</span>
                              <span>
                                Progress: {entry.progress} / {anime.episodeCount || "?"}
                              </span>
                            </div>
                            <div className="flex justify-end space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setUpdateLibraryId(entry.id);
                                  setUpdateStatus(entry.status);
                                  setUpdateProgress(entry.progress);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => removeLibraryEntry(entry.id)}
                              >
                                Remove
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <form className="space-y-3" onSubmit={(e) => {
                              e.preventDefault();
                              updateLibraryEntry(entry.id);
                            }}>
                              <div className="space-y-2">
                                <Label htmlFor={`status-${entry.id}`}>Status</Label>
                                <select
                                  id={`status-${entry.id}`}
                                  value={updateStatus}
                                  onChange={(e) => setUpdateStatus(e.target.value)}
                                  className="block w-full p-2 rounded border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                >
                                  <option value="planned">Planned</option>
                                  <option value="watching">Watching</option>
                                  <option value="completed">Completed</option>
                                  <option value="on_hold">On Hold</option>
                                  <option value="dropped">Dropped</option>
                                </select>
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor={`progress-${entry.id}`}>Progress (Episodes Watched)</Label>
                                <Input
                                  id={`progress-${entry.id}`}
                                  type="number"
                                  min={0}
                                  value={updateProgress}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    setUpdateProgress(isNaN(val) ? 0 : val);
                                  }}
                                  className="w-full p-2 rounded border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                                {anime.episodeCount && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Maximum episodes: {anime.episodeCount}
                                  </p>
                                )}
                              </div>

                              <div className="flex justify-end space-x-2 mt-4">
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setUpdateLibraryId(null);
                                    setUpdateStatus("");
                                    setUpdateProgress(0);
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="submit"
                                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                                >
                                  Save Changes
                                </Button>
                              </div>
                            </form>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}