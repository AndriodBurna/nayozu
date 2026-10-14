import { Anime, AnimeProvider, AnimeSearchResult, Genre } from "../types";
import { mockAnime, mockGenres } from "../mockData";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class MockAnimeProvider implements AnimeProvider {
  async searchAnime(query: string, page = 1): Promise<AnimeSearchResult> {
    await delay(500); // simulate network delay
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) {
      return { results: [], total: 0 };
    }
    const results = mockAnime.filter(anime =>
      anime.title.toLowerCase().includes(lowerQuery) ||
      anime.alternativeTitles?.some(alt => alt.toLowerCase().includes(lowerQuery))
    );
    // Simulate pagination: 10 results per page
    const pageSize = 10;
    const start = (page - 1) * pageSize;
    const paginatedResults = results.slice(start, start + pageSize);
    return {
      results: paginatedResults,
      total: results.length,
      hasMore: results.length > start + pageSize,
    };
  }

  async getAnimeById(id: number): Promise<Anime> {
    await delay(300);
    const anime = mockAnime.find(a => a.id === id);
    if (!anime) {
      throw new Error(`Anime with id ${id} not found`);
    }
    return anime;
  }

  async getAnimesByIds(ids: number[]): Promise<Anime[]> {
    await delay(300);
    return mockAnime.filter(anime => ids.includes(anime.id));
  }

  async getGenres(): Promise<Genre[]> {
    await delay(200);
    return mockGenres;
  }

  async getAnimesByGenre(genreId: number, page = 1): Promise<AnimeSearchResult> {
    await delay(500);
    const results = mockAnime.filter(anime =>
      anime.genres?.includes(mockGenres.find(g => g.id === genreId)?.name || "")
    );
    const pageSize = 10;
    const start = (page - 1) * pageSize;
    const paginatedResults = results.slice(start, start + pageSize);
    return {
      results: paginatedResults,
      total: results.length,
      hasMore: results.length > start + pageSize,
    };
  }

  async getAllAnime(): Promise<Anime[]> {
    await delay(300);
    return mockAnime;
  }
}