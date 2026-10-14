import { AnimeProvider } from "../types";
import { MockAnimeProvider } from "../providers/mockProvider";

// In the future, we can switch providers based on environment variables
// For now, we use the mock provider
export const animeProvider: AnimeProvider = new MockAnimeProvider();

// Export convenience functions
export const searchAnime = async (query: string, page = 1) => {
  return await animeProvider.searchAnime(query, page);
};

export const getAnimeById = async (id: number) => {
  return await animeProvider.getAnimeById(id);
};

export const getAnimesByIds = async (ids: number[]) => {
  return await animeProvider.getAnimesByIds(ids);
};

export const getGenres = async () => {
  return await animeProvider.getGenres();
};

export const getAnimesByGenre = async (genreId: number, page = 1) => {
  return await animeProvider.getAnimesByGenre(genreId, page);
};

export const getAllAnime = async () => {
  return await animeProvider.getAllAnime();
};