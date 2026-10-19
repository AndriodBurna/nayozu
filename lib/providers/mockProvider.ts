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
      results: paginatedResults as unknown as Anime[],
      total: results.length,
      hasMore: results.length > start + pageSize,
    };
  }

  async getAnimeById(id: string | number): Promise<Anime> {
    await delay(300);
    const anime = mockAnime.find(a => String(a.id) === String(id));
    if (!anime) {
      throw new Error(`Anime with id ${id} not found`);
    }
    return anime as unknown as Anime;
  }

  async getAnimesByIds(ids: Array<string | number>): Promise<Anime[]> {
    await delay(300);
    const stringIds = ids.map(String);
    return mockAnime.filter(anime => stringIds.includes(String(anime.id))) as unknown as Anime[];
  }

  async getGenres(): Promise<Genre[]> {
    await delay(200);
    return mockGenres;
  }

  async getAnimesByGenre(genreId: string | number, page = 1): Promise<AnimeSearchResult> {
    await delay(500);
    const genreName = mockGenres.find(g => String(g.id) === String(genreId))?.name || "";
    const results = mockAnime.filter(anime =>
      anime.genres?.includes(genreName)
    );
    const pageSize = 10;
    const start = (page - 1) * pageSize;
    const paginatedResults = results.slice(start, start + pageSize);
    return {
      results: paginatedResults as unknown as Anime[],
      total: results.length,
      hasMore: results.length > start + pageSize,
    };
  }
}