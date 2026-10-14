"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAnimeById } from "@/lib/services/animeService";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import Rating from "@/components/rating";
import ReviewForm from "@/components/review-form";
import ReviewList from "@/components/review-list";
import CommentList from "@/components/comment-list";

export default function AnimeDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const animeId = Number(id);

  const [anime, setAnime] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [libraryEntry, setLibraryEntry] = useState<any>(null); // library entry for this anime and user
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("planned");
  const [newProgress, setNewProgress] = useState<number>(0);

  // Tab state for reviews and comments
  const [activeTab, setActiveTab] = useState<"reviews" | "comments">("reviews");

  // Fetch anime data
  useEffect(() => {
    const fetchAnime = async () => {
      try {
        setLoading(true);
        const data = await getAnimeById(animeId);
        setAnime(data);
        setLoading(false);
      } catch (err) {
        if (err instanceof Error && err.message.includes("not found")) {
          setError("Anime not found");
        } else {
          setError("Failed to load anime details");
        }
        setLoading(false);
      }
    };

    fetchAnime();
  }, [animeId]);

  // Fetch user session and library entry for this anime
  useEffect(() => {
    const fetchSessionAndLibrary = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        setUserId(user ? user.id : null);

        if (user) {
          // Fetch library entry for this user and anime
          const { data, error } = await supabase
            .from("user_anime_library")
            .select("*")
            .eq("user_id", user.id)
            .eq("anime_id", animeId.toString()) // anime_id stored as text
            .single();

          if (error && error.code !== "PGRST116") {
            // PGRST116 means no rows returned (which is fine)
            throw error;
          }
          setLibraryEntry(data || null);
        } else {
          setLibraryEntry(null);
        }
      } catch (err) {
        console.error("Failed to fetch session or library entry:", err);
        setLibraryEntry(null);
        setUserId(null);
      }
    };

    fetchSessionAndLibrary();
  }, [animeId]); // Run whenever animeId changes

  const handleAddToLibrary = async () => {
    setIsAdding(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/auth/login";
        return;
      }

      const { error } = await supabase
        .from("user_anime_library")
        .insert({
          user_id: user.id,
          anime_id: animeId.toString(),
          status: "planned",
          progress: 0,
        });

      if (error) throw error;

      // Optimistically update the library entry
      setLibraryEntry({
        id: "", // we don't know the ID yet, but we can set a placeholder
        user_id: user.id,
        anime_id: animeId.toString(),
        status: "planned",
        progress: 0,
      });
      setIsAdding(false);
    } catch (err) {
      console.error("Failed to add to library:", err);
      setIsAdding(false);
    }
  };

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

      // Optimistically update the library entry
      setLibraryEntry({
        ...libraryEntry,
        status: newStatus,
        progress: newProgress,
        updated_at: new Date().toISOString(),
      });
      setIsUpdating(false);
    } catch (err) {
      console.error("Failed to update library entry:", err);
      setIsUpdating(false);
    }
  };

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

  if (loading) return <div className="flex h-[60vh] items-center justify-center">Loading...</div>;
  if (error) return <div className="flex h-[60vh] items-center justify-center">{error}</div>;
  if (!anime) return <div className="flex h-[60vh] items-center justify-center">Anime not found</div>;

  return (
    <div className="min-h-screen bg-[#080D18] text-[#F4F6FC] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col items-center">
          <Link
            href="/anime"
            className="mb-4 text-sm text-[#7047F5] hover:underline"
          >
            ← Back to Anime Discovery
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-[250px_1fr]">
          {/* Cover Image */}
          <div className="flex flex-col items-center">
            <img
              src={anime.coverImage}
              alt={anime.title}
              className="w-64 h-96 object-cover rounded-lg shadow-lg"
            />
          </div>

          {/* Details */}
          <div className="space-y-6">
            <h1 className="text-3xl font-bold text-white">{anime.title}</h1>
            {anime.alternativeTitles && anime.alternativeTitles.length > 0 && (
              <div className="text-sm text-gray-400 italic mb-2">
                {"Also known as: " + anime.alternativeTitles.join(", ")}
              </div>
            )}
            <div className="space-y-2">
              <p className="text-lg text-white">{anime.synopsis}</p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-gray-400">
              <span>Genres: {anime.genres?.join(", ") || "N/A"}</span>
              <span>Released: {anime.releaseYear}</span>
              <span>Season: {anime.releaseSeason}</span>
              <span>Format: {anime.format}</span>
              <span>Episodes: {anime.episodeCount}</span>
              <span>Status: {anime.status}</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span>Average Score: {anime.averageScore}/100</span>
              <span>Popularity: {anime.popularity}</span>
            </div>

            {/* Rating Component */}
            <div className="mt-6">
              <Rating animeId={animeId.toString()} />
            </div>

            {/* Library Controls */}
            {!userId ? (
              // Not authenticated
              <div className="mt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.href = "/auth/login";
                  }}
                >
                  Sign in to add to library
                </Button>
              </div>
            ) : libraryEntry ? (
              // In library
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm text-gray-400">
                  <span>Status: {libraryEntry.status}</span>
                  <span>Progress: {libraryEntry.progress}</span>
                </div>
                <div className="flex justify-end space-x-2">
                  {!isUpdating ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsUpdating(true);
                        setNewStatus(libraryEntry.status);
                        setNewProgress(libraryEntry.progress);
                      }}
                    >
                      Edit
                    </Button>
                  ) : (
                    <>
                      <div className="flex space-x-1">
                        <select
                          value={newStatus}
                          onChange={(e) => setNewStatus(e.target.value)}
                          className="border border-gray-600 bg-[#101827/80] rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="planned">Planned</option>
                          <option value="watching">Watching</option>
                          <option value="completed">Completed</option>
                          <option value="on_hold">On Hold</option>
                          <option value="dropped">Dropped</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          value={newProgress}
                          onChange={(e) => setNewProgress(parseInt(e.target.value) || 0)}
                          className="border border-gray-600 bg-[#101827/80] rounded w-20 px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex justify-end space-x-1 mt-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setIsUpdating(false);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleUpdateLibrary}
                        >
                          Save
                        </Button>
                      </div>
                    </>
                  )}
                  <Button
                    variant="outline"
                    onClick={handleRemoveFromLibrary}
                    className="text-red-400 hover:text-red-500"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              // Not in library
              <div className="mt-4">
                <Button
                  onClick={handleAddToLibrary}
                  disabled={isAdding}
                >
                  {isAdding ? "Adding..." : "+ Add to Library"}
                </Button>
              </div>
            )}

            {/* Tabs for Reviews and Comments */}
            <div className="mt-6 flex space-x-4 text-sm font-medium">
              <button
                onClick={() => setActiveTab("reviews")}
                className={cn(
                  activeTab === "reviews"
                    ? "border-b-2 border-[#7047F5] text-[#7047F5]"
                    : "border-b-2 border-transparent text-gray-400 hover:text-white"
                )}
              >
                Reviews
              </button>
              <button
                onClick={() => setActiveTab("comments")}
                className={cn(
                  activeTab === "comments"
                    ? "border-b-2 border-[#7047F5] text-[#7047F5]"
                    : "border-b-2 border-transparent text-gray-400 hover:text-white"
                )}
              >
                Discussions
              </button>
            </div>

            {/* Reviews Tab */}
            {activeTab === "reviews" && (
              <>
                <div className="mt-6">
                  <h2 className="text-xl font-semibold text-white mb-4">Reviews</h2>
                  <ReviewForm animeId={animeId.toString()} />
                </div>
                <div className="mt-6">
                  <ReviewList animeId={animeId.toString()} />
                </div>
              </>
            )}

            {/* Comments Tab */}
            {activeTab === "comments" && (
              <>
                <div className="mt-6">
                  <h2 className="text-xl font-semibold text-white mb-4">Discussions</h2>
                  <CommentList animeId={animeId.toString()} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}