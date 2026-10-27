"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Bookmark,
  BookOpen,
  CheckCircle2,
  Clock,
  ExternalLink,
  Film,
  Glasses,
  Heart,
  History as HistoryIcon,
  Info,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  removeLibraryEntryAction,
  toggleFavoriteAction,
  upsertLibraryEntryAction,
  type CatalogPickerOption,
  type LibraryEntryItem,
  type LibraryStatus,
} from "@/lib/actions/libraryActions";
import type { UserActivityHistoryItem } from "@/lib/services/userLibraryServer";

export type LibraryPageMode =
  | "watchlist"
  | "reading-list"
  | "history"
  | "favorites";

interface LibraryCollectionClientProps {
  mode: LibraryPageMode;
  user: {
    id: string;
    email: string | null;
    username: string;
  } | null;
  entries?: LibraryEntryItem[];
  historyItems?: UserActivityHistoryItem[];
  catalogOptions?: CatalogPickerOption[];
  error?: string | null;
}

const LIBRARY_TABS = [
  { id: "watchlist" as const, label: "Watchlist", href: "/watchlist", icon: Bookmark },
  {
    id: "reading-list" as const,
    label: "Reading List",
    href: "/reading-list",
    icon: Glasses,
  },
  { id: "history" as const, label: "History", href: "/history", icon: HistoryIcon },
  { id: "favorites" as const, label: "Favorites", href: "/favorites", icon: Heart },
];

function formatStatusLabel(status: LibraryStatus, mediaType: "anime" | "manga"): string {
  switch (status) {
    case "planned":
      return mediaType === "manga" ? "Plan to Read" : "Plan to Watch";
    case "watching":
      return mediaType === "manga" ? "Reading" : "Watching";
    case "completed":
      return "Completed";
    case "on_hold":
      return "On Hold";
    case "dropped":
      return "Dropped";
    default:
      return status;
  }
}

export default function LibraryCollectionClient({
  mode,
  user,
  entries = [],
  historyItems = [],
  catalogOptions = [],
  error,
}: LibraryCollectionClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LibraryStatus>("all");
  const [mediaFilter, setMediaFilter] = useState<"all" | "anime" | "manga">("all");
  const [activityKindFilter, setActivityKindFilter] = useState<
    "all" | "progress" | "rating" | "review"
  >("all");
  const [sortBy, setSortBy] = useState<
    "updated" | "title" | "progress" | "score"
  >("updated");

  // Add Entry Modal
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCatalogKey, setSelectedCatalogKey] = useState<string>(() => {
    const first = catalogOptions[0];
    return first ? `${first.mediaType}:${first.externalId}` : "";
  });
  const [newStatus, setNewStatus] = useState<LibraryStatus>("planned");
  const [newProgress, setNewProgress] = useState<number>(0);

  const pageMeta = useMemo(() => {
    switch (mode) {
      case "watchlist":
        return {
          title: "My Watchlist",
          subtitle:
            "Track anime series and movies you plan to watch, are currently watching, or have completed.",
          emptyTitle: "Your Watchlist is Empty",
          emptyDesc:
            "Add anime titles you intend to watch using the '+ Add Anime' button above or while browsing the catalog.",
          browseHref: "/anime",
          browseLabel: "Browse Anime",
          addButtonLabel: "Add Anime to Watchlist",
        };
      case "reading-list":
        return {
          title: "My Reading List",
          subtitle:
            "Organize manga titles you plan to read and track your chapter progress across series.",
          emptyTitle: "Your Reading List is Empty",
          emptyDesc:
            "Add manga titles you intend to read using the '+ Add Manga' button above or from the Manga page.",
          browseHref: "/manga",
          browseLabel: "Browse Manga",
          addButtonLabel: "Add Manga to Reading List",
        };
      case "history":
        return {
          title: "Viewing & Reading History",
          subtitle:
            "Review your recent episode and chapter progress updates, ratings, and community reviews.",
          emptyTitle: "No Viewing or Reading Activity Yet",
          emptyDesc:
            "Watch episodes, read chapters, update your library progress, or rate titles to build your personal activity history.",
          browseHref: "/anime",
          browseLabel: "Explore Catalog",
          addButtonLabel: "",
        };
      case "favorites":
        return {
          title: "My Favorites",
          subtitle:
            "Your curated collection of all-time favorite anime and manga titles.",
          emptyTitle: "No Favorites Added Yet",
          emptyDesc:
            "Mark any anime or manga as a Favorite using the '+ Add Favorite' button or the heart icon on your library cards.",
          browseHref: "/anime",
          browseLabel: "Discover Titles",
          addButtonLabel: "Add Title to Favorites",
        };
    }
  }, [mode]);

  // Filtered & sorted entries for Watchlist / Reading List / Favorites
  const filteredEntries = useMemo(() => {
    const list = entries.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (mediaFilter !== "all" && item.mediaType !== mediaFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchTitle = item.media.title.toLowerCase().includes(q);
        const matchGenre = item.media.genres.some((g) =>
          g.toLowerCase().includes(q)
        );
        if (!matchTitle && !matchGenre) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === "title") {
        return a.media.title.localeCompare(b.media.title);
      }
      if (sortBy === "progress") {
        return b.progress - a.progress;
      }
      if (sortBy === "score") {
        return (b.media.averageScore ?? 0) - (a.media.averageScore ?? 0);
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return list;
  }, [entries, statusFilter, mediaFilter, searchQuery, sortBy]);

  // Filtered History items
  const filteredHistory = useMemo(() => {
    return historyItems.filter((item) => {
      if (mediaFilter !== "all" && item.mediaType !== mediaFilter) return false;
      if (activityKindFilter !== "all" && item.kind !== activityKindFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        if (!item.title.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [historyItems, mediaFilter, activityKindFilter, searchQuery]);

  // Handlers
  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCatalogKey) return;
    setActionError(null);

    const [mType, extIdStr] = selectedCatalogKey.split(":");
    const mediaType: "anime" | "manga" = mType === "manga" ? "manga" : "anime";
    const externalId = Number(extIdStr);

    startTransition(async () => {
      if (mode === "favorites") {
        const res = await toggleFavoriteAction({ externalId, mediaType });
        if (!res.success) {
          setActionError(res.error || "Failed to add favorite.");
          return;
        }
      } else {
        const res = await upsertLibraryEntryAction({
          externalId,
          mediaType,
          status: newStatus,
          progress: newProgress,
        });
        if (!res.success) {
          setActionError(res.error || "Failed to add library entry.");
          return;
        }
      }

      setAddOpen(false);
      setNewProgress(0);
      router.refresh();
    });
  };

  const handleUpdateEntry = (
    item: LibraryEntryItem,
    nextStatus: LibraryStatus,
    nextProgress: number
  ) => {
    setActionError(null);
    startTransition(async () => {
      const res = await upsertLibraryEntryAction({
        externalId: item.externalId,
        mediaType: item.mediaType,
        status: nextStatus,
        progress: nextProgress,
      });
      if (!res.success) {
        setActionError(res.error || "Failed to update entry.");
        return;
      }
      router.refresh();
    });
  };

  const handleToggleFavorite = (
    externalId: number,
    mediaType: "anime" | "manga"
  ) => {
    setActionError(null);
    startTransition(async () => {
      const res = await toggleFavoriteAction({ externalId, mediaType });
      if (!res.success) {
        setActionError(res.error || "Failed to update favorite status.");
        return;
      }
      router.refresh();
    });
  };

  const handleRemoveEntry = (entryId: string) => {
    setActionError(null);
    startTransition(async () => {
      const res = await removeLibraryEntryAction({ entryId });
      if (!res.success) {
        setActionError(res.error || "Failed to remove entry.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-7 pb-12">
      {/* Shared My Library Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2238] pb-4">
        <nav aria-label="My Library sections" className="flex flex-wrap items-center gap-2">
          {LIBRARY_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === mode;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "border border-[#1b2238] bg-[#121624] text-zinc-400 hover:border-primary/40 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {user && (
          <span className="text-xs text-zinc-400">
            Signed in as <strong className="text-zinc-200">@{user.username}</strong>
          </span>
        )}
      </div>

      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold text-white">
            {pageMeta.title}
          </h1>
          <p className="text-xs md:text-sm text-zinc-400">{pageMeta.subtitle}</p>
        </div>

        {user && pageMeta.addButtonLabel && (
          <Button
            type="button"
            onClick={() => {
              setActionError(null);
              setAddOpen((prev) => !prev);
            }}
            className="h-10 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/20 hover:brightness-110 shrink-0"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {pageMeta.addButtonLabel}
          </Button>
        )}
      </div>

      {/* Unauthenticated Gate */}
      {!user ? (
        <section className="rounded-3xl border border-[#1e253d] bg-[#121625] p-8 md:p-12 text-center space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 border border-primary/30 text-primary">
            <Lock className="h-7 w-7" />
          </div>
          <div className="max-w-lg mx-auto space-y-2">
            <h2 className="text-xl font-bold text-white">
              Sign In to Access {pageMeta.title}
            </h2>
            <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">
              Your personal Watchlist, Reading List, viewing/reading History, and
              Favorites are private to your account and protected by Supabase Row
              Level Security. Sign in or create an account to start tracking titles.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Button
              asChild
              className="rounded-xl bg-primary px-6 font-semibold text-primary-foreground"
            >
              <Link href="/auth/login">Sign In</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl px-6">
              <Link href="/auth/sign-up">Create Account</Link>
            </Button>
            <Button asChild variant="ghost" className="rounded-xl text-zinc-400">
              <Link href={pageMeta.browseHref}>{pageMeta.browseLabel}</Link>
            </Button>
          </div>
        </section>
      ) : (
        <>
          {/* Add Title Form Modal/Drawer */}
          {addOpen && catalogOptions.length > 0 && (
            <section className="rounded-2xl border border-primary/40 bg-[#121625] p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h2 className="text-sm font-bold text-white">
                  {pageMeta.addButtonLabel}
                </h2>
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
                  aria-label="Close add form"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleAddSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-zinc-300">
                      Select Title from Catalog
                    </label>
                    <select
                      aria-label="Select Title from Catalog"
                      value={selectedCatalogKey}
                      onChange={(e) => setSelectedCatalogKey(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground"
                    >
                      {catalogOptions.map((opt) => (
                        <option
                          key={`${opt.mediaType}:${opt.externalId}`}
                          value={`${opt.mediaType}:${opt.externalId}`}
                        >
                          [{opt.mediaType.toUpperCase()}] {opt.title}{" "}
                          {opt.year ? `(${opt.year})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {mode !== "favorites" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-zinc-300">
                          Status
                        </label>
                        <select
                          aria-label="Library Status"
                          value={newStatus}
                          onChange={(e) =>
                            setNewStatus(e.target.value as LibraryStatus)
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
                        >
                          <option value="planned">
                            {mode === "reading-list"
                              ? "Plan to Read"
                              : "Plan to Watch"}
                          </option>
                          <option value="watching">
                            {mode === "reading-list" ? "Reading" : "Watching"}
                          </option>
                          <option value="completed">Completed</option>
                          <option value="on_hold">On Hold</option>
                          <option value="dropped">Dropped</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-zinc-300">
                          {mode === "reading-list" ? "Chapters" : "Episodes"}
                        </label>
                        <Input
                          type="number"
                          min={0}
                          value={newProgress}
                          onChange={(e) =>
                            setNewProgress(
                              Math.max(Number(e.target.value) || 0, 0)
                            )
                          }
                          className="h-9 text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAddOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isPending}
                    className="bg-primary text-primary-foreground"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save to Library"
                    )}
                  </Button>
                </div>
              </form>
            </section>
          )}

          {/* Error Banner */}
          {(error || actionError) && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span>{actionError || error}</span>
            </div>
          )}

          {/* Filter & Sort Controls */}
          <div className="flex flex-col gap-3 rounded-2xl border border-[#1b2238] bg-[#121624] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {(mode === "watchlist" || mode === "reading-list") &&
                (
                  [
                    { id: "all", label: "All Entries" },
                    {
                      id: "planned",
                      label:
                        mode === "reading-list" ? "Plan to Read" : "Plan to Watch",
                    },
                    {
                      id: "watching",
                      label: mode === "reading-list" ? "Reading" : "Watching",
                    },
                    { id: "completed", label: "Completed" },
                    { id: "on_hold", label: "On Hold" },
                    { id: "dropped", label: "Dropped" },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStatusFilter(st.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      statusFilter === st.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-[#0e1220] text-zinc-400 hover:text-white border border-[#1e263f]"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}

              {(mode === "history" || mode === "favorites") &&
                (
                  [
                    { id: "all", label: "All Media" },
                    { id: "anime", label: "Anime" },
                    { id: "manga", label: "Manga" },
                  ] as const
                ).map((mf) => (
                  <button
                    key={mf.id}
                    type="button"
                    onClick={() => setMediaFilter(mf.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      mediaFilter === mf.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-[#0e1220] text-zinc-400 hover:text-white border border-[#1e263f]"
                    }`}
                  >
                    {mf.label}
                  </button>
                ))}

              {mode === "history" && (
                <select
                  aria-label="Filter by activity type"
                  value={activityKindFilter}
                  onChange={(e) =>
                    setActivityKindFilter(
                      e.target.value as "all" | "progress" | "rating" | "review"
                    )
                  }
                  className="h-8 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground"
                >
                  <option value="all">All Activity Types</option>
                  <option value="progress">Episode / Chapter Progress</option>
                  <option value="rating">Ratings</option>
                  <option value="review">Reviews</option>
                </select>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by title..."
                  className="h-9 pl-8 text-xs"
                />
              </div>

              {mode !== "history" && (
                <select
                  aria-label="Sort library entries"
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(
                      e.target.value as "updated" | "title" | "progress" | "score"
                    )
                  }
                  className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground"
                >
                  <option value="updated">Recently Updated</option>
                  <option value="title">Title (A–Z)</option>
                  <option value="progress">Highest Progress</option>
                  <option value="score">Community Score</option>
                </select>
              )}
            </div>
          </div>

          {/* Schema / Architecture Note for History & Favorites */}
          {mode === "history" && (
            <div className="rounded-xl border border-[#1e2640] bg-[#101423] px-4 py-3 text-xs text-zinc-400 flex items-start gap-2.5">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span>
                Showing your persisted episode/chapter progress updates (
                <code>public.user_anime_library</code>), ratings (
                <code>public.anime_ratings</code>), and reviews (
                <code>public.anime_reviews</code>). Granular per-episode video
                playback timestamps (second-by-second resume logs) would require an
                additional <code>playback_history</code> database migration.
              </span>
            </div>
          )}

          {mode === "favorites" && (
            <div className="rounded-xl border border-[#1e2640] bg-[#101423] px-4 py-3 text-xs text-zinc-400 flex items-start gap-2.5">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span>
                Favorites are stored per-user in{" "}
                <code>public.user_anime_library</code> under Row Level Security (
                <code>auth.uid() = user_id</code>) using dedicated favorite keys so
                they never overwrite your Watchlist or Reading List progress.
              </span>
            </div>
          )}

          {/* Content Area: History Timeline vs Library Cards Grid */}
          {mode === "history" ? (
            filteredHistory.length === 0 ? (
              <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-16 px-4 text-center space-y-3">
                <HistoryIcon className="mx-auto h-9 w-9 text-zinc-500" />
                <h2 className="text-base font-bold text-white">
                  {pageMeta.emptyTitle}
                </h2>
                <p className="max-w-md mx-auto text-xs text-zinc-400">
                  {pageMeta.emptyDesc}
                </p>
                <div className="flex items-center justify-center gap-3 pt-1">
                  <Button
                    asChild
                    size="sm"
                    className="bg-primary text-primary-foreground"
                  >
                    <Link href="/anime">Browse Anime</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/manga">Browse Manga</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredHistory.map((item) => {
                  const detailHref = `/${item.mediaType}/${item.slug}`;
                  const unitLabel =
                    item.mediaType === "manga" ? "Chapter" : "Episode";

                  return (
                    <article
                      key={item.id}
                      className="flex flex-col gap-4 rounded-2xl border border-[#1c233a] bg-[#121624] p-4 sm:flex-row sm:items-center sm:justify-between hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <Link
                          href={detailHref}
                          className="relative h-20 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#181d30]"
                        >
                          {item.coverImage ? (
                            <Image
                              src={item.coverImage}
                              alt={item.title}
                              fill
                              sizes="56px"
                              className="object-cover"
                            />
                          ) : null}
                        </Link>

                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase"
                            >
                              {item.mediaType === "manga" ? (
                                <>
                                  <BookOpen className="mr-1 h-3 w-3" /> Manga
                                </>
                              ) : (
                                <>
                                  <Film className="mr-1 h-3 w-3" /> Anime
                                </>
                              )}
                            </Badge>

                            {item.kind === "progress" && item.status && (
                              <span className="rounded-md bg-primary/15 border border-primary/30 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                {formatStatusLabel(item.status, item.mediaType)} ·{" "}
                                {unitLabel} {item.progress ?? 0}
                                {item.totalUnits ? ` / ${item.totalUnits}` : ""}
                              </span>
                            )}

                            {item.kind === "rating" && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                                <Star className="h-3 w-3 fill-amber-400 stroke-none" />
                                Rated {item.rating}/10
                              </span>
                            )}

                            {item.kind === "review" && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 text-[11px] font-semibold text-sky-400">
                                <MessageSquare className="h-3 w-3" /> Published
                                Review
                              </span>
                            )}
                          </div>

                          <h3 className="truncate text-sm md:text-base font-bold text-white">
                            <Link
                              href={detailHref}
                              className="hover:text-primary transition-colors"
                            >
                              {item.title}
                            </Link>
                          </h3>

                          {item.kind === "review" && item.reviewBody && (
                            <p className="line-clamp-1 text-xs text-zinc-400">
                              {item.reviewTitle ? `${item.reviewTitle}: ` : ""}
                              {item.reviewBody}
                            </p>
                          )}

                          <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Updated{" "}
                            {new Date(item.timestamp).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                          <Link href={detailHref}>
                            {item.mediaType === "manga" ? "Continue Reading" : "Continue Watching"}
                            <ExternalLink className="ml-1.5 h-3 w-3" />
                          </Link>
                        </Button>
                        {item.libraryEntryId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isPending}
                            onClick={() => handleRemoveEntry(item.libraryEntryId!)}
                            className="h-8 px-2 text-zinc-400 hover:text-red-400"
                            title="Remove from history"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          ) : filteredEntries.length === 0 ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-16 px-4 text-center space-y-3">
              <Bookmark className="mx-auto h-9 w-9 text-zinc-500" />
              <h2 className="text-base font-bold text-white">
                {pageMeta.emptyTitle}
              </h2>
              <p className="max-w-md mx-auto text-xs text-zinc-400">
                {pageMeta.emptyDesc}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                {pageMeta.addButtonLabel && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setAddOpen(true)}
                    className="bg-primary text-primary-foreground"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    {pageMeta.addButtonLabel}
                  </Button>
                )}
                <Button asChild variant="outline" size="sm">
                  <Link href={pageMeta.browseHref}>{pageMeta.browseLabel}</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredEntries.map((entry) => {
                const detailHref = `/${entry.mediaType}/${entry.media.slug}`;
                const unitName = entry.mediaType === "manga" ? "Ch" : "Ep";
                const scoreFormatted =
                  entry.media.averageScore && entry.media.averageScore > 0
                    ? (entry.media.averageScore / 10).toFixed(1)
                    : null;

                return (
                  <article
                    key={entry.id}
                    className="flex flex-col justify-between rounded-2xl border border-[#1c233a] bg-[#121624] p-4 transition-all hover:border-primary/40"
                  >
                    <div className="flex gap-4">
                      {/* Cover Poster */}
                      <Link
                        href={detailHref}
                        className="relative h-32 w-22 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#181d30]"
                      >
                        {entry.media.coverImage ? (
                          <Image
                            src={entry.media.coverImage}
                            alt={entry.media.title}
                            fill
                            sizes="88px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-zinc-500">
                            No Image
                          </div>
                        )}
                      </Link>

                      {/* Details */}
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-200">
                              {entry.media.format || entry.mediaType}
                            </span>
                            {entry.media.year && (
                              <span className="text-[11px] text-zinc-400">
                                {entry.media.year}
                              </span>
                            )}
                            {scoreFormatted && (
                              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-400">
                                <Star className="h-3 w-3 fill-amber-400 stroke-none" />
                                {scoreFormatted}
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              handleToggleFavorite(entry.externalId, entry.mediaType)
                            }
                            aria-label={
                              entry.isFavorite
                                ? "Remove from Favorites"
                                : "Add to Favorites"
                            }
                            className={`rounded-lg p-1.5 transition-colors ${
                              entry.isFavorite
                                ? "text-rose-400 bg-rose-500/15"
                                : "text-zinc-500 hover:text-rose-400 hover:bg-white/5"
                            }`}
                          >
                            <Heart
                              className={`h-4 w-4 ${
                                entry.isFavorite ? "fill-rose-400" : ""
                              }`}
                            />
                          </button>
                        </div>

                        <h3 className="line-clamp-1 text-sm font-bold text-white">
                          <Link
                            href={detailHref}
                            className="hover:text-primary transition-colors"
                          >
                            {entry.media.title}
                          </Link>
                        </h3>

                        {/* Status Selector & Progress Controls */}
                        {mode !== "favorites" || !entry.rawAnimeId.startsWith("fav:") ? (
                          <div className="space-y-2 pt-1">
                            <div className="flex items-center gap-2">
                              <select
                                aria-label={`Status for ${entry.media.title}`}
                                value={entry.status}
                                disabled={isPending}
                                onChange={(e) =>
                                  handleUpdateEntry(
                                    entry,
                                    e.target.value as LibraryStatus,
                                    entry.progress
                                  )
                                }
                                className="h-7 rounded-md border border-[#252d47] bg-[#0e1220] px-2 text-[11px] font-medium text-zinc-200"
                              >
                                <option value="planned">
                                  {entry.mediaType === "manga"
                                    ? "Plan to Read"
                                    : "Plan to Watch"}
                                </option>
                                <option value="watching">
                                  {entry.mediaType === "manga"
                                    ? "Reading"
                                    : "Watching"}
                                </option>
                                <option value="completed">Completed</option>
                                <option value="on_hold">On Hold</option>
                                <option value="dropped">Dropped</option>
                              </select>
                            </div>

                            <div className="flex items-center justify-between gap-2 text-xs text-zinc-300">
                              <span>
                                {unitName} <strong>{entry.progress}</strong>
                                {entry.media.totalUnits
                                  ? ` / ${entry.media.totalUnits}`
                                  : ""}
                              </span>

                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={
                                    isPending ||
                                    Boolean(
                                      entry.media.totalUnits &&
                                        entry.progress >= entry.media.totalUnits
                                    )
                                  }
                                  onClick={() =>
                                    handleUpdateEntry(
                                      entry,
                                      entry.progress + 1 >=
                                        (entry.media.totalUnits || Infinity)
                                        ? "completed"
                                        : entry.status === "planned"
                                          ? "watching"
                                          : entry.status,
                                      entry.progress + 1
                                    )
                                  }
                                  className="h-6 px-2 text-[11px]"
                                >
                                  +1 {unitName}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-rose-300 flex items-center gap-1 pt-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Marked as
                            Favorite
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Card Footer */}
                    <div className="mt-3.5 flex items-center justify-between border-t border-white/5 pt-2.5 text-[11px] text-zinc-500">
                      <Link
                        href={detailHref}
                        className="font-semibold text-zinc-300 hover:text-primary transition-colors"
                      >
                        Open Title Page →
                      </Link>

                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          mode === "favorites"
                            ? handleToggleFavorite(
                                entry.externalId,
                                entry.mediaType
                              )
                            : handleRemoveEntry(entry.id)
                        }
                        className="inline-flex items-center gap-1 text-zinc-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
