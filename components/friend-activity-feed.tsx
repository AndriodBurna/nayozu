"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Eye,
  Film,
  Loader2,
  MessageSquare,
  Play,
  Radio,
  RefreshCw,
  Settings,
  Sparkles,
  Star,
  Tv,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/shell-context";
import { getFriendActivityFeedAction } from "@/lib/actions/friendActions";
import type {
  FriendActivityItemDTO,
  FriendActivityType,
} from "@/lib/friends/friendActivityAndInvitesService";

type ActivityCategoryFilter = "all" | "library" | "community" | "watch_together";

export interface FriendActivityFeedProps {
  compact?: boolean;
  pageSize?: number;
  onItemNavigate?: () => void;
}

function getActivityBadgeMeta(type: FriendActivityType): {
  label: string;
  className: string;
  icon: typeof Tv;
} {
  switch (type) {
    case "started_watching":
      return {
        label: "Started Watching",
        className:
          "border-sky-500/30 bg-sky-500/15 text-sky-300",
        icon: Play,
      };
    case "updated_watching_progress":
      return {
        label: "Watching Progress",
        className:
          "border-indigo-500/30 bg-indigo-500/15 text-indigo-300",
        icon: Film,
      };
    case "completed_anime":
      return {
        label: "Completed Anime",
        className:
          "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
        icon: CheckCircle2,
      };
    case "started_reading":
      return {
        label: "Started Reading",
        className:
          "border-violet-500/30 bg-violet-500/15 text-violet-300",
        icon: BookOpen,
      };
    case "updated_reading_progress":
      return {
        label: "Reading Progress",
        className:
          "border-purple-500/30 bg-purple-500/15 text-purple-300",
        icon: BookOpen,
      };
    case "completed_manga":
      return {
        label: "Completed Manga",
        className:
          "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
        icon: CheckCircle2,
      };
    case "published_review":
      return {
        label: "Published Review",
        className:
          "border-amber-500/30 bg-amber-500/15 text-amber-300",
        icon: Star,
      };
    case "published_discussion":
      return {
        label: "Started Discussion",
        className:
          "border-primary/35 bg-primary/15 text-primary",
        icon: MessageSquare,
      };
    case "watch_room_active":
      return {
        label: "Hosting Watch Room",
        className:
          "border-rose-500/35 bg-rose-500/15 text-rose-300",
        icon: Radio,
      };
  }
}

function matchesCategoryFilter(
  type: FriendActivityType,
  filter: ActivityCategoryFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "library") {
    return (
      type === "started_watching" ||
      type === "updated_watching_progress" ||
      type === "completed_anime" ||
      type === "started_reading" ||
      type === "updated_reading_progress" ||
      type === "completed_manga"
    );
  }
  if (filter === "community") {
    return type === "published_review" || type === "published_discussion";
  }
  if (filter === "watch_together") {
    return type === "watch_room_active";
  }
  return true;
}

export default function FriendActivityFeed({
  compact = false,
  pageSize = compact ? 5 : 12,
  onItemNavigate,
}: FriendActivityFeedProps) {
  const { isUserOnline } = useShell();

  const [items, setItems] = useState<FriendActivityItemDTO[]>([]);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] =
    useState<ActivityCategoryFilter>("all");
  const [revealedSpoilers, setRevealedSpoilers] = useState<
    Record<string, boolean>
  >({});

  const loadPage = useCallback(
    async (targetPage: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const res = await getFriendActivityFeedAction({
          page: targetPage,
          limit: pageSize,
        });

        if (!res.success) {
          setError(res.error || "Unable to load friend activity right now.");
          return;
        }

        setPage(res.page);
        setHasMore(res.hasMore);
        setItems((prev) => {
          if (!append) return res.items;
          const existingIds = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const nextItem of res.items) {
            if (!existingIds.has(nextItem.id)) {
              existingIds.add(nextItem.id);
              merged.push(nextItem);
            }
          }
          return merged;
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load friend activity right now."
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [pageSize]
  );

  useEffect(() => {
    void loadPage(1, false);
  }, [loadPage]);

  useEffect(() => {
    const onFriendsUpdated = () => {
      void loadPage(1, false);
    };
    window.addEventListener("nayozu:friends-updated", onFriendsUpdated);
    window.addEventListener("nayozu:watch-rooms-updated", onFriendsUpdated);
    return () => {
      window.removeEventListener("nayozu:friends-updated", onFriendsUpdated);
      window.removeEventListener("nayozu:watch-rooms-updated", onFriendsUpdated);
    };
  }, [loadPage]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) =>
        matchesCategoryFilter(item.activityType, categoryFilter)
      ),
    [items, categoryFilter]
  );

  if (loading && items.length === 0) {
    return (
      <div
        className="space-y-3"
        aria-label="Loading friend activity feed"
      >
        {Array.from({ length: compact ? 3 : 4 }).map((_, idx) => (
          <div
            key={idx}
            className="flex items-start gap-3 rounded-2xl border border-[#1c2236] bg-[#121624]/80 p-3.5 animate-pulse"
          >
            <div className="h-9 w-9 shrink-0 rounded-full bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 rounded bg-white/10" />
              <div className="h-3 w-4/5 rounded bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200 space-y-2.5"
      >
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>Could not load friend activity</span>
        </div>
        <p className="text-[11px] text-rose-200/90 leading-relaxed">{error}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void loadPage(1, false)}
          className="h-7 border-rose-400/30 bg-rose-950/50 text-xs text-rose-100 hover:bg-rose-900/60"
        >
          <RefreshCw className="mr-1.5 h-3 w-3" /> Retry
        </Button>
      </div>
    );
  }

  if (compact) {
    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-[#1c2236] bg-[#121624] p-3 text-xs text-zinc-400 space-y-2">
          <p className="font-medium text-zinc-200">
            No recent friend activity yet
          </p>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            When your accepted friends update their anime or manga progress, publish reviews, or start Watch Together rooms, their activity will appear here.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {items.slice(0, pageSize).map((item) => {
          const badge = getActivityBadgeMeta(item.activityType);
          const isSpoilerHidden =
            item.isSpoiler && !revealedSpoilers[item.id];
          const relativeTime = formatDistanceToNow(new Date(item.createdAt), {
            addSuffix: true,
          });
          const online = isUserOnline(item.actor.id, {
            isPublicProfile: item.actor.isPublicProfile,
            isAcceptedFriend: true,
            isBlocked: false,
          });

          return (
            <div
              key={item.id}
              className="rounded-xl border border-[#1c2236] bg-[#121624] p-2.5 space-y-1.5 hover:border-[#28314e] transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/u/${encodeURIComponent(item.actor.username)}`}
                  onClick={onItemNavigate}
                  className="flex items-center gap-2 min-w-0 group"
                >
                  <div className="relative h-6 w-6 shrink-0 rounded-full overflow-hidden bg-primary/15 border border-white/10 flex items-center justify-center text-[10px] font-bold text-primary">
                    {item.actor.avatarUrl ? (
                      <Image
                        src={item.actor.avatarUrl}
                        alt={item.actor.username}
                        fill
                        sizes="24px"
                        className="object-cover"
                      />
                    ) : (
                      <span>
                        {item.actor.username.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span
                      className={`absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full ring-1 ring-[#121624] ${
                        online ? "bg-emerald-500" : "bg-zinc-600"
                      }`}
                    />
                  </div>
                  <span className="truncate text-xs font-semibold text-white group-hover:text-primary transition-colors">
                    {item.actor.displayName || item.actor.username}
                  </span>
                </Link>
                <span className="shrink-0 text-[10px] text-zinc-500">
                  {relativeTime}
                </span>
              </div>

              {isSpoilerHidden ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                  <span>Spoiler hidden</span>
                  <button
                    type="button"
                    onClick={() =>
                      setRevealedSpoilers((prev) => ({
                        ...prev,
                        [item.id]: true,
                      }))
                    }
                    className="font-bold underline hover:text-white"
                  >
                    Reveal
                  </button>
                </div>
              ) : (
                <Link
                  href={item.linkUrl}
                  onClick={onItemNavigate}
                  className="block text-[11px] text-zinc-300 hover:text-white leading-snug line-clamp-2"
                >
                  <span
                    className={`mr-1.5 inline-flex items-center rounded border px-1.5 py-0.2 text-[9px] font-bold uppercase ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                  {item.description}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category Filter Pills + Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "all", label: "All Friend Activity" },
              { id: "library", label: "Watching & Reading" },
              { id: "community", label: "Reviews & Discussions" },
              { id: "watch_together", label: "Watch Together" },
            ] as const
          ).map((tab) => {
            const active = categoryFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "border border-[#1c233a] bg-[#121624] text-zinc-400 hover:border-primary/40 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 rounded-xl text-xs text-zinc-400 hover:text-white"
          >
            <Link href="/settings">
              <Settings className="mr-1.5 h-3.5 w-3.5" />
              Privacy Controls
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadPage(1, false)}
            className="h-8 rounded-xl border-[#232a42] bg-[#151a2a] text-xs font-semibold text-zinc-300 hover:text-white"
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${
                loading ? "animate-spin text-primary" : ""
              }`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Empty States */}
      {filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/70 py-12 px-4 text-center space-y-3">
          <Sparkles className="mx-auto h-8 w-8 text-primary" />
          <h3 className="text-sm font-bold text-white">
            {items.length === 0
              ? "No Recent Friend Activity Yet"
              : "No Activity Matches This Filter"}
          </h3>
          <p className="max-w-md mx-auto text-xs text-zinc-400 leading-relaxed">
            {items.length === 0
              ? "Connect with friends on Nayozu to see when they start or complete anime & manga, publish reviews, open discussions, or host Watch Together rooms."
              : "Try switching back to All Friend Activity to see more updates from your friends."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            {items.length === 0 ? (
              <>
                <Button
                  asChild
                  size="sm"
                  className="rounded-xl bg-primary text-xs font-bold text-primary-foreground"
                >
                  <Link href="/profile?tab=friends&subtab=search">
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    Find Friends
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-[#232a42] bg-[#151a2a] text-xs text-zinc-200"
                >
                  <Link href="/profile?tab=friends">
                    <Users className="mr-1.5 h-3.5 w-3.5" />
                    Manage Friends
                  </Link>
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCategoryFilter("all")}
                className="rounded-xl text-xs"
              >
                Show All Activity
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const badge = getActivityBadgeMeta(item.activityType);
            const BadgeIcon = badge.icon;
            const isSpoilerHidden =
              item.isSpoiler && !revealedSpoilers[item.id];
            const relativeTime = formatDistanceToNow(new Date(item.createdAt), {
              addSuffix: true,
            });
            const online = isUserOnline(item.actor.id, {
              isPublicProfile: item.actor.isPublicProfile,
              isAcceptedFriend: true,
              isBlocked: false,
            });

            return (
              <article
                key={item.id}
                className="flex flex-col justify-between gap-4 rounded-2xl border border-[#1c233a] bg-[#121624] p-4 sm:flex-row sm:items-center hover:border-[#2a3556] transition-colors"
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  {/* Friend Avatar */}
                  <Link
                    href={`/u/${encodeURIComponent(item.actor.username)}`}
                    onClick={onItemNavigate}
                    className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-primary/40 bg-[#1a2035] flex items-center justify-center text-xs font-bold text-primary"
                  >
                    {item.actor.avatarUrl ? (
                      <Image
                        src={item.actor.avatarUrl}
                        alt={item.actor.username}
                        fill
                        sizes="44px"
                        className="object-cover"
                      />
                    ) : (
                      <span>
                        {item.actor.username.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span
                      title={online ? "Online now" : "Offline"}
                      className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-[#121624] ${
                        online ? "bg-emerald-500" : "bg-zinc-600"
                      }`}
                    />
                  </Link>

                  {/* Activity Body */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/u/${encodeURIComponent(item.actor.username)}`}
                        onClick={onItemNavigate}
                        className="text-xs font-bold text-white hover:text-primary transition-colors"
                      >
                        {item.actor.displayName || item.actor.username}
                      </Link>
                      <span className="text-[11px] text-zinc-400">
                        @{item.actor.username}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.className}`}
                      >
                        <BadgeIcon className="h-3 w-3" />
                        {badge.label}
                      </span>
                      {typeof item.score === "number" && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {item.score}/10
                        </span>
                      )}
                      <span className="text-[11px] text-zinc-500">
                        · {relativeTime}
                      </span>
                    </div>

                    <p className="text-sm font-semibold text-zinc-100 leading-snug">
                      {item.description}
                    </p>

                    {isSpoilerHidden ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        <span>
                          This post is marked as a spoiler by @
                          {item.actor.username}.
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setRevealedSpoilers((prev) => ({
                              ...prev,
                              [item.id]: true,
                            }))
                          }
                          className="h-7 rounded-lg border-amber-400/40 bg-amber-500/15 px-2.5 text-[11px] font-bold text-amber-200 hover:bg-amber-500/25"
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          Reveal Spoiler
                        </Button>
                      </div>
                    ) : (
                      <>
                        {item.title && (
                          <p className="text-xs font-medium text-primary">
                            {item.title}
                          </p>
                        )}
                        {item.excerpt && (
                          <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">
                            {item.excerpt}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Right Media Artwork / Action */}
                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-1 sm:pt-0">
                  {item.media && (
                    <Link
                      href={item.linkUrl}
                      onClick={onItemNavigate}
                      className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#0d111d] p-1.5 pr-3 hover:border-primary/40 transition-colors max-w-[220px]"
                    >
                      <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-lg bg-[#181d30] flex items-center justify-center">
                        {item.media.coverImage ? (
                          <Image
                            src={item.media.coverImage}
                            alt={item.media.title}
                            fill
                            sizes="36px"
                            className="object-cover"
                          />
                        ) : (
                          <Tv className="h-4 w-4 text-zinc-500" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-white">
                          {item.media.title}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400">
                          {item.media.mediaType}
                        </p>
                      </div>
                    </Link>
                  )}

                  <Button
                    asChild
                    size="sm"
                    variant={
                      item.activityType === "watch_room_active"
                        ? "default"
                        : "outline"
                    }
                    className={`h-8 rounded-xl text-xs font-semibold ${
                      item.activityType === "watch_room_active"
                        ? "bg-primary text-primary-foreground"
                        : "border-[#232a42] bg-[#151a2a] text-zinc-200 hover:text-white"
                    }`}
                  >
                    <Link href={item.linkUrl} onClick={onItemNavigate}>
                      {item.activityType === "watch_room_active" ? (
                        <>
                          <Tv className="mr-1.5 h-3.5 w-3.5" />
                          Join Room
                        </>
                      ) : (
                        <>
                          View
                          <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </>
                      )}
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Bounded Pagination Control */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void loadPage(page + 1, true)}
            className="h-9 rounded-xl border-[#232a42] bg-[#151a2a] px-5 text-xs font-semibold text-zinc-200 hover:text-white"
          >
            {loadingMore ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Loading More Activity...
              </>
            ) : (
              "Load More Friend Activity"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
