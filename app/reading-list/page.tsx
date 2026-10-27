import type { Metadata } from "next";
import LibraryCollectionClient from "@/components/library-collection-client";
import { loadUserLibraryBundle } from "@/lib/services/userLibraryServer";

export const metadata: Metadata = {
  title: "My Reading List | Nayozu",
  description:
    "Manage your personal manga reading list, track chapter progress, and organize manga series on Nayozu.",
};

export default async function ReadingListPage() {
  const bundle = await loadUserLibraryBundle();

  return (
    <LibraryCollectionClient
      mode="reading-list"
      user={bundle.user}
      entries={bundle.mangaReadingList}
      catalogOptions={bundle.mangaCatalogOptions}
      error={bundle.error}
    />
  );
}
