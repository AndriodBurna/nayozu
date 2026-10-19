import AnimeCard from "./anime-card";
import { buildLibraryMap, type LibraryEntry } from "@/lib/libraryMap";
import type { Anime } from "@/lib/services/normalizeAnime";

interface AnimeGridProps {
  anime: Anime[];
  libraryEntries?: LibraryEntry[];
  userId?: string | null;
  /** Kept so existing callers still compile; the grid sizes itself (see .anime-grid in globals.css). */
  columns?: number;
}

export default function AnimeGrid({ anime, libraryEntries, userId }: AnimeGridProps) {
  const libraryMap = buildLibraryMap(libraryEntries);

  return (
    <div className="anime-grid">
      {anime.map((item) => (
        <AnimeCard
          key={item.id}
          externalId={item.external_id}
          title={item.title}
          image={item.image}
          averageScore={item.averageScore}
          genres={item.genres.map((g) => g.name)}
          year={item.year}
          synopsis={item.synopsis}
          episodes={item.episodes}
          status={item.status}
          slug={item.slug}
          libraryEntry={libraryMap.get(String(item.external_id))}
          userId={userId}
        />
      ))}
    </div>
  );
}