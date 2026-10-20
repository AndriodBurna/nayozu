import Link from "next/link";
import type { Metadata } from "next";
import AnimeGrid from "@/components/anime-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";
import { AUTH_ENABLED } from "@/lib/features";
import { normalizeAnime, type AnimeRow } from "@/lib/services/normalizeAnime";
import type { LibraryEntry } from "@/lib/libraryMap";

export const metadata: Metadata = {
  title: "Search | Nayozu",
  description: "Search anime and manga titles on Nayozu.",
};

const WITH_GENRES = "*, anime_genres(genres(name))";
const PAGE_SIZE = 24;

/** Strip %, ,, (, ), \, *, and _ from the query string before building the filter. */
function cleanQuery(raw: string): string {
  return raw.replace(/[%,\(\)\\\*_]/g, " ").replace(/\s+/g, " ").trim();
}

type Props = {
  searchParams: Promise<{
    q?: string;
    type?: string;
    page?: string;
  }>;
};

export default async function SearchPage({ searchParams }: Props) {
  const { q: rawQ = "", type: rawType = "all", page: rawPage = "1" } =
    await searchParams;

  const activeType =
    rawType === "anime" || rawType === "manga" ? rawType : "all";
  const page = Math.max(1, parseInt(rawPage, 10) || 1);
  const cleanQ = cleanQuery(rawQ);

  const supabase = await createClient();

  // User & library entries (if auth enabled)
  const userRes = AUTH_ENABLED
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  const user = userRes.data.user;
  const userId = user ? user.id : null;
  let libraryEntries: LibraryEntry[] | undefined;
  if (user) {
    const { data } = await supabase
      .from("user_anime_library")
      .select("*")
      .eq("user_id", user.id);
    libraryEntries = (data as LibraryEntry[] | null) ?? undefined;
  }

  let items: ReturnType<typeof normalizeAnime>[] = [];
  let total = 0;

  if (cleanQ) {
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("anime")
      .select(WITH_GENRES, { count: "exact" });

    if (activeType === "anime" || activeType === "manga") {
      query = query.eq("media_type", activeType);
    }

    query = query
      .or(`title_romaji.ilike.%${cleanQ}%,title_english.ilike.%${cleanQ}%`)
      .order("popularity", { ascending: false, nullsFirst: false })
      .order("id")
      .range(from, to);

    const { data, error, count } = await query;

    if (error) {
      if (error.code === "PGRST103") {
        items = [];
        total = count ?? 0;
      } else {
        console.error("Search query error:", error);
        items = [];
        total = 0;
      }
    } else {
      items = (data ?? []).map((row) =>
        normalizeAnime(row as unknown as AnimeRow)
      );
      total = count ?? 0;
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function makeTabUrl(tabType: string) {
    const params = new URLSearchParams();
    if (rawQ) params.set("q", rawQ);
    params.set("type", tabType);
    return `/search?${params.toString()}`;
  }

  function makePageUrl(targetPage: number) {
    const params = new URLSearchParams();
    if (rawQ) params.set("q", rawQ);
    if (rawType) params.set("type", rawType);
    if (targetPage > 1) params.set("page", String(targetPage));
    return `/search?${params.toString()}`;
  }

  const tabs = [
    { id: "all", label: "All" },
    { id: "anime", label: "Anime" },
    { id: "manga", label: "Manga" },
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      {/* Header with Title and Search Input Form */}
      <div className="flex flex-col gap-6 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Search</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search anime and manga titles across the catalog.
          </p>
        </div>

        {/* Search input form */}
        <form method="GET" action="/search" className="flex items-center gap-2 max-w-md">
          {rawType !== "all" && (
            <input type="hidden" name="type" value={rawType} />
          )}
          <Input
            type="search"
            name="q"
            defaultValue={rawQ}
            placeholder="Search anime and manga..."
            className="h-9"
          />
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>

        {/* Tabs: All | Anime | Manga */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="inline-flex rounded-lg border border-border bg-muted p-1">
            {tabs.map((tab) => {
              const isActive = activeType === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={makeTabUrl(tab.id)}
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>

          {/* Total count */}
          {cleanQ ? (
            <span className="text-sm text-muted-foreground">
              {total} {total === 1 ? "result" : "results"} found
            </span>
          ) : null}
        </div>
      </div>

      {/* Main Content Area */}
      {!cleanQ ? (
        <p className="py-16 text-center text-muted-foreground">
          Enter a search term to find anime and manga.
        </p>
      ) : total === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          No results for {rawQ}
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <AnimeGrid
            anime={items}
            libraryEntries={libraryEntries}
            userId={userId}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-4">
              {page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={makePageUrl(page - 1)}>Previous</Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Previous
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={makePageUrl(page + 1)}>Next</Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Next
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
