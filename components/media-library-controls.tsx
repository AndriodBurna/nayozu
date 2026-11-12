"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, Check, Heart, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  toggleFavoriteAction,
  upsertLibraryEntryAction,
  type LibraryStatus,
} from "@/lib/actions/libraryActions";

interface MediaLibraryControlsProps {
  externalId: number;
  mediaType: "anime" | "manga";
  userId: string | null;
  initialStatus: LibraryStatus | null;
  initialProgress: number;
  initialFavorite: boolean;
}

export default function MediaLibraryControls({
  externalId,
  mediaType,
  userId,
  initialStatus,
  initialProgress,
  initialFavorite,
}: MediaLibraryControlsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<LibraryStatus | null>(initialStatus);
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!userId) {
    return (
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <Button asChild variant="outline" size="sm" className="rounded-xl text-xs">
          <Link href="/login">
            <Bookmark className="mr-1.5 h-3.5 w-3.5" />
            Sign in to add to {mediaType === "manga" ? "Reading List" : "Watchlist"}
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="rounded-xl text-xs text-zinc-400">
          <Link href="/login">
            <Heart className="mr-1.5 h-3.5 w-3.5" />
            Favorite
          </Link>
        </Button>
      </div>
    );
  }

  const handleSetStatus = (nextStatus: LibraryStatus) => {
    setError(null);
    startTransition(async () => {
      const res = await upsertLibraryEntryAction({
        externalId,
        mediaType,
        status: nextStatus,
        progress: initialProgress,
      });
      if (!res.success) {
        setError(res.error || "Failed to update library.");
        return;
      }
      setStatus(nextStatus);
      router.refresh();
    });
  };

  const handleToggleFav = () => {
    setError(null);
    startTransition(async () => {
      const res = await toggleFavoriteAction({ externalId, mediaType });
      if (!res.success) {
        setError(res.error || "Failed to update Favorites.");
        return;
      }
      setIsFavorite(Boolean(res.isFavorite));
      router.refresh();
    });
  };

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-center gap-2.5">
        {!status ? (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => handleSetStatus("planned")}
            className="rounded-xl bg-primary text-xs font-semibold text-primary-foreground"
          >
            {isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" />
            )}
            Add to {mediaType === "manga" ? "Reading List" : "Watchlist"}
          </Button>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-1">
            <Check className="h-3.5 w-3.5 text-primary" />
            <select
              aria-label="Library status"
              value={status}
              disabled={isPending}
              onChange={(e) => handleSetStatus(e.target.value as LibraryStatus)}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none"
            >
              <option value="planned" className="bg-[#121625]">
                Planning ({mediaType === "manga" ? "Plan to Read" : "Plan to Watch"})
              </option>
              <option value="watching" className="bg-[#121625]">
                In Progress ({mediaType === "manga" ? "Reading" : "Watching"})
              </option>
              <option value="completed" className="bg-[#121625]">
                Completed
              </option>
              <option value="on_hold" className="bg-[#121625]">
                On Hold
              </option>
              <option value="dropped" className="bg-[#121625]">
                Dropped
              </option>
            </select>
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleToggleFav}
          className={`rounded-xl text-xs ${
            isFavorite
              ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
              : "text-zinc-300"
          }`}
        >
          <Heart
            className={`mr-1.5 h-3.5 w-3.5 ${
              isFavorite ? "fill-rose-400 text-rose-400" : ""
            }`}
          />
          {isFavorite ? "In Favorites" : "Add to Favorites"}
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
