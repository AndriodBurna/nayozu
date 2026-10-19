export interface GenreRef {
  name: string;
}

interface GenreLink {
  genres: GenreRef | null;
}

/** A row from the `anime` table, optionally with the genre junction embedded. */
export interface AnimeRow {
  id: string;
  external_id: number;
  slug: string;
  title_romaji: string;
  title_english: string | null;
  synopsis: string | null;
  cover_image_url: string | null;
  banner_image_url: string | null;
  episodes: number | null;
  status: string | null;
  season: string | null;
  season_year: number | null;
  format: string | null;
  average_score: number | null;
  popularity: number | null;
  media_type: string;
  anime_genres?: GenreLink[] | null;
  genre_filter?: unknown; // helper embed used only for filtering; dropped below
}

/** Shape the UI components consume (original columns + camelCase aliases). */
export interface Anime extends Omit<AnimeRow, "anime_genres" | "genre_filter"> {
  title: string;
  titleEnglish: string | null;
  alternativeTitles: string[];
  coverImage: string | null;
  bannerImage: string | null;
  averageScore: number | null;
  releaseYear: number | null;
  releaseSeason: string | null;
  episodeCount: number | null;
  genres: GenreRef[];
  // Aliases the existing AnimeCarousel / AnimeCard read:
  image: string | null;
  year: number | null;
}

/** AniList descriptions contain <br>, <i>, <b> and HTML entities. Show plain text. */
export function cleanSynopsis(text: string | null): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

export function normalizeAnime(row: AnimeRow): Anime {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { anime_genres, genre_filter, ...rest } = row;

  const genres = (anime_genres ?? [])
    .map((link) => link.genres)
    .filter((g): g is GenreRef => g !== null);

  const alternativeTitles =
    row.title_english && row.title_english !== row.title_romaji
      ? [row.title_english]
      : [];

  return {
    ...rest,
    synopsis: cleanSynopsis(row.synopsis),
    title: row.title_romaji,
    titleEnglish: row.title_english,
    alternativeTitles,
    coverImage: row.cover_image_url,
    bannerImage: row.banner_image_url,
    averageScore: row.average_score,
    releaseYear: row.season_year,
    releaseSeason: row.season,
    episodeCount: row.episodes,
    genres,
    image: row.cover_image_url,
    year: row.season_year,
  };
}