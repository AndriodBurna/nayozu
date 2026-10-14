export interface Anime {
  id: number;
  title: string;
  alternativeTitles?: string[];
  synopsis?: string;
  coverImage?: string; // URL to cover image
  genres?: string[];
  releaseYear?: number;
  releaseSeason?: string; // e.g., "WINTER 2023"
  format?: string; // e.g., "TV", "MOVIE", "OVA"
  episodeCount?: number;
  status?: string; // e.g., "RELEASING", "COMPLETED"
  averageScore?: number; // 0-100
  popularity?: number;
  // Add more fields as needed
}

export interface Genre {
  id: number;
  name: string;
}

export interface AnimeSearchResult {
  results: Anime[];
  total?: number;
  hasMore?: boolean;
}

export interface AnimeProvider {
  searchAnime: (query: string, page?: number) => Promise<AnimeSearchResult>;
  getAnimeById: (id: number) => Promise<Anime>;
  getAnimesByIds: (ids: number[]) => Promise<Anime[]>;
  getGenres: () => Promise<Genre[]>;
  getAnimesByGenre: (genreId: number, page?: number) => Promise<AnimeSearchResult>;
  getAllAnime: () => Promise<Anime[]>;
  // Additional methods can be added as needed
}