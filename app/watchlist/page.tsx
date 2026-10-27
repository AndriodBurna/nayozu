import type { Metadata } from "next";
import LibraryCollectionClient from "@/components/library-collection-client";
import { loadUserLibraryBundle } from "@/lib/services/userLibraryServer";

export const metadata: Metadata = {
  title: "My Watchlist | Nayozu",
  description:
    "Manage your personal anime watchlist, track episode progress, and organize titles on Nayozu.",
};

export default async function WatchlistPage() {
  const bundle = await loadUserLibraryBundle();

  return (
    <LibraryCollectionClient
      mode="watchlist"
      user={bundle.user}
      entries={bundle.animeWatchlist}
      catalogOptions={bundle.animeCatalogOptions}
      error={bundle.error}
    />
  );
}
