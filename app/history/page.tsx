import type { Metadata } from "next";
import LibraryCollectionClient from "@/components/library-collection-client";
import { loadUserLibraryBundle } from "@/lib/services/userLibraryServer";

export const metadata: Metadata = {
  title: "Viewing & Reading History | Nayozu",
  description:
    "View your recent anime episode progress, manga chapter reading progress, ratings, and review activity on Nayozu.",
};

export default async function HistoryPage() {
  const bundle = await loadUserLibraryBundle();

  return (
    <LibraryCollectionClient
      mode="history"
      user={bundle.user}
      historyItems={bundle.historyItems}
      error={bundle.error}
    />
  );
}
