import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LibraryCollectionClient from "@/components/library-collection-client";
import { loadUserLibraryBundle } from "@/lib/services/userLibraryServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Library | Nayozu",
  description:
    "Manage your personal anime watchlist, manga reading list, favorites, and progress on Nayozu.",
};

export default async function LibraryPage() {
  const bundle = await loadUserLibraryBundle();

  if (!bundle.user) {
    redirect("/login?next=/library");
  }

  const combinedEntries = [
    ...bundle.animeWatchlist,
    ...bundle.mangaReadingList,
  ];
  const combinedOptions = [
    ...bundle.animeCatalogOptions,
    ...bundle.mangaCatalogOptions,
  ];

  return (
    <LibraryCollectionClient
      mode="library"
      user={bundle.user}
      entries={combinedEntries}
      catalogOptions={combinedOptions}
      error={bundle.error}
    />
  );
}
