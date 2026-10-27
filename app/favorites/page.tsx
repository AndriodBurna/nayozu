import type { Metadata } from "next";
import LibraryCollectionClient from "@/components/library-collection-client";
import { loadUserLibraryBundle } from "@/lib/services/userLibraryServer";

export const metadata: Metadata = {
  title: "My Favorites | Nayozu",
  description:
    "View and manage your favorite anime and manga titles on Nayozu.",
};

export default async function FavoritesPage() {
  const bundle = await loadUserLibraryBundle();
  const combinedOptions = [
    ...bundle.animeCatalogOptions,
    ...bundle.mangaCatalogOptions,
  ];

  return (
    <LibraryCollectionClient
      mode="favorites"
      user={bundle.user}
      entries={bundle.favorites}
      catalogOptions={combinedOptions}
      error={bundle.error}
    />
  );
}
