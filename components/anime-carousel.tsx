import AnimeCard from "./anime-card";
import { buildLibraryMap, type LibraryEntry } from "@/lib/libraryMap";
import type { Anime } from "@/lib/services/normalizeAnime";

interface AnimeCarouselProps {
  title: string;
  anime: Anime[];
  libraryEntries?: LibraryEntry[];
  userId?: string | null;
}

export default function AnimeCarousel({
  title,
  anime,
  libraryEntries,
  userId,
}: AnimeCarouselProps) {
  const libraryMap = buildLibraryMap(libraryEntries);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">{title}</h2>

      {/* Horizontal scroller: every card has the same fixed width */}
      <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-4">
        {anime.map((item) => (
          <div
            key={item.id}
            className="flex w-[210px] shrink-0 snap-start sm:w-[230px]"
          >
            <AnimeCard
              externalId={item.external_id}
              title={item.title}
              image={item.image}
              averageScore={item.averageScore}
              genres={item.genres.map((g) => g.name)}
              year={item.year}
              synopsis={item.synopsis}
              episodes={item.episodes}
              chapters={item.chapters}
              volumes={item.volumes}
              status={item.status}
              slug={item.slug}
              mediaType={item.mediaType || (item.media_type as "anime" | "manga") || "anime"}
              libraryEntry={libraryMap.get(String(item.external_id))}
              userId={userId}
            />
          </div>
        ))}
      </div>
    </section>
  );
}