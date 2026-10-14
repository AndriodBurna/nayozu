import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnimeCardProps {
  id: number;
  title: string;
  image: string;
  averageScore: number;
  genres: string[];
  year: number;
  // Optional library entry for this anime for the current user
  libraryEntry?: {
    id: string;
    status: string;
    progress: number;
  };
  // Optional user ID to check if the user is authenticated
  userId?: string | null;
}

export default function AnimeCard({
  id,
  title,
  image,
  averageScore,
  genres,
  year,
  libraryEntry,
  userId,
}: AnimeCardProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("planned");
  const [newProgress, setNewProgress] = useState<number>(0);

  const supabase = createClient();

  const handleAddToLibrary = async () => {
    setIsAdding(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        // Redirect to login
        window.location.href = "/auth/login";
        return;
      }

      // Check if already exists (should not happen if libraryEntry is undefined)
      if (libraryEntry) {
        // Already in library, do nothing
        setIsAdding(false);
        return;
      }

      const { error } = await supabase
        .from("user_anime_library")
        .insert({
          user_id: user.id,
          anime_id: id.toString(), // store as text for now
          status: "planned",
          progress: 0,
        });

      if (error) throw error;

      // Optionally, we can refetch the library entry in the parent component
      // For now, we just show a success state and then update the libraryEntry prop via parent refetch
      // We'll close the add state and let the parent handle refetch
      setIsAdding(false);
      // We could also update the libraryEntry prop via a callback, but we don't have one.
      // Instead, we'll just show a temporary success message and then rely on the parent to refetch.
      // For simplicity, we'll just reset the state and let the parent refetch on its own.
      // We'll trigger a refetch by calling a function if provided, but we don't have one.
      // We'll just set a timeout to reset the state and hope the parent refetches.
      // Better: we'll pass a callback prop `onLibraryChange` but we don't want to change the API too much.
      // Given the scope, we'll just update the libraryEntry locally for optimistic UI.
      // We'll set the libraryEntry to the new entry (we don't have the ID yet).
      // We'll skip optimistic update for now and just reset the form.
    } catch (err) {
      console.error("Failed to add to library:", err);
      setIsAdding(false);
    }
  };

  const handleUpdateLibrary = async () => {
    setIsUpdating(true);
    try {
      if (!libraryEntry) return;

      const { error } = await supabase
        .from("user_anime_library")
        .update({
          status: newStatus,
          progress: newProgress,
          updated_at: new Date().toISOString(),
        })
        .eq("id", libraryEntry.id);

      if (error) throw error;

      // Reset update state
      setIsUpdating(false);
      // Again, we would rely on parent to refetch, but we can optimistically update the libraryEntry prop
      // We'll update the libraryEntry object locally (since we have it as a prop, we can't mutate it, but we can state)
      // We'll just reset the form and let the parent refetch.
    } catch (err) {
      console.error("Failed to update library entry:", err);
      setIsUpdating(false);
    }
  };

  const handleRemoveFromLibrary = async () => {
    if (!libraryEntry) return;
    try {
      const { error } = await supabase
        .from("user_anime_library")
        .delete()
        .eq("id", libraryEntry.id);

      if (error) throw error;

      // Again, rely on parent to refetch
    } catch (err) {
      console.error("Failed to remove from library:", err);
    }
  };

  return (
    <Link href={`/anime/${id}`} className="group block hover:shadow-xl transition-shadow">
      <div className="relative bg-[#101827/80] rounded-lg p-4 overflow-hidden">
        {/* Cover Image */}
        <div className="aspect-w-2 aspect-h-3 mb-4">
          <img
            src={image}
            alt={title}
            className="rounded-lg h-full w-full object-cover group-hover:opacity-90 transition-opacity"
          />
        </div>

        {/* Title and Rating */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-white group-hover:underline">
            {title}
          </h3>
          <div className="flex items-center text-sm text-gray-400">
            {averageScore}/100
          </div>
        </div>

        {/* Genres */}
        <div className="flex flex-wrap gap-1 mb-2 text-sm text-gray-400">
          {genres.map((genre) => (
            <span key={genre} className="bg-[#101827/60] px-2 py-0.5 rounded">
              {genre}
            </span>
          ))}
        </div>

        {/* Year */}
        <div className="text-sm text-gray-400 mb-4">
          {year}
        </div>

        {/* Library Controls */}
        {!userId ? (
          // Not authenticated
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.location.href = "/auth/login";
            }}
            className="mt-2"
          >
            Sign in to add to library
          </Button>
        ) : libraryEntry ? (
          // In library
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-400">
              <span>Status: {libraryEntry.status}</span>
              <span>Progress: {libraryEntry.progress}</span>
            </div>
            <div className="flex justify-end space-x-1">
              {!isUpdating ? (
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
              ) : (
                <>
                  <div className="flex space-x-1">
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      className="border border-gray-600 bg-[#101827/80] rounded px-1 py-0.5 text-xs text-white"
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
                      className="border border-gray-600 bg-[#101827/80] rounded w-20 px-1 py-0.5 text-xs text-white"
                    />
                  </div>
                  <div className="flex justify-end space-x-1 mt-1">
                    <Button
                      variant="outline"
                      size="sm"
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
                size="sm"
                onClick={handleRemoveFromLibrary}
                className="text-red-400 hover:text-red-500"
              >
                Remove
              </Button>
            </div>
          </div>
        ) : (
          // Not in library
          <Button
            onClick={handleAddToLibrary}
            disabled={isAdding}
            className="mt-2"
          >
            {isAdding ? "Adding..." : "+ Add to Library"}
          </Button>
        )}
      </div>
    </Link>
  );
}