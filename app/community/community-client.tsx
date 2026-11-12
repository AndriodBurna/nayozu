"use client";

import { useEffect, useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  MessageSquare,
  Search,
  Plus,
  Sparkles,
  BookOpen,
  HelpCircle,
  Users,
  AlertCircle,
  Loader2,
  Send,
  Eye,
  Lock,
  Filter,
  Flame,
  Info,
  Edit3,
  Trash2,
  Flag,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  createCommunityPostAction,
  createCommunityReplyAction,
} from "./actions";
import {
  updateDiscussionAction,
  deleteDiscussionAction,
  updateDiscussionReplyAction,
  deleteDiscussionReplyAction,
  updateMediaCommentAction,
  deleteMediaCommentAction,
  deleteReviewAction,
  upsertReviewAction,
  type ReactionSummary,
  type ReactionTargetType,
  type ReportContentType,
} from "@/lib/actions/communityActions";
import {
  ReactionBar,
  ReportContentModal,
  BlockUserButton,
} from "@/components/community-action-modals";

export interface CommunityAuthor {
  id?: string;
  username: string;
  displayName?: string | null;
  avatarUrl: string | null;
}

export interface CommunityReplyItem {
  id: string;
  userId?: string;
  body: string;
  createdAt: string;
  author: CommunityAuthor;
  targetType?: "discussion_reply" | "comment";
  reactions?: ReactionSummary;
}

export interface CommunityPostItem {
  id: string;
  rawId?: string;
  userId?: string;
  kind: "discussion" | "question" | "review";
  sourceTable?: "discussions" | "anime_comments" | "anime_reviews";
  targetType?: ReactionTargetType;
  animeId: string;
  mediaTitle: string | null;
  mediaSlug: string | null;
  mediaType: "anime" | "manga" | null;
  title: string | null;
  body: string;
  isSpoiler: boolean;
  isLocked?: boolean;
  createdAt: string;
  author: CommunityAuthor;
  reactions?: ReactionSummary;
  replies: CommunityReplyItem[];
  isSample?: boolean;
}

export interface MediaOption {
  externalId: string;
  title: string;
  slug: string;
  mediaType: "anime" | "manga";
}

interface CommunityClientProps {
  initialPosts: CommunityPostItem[];
  mediaOptions: MediaOption[];
  currentUser: {
    id: string;
    username: string;
    avatarUrl: string | null;
  } | null;
  loadError?: string | null;
  initialDiscussionId?: string | null;
}

type TabKey = "all" | "reviews" | "questions";
type SortKey = "latest" | "oldest" | "discussed" | "reacted";

const DEFAULT_REACTIONS: ReactionSummary = {
  like: 0,
  helpful: 0,
  fire: 0,
  userReaction: null,
};

const SAMPLE_TOPICS: CommunityPostItem[] = [
  {
    id: "sample-topic-1",
    kind: "question",
    animeId: "community",
    mediaTitle: "General Community",
    mediaSlug: null,
    mediaType: null,
    title: "Anime of the Year — Which series had the best animation and pacing?",
    body: "Between Sousou no Frieren, Jujutsu Kaisen Season 2, and Dandadan, which studio delivered the most consistent adaptation from start to finish?",
    isSpoiler: false,
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    author: {
      username: "LunaRin",
      displayName: "LunaRin",
      avatarUrl:
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80",
    },
    replies: [
      {
        id: "sample-reply-1",
        body: "Frieren's direction and soundtrack integration made every quiet scene feel cinematic.",
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        author: {
          username: "Kaito",
          displayName: "Kaito",
          avatarUrl:
            "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=100&auto=format&fit=crop&q=80",
        },
      },
    ],
    isSample: true,
  },
  {
    id: "sample-topic-2",
    kind: "review",
    animeId: "154587",
    mediaTitle: "Sousou no Frieren",
    mediaSlug: "sousou-no-frieren",
    mediaType: "anime",
    title: "A meditative masterpiece on time, memory, and companionship",
    body: "Unlike traditional fantasy stories that rush toward a demon king battle, Frieren begins after the victory. Watching Frieren retrace her party's footsteps with Fern and Stark turns every small town into an emotional reflection.",
    isSpoiler: false,
    createdAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
    author: {
      username: "Mochi",
      displayName: "Mochi",
      avatarUrl:
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80",
    },
    replies: [],
    isSample: true,
  },
];

export default function CommunityClient({
  initialPosts,
  mediaOptions,
  currentUser,
  loadError,
  initialDiscussionId = null,
}: CommunityClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(
    initialDiscussionId
  );

  // Filter & Sort state
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("latest");
  const [selectedMediaFilter, setSelectedMediaFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(12);

  // Create Post Form state
  const [composerOpen, setComposerOpen] = useState(false);
  const [postType, setPostType] = useState<"discussion" | "question" | "review">("discussion");
  const [selectedAnimeId, setSelectedAnimeId] = useState<string>("community");
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [reviewScore, setReviewScore] = useState<number | "">(9);
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Edit Post / Reply state
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostTitle, setEditPostTitle] = useState("");
  const [editPostBody, setEditPostBody] = useState("");
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editReplyBody, setEditReplyBody] = useState("");

  // Spoiler, Reply & Report UI state
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyError, setReplyError] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    contentType: ReportContentType;
    contentId: string;
    label: string;
  } | null>(null);

  const usingSampleFallback = initialPosts.length === 0 && !loadError;
  const allPosts = useMemo(
    () => (initialPosts.length > 0 ? initialPosts : SAMPLE_TOPICS),
    [initialPosts]
  );

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return allPosts
      .filter((post) => {
        if (activeTab === "reviews" && post.kind !== "review") return false;
        if (activeTab === "questions" && post.kind !== "question") return false;
        if (selectedMediaFilter !== "all" && post.animeId !== selectedMediaFilter) {
          return false;
        }
        if (q) {
          const haystack = `${post.title || ""} ${post.body} ${post.author.username} ${post.mediaTitle || ""}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "discussed") {
          const diff = b.replies.length - a.replies.length;
          if (diff !== 0) return diff;
        }
        if (sortBy === "reacted") {
          const ra =
            (a.reactions?.like ?? 0) +
            (a.reactions?.helpful ?? 0) +
            (a.reactions?.fire ?? 0);
          const rb =
            (b.reactions?.like ?? 0) +
            (b.reactions?.helpful ?? 0) +
            (b.reactions?.fire ?? 0);
          if (rb !== ra) return rb - ra;
        }
        if (sortBy === "oldest") {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [allPosts, activeTab, searchQuery, sortBy, selectedMediaFilter]);

  const paginatedPosts = filteredPosts.slice(0, visibleCount);

  useEffect(() => {
    const targetId = initialDiscussionId;
    if (!targetId) return;

    setHighlightedPostId(targetId);
    setActiveTab("all");
    setSelectedMediaFilter("all");
    setSearchQuery("");
    setExpandedComments((prev) => ({ ...prev, [targetId]: true }));

    const idx = allPosts.findIndex(
      (p) => p.id === targetId || p.rawId === targetId
    );
    if (idx >= 0 && idx + 1 > visibleCount) {
      setVisibleCount(idx + 4);
    }

    const timer = window.setTimeout(() => {
      const el = document.getElementById(`discussion-${targetId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);

    return () => window.clearTimeout(timer);
  }, [initialDiscussionId, allPosts, visibleCount]);

  const handleCreatePost = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    startTransition(async () => {
      const res = await createCommunityPostAction({
        postType,
        animeId: selectedAnimeId,
        title: postTitle,
        body: postBody,
        score: postType === "review" && reviewScore !== "" ? Number(reviewScore) : null,
        isSpoiler,
      });

      if (!res.success) {
        setFormError(res.error || "Could not publish post.");
        return;
      }

      setPostTitle("");
      setPostBody("");
      setIsSpoiler(false);
      setFormSuccess("Your post was published to the community.");
      setComposerOpen(false);
      router.refresh();
    });
  };

  const handleSavePostEdit = (post: CommunityPostItem) => {
    const cleanTitle = editPostTitle.trim();
    const cleanBody = editPostBody.trim();
    if (!cleanBody) return;

    startTransition(async () => {
      let res: { success: boolean; error?: string };
      if (post.sourceTable === "discussions") {
        res = await updateDiscussionAction({
          discussionId: post.rawId || post.id,
          title: cleanTitle || post.title || "Community Discussion",
          body: cleanBody,
        });
      } else if (post.sourceTable === "anime_reviews") {
        res = await upsertReviewAction({
          externalId: post.animeId,
          mediaType: post.mediaType || "anime",
          title: cleanTitle || null,
          body: cleanBody,
        });
      } else {
        res = await updateMediaCommentAction({
          commentId: post.rawId || post.id,
          body: cleanTitle ? `${cleanTitle}\n\n${cleanBody}` : cleanBody,
        });
      }

      if (!res.success) {
        setFormError(res.error || "Failed to update post.");
        return;
      }
      setEditingPostId(null);
      router.refresh();
    });
  };

  const handleDeletePost = (post: CommunityPostItem) => {
    startTransition(async () => {
      let res: { success: boolean; error?: string };
      if (post.sourceTable === "discussions") {
        res = await deleteDiscussionAction({
          discussionId: post.rawId || post.id,
        });
      } else if (post.sourceTable === "anime_reviews") {
        res = await deleteReviewAction({
          reviewId: post.rawId || post.id.replace(/^review-/, ""),
        });
      } else {
        res = await deleteMediaCommentAction({
          commentId: post.rawId || post.id,
        });
      }

      if (!res.success) {
        setFormError(res.error || "Failed to delete post.");
        return;
      }
      router.refresh();
    });
  };

  const handleReplySubmit = (post: CommunityPostItem) => {
    const draft = (replyDrafts[post.id] ?? "").trim();
    if (!draft) return;

    setReplyingId(post.id);
    setReplyError((prev) => ({ ...prev, [post.id]: "" }));

    startTransition(async () => {
      const res = await createCommunityReplyAction({
        parentCommentId: post.rawId || post.id,
        animeId: post.animeId,
        body: draft,
        isDiscussionTable: post.sourceTable === "discussions",
      });

      setReplyingId(null);

      if (!res.success) {
        setReplyError((prev) => ({
          ...prev,
          [post.id]: res.error || "Failed to post reply.",
        }));
        return;
      }

      setReplyDrafts((prev) => ({ ...prev, [post.id]: "" }));
      router.refresh();
    });
  };

  const handleSaveReplyEdit = (reply: CommunityReplyItem) => {
    const trimmed = editReplyBody.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const res =
        reply.targetType === "discussion_reply"
          ? await updateDiscussionReplyAction({
              replyId: reply.id,
              body: trimmed,
            })
          : await updateMediaCommentAction({
              commentId: reply.id,
              body: trimmed,
            });

      if (res.success) {
        setEditingReplyId(null);
        router.refresh();
      }
    });
  };

  const handleDeleteReply = (reply: CommunityReplyItem) => {
    startTransition(async () => {
      const res =
        reply.targetType === "discussion_reply"
          ? await deleteDiscussionReplyAction({ replyId: reply.id })
          : await deleteMediaCommentAction({ commentId: reply.id });

      if (res.success) {
        router.refresh();
      }
    });
  };

  const tabs: Array<{ id: TabKey; label: string; icon: typeof MessageSquare }> = [
    { id: "all", label: "All Discussions", icon: MessageSquare },
    { id: "reviews", label: "Reviews", icon: BookOpen },
    { id: "questions", label: "Questions", icon: HelpCircle },
  ];

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* 1. Community Hero Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1e253d] bg-gradient-to-br from-[#131829] via-[#101423] to-[#0b0e17] p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Flame className="h-3.5 w-3.5 fill-current" />
              <span>Nayozu Community Hub</span>
            </div>
            <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-white">
              Discussions, Reviews & Questions
            </h1>
            <p className="text-sm text-zinc-400">
              Share episode reactions, publish in-depth anime & manga reviews, and discuss theories with the community.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {currentUser ? (
              <Button
                onClick={() => {
                  setComposerOpen((prev) => !prev);
                  setFormError(null);
                  setFormSuccess(null);
                }}
                className="h-10 rounded-xl bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {composerOpen ? "Close Composer" : "New Post"}
              </Button>
            ) : (
              <Button
                asChild
                className="h-10 rounded-xl bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110"
              >
                <Link href="/login">
                  <Lock className="mr-1.5 h-3.5 w-3.5" />
                  Sign in to Post
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Success Banner */}
      {formSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
          <span>{formSuccess}</span>
          <button
            type="button"
            onClick={() => setFormSuccess(null)}
            className="text-emerald-400 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2. Create Post Composer */}
      {currentUser ? (
        composerOpen && (
          <section className="rounded-2xl border border-[#1e253d] bg-[#121625] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                  {currentUser.username.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Create a Community Post
                  </h2>
                  <p className="text-[11px] text-zinc-400">
                    Posting as @{currentUser.username}
                  </p>
                </div>
              </div>

              <div className="inline-flex rounded-xl border border-[#232a42] bg-[#0b0e17] p-1 text-xs">
                {(
                  [
                    { id: "discussion", label: "Discussion" },
                    { id: "question", label: "Question" },
                    { id: "review", label: "Review" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setPostType(t.id);
                      if (
                        t.id === "review" &&
                        selectedAnimeId === "community" &&
                        mediaOptions.length > 0
                      ) {
                        setSelectedAnimeId(mediaOptions[0].externalId);
                      }
                    }}
                    className={cn(
                      "rounded-lg px-3 py-1 font-medium transition-colors",
                      postType === t.id
                        ? "bg-primary text-primary-foreground"
                        : "text-zinc-400 hover:text-white"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleCreatePost} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="post-media" className="text-xs text-zinc-300">
                    Topic / Series {postType === "review" ? "(Required)" : "(Optional)"}
                  </Label>
                  <select
                    id="post-media"
                    value={selectedAnimeId}
                    onChange={(e) => setSelectedAnimeId(e.target.value)}
                    className="h-10 w-full rounded-xl border border-[#232a42] bg-[#0b0e17] px-3 text-xs text-white focus:border-primary focus:outline-none"
                  >
                    {postType !== "review" && (
                      <option value="community">General Community Discussion</option>
                    )}
                    {mediaOptions.map((m) => (
                      <option key={m.externalId} value={m.externalId}>
                        {m.title} ({m.mediaType === "manga" ? "Manga" : "Anime"})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="post-title" className="text-xs text-zinc-300">
                    Headline / Title {postType === "discussion" ? "(Required)" : "(Optional)"}
                  </Label>
                  <Input
                    id="post-title"
                    value={postTitle}
                    onChange={(e) => setPostTitle(e.target.value)}
                    placeholder={
                      postType === "question"
                        ? "e.g., What chapter does Season 2 end on?"
                        : postType === "review"
                        ? "e.g., Why this season exceeded expectations"
                        : "e.g., Episode discussion & thoughts"
                    }
                    className="h-10 rounded-xl border-[#232a42] bg-[#0b0e17] text-xs text-white"
                  />
                </div>
              </div>

              {postType === "review" && (
                <div className="flex items-center gap-3">
                  <Label htmlFor="post-score" className="text-xs text-zinc-300">
                    Rating Score (1–10):
                  </Label>
                  <select
                    id="post-score"
                    value={reviewScore}
                    onChange={(e) =>
                      setReviewScore(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    className="h-9 rounded-xl border border-[#232a42] bg-[#0b0e17] px-3 text-xs font-bold text-amber-300"
                  >
                    <option value="">No rating</option>
                    {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n} / 10
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="post-body" className="text-xs text-zinc-300">
                  Content
                </Label>
                <Textarea
                  id="post-body"
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                  rows={4}
                  required
                  placeholder="Write your thoughts, review, or question..."
                  className="rounded-xl border-[#232a42] bg-[#0b0e17] text-sm text-white"
                />
              </div>

              {postType !== "review" && (
                <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSpoiler}
                    onChange={(e) => setIsSpoiler(e.target.checked)}
                    className="rounded border-zinc-600"
                  />
                  <span>Contains spoilers (blur content until clicked)</span>
                </label>
              )}

              {formError && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setComposerOpen(false)}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending || !postBody.trim()}
                  className="rounded-xl bg-primary px-5 text-xs font-semibold text-primary-foreground"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      Publish Post
                    </>
                  )}
                </Button>
              </div>
            </form>
          </section>
        )
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[#1e253d] bg-[#121625]/80 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">
                Join the conversation on Nayozu
              </p>
              <p className="text-[11px] text-zinc-400">
                Sign in to start discussions, ask questions, react, and post anime or manga reviews.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-8 rounded-xl text-xs">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button
              asChild
              size="sm"
              className="h-8 rounded-xl bg-primary text-xs font-semibold text-primary-foreground"
            >
              <Link href="/register">Get started</Link>
            </Button>
          </div>
        </div>
      )}

      {/* 3. Tabs, Search, and Sort Controls */}
      <div className="flex flex-col gap-4 border-b border-[#1a2034] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                    : "bg-[#121625] text-zinc-400 hover:bg-[#171d30] hover:text-white border border-[#1d243b]"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:w-60 sm:flex-initial">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter discussions..."
              className="h-9 w-full rounded-xl border border-[#1f263c] bg-[#101422] pl-9 pr-3 text-xs text-white placeholder-zinc-500 focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-zinc-400 hidden sm:inline" />
            <select
              aria-label="Filter by series"
              value={selectedMediaFilter}
              onChange={(e) => setSelectedMediaFilter(e.target.value)}
              className="h-9 rounded-xl border border-[#1f263c] bg-[#101422] px-3 text-xs text-zinc-200 focus:border-primary focus:outline-none max-w-[180px]"
            >
              <option value="all">All Topics & Series</option>
              <option value="community">General Community</option>
              {mediaOptions.map((m) => (
                <option key={m.externalId} value={m.externalId}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>

          <select
            aria-label="Sort posts"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="h-9 rounded-xl border border-[#1f263c] bg-[#101422] px-3 text-xs text-zinc-200 focus:border-primary focus:outline-none"
          >
            <option value="latest">Latest First</option>
            <option value="oldest">Oldest First</option>
            <option value="discussed">Most Discussed</option>
            <option value="reacted">Most Reacted</option>
          </select>
        </div>
      </div>

      {/* 4. Error Banner */}
      {loadError && (
        <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Failed to load community feed from database</p>
            <p className="mt-0.5 text-zinc-300">{loadError}</p>
          </div>
        </div>
      )}

      {usingSampleFallback && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-zinc-300">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span>
              Showing featured starter topics while the community database has no user posts yet. Sign in to publish the first live post!
            </span>
          </div>
        </div>
      )}

      {/* 5. Main Content Area */}
      {filteredPosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[#1c2236] bg-[#121624] p-12 text-center space-y-3">
          <MessageSquare className="h-8 w-8 text-zinc-500" />
          <h3 className="text-base font-bold text-white">No matching posts found</h3>
          <p className="max-w-sm text-xs text-zinc-400">
            Try clearing your search filter or switching tabs to see more community discussions.
          </p>
          {(searchQuery || selectedMediaFilter !== "all" || activeTab !== "all") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setSelectedMediaFilter("all");
                setActiveTab("all");
              }}
              className="rounded-xl text-xs"
            >
              Reset Filters
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {paginatedPosts.map((post) => {
            const isSpoilerHidden = post.isSpoiler && !revealedSpoilers[post.id];
            const isExpanded = Boolean(expandedComments[post.id]);
            const canReplyInDb =
              !post.isSample && post.kind !== "review" && !post.isLocked;
            const isOwner = Boolean(
              currentUser &&
                (post.userId === currentUser.id ||
                  post.author.username === currentUser.username)
            );
            const isEditingPost = editingPostId === post.id;
            const targetId = post.rawId || post.id.replace(/^review-/, "");
            const targetType: ReactionTargetType =
              post.targetType ??
              (post.kind === "review" ? "review" : "discussion");

            return (
              <article
                id={`discussion-${post.id}`}
                key={post.id}
                className={cn(
                  "rounded-2xl border bg-[#121624] p-5 transition-colors hover:border-[#26304d]",
                  highlightedPostId === post.id
                    ? "border-primary/70 ring-1 ring-primary/30"
                    : "border-[#1c2236]"
                )}
              >
                {/* Author & Topic Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/u/${encodeURIComponent(post.author.username)}`}
                      className="shrink-0"
                    >
                      {post.author.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={post.author.avatarUrl}
                          alt={post.author.username}
                          className="h-10 w-10 rounded-full object-cover border border-white/10"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                          {post.author.username.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </Link>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/u/${encodeURIComponent(post.author.username)}`}
                          className="text-sm font-semibold text-white hover:text-primary"
                        >
                          {post.author.displayName || post.author.username}
                        </Link>
                        <span className="text-xs text-zinc-500">
                          @{post.author.username}
                        </span>
                        {isOwner && !post.isSample && (
                          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                            You
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-400">
                        {formatDistanceToNow(new Date(post.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Badges + Owner / Report / Block Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    {post.isLocked && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-300"
                      >
                        <Lock className="mr-1 h-3 w-3" />
                        Locked
                      </Badge>
                    )}

                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[11px] capitalize",
                        post.kind === "review"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                          : post.kind === "question"
                          ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                          : "border-primary/30 bg-primary/10 text-primary"
                      )}
                    >
                      {post.kind}
                    </Badge>

                    {post.mediaTitle &&
                      (post.mediaSlug && post.mediaType ? (
                        <Link
                          href={`/${post.mediaType}/${post.mediaSlug}`}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-0.5 text-[11px] font-medium text-zinc-300 hover:border-primary hover:text-white transition-colors"
                        >
                          {post.mediaTitle}
                        </Link>
                      ) : (
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-0.5 text-[11px] text-zinc-400">
                          {post.mediaTitle}
                        </span>
                      ))}

                    {!post.isSample && isOwner && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPostId(post.id);
                            setEditPostTitle(post.title ?? "");
                            setEditPostBody(post.body);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-semibold text-zinc-300 hover:text-primary"
                        >
                          <Edit3 className="h-3 w-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleDeletePost(post)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}

                    {!post.isSample && !isOwner && currentUser && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setReportTarget({
                              contentType: targetType,
                              contentId: targetId,
                              label: `${post.kind} by @${post.author.username}`,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-semibold text-zinc-400 hover:border-rose-500/40 hover:text-rose-300"
                        >
                          <Flag className="h-3 w-3" />
                          <span>Report</span>
                        </button>
                        {post.userId && (
                          <BlockUserButton
                            targetUserId={post.userId}
                            targetUsername={post.author.username}
                            compact
                            onBlockedChange={() => router.refresh()}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Post Title & Body or Inline Editor */}
                {isEditingPost ? (
                  <div className="mt-4 space-y-3 rounded-xl border border-primary/30 bg-black/30 p-3.5">
                    <Input
                      value={editPostTitle}
                      onChange={(e) => setEditPostTitle(e.target.value)}
                      placeholder="Headline / Title"
                      className="h-9 rounded-lg border-white/15 bg-[#10131c] text-xs text-white"
                    />
                    <Textarea
                      rows={4}
                      value={editPostBody}
                      onChange={(e) => setEditPostBody(e.target.value)}
                      className="rounded-lg border-white/15 bg-[#10131c] text-xs text-white"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingPostId(null)}
                        className="text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleSavePostEdit(post)}
                        className="bg-primary text-xs text-white"
                      >
                        Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3.5 space-y-2">
                    {post.title && (
                      <h3 className="text-base font-bold text-white leading-snug">
                        {post.title}
                      </h3>
                    )}

                    {isSpoilerHidden ? (
                      <div className="flex flex-col items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-center space-y-2">
                        <p className="text-xs font-medium text-amber-300">
                          This post contains spoilers.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setRevealedSpoilers((prev) => ({
                              ...prev,
                              [post.id]: true,
                            }))
                          }
                          className="h-8 rounded-xl text-xs"
                        >
                          <Eye className="mr-1.5 h-3.5 w-3.5" />
                          Reveal Spoiler
                        </Button>
                      </div>
                    ) : (
                      <p className="whitespace-pre-line text-sm text-zinc-200 leading-relaxed">
                        {post.body}
                      </p>
                    )}
                  </div>
                )}

                {/* Post Footer Actions: Replies & Live Reactions */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-3 text-xs text-zinc-400">
                  <div className="flex flex-wrap items-center gap-3">
                    {post.kind !== "review" && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedComments((prev) => ({
                            ...prev,
                            [post.id]: !prev[post.id],
                          }))
                        }
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-semibold text-zinc-300 hover:border-primary/40 hover:text-primary transition-colors"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>
                          {post.replies.length}{" "}
                          {post.replies.length === 1 ? "Reply" : "Replies"}
                        </span>
                      </button>
                    )}

                    {!post.isSample && (
                      <ReactionBar
                        targetType={targetType}
                        targetId={targetId}
                        initialReactions={post.reactions ?? DEFAULT_REACTIONS}
                        isAuthenticated={Boolean(currentUser)}
                        compact
                      />
                    )}
                  </div>

                  {post.mediaSlug && post.mediaType && (
                    <Link
                      href={`/${post.mediaType}/${post.mediaSlug}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      View {post.mediaType === "manga" ? "Manga" : "Anime"} Page →
                    </Link>
                  )}
                </div>

                {/* Expanded Replies Drawer */}
                {isExpanded && (
                  <div className="mt-4 space-y-3 rounded-xl border border-[#1e253b] bg-[#0b0e17] p-4">
                    {post.replies.length === 0 ? (
                      <p className="text-xs text-zinc-500">No replies yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {post.replies.map((reply) => {
                          const isReplyOwner = Boolean(
                            currentUser &&
                              (reply.userId === currentUser.id ||
                                reply.author.username === currentUser.username)
                          );
                          const isEditingReply = editingReplyId === reply.id;
                          const replyTargetType =
                            reply.targetType ?? "discussion_reply";

                          return (
                            <div
                              key={reply.id}
                              className="flex items-start gap-2.5 border-b border-white/5 pb-3 last:border-0 last:pb-0"
                            >
                              <Link
                                href={`/u/${encodeURIComponent(reply.author.username)}`}
                                className="shrink-0"
                              >
                                {reply.author.avatarUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={reply.author.avatarUrl}
                                    alt={reply.author.username}
                                    className="h-7 w-7 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                                    {reply.author.username.slice(0, 2).toUpperCase()}
                                  </div>
                                )}
                              </Link>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Link
                                      href={`/u/${encodeURIComponent(reply.author.username)}`}
                                      className="text-xs font-semibold text-white hover:text-primary"
                                    >
                                      {reply.author.displayName || reply.author.username}
                                    </Link>
                                    <span className="text-[10px] text-zinc-500">
                                      {formatDistanceToNow(new Date(reply.createdAt), {
                                        addSuffix: true,
                                      })}
                                    </span>
                                  </div>

                                  {!post.isSample && (
                                    <div className="flex items-center gap-2">
                                      {isReplyOwner ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingReplyId(reply.id);
                                              setEditReplyBody(reply.body);
                                            }}
                                            className="text-[11px] font-semibold text-zinc-400 hover:text-primary"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteReply(reply)}
                                            className="text-[11px] font-semibold text-rose-300 hover:underline"
                                          >
                                            Delete
                                          </button>
                                        </>
                                      ) : (
                                        currentUser && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setReportTarget({
                                                contentType: replyTargetType,
                                                contentId: reply.id,
                                                label: `reply by @${reply.author.username}`,
                                              })
                                            }
                                            className="text-[11px] font-semibold text-zinc-400 hover:text-rose-300"
                                          >
                                            Report
                                          </button>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>

                                {isEditingReply ? (
                                  <div className="mt-2 space-y-2">
                                    <Input
                                      value={editReplyBody}
                                      onChange={(e) => setEditReplyBody(e.target.value)}
                                      className="h-8 rounded-lg border-white/15 bg-[#121625] text-xs text-white"
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setEditingReplyId(null)}
                                        className="h-7 text-[11px]"
                                      >
                                        Cancel
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => handleSaveReplyEdit(reply)}
                                        className="h-7 bg-primary text-[11px] text-white"
                                      >
                                        Save
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
                                    {reply.body}
                                  </p>
                                )}

                                {!post.isSample && (
                                  <div className="mt-2">
                                    <ReactionBar
                                      targetType={replyTargetType}
                                      targetId={reply.id}
                                      initialReactions={
                                        reply.reactions ?? DEFAULT_REACTIONS
                                      }
                                      isAuthenticated={Boolean(currentUser)}
                                      compact
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Reply Input */}
                    {post.isLocked ? (
                      <div className="flex items-center gap-1.5 pt-2 text-[11px] text-amber-300">
                        <Lock className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          This discussion has been locked by a moderator. New replies are disabled.
                        </span>
                      </div>
                    ) : canReplyInDb ? (
                      currentUser ? (
                        <div className="pt-2 space-y-2">
                          <div className="flex items-center gap-2">
                            <Input
                              value={replyDrafts[post.id] ?? ""}
                              onChange={(e) =>
                                setReplyDrafts((prev) => ({
                                  ...prev,
                                  [post.id]: e.target.value,
                                }))
                              }
                              placeholder="Write a reply..."
                              className="h-9 rounded-xl border-[#232a42] bg-[#121625] text-xs text-white"
                            />
                            <Button
                              type="button"
                              size="sm"
                              disabled={
                                replyingId === post.id ||
                                !(replyDrafts[post.id] ?? "").trim()
                              }
                              onClick={() => handleReplySubmit(post)}
                              className="h-9 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
                            >
                              {replyingId === post.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                "Reply"
                              )}
                            </Button>
                          </div>
                          {replyError[post.id] && (
                            <p className="text-[11px] text-destructive">
                              {replyError[post.id]}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between pt-2 text-xs text-zinc-400">
                          <span>Sign in to reply to this discussion.</span>
                          <Link
                            href="/login"
                            className="font-semibold text-primary hover:underline"
                          >
                            Sign in →
                          </Link>
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-1.5 pt-2 text-[11px] text-zinc-500">
                        <Info className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {post.isSample
                            ? "This is a starter showcase topic. Publish a new discussion above to start a live thread."
                            : "Direct replies are supported on discussion and question threads."}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          {visibleCount < filteredPosts.length && (
            <div className="pt-2 text-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => setVisibleCount((c) => c + 12)}
                className="rounded-xl text-xs font-semibold"
              >
                <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                Load More ({paginatedPosts.length} of {filteredPosts.length})
              </Button>
            </div>
          )}
        </div>
      )}

      {reportTarget && (
        <ReportContentModal
          isOpen={true}
          onClose={() => setReportTarget(null)}
          contentType={reportTarget.contentType}
          contentId={reportTarget.contentId}
          contentLabel={reportTarget.label}
        />
      )}
    </div>
  );
}
