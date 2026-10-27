import { createClient } from "@/lib/supabase/server";
import type {
  CatalogPickerOption,
  LibraryEntryItem,
  LibraryStatus,
} from "@/lib/actions/libraryActions";

interface RawLibraryRow {
  id: string;
  user_id: string;
  anime_id: string;
  status: string;
  progress: number;
  updated_at: string;
  created_at: string;
}

interface RawAnimeDbRow {
  external_id: number;
  slug: string;
  title_romaji: string;
  title_english: string | null;
  cover_image_url: string | null;
  format: string | null;
  episodes: number | null;
  chapters: number | null;
  season_year: number | null;
  average_score: number | null;
  media_type: string;
  anime_genres?: Array<{ genres: { name: string } | null }> | null;
}

export interface UserActivityHistoryItem {
  id: string;
  kind: "progress" | "rating" | "review";
  timestamp: string;
  mediaType: "anime" | "manga";
  externalId: number;
  slug: string;
  title: string;
  coverImage: string | null;
  format: string | null;
  totalUnits: number | null;
  status?: LibraryStatus;
  progress?: number;
  rating?: number;
  reviewTitle?: string | null;
  reviewBody?: string | null;
  libraryEntryId?: string;
}

export interface UserLibraryBundle {
  user: {
    id: string;
    email: string | null;
    username: string;
  } | null;
  animeWatchlist: LibraryEntryItem[];
  mangaReadingList: LibraryEntryItem[];
  favorites: LibraryEntryItem[];
  historyItems: UserActivityHistoryItem[];
  animeCatalogOptions: CatalogPickerOption[];
  mangaCatalogOptions: CatalogPickerOption[];
  error: string | null;
}

function parseRawAnimeKey(rawKey: string): {
  isFavorite: boolean;
  mediaTypeHint: "anime" | "manga" | null;
  externalId: number | null;
} {
  const trimmed = rawKey.trim();
  const favMatch = trimmed.match(/^fav:(anime|manga):(\d+)$/);
  if (favMatch) {
    return {
      isFavorite: true,
      mediaTypeHint: favMatch[1] as "anime" | "manga",
      externalId: Number(favMatch[2]),
    };
  }

  const typedMatch = trimmed.match(/^(anime|manga):(\d+)$/);
  if (typedMatch) {
    return {
      isFavorite: false,
      mediaTypeHint: typedMatch[1] as "anime" | "manga",
      externalId: Number(typedMatch[2]),
    };
  }

  if (/^\d+$/.test(trimmed)) {
    return {
      isFavorite: false,
      mediaTypeHint: null,
      externalId: Number(trimmed),
    };
  }

  return { isFavorite: false, mediaTypeHint: null, externalId: null };
}

export async function loadUserLibraryBundle(): Promise<UserLibraryBundle> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      user: null,
      animeWatchlist: [],
      mangaReadingList: [],
      favorites: [],
      historyItems: [],
      animeCatalogOptions: [],
      mangaCatalogOptions: [],
      error: null,
    };
  }

  const username =
    (user.user_metadata?.username as string | undefined) ||
    user.email?.split("@")[0] ||
    `user_${user.id.slice(0, 6)}`;

  try {
    const [
      libRes,
      ratingsRes,
      reviewsRes,
      popularAnimeRes,
      popularMangaRes,
    ] = await Promise.all([
      supabase
        .from("user_anime_library")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }),

      supabase
        .from("anime_ratings")
        .select("id, anime_id, rating, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(50),

      supabase
        .from("anime_reviews")
        .select("id, anime_id, title, body, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),

      supabase
        .from("anime")
        .select(
          "external_id, slug, title_romaji, title_english, cover_image_url, format, episodes, chapters, season_year, media_type"
        )
        .eq("media_type", "anime")
        .neq("status", "NOT_YET_RELEASED")
        .order("popularity", { ascending: false, nullsFirst: false })
        .limit(60),

      supabase
        .from("anime")
        .select(
          "external_id, slug, title_romaji, title_english, cover_image_url, format, episodes, chapters, season_year, media_type"
        )
        .eq("media_type", "manga")
        .order("popularity", { ascending: false, nullsFirst: false })
        .limit(60),
    ]);

    if (libRes.error) {
      return {
        user: { id: user.id, email: user.email ?? null, username },
        animeWatchlist: [],
        mangaReadingList: [],
        favorites: [],
        historyItems: [],
        animeCatalogOptions: [],
        mangaCatalogOptions: [],
        error: libRes.error.message,
      };
    }

    const rawLibRows = (libRes.data ?? []) as RawLibraryRow[];

    // Collect all numeric external_ids referenced in library, ratings, and reviews
    const neededIds = new Set<number>();
    for (const r of rawLibRows) {
      const parsed = parseRawAnimeKey(r.anime_id);
      if (parsed.externalId) neededIds.add(parsed.externalId);
    }
    for (const r of ratingsRes.data ?? []) {
      if (/^\d+$/.test(String(r.anime_id))) neededIds.add(Number(r.anime_id));
    }
    for (const r of reviewsRes.data ?? []) {
      if (/^\d+$/.test(String(r.anime_id))) neededIds.add(Number(r.anime_id));
    }

    const mediaByCompositeKey = new Map<string, RawAnimeDbRow>();
    const mediaByExtIdFallback = new Map<number, RawAnimeDbRow>();

    if (neededIds.size > 0) {
      const { data: matchedMedia } = await supabase
        .from("anime")
        .select(
          "external_id, slug, title_romaji, title_english, cover_image_url, format, episodes, chapters, season_year, average_score, media_type, anime_genres(genres(name))"
        )
        .in("external_id", Array.from(neededIds));

      for (const m of (matchedMedia ?? []) as unknown as RawAnimeDbRow[]) {
        const mType = m.media_type === "manga" ? "manga" : "anime";
        mediaByCompositeKey.set(`${mType}:${m.external_id}`, m);
        // Prefer anime on numeric fallback only if not yet set
        if (!mediaByExtIdFallback.has(Number(m.external_id)) || mType === "anime") {
          mediaByExtIdFallback.set(Number(m.external_id), m);
        }
      }
    }

    // Track favorites by `${mediaType}:${externalId}` -> rowId
    const favoriteRowByKey = new Map<string, RawLibraryRow>();
    const standardRows: Array<{
      row: RawLibraryRow;
      media: RawAnimeDbRow;
      mediaType: "anime" | "manga";
    }> = [];

    for (const row of rawLibRows) {
      const parsed = parseRawAnimeKey(row.anime_id);
      if (!parsed.externalId) continue;

      if (parsed.isFavorite && parsed.mediaTypeHint) {
        favoriteRowByKey.set(`${parsed.mediaTypeHint}:${parsed.externalId}`, row);
        continue;
      }

      const matched =
        (parsed.mediaTypeHint
          ? mediaByCompositeKey.get(`${parsed.mediaTypeHint}:${parsed.externalId}`)
          : null) ?? mediaByExtIdFallback.get(parsed.externalId);

      if (!matched) continue;
      const resolvedType: "anime" | "manga" =
        matched.media_type === "manga" ? "manga" : "anime";

      standardRows.push({ row, media: matched, mediaType: resolvedType });
    }

    const toLibraryEntryItem = (
      row: RawLibraryRow,
      media: RawAnimeDbRow,
      mediaType: "anime" | "manga",
      isFav: boolean,
      favRowId: string | null
    ): LibraryEntryItem => {
      const genres = (media.anime_genres ?? [])
        .map((g) => g.genres?.name)
        .filter((n): n is string => Boolean(n));

      return {
        id: row.id,
        rawAnimeId: row.anime_id,
        externalId: Number(media.external_id),
        mediaType,
        status: (row.status as LibraryStatus) || "planned",
        progress: Number(row.progress) || 0,
        isFavorite: isFav,
        favoriteRowId: favRowId,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        media: {
          slug: media.slug,
          title: media.title_english || media.title_romaji,
          coverImage: media.cover_image_url ?? null,
          format: media.format ?? null,
          totalUnits:
            mediaType === "manga"
              ? media.chapters
                ? Number(media.chapters)
                : null
              : media.episodes
                ? Number(media.episodes)
                : null,
          year: media.season_year ? Number(media.season_year) : null,
          averageScore: media.average_score ? Number(media.average_score) : null,
          genres,
        },
      };
    };

    const animeWatchlist: LibraryEntryItem[] = [];
    const mangaReadingList: LibraryEntryItem[] = [];
    const standardByComposite = new Map<string, LibraryEntryItem>();

    for (const item of standardRows) {
      const compKey = `${item.mediaType}:${item.media.external_id}`;
      if (standardByComposite.has(compKey)) continue;
      const favRow = favoriteRowByKey.get(compKey);
      const entry = toLibraryEntryItem(
        item.row,
        item.media,
        item.mediaType,
        Boolean(favRow),
        favRow?.id ?? null
      );
      standardByComposite.set(compKey, entry);
      if (item.mediaType === "anime") {
        animeWatchlist.push(entry);
      } else {
        mangaReadingList.push(entry);
      }
    }

    // Build Favorites list (merging progress/status when also in Watchlist/Reading List)
    const favorites: LibraryEntryItem[] = [];
    for (const [compKey, favRow] of favoriteRowByKey.entries()) {
      const existingStandard = standardByComposite.get(compKey);
      if (existingStandard) {
        favorites.push(existingStandard);
        continue;
      }
      const media = mediaByCompositeKey.get(compKey);
      if (!media) continue;
      const mType: "anime" | "manga" =
        media.media_type === "manga" ? "manga" : "anime";
      favorites.push(toLibraryEntryItem(favRow, media, mType, true, favRow.id));
    }

    // Build History items (progress updates, watching/completed/on_hold/dropped entries, ratings, reviews)
    const historyItems: UserActivityHistoryItem[] = [];
    for (const entry of [...animeWatchlist, ...mangaReadingList]) {
      if (entry.progress > 0 || entry.status !== "planned") {
        historyItems.push({
          id: `lib-${entry.id}`,
          kind: "progress",
          timestamp: entry.updatedAt,
          mediaType: entry.mediaType,
          externalId: entry.externalId,
          slug: entry.media.slug,
          title: entry.media.title,
          coverImage: entry.media.coverImage,
          format: entry.media.format,
          totalUnits: entry.media.totalUnits,
          status: entry.status,
          progress: entry.progress,
          libraryEntryId: entry.id,
        });
      }
    }

    for (const r of ratingsRes.data ?? []) {
      const extId = Number(r.anime_id);
      const media = mediaByExtIdFallback.get(extId);
      if (!media) continue;
      const mType: "anime" | "manga" =
        media.media_type === "manga" ? "manga" : "anime";
      historyItems.push({
        id: `rating-${r.id}`,
        kind: "rating",
        timestamp: r.updated_at,
        mediaType: mType,
        externalId: extId,
        slug: media.slug,
        title: media.title_english || media.title_romaji,
        coverImage: media.cover_image_url ?? null,
        format: media.format ?? null,
        totalUnits:
          mType === "manga"
            ? media.chapters
              ? Number(media.chapters)
              : null
            : media.episodes
              ? Number(media.episodes)
              : null,
        rating: Number(r.rating),
      });
    }

    for (const rev of reviewsRes.data ?? []) {
      const extId = Number(rev.anime_id);
      const media = mediaByExtIdFallback.get(extId);
      if (!media) continue;
      const mType: "anime" | "manga" =
        media.media_type === "manga" ? "manga" : "anime";
      historyItems.push({
        id: `review-${rev.id}`,
        kind: "review",
        timestamp: rev.created_at,
        mediaType: mType,
        externalId: extId,
        slug: media.slug,
        title: media.title_english || media.title_romaji,
        coverImage: media.cover_image_url ?? null,
        format: media.format ?? null,
        totalUnits:
          mType === "manga"
            ? media.chapters
              ? Number(media.chapters)
              : null
            : media.episodes
              ? Number(media.episodes)
              : null,
        reviewTitle: rev.title,
        reviewBody: rev.body,
      });
    }

    historyItems.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const toOption = (
      row: RawAnimeDbRow,
      mediaType: "anime" | "manga"
    ): CatalogPickerOption => ({
      externalId: Number(row.external_id),
      slug: row.slug,
      title: row.title_english || row.title_romaji,
      coverImage: row.cover_image_url ?? null,
      format: row.format ?? null,
      totalUnits:
        mediaType === "manga"
          ? row.chapters
            ? Number(row.chapters)
            : null
          : row.episodes
            ? Number(row.episodes)
            : null,
      year: row.season_year ? Number(row.season_year) : null,
      mediaType,
    });

    const animeCatalogOptions = (
      (popularAnimeRes.data ?? []) as unknown as RawAnimeDbRow[]
    ).map((r) => toOption(r, "anime"));

    const mangaCatalogOptions = (
      (popularMangaRes.data ?? []) as unknown as RawAnimeDbRow[]
    ).map((r) => toOption(r, "manga"));

    return {
      user: { id: user.id, email: user.email ?? null, username },
      animeWatchlist,
      mangaReadingList,
      favorites,
      historyItems,
      animeCatalogOptions,
      mangaCatalogOptions,
      error: null,
    };
  } catch (err) {
    return {
      user: { id: user.id, email: user.email ?? null, username },
      animeWatchlist: [],
      mangaReadingList: [],
      favorites: [],
      historyItems: [],
      animeCatalogOptions: [],
      mangaCatalogOptions: [],
      error: err instanceof Error ? err.message : "Failed to load user library",
    };
  }
}
