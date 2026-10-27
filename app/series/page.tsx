import type { Metadata } from "next";
import MediaBrowser from "@/components/media-browser";

export const metadata: Metadata = {
  title: "Anime Series | Nayozu",
  description:
    "Discover popular, trending, and top-rated anime television series, ONAs, OVAs, and specials on Nayozu.",
};

export default function SeriesPage() {
  return <MediaBrowser mediaType="anime" mode="series" />;
}
