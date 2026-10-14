import AnimeCard from "./anime-card";

interface AnimeCarouselProps {
  title: string;
  anime: Array<{
    id: number;
    title: string;
    image: string;
    averageScore: number;
    genres: string[];
    year: number;
  }>;
  libraryEntries?: Array<{
    id: string;
    anime_id: string;
    status: string;
    progress: number;
    user_id: string;
  }>;
  userId?: string | null;
}

export default function AnimeCarousel({
  title,
  anime,
  libraryEntries,
  userId
}: AnimeCarouselProps) {
  // Create a map from anime id (as number) to library entry for quick lookup
  const libraryMap = new Map<number, any>();
  if (libraryEntries) {
    for (const entry of libraryEntries) {
      const animeId = parseInt(entry.anime_id, 10);
      if (!isNaN(animeId)) {
        libraryMap.set(animeId, entry);
      }
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white mb-4">{title}</h2>
      <div className="overflow-x-auto space-x-4 px-2 pb-4">
        <div className="flex-snap flex space-x-4">
          {anime.map((item) => {
            const libraryEntry = libraryMap.get(item.id);
            return (
              <AnimeCard
                key={item.id}
                id={item.id}
                title={item.title}
                image={item.image}
                averageScore={item.averageScore}
                genres={item.genres}
                year={item.year}
                libraryEntry={libraryEntry}
                userId={userId}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}