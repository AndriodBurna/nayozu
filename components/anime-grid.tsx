import AnimeCard from "./anime-card";

interface AnimeGridProps {
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
  columns?: number;
}

export default function AnimeGrid({
  anime,
  libraryEntries,
  userId,
  columns = 3
}: AnimeGridProps) {
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

  // Responsive column count: 1 for mobile, 2 on tablet, 3 on desktop
  // We'll use Tailwind grid classes
  return (
    <div className="grid gap-6">
      {/* We'll use Tailwind's grid template columns via className */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${columns} gap-6`}>
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
  );
}