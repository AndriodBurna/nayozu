import type { Metadata } from "next";
import MediaBrowser from "@/components/media-browser";

export const metadata: Metadata = {
  title: "Anime Movies | Nayozu",
  description:
    "Explore popular, top-rated, and recent feature-length anime movies with ratings, release years, genres, and synopses on Nayozu.",
};

export default function MoviesPage() {
  return <MediaBrowser mediaType="anime" mode="movies" />;
}
