import AnimeCard from "./anime-card";
import { buildLibraryMap, type LibraryEntry } from "@/lib/libraryMap";
import type { Anime } from "@/lib/services/normalizeAnime";

interface AnimeGridProps {
  anime: Anime[];
  libraryEntries?: LibraryEntry[];
  userId?: string | null;
  /** Kept so existing callers still compile; the grid sizes itself (see .anime-grid in globals.css). */
  columns?: number;
  showExtendedMeta?: boolean;
}

export default function AnimeGrid({
  anime,
  libraryEntries,
  userId,
  showExtendedMeta = false,
}: AnimeGridProps) {
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
          episodes={item.episodes}
          slug={item.slug}
          mediaType={item.mediaType || (item.media_type as "anime" | "manga") || "anime"}
          format={item.format}
          year={item.year}
          season={item.season}
          status={item.status}
          genres={item.genres?.map((g) => g.name)}
          synopsis={item.synopsis}
          showExtendedMeta={showExtendedMeta}
        />
      ))}
    </div>
  );
}