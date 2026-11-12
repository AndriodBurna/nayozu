"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Star,
  PenSquare,
  Trash2,
  Flag,
  ArrowUpDown,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  fetchMediaReviewsAndRatingsAction,
  submitRatingAction,
  removeRatingAction,
  upsertReviewAction,
  deleteReviewAction,
  type MediaType,
  type ReviewItemDTO,
  type ReviewSortOption,
} from "@/lib/actions/communityActions";
import {
  ReactionBar,
  ReportContentModal,
  BlockUserButton,
} from "@/components/community-action-modals";

export function MediaReviewsSection({
  externalId,
  mediaType = "anime",
  mediaTitle,
}: {
  externalId: string | number;
  mediaType?: MediaType;
  mediaTitle: string;
}) {
  const [loading, setLoading] = useState(true);
  const [averageScore, setAverageScore] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [hoverScore, setHoverScore] = useState<number | null>(null);
  const [userReview, setUserReview] = useState<ReviewItemDTO | null>(null);
  const [reviews, setReviews] = useState<ReviewItemDTO[]>([]);
  const [totalReviews, setTotalReviews] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<ReviewSortOption>("newest");
  const [page, setPage] = useState(1);

  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewScore, setReviewScore] = useState<number | "">("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [reportTarget, setReportTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);

  const [isPending, startTransition] = useTransition();

  const loadData = useCallback(
    async (targetSort: ReviewSortOption, targetPage: number, append = false) => {
      if (!append) setLoading(true);
      const data = await fetchMediaReviewsAndRatingsAction({
        externalId,
        mediaType,
        sortBy: targetSort,
        page: targetPage,
        limit: 8,
      });

      setAverageScore(data.averageScore);
      setRatingCount(data.ratingCount);
      setUserScore(data.userScore);
      setUserReview(data.userReview);
      setTotalReviews(data.totalReviews);
      setHasMore(data.hasMore);
      setCurrentUserId(data.currentUserId);

      if (append) {
        setReviews((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const next = data.reviews.filter((r) => !existingIds.has(r.id));
          return [...prev, ...next];
        });
      } else {
        setReviews(data.reviews);
      }

      if (data.userReview) {
        setReviewTitle(data.userReview.title ?? "");
        setReviewBody(data.userReview.body);
        setReviewScore(data.userScore ?? "");
      } else if (data.userScore) {
        setReviewScore(data.userScore);
      }
      setLoading(false);
    },
    [externalId, mediaType]
  );

  useEffect(() => {
    void loadData(sortBy, 1, false);
  }, [loadData, sortBy]);

  const handleSelectRating = (score: number) => {
    setFeedback(null);
    if (!currentUserId) {
      setFeedback({
        type: "error",
        message: "Please sign in to submit a rating.",
      });
      return;
    }

    startTransition(async () => {
      const res = await submitRatingAction({
        externalId,
        mediaType,
        score,
      });
      if (!res.success) {
        setFeedback({
          type: "error",
          message: res.error || "Could not submit rating.",
        });
        return;
      }
      setUserScore(score);
      setReviewScore(score);
      setAverageScore(res.averageScore ?? score);
      setRatingCount(res.ratingCount ?? ratingCount);
      setFeedback({
        type: "success",
        message: `Saved your ${score}/10 rating for ${mediaTitle}.`,
      });
      void loadData(sortBy, 1, false);
    });
  };

  const handleRemoveRating = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await removeRatingAction({ externalId, mediaType });
      if (!res.success) {
        setFeedback({
          type: "error",
          message: res.error || "Could not remove rating.",
        });
        return;
      }
      setUserScore(null);
      setAverageScore(res.averageScore ?? null);
      setRatingCount(res.ratingCount ?? 0);
      setFeedback({
        type: "success",
        message: "Your rating has been removed.",
      });
      void loadData(sortBy, 1, false);
    });
  };

  const handleSaveReview = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!currentUserId) {
      setFeedback({
        type: "error",
        message: "Please sign in to write a review.",
      });
      return;
    }

    startTransition(async () => {
      const res = await upsertReviewAction({
        externalId,
        mediaType,
        title: reviewTitle.trim() || null,
        body: reviewBody.trim(),
        score: reviewScore === "" ? null : Number(reviewScore),
      });
      if (!res.success) {
        setFeedback({
          type: "error",
          message: res.error || "Failed to publish review.",
        });
        return;
      }
      setFeedback({
        type: "success",
        message: userReview
          ? "Your review has been updated."
          : "Your review has been published.",
      });
      setIsComposerOpen(false);
      setPage(1);
      await loadData(sortBy, 1, false);
    });
  };

  const handleDeleteOwnReview = (reviewId: string) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await deleteReviewAction({ reviewId });
      if (!res.success) {
        setFeedback({
          type: "error",
          message: res.error || "Failed to delete review.",
        });
        return;
      }
      setUserReview(null);
      setReviewTitle("");
      setReviewBody("");
      setIsComposerOpen(false);
      setFeedback({
        type: "success",
        message: "Your review has been deleted.",
      });
      await loadData(sortBy, 1, false);
    });
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    void loadData(sortBy, nextPage, true);
  };

  return (
    <section className="space-y-5 rounded-3xl border border-white/10 bg-[#10131c] p-5 md:p-6">
      {/* Header + Rating Widget */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            Community Ratings & Reviews
          </p>
          <h2 className="mt-1 text-xl font-bold text-white">
            Reviews for {mediaTitle}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Rate this {mediaType} from 1 to 10 and share an in-depth review with the community.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
          <div className="flex items-center gap-2.5 pr-3 border-r border-white/10">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
              <Star className="h-5 w-5 fill-amber-300" />
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-black text-white">
                  {averageScore !== null ? averageScore.toFixed(1) : "—"}
                </span>
                <span className="text-xs text-slate-400">/ 10</span>
              </div>
              <p className="text-[11px] text-slate-400">
                {ratingCount} {ratingCount === 1 ? "rating" : "ratings"}
              </p>
            </div>
          </div>

          {/* 1-10 Interactive Rating Selector */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-300">
                {userScore ? `Your Rating: ${userScore}/10` : "Rate this title:"}
              </span>
              {userScore && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleRemoveRating}
                  className="text-[11px] font-semibold text-rose-300 hover:text-rose-200"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => {
                const active = (hoverScore ?? userScore ?? 0) >= val;
                return (
                  <button
                    key={val}
                    type="button"
                    disabled={isPending}
                    onMouseEnter={() => setHoverScore(val)}
                    onMouseLeave={() => setHoverScore(null)}
                    onClick={() => handleSelectRating(val)}
                    title={`Rate ${val}/10`}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold transition ${
                      active
                        ? "border-amber-400/50 bg-amber-400/20 text-amber-200"
                        : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25 hover:text-white"
                    } disabled:opacity-50`}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/10 text-rose-200"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Action Bar: Write / Edit Review + Sort Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {currentUserId ? (
            <button
              type="button"
              onClick={() => {
                if (userReview) {
                  setReviewTitle(userReview.title ?? "");
                  setReviewBody(userReview.body);
                  setReviewScore(userScore ?? "");
                }
                setIsComposerOpen((v) => !v);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white transition hover:bg-primary/90"
            >
              <PenSquare className="h-3.5 w-3.5" />
              <span>{userReview ? "Edit Your Review" : "Write a Review"}</span>
            </button>
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary/25"
            >
              <PenSquare className="h-3.5 w-3.5" />
              <span>Sign in to Rate or Review</span>
            </Link>
          )}

          {userReview && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleDeleteOwnReview(userReview.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete My Review</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
          <label htmlFor="review-sort" className="text-xs font-semibold text-slate-400">
            Sort by:
          </label>
          <select
            id="review-sort"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as ReviewSortOption);
              setPage(1);
            }}
            className="rounded-xl border border-white/10 bg-[#151a27] px-3 py-1.5 text-xs font-semibold text-white focus:border-primary/50 focus:outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="highest">Highest rated</option>
            <option value="lowest">Lowest rated</option>
          </select>
        </div>
      </div>

      {/* Review Composer Form */}
      {isComposerOpen && currentUserId && (
        <form
          onSubmit={handleSaveReview}
          className="space-y-3 rounded-2xl border border-primary/30 bg-[#141926] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white">
              {userReview ? "Update Your Review" : `Write a Review for ${mediaTitle}`}
            </h3>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-300">
                Score (1–10):
              </label>
              <select
                value={reviewScore}
                onChange={(e) =>
                  setReviewScore(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 text-xs font-bold text-amber-300"
              >
                <option value="">No score</option>
                {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} / 10
                  </option>
                ))}
              </select>
            </div>
          </div>

          <input
            type="text"
            maxLength={160}
            value={reviewTitle}
            onChange={(e) => setReviewTitle(e.target.value)}
            placeholder="Review headline (optional, e.g. 'Masterpiece of modern storytelling')"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
          />

          <textarea
            rows={5}
            required
            minLength={10}
            maxLength={5000}
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
            placeholder="Share your thoughts on story, animation/art, characters, and pacing (minimum 10 characters)..."
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-xs leading-relaxed text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsComposerOpen(false)}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending
                ? "Saving..."
                : userReview
                  ? "Update Review"
                  : "Publish Review"}
            </button>
          </div>
        </form>
      )}

      {/* Review List */}
      {loading ? (
        <div className="py-8 text-center text-xs text-slate-400">
          Loading community reviews...
        </div>
      ) : reviews.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-center">
          <p className="text-sm font-semibold text-white">No reviews yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Be the first to share a review for {mediaTitle}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((rev) => {
            const isOwner = currentUserId === rev.userId;
            return (
              <article
                key={rev.id}
                className="rounded-2xl border border-white/10 bg-[#141824] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Link
                      href={`/u/${encodeURIComponent(rev.author.username)}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-primary/20 text-xs font-bold uppercase text-white hover:border-primary"
                    >
                      {rev.author.username.slice(0, 2)}
                    </Link>
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/u/${encodeURIComponent(rev.author.username)}`}
                          className="text-xs font-bold text-white hover:text-primary"
                        >
                          {rev.author.displayName || `@${rev.author.username}`}
                        </Link>
                        <span className="text-[11px] text-slate-500">
                          @{rev.author.username}
                        </span>
                        {isOwner && (
                          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                            You
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {new Date(rev.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {rev.score !== null && (
                    <div className="inline-flex items-center gap-1 rounded-xl border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-300">
                      <Star className="h-3.5 w-3.5 fill-amber-300" />
                      <span>{rev.score} / 10</span>
                    </div>
                  )}
                </div>

                {rev.title && (
                  <h4 className="mt-3 text-sm font-bold text-white">{rev.title}</h4>
                )}
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-200">
                  {rev.body}
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
                  <ReactionBar
                    targetType="review"
                    targetId={rev.id}
                    initialReactions={rev.reactions}
                    isAuthenticated={Boolean(currentUserId)}
                    compact
                  />

                  <div className="flex items-center gap-2">
                    {isOwner ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setReviewTitle(rev.title ?? "");
                            setReviewBody(rev.body);
                            setReviewScore(rev.score ?? "");
                            setIsComposerOpen(true);
                          }}
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteOwnReview(rev.id)}
                          className="text-[11px] font-semibold text-rose-300 hover:underline"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      currentUserId && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setReportTarget({
                                id: rev.id,
                                label: `review by @${rev.author.username}`,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1 text-[11px] font-semibold text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
                          >
                            <Flag className="h-3 w-3" />
                            <span>Report</span>
                          </button>
                          <BlockUserButton
                            targetUserId={rev.userId}
                            targetUsername={rev.author.username}
                            compact
                            onBlockedChange={() => void loadData(sortBy, 1, false)}
                          />
                        </>
                      )
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {hasMore && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={handleLoadMore}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-bold text-white hover:bg-white/[0.08]"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                <span>
                  Load More Reviews ({reviews.length} of {totalReviews})
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {reportTarget && (
        <ReportContentModal
          isOpen={true}
          onClose={() => setReportTarget(null)}
          contentType="review"
          contentId={reportTarget.id}
          contentLabel={reportTarget.label}
        />
      )}
    </section>
  );
}
