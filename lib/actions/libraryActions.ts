"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LibraryStatus =
  | "planned"
  | "watching"
  | "completed"
  | "on_hold"
  | "dropped";

export interface LibraryEntryItem {
  id: string;
  rawAnimeId: string;
  externalId: number;
  mediaType: "anime" | "manga";
  status: LibraryStatus;
  progress: number;
  isFavorite: boolean;
  favoriteRowId: string | null;
  updatedAt: string;
  createdAt: string;
  media: {
    slug: string;
    title: string;
    coverImage: string | null;
    format: string | null;
    totalUnits: number | null; // episodes for anime, chapters for manga
    year: number | null;
    averageScore: number | null;
    genres: string[];
  };
}

export interface CatalogPickerOption {
  externalId: number;
  slug: string;
  title: string;
  coverImage: string | null;
  format: string | null;
  totalUnits: number | null;
  year: number | null;
  mediaType: "anime" | "manga";
}

export interface LibraryActionResult {
  success: boolean;
  error?: string;
}

const VALID_STATUSES: readonly LibraryStatus[] = [
  "planned",
  "watching",
  "completed",
  "on_hold",
  "dropped",
];

function revalidateLibraryPaths() {
  revalidatePath("/watchlist");
  revalidatePath("/reading-list");
  revalidatePath("/history");
  revalidatePath("/favorites");
  revalidatePath("/library");
  revalidatePath("/profile");
}

/**
 * Add or update a user's Watchlist (anime) or Reading List (manga) entry.
 * Enforces server-side authentication and RLS (user_id === user.id) and uses a
 * deterministic canonical storage key so concurrent upserts resolve atomically via
 * `ON CONFLICT (user_id, anime_id)`.
 */
export async function upsertLibraryEntryAction(input: {
  externalId: number;
  mediaType: "anime" | "manga";
  status: LibraryStatus;
  progress?: number;
}): Promise<LibraryActionResult> {
  const extId = Number(input.externalId);
  if (!Number.isFinite(extId) || extId <= 0) {
    return { success: false, error: "Invalid title ID." };
  }

  if (input.mediaType !== "anime" && input.mediaType !== "manga") {
    return { success: false, error: "Invalid media type." };
  }

  if (!VALID_STATUSES.includes(input.status)) {
    return { success: false, error: "Invalid library status." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to add or update library entries.",
    };
  }

  // Verify the title exists in public.anime for the given mediaType
  const { data: mediaRow, error: mediaErr } = await supabase
    .from("anime")
    .select("external_id, media_type, episodes, chapters")
    .eq("external_id", extId)
    .eq("media_type", input.mediaType)
    .maybeSingle();

  if (mediaErr || !mediaRow) {
    return {
      success: false,
      error: "Selected title was not found in the catalog.",
    };
  }

  const maxUnits =
    input.mediaType === "manga"
      ? mediaRow.chapters
        ? Number(mediaRow.chapters)
        : null
      : mediaRow.episodes
        ? Number(mediaRow.episodes)
        : null;

  const rawProgress = Math.max(Math.floor(Number(input.progress) || 0), 0);
  const clampedProgress =
    maxUnits && rawProgress > maxUnits ? maxUnits : rawProgress;

  const finalStatus: LibraryStatus =
    maxUnits && clampedProgress >= maxUnits && input.status === "watching"
      ? "completed"
      : input.status;

  // Deterministic canonical key prevents cross-media ID collisions and TOCTOU races
  const storageKey =
    input.mediaType === "manga" ? `manga:${extId}` : String(extId);

  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase.from("user_anime_library").upsert(
    {
      user_id: user.id,
      anime_id: storageKey,
      status: finalStatus,
      progress: clampedProgress,
      updated_at: now,
    },
    { onConflict: "user_id,anime_id" }
  );

  if (upsertErr) {
    return {
      success: false,
      error: upsertErr.message || "Failed to save library entry.",
    };
  }

  revalidateLibraryPaths();
  return { success: true };
}

/**
 * Remove a library entry belonging to the authenticated user.
 */
export async function removeLibraryEntryAction(input: {
  entryId: string;
}): Promise<LibraryActionResult> {
  const cleanId = (input.entryId ?? "").trim();
  if (!cleanId) {
    return { success: false, error: "Invalid library entry ID." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to remove library entries.",
    };
  }

  const { error } = await supabase
    .from("user_anime_library")
    .delete()
    .eq("id", cleanId)
    .eq("user_id", user.id);

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to remove library entry.",
    };
  }

  revalidateLibraryPaths();
  return { success: true };
}

/**
 * Toggle explicit Favorite status for an anime or manga title.
 * Stored in `public.user_anime_library` with `anime_id = "fav:<mediaType>:<externalId>"`
 * so it is protected by Row Level Security (`auth.uid() = user_id`) without colliding
 * with Watchlist / Reading List progress entries.
 */
export async function toggleFavoriteAction(input: {
  externalId: number;
  mediaType: "anime" | "manga";
}): Promise<{ success: boolean; isFavorite?: boolean; error?: string }> {
  const extId = Number(input.externalId);
  if (!Number.isFinite(extId) || extId <= 0) {
    return { success: false, error: "Invalid title ID." };
  }

  if (input.mediaType !== "anime" && input.mediaType !== "manga") {
    return { success: false, error: "Invalid media type." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to manage Favorites.",
    };
  }

  const favKey = `fav:${input.mediaType}:${extId}`;

  const { data: existing, error: fetchErr } = await supabase
    .from("user_anime_library")
    .select("id")
    .eq("user_id", user.id)
    .eq("anime_id", favKey)
    .maybeSingle();

  if (fetchErr) {
    return {
      success: false,
      error: fetchErr.message || "Failed to check favorite status.",
    };
  }

  if (existing) {
    const { error: delErr } = await supabase
      .from("user_anime_library")
      .delete()
      .eq("id", existing.id)
      .eq("user_id", user.id);

    if (delErr) {
      return {
        success: false,
        error: delErr.message || "Failed to remove from Favorites.",
      };
    }

    revalidateLibraryPaths();
    return { success: true, isFavorite: false };
  }

  // Verify title exists in public.anime before upserting
  const { data: mediaRow } = await supabase
    .from("anime")
    .select("external_id")
    .eq("external_id", extId)
    .eq("media_type", input.mediaType)
    .maybeSingle();

  if (!mediaRow) {
    return {
      success: false,
      error: "Selected title was not found in the catalog.",
    };
  }

  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase.from("user_anime_library").upsert(
    {
      user_id: user.id,
      anime_id: favKey,
      status: "completed",
      progress: 0,
      updated_at: now,
    },
    { onConflict: "user_id,anime_id" }
  );

  if (upsertErr) {
    return {
      success: false,
      error: upsertErr.message || "Failed to add to Favorites.",
    };
  }

  revalidateLibraryPaths();
  return { success: true, isFavorite: true };
}
