export interface GenreRef {
  name: string;
}

interface GenreLink {
  genres: GenreRef | null;
}

export interface ExternalLink {
  site: string;
  url: string;
  type?: string | null;
  language?: string | null;
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
  chapters?: number | null;
  volumes?: number | null;
  status: string | null;
  season: string | null;
  season_year: number | null;
  format: string | null;
  country?: string | null;
  average_score: number | null;
  popularity: number | null;
  media_type: string;
  external_links?: ExternalLink[] | null;
  trailer_site?: string | null;
  trailer_id?: string | null;
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
  chapterCount: number | null;
  volumeCount: number | null;
  externalLinks: ExternalLink[] | null;
  trailerSite: string | null;
  trailerId: string | null;
  mediaType: "anime" | "manga";
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
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
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

  const mediaType = (row.media_type === "manga" ? "manga" : "anime") as "anime" | "manga";

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
    episodeCount: row.episodes ?? null,
    chapterCount: row.chapters ?? null,
    volumeCount: row.volumes ?? null,
    externalLinks: row.external_links ?? null,
    trailerSite: row.trailer_site ?? null,
    trailerId: row.trailer_id ?? null,
    mediaType,
    genres,
    image: row.cover_image_url,
    year: row.season_year,
  };
}