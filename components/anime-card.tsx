"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LibraryEntry } from "@/lib/libraryMap";
import { AUTH_ENABLED } from "@/lib/features";

interface AnimeCardProps {
  /** AniList id. Library rows store this (as text) in anime_id. */
  externalId: number;
  title: string;
  image: string | null;
  averageScore: number | null;
  genres: string[];
  year: number | null;
  synopsis?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  status?: string | null;
  slug: string;
  mediaType?: "anime" | "manga";
  libraryEntry?: LibraryEntry;
  userId?: string | null;
}

const LIBRARY_COLUMNS = "id, anime_id, status, progress, user_id";

const selectClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");

export default function AnimeCard({
  externalId,
  title,
  image,
  averageScore,
  genres,
  year,
  synopsis,
  episodes,
  chapters,
  volumes,
  status,
  slug,
  mediaType = "anime",
  libraryEntry,
  userId,
}: AnimeCardProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [entry, setEntry] = useState<LibraryEntry | undefined>(libraryEntry);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftStatus, setDraftStatus] = useState("planned");
  const [draftProgress, setDraftProgress] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);

  // Follow the server/parent if it sends a different entry later.
  useEffect(() => setEntry(libraryEntry), [libraryEntry]);

  const chapterOrVolume = chapters
    ? `${chapters} ch`
    : volumes
    ? `${volumes} vol`
    : null;

  const meta = [
    year,
    mediaType === "manga" ? chapterOrVolume : (episodes ? `${episodes} eps` : null),
    status ? pretty(status) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const addToLibrary = async () => {
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }
      const { data, error } = await supabase
        .from("user_anime_library")
        .insert({
          user_id: user.id,
          anime_id: String(externalId),
          status: "planned",
          progress: 0,
        })
        .select(LIBRARY_COLUMNS)
        .single();
      if (error) throw error;
      setEntry(data);
    } catch (err) {
      console.error("Failed to add to library:", err);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!entry) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("user_anime_library")
        .update({
          status: draftStatus,
          progress: draftProgress,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entry.id)
        .select(LIBRARY_COLUMNS)
        .single();
      if (error) throw error;
      setEntry(data);
      setEditing(false);
    } catch (err) {
      console.error("Failed to update library entry:", err);
    } finally {
      setBusy(false);
    }
  };

  const removeFromLibrary = async () => {
    if (!entry) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("user_anime_library")
        .delete()
        .eq("id", entry.id);
      if (error) throw error;
      setEntry(undefined);
      setEditing(false);
    } catch (err) {
      console.error("Failed to remove from library:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="anime-card">
      {/* Poster (link) */}
      <Link href={`/${mediaType}/${slug}`} className="anime-card-poster block" aria-label={title}>
        {image && !imgFailed ? (
          <Image
            src={image}
            alt={title}
            fill
            sizes="(min-width: 1024px) 230px, 210px"
            className="object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
            No image
          </div>
        )}
      </Link>

      <div className="anime-card-body">
        <div className="anime-card-head">
          <h3 className="anime-card-title">
            <Link href={`/${mediaType}/${slug}`} className="hover:underline">
              {title}
            </Link>
          </h3>
          {averageScore ? (
            <span className="anime-card-score">{averageScore}/100</span>
          ) : null}
        </div>

        {meta && <p className="text-xs capitalize text-muted-foreground">{meta}</p>}

        {synopsis && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{synopsis}</p>
        )}

        {/* Everything below is pinned to the bottom so cards line up */}
        <div className="mt-auto flex flex-col gap-3 pt-1">
          {genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {genres.slice(0, 3).map((genre) => (
                <Badge key={genre} variant="secondary" className="font-normal">
                  {genre}
                </Badge>
              ))}
            </div>
          )}

          {/* Library controls (outside the links: no buttons inside <a>) */}
          {!AUTH_ENABLED ? null : !userId ? (
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/auth/login">Sign in to add to library</Link>
            </Button>
          ) : !entry ? (
            <Button size="sm" className="w-full" onClick={addToLibrary} disabled={busy}>
              {busy ? "Adding..." : "+ Add to Library"}
            </Button>
          ) : editing ? (
            <div className="space-y-2">
              <select
                aria-label="Status"
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value)}
                className={selectClass}
              >
                <option value="planned">Planned</option>
                <option value="watching">Watching</option>
                <option value="completed">Completed</option>
                <option value="on_hold">On Hold</option>
                <option value="dropped">Dropped</option>
              </select>
              <Input
                type="number"
                min={0}
                aria-label="Progress"
                value={draftProgress}
                onChange={(e) => setDraftProgress(parseInt(e.target.value, 10) || 0)}
                className="h-8 text-xs md:text-xs"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="flex-1" onClick={saveEdit} disabled={busy}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs capitalize text-muted-foreground">
                {pretty(entry.status)} · {mediaType === "manga" ? "ch" : "ep"} {entry.progress}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setDraftStatus(entry.status);
                    setDraftProgress(entry.progress);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={removeFromLibrary}
                  disabled={busy}
                >
                  Remove
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}