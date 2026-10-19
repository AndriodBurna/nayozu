import { createClient } from "@/lib/supabase/client";
import { normalizeAnime, type Anime, type AnimeRow } from "./normalizeAnime";

// Browser client: uses your existing helper, so the env variable names
// are whatever lib/supabase/client.ts already reads. No keys live here.
const supabase = createClient();

const WITH_GENRES = "*, anime_genres(genres(name))";
export const PAGE_SIZE = 24;

type DbError = { message?: string; code?: string; details?: string; hint?: string };

function fail(fn: string, error: DbError): never {
  console.error(`${fn} error:`, error.message, error.code, error.details, error.hint);
  throw error;
}

/** Strip characters that would break a PostgREST .or() filter string. */
const cleanSearch = (s: string) => s.replace(/[%,()\\*]/g, " ").trim();

const toAnimeList = (data: unknown): Anime[] =>
  ((data ?? []) as AnimeRow[]).map(normalizeAnime);

/* ------------------------------------------------------------------ */
/* Lists for the home page                                             */
/* ------------------------------------------------------------------ */

export const getPopularAnime = async (limit: number, offset = 0): Promise<Anime[]> => {
  const { data, error } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .order("popularity", { ascending: false, nullsFirst: false })
    .order("id")
    .range(offset, offset + limit - 1);
  if (error) fail("getPopularAnime", error);
  return toAnimeList(data);
};

export const getTopRatedAnime = async (limit: number): Promise<Anime[]> => {
  const { data, error } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .gt("average_score", 0) // also excludes NULL scores
    .order("average_score", { ascending: false, nullsFirst: false })
    .order("popularity", { ascending: false, nullsFirst: false })
    .order("id")
    .limit(limit);
  if (error) fail("getTopRatedAnime", error);
  return toAnimeList(data);
};

export const getRecentAnime = async (limit: number): Promise<Anime[]> => {
  const { data, error } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .not("season_year", "is", null)
    .neq("status", "NOT_YET_RELEASED")
    .order("season_year", { ascending: false, nullsFirst: false })
    .order("popularity", { ascending: false, nullsFirst: false })
    .order("id")
    .limit(limit);
  if (error) fail("getRecentAnime", error);
  return toAnimeList(data);
};

/* ------------------------------------------------------------------ */
/* Single / multiple lookups                                           */
/* ------------------------------------------------------------------ */

export const getAnimeBySlug = async (slug: string): Promise<Anime | null> => {
  const { data, error } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .eq("slug", slug)
    .maybeSingle(); // null (not an exception) when the slug doesn't exist
  if (error) fail("getAnimeBySlug", error);
  return data ? normalizeAnime(data as unknown as AnimeRow) : null;
};

/** `id` is the uuid primary key (it was a number in the mock data). */
export const getAnimeById = async (id: string): Promise<Anime | null> => {
  const { data, error } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getAnimeById", error);
  return data ? normalizeAnime(data as unknown as AnimeRow) : null;
};

export const getAnimesByIds = async (ids: string[]): Promise<Anime[]> => {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .in("id", ids);
  if (error) fail("getAnimesByIds", error);
  return toAnimeList(data);
};

/**
 * Library, ratings, reviews and comments store the AniList id as text
 * (anime.external_id), so the library page should use this one.
 */
export const getAnimesByExternalIds = async (externalIds: Array<string | number>): Promise<Anime[]> => {
  if (externalIds.length === 0) return [];
  const { data, error } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .eq("media_type", "anime")
    .in("external_id", externalIds.map(Number));
  if (error) fail("getAnimesByExternalIds", error);
  return toAnimeList(data);
};

export const getGenres = async (): Promise<Array<{ id: string; name: string }>> => {
  const { data, error } = await supabase.from("genres").select("id, name").order("name");
  if (error) fail("getGenres", error);
  return data ?? [];
};

/* ------------------------------------------------------------------ */
/* Browse page: search + genre filter + sort + pagination              */
/* ------------------------------------------------------------------ */

export interface AnimePageParams {
  page: number;
  pageSize?: number;
  search?: string;
  genre?: string; // genre NAME, e.g. "Action"
  sort?: string; // "popularity" | "score" | "newest"
}

export const getAnimePage = async ({
  page,
  pageSize = PAGE_SIZE,
  search,
  genre,
  sort = "popularity",
}: AnimePageParams): Promise<{ items: Anime[]; total: number }> => {
  const from = (Math.max(page, 1) - 1) * pageSize;
  const to = from + pageSize - 1;

  // When filtering by genre we embed the junction a SECOND time under an
  // alias, only for filtering. That keeps the card's genre list complete
  // (otherwise the embed would only contain the one genre we filtered on).
  const select = genre
    ? "*, genre_filter:anime_genres!inner(genres!inner(name)), anime_genres(genres(name))"
    : WITH_GENRES;

  let query = supabase.from("anime").select(select, { count: "exact" });

  if (genre) query = query.eq("genre_filter.genres.name", genre);

  const term = search ? cleanSearch(search) : "";
  if (term) {
    query = query.or(`title_romaji.ilike.%${term}%,title_english.ilike.%${term}%`);
  }

  const column =
    sort === "score" ? "average_score" : sort === "newest" ? "season_year" : "popularity";

  // nullsFirst:false matters: Postgres puts NULLs FIRST on descending sorts.
  // The final .order("id") keeps pagination stable when values tie.
  query = query
    .order(column, { ascending: false, nullsFirst: false })
    .order("popularity", { ascending: false, nullsFirst: false })
    .order("id")
    .range(from, to);

  const { data, error, count } = await query;

  if (error) {
    // Requested a page beyond the end: treat as empty, not as a crash.
    if (error.code === "PGRST103") return { items: [], total: count ?? 0 };
    fail("getAnimePage", error);
  }

  return { items: toAnimeList(data), total: count ?? 0 };
};