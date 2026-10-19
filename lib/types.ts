export type { Anime, AnimeRow, GenreRef } from "./services/normalizeAnime";
import type { Anime } from "./services/normalizeAnime";

export interface Genre {
  id: string | number;
  name: string;
}

export interface AnimeSearchResult {
  results: Anime[];
  total?: number;
  hasMore?: boolean;
}

export interface AnimeProvider {
  searchAnime: (query: string, page?: number) => Promise<AnimeSearchResult>;
  getAnimeById: (id: string | number) => Promise<Anime>;
  getAnimesByIds: (ids: Array<string | number>) => Promise<Anime[]>;
  getGenres: () => Promise<Genre[]>;
  getAnimesByGenre: (genreId: string | number, page?: number) => Promise<AnimeSearchResult>;
}