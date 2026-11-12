"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Send,
  Reply,
  Edit3,
  Trash2,
  Flag,
  Eye,
  EyeOff,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import {
  fetchMediaCommentsAction,
  createMediaCommentAction,
  updateMediaCommentAction,
  deleteMediaCommentAction,
  type MediaCommentDTO,
  type MediaType,
} from "@/lib/actions/communityActions";
import {
  ReactionBar,
  ReportContentModal,
  BlockUserButton,
} from "@/components/community-action-modals";

export function CommentList({
  animeId,
  mediaType = "anime",
  episodeNumber = null,
  chapterNumber = null,
  contextLabel,
}: {
  animeId: string;
  mediaType?: MediaType;
  episodeNumber?: number | null;
  chapterNumber?: number | null;
  contextLabel?: string;
}) {
  const [comments, setComments] = useState<MediaCommentDTO[]>([]);
  const [totalTopLevel, setTotalTopLevel] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [newBody, setNewBody] = useState("");
  const [newIsSpoiler, setNewIsSpoiler] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replySpoiler, setReplySpoiler] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSpoiler, setEditSpoiler] = useState(false);

  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
  const [reportTarget, setReportTarget] = useState<{ id: string; label: string } | null>(null);

  const [isPending, startTransition] = useTransition();

  const loadComments = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      const res = await fetchMediaCommentsAction({
        externalId: animeId,
        mediaType,
        episodeNumber,
        chapterNumber,
        page: targetPage,
        limit: 12,
      });
      setComments(res.comments);
      setTotalTopLevel(res.totalTopLevel);
      setHasMore(res.hasMore);
      setCurrentUserId(res.currentUserId);
      setLoading(false);
    },
    [animeId, mediaType, episodeNumber, chapterNumber]
  );

  useEffect(() => {
    setPage(1);
    void loadComments(1);
  }, [loadComments]);

  const handleCreateTopLevel = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const trimmed = newBody.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const res = await createMediaCommentAction({
        externalId: animeId,
        mediaType,
        episodeNumber,
        chapterNumber,
        parentCommentId: null,
        body: trimmed,
        isSpoiler: newIsSpoiler,
      });
      if (!res.success) {
        setErrorMsg(res.error || "Failed to post comment.");
        return;
      }
      setNewBody("");
      setNewIsSpoiler(false);
      await loadComments(page);
    });
  };

  const handleCreateReply = (parentId: string) => {
    setErrorMsg(null);
    const trimmed = replyBody.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const res = await createMediaCommentAction({
        externalId: animeId,
        mediaType,
        episodeNumber,
        chapterNumber,
        parentCommentId: parentId,
        body: trimmed,
        isSpoiler: replySpoiler,
      });
      if (!res.success) {
        setErrorMsg(res.error || "Failed to post reply.");
        return;
      }
      setReplyingToId(null);
      setReplyBody("");
      setReplySpoiler(false);
      await loadComments(page);
    });
  };

  const handleSaveEdit = (commentId: string) => {
    setErrorMsg(null);
    const trimmed = editBody.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const res = await updateMediaCommentAction({
        commentId,
        body: trimmed,
        isSpoiler: editSpoiler,
      });
      if (!res.success) {
        setErrorMsg(res.error || "Failed to update comment.");
        return;
      }
      setEditingId(null);
      setEditBody("");
      await loadComments(page);
    });
  };

  const handleDelete = (commentId: string) => {
    setErrorMsg(null);
    startTransition(async () => {
      const res = await deleteMediaCommentAction({ commentId });
      if (!res.success) {
        setErrorMsg(res.error || "Failed to delete comment.");
        return;
      }
      await loadComments(page);
    });
  };

  const renderCommentNode = (item: MediaCommentDTO, isReply = false) => {
    const isOwner = currentUserId === item.userId;
    const isEditing = editingId === item.id;
    const isReplying = replyingToId === item.id;
    const spoilerHidden = item.isSpoiler && !revealedSpoilers[item.id];

    return (
      <div
        key={item.id}
        className={`rounded-2xl border p-4 ${
          isReply
            ? "border-white/5 bg-black/25"
            : "border-white/10 bg-[#141824]"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Link
              href={`/u/${encodeURIComponent(item.author.username)}`}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-primary/20 text-[11px] font-bold uppercase text-white hover:border-primary"
            >
              {item.author.username.slice(0, 2)}
            </Link>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/u/${encodeURIComponent(item.author.username)}`}
                  className="text-xs font-bold text-white hover:text-primary"
                >
                  {item.author.displayName || `@${item.author.username}`}
                </Link>
                <span className="text-[11px] text-slate-500">
                  @{item.author.username}
                </span>
                {isOwner && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                    You
                  </span>
                )}
                {item.isSpoiler && (
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                    Spoiler
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                {new Date(item.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOwner ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(item.id);
                    setEditBody(item.body);
                    setEditSpoiler(item.isSpoiler);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-300 hover:text-primary"
                >
                  <Edit3 className="h-3 w-3" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(item.id)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300 hover:text-rose-200"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Delete</span>
                </button>
              </>
            ) : (
              currentUserId && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setReportTarget({
                        id: item.id,
                        label: `comment by @${item.author.username}`,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1 text-[11px] font-semibold text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
                  >
                    <Flag className="h-3 w-3" />
                    <span>Report</span>
                  </button>
                  <BlockUserButton
                    targetUserId={item.userId}
                    targetUsername={item.author.username}
                    compact
                    onBlockedChange={() => void loadComments(page)}
                  />
                </>
              )
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="mt-3 space-y-2 rounded-xl border border-primary/30 bg-black/30 p-3">
            <textarea
              rows={3}
              maxLength={2000}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#10131c] p-2.5 text-xs text-white focus:border-primary/50 focus:outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={editSpoiler}
                  onChange={(e) => setEditSpoiler(e.target.checked)}
                  className="accent-primary"
                />
                <span>Contains spoilers</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded-lg border border-white/10 px-3 py-1 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleSaveEdit(item.id)}
                  className="rounded-lg bg-primary px-3 py-1 text-xs font-bold text-white"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : spoilerHidden ? (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-400/20 bg-amber-400/5 px-3.5 py-2.5">
            <span className="text-xs text-amber-200/90">
              This comment is marked as containing spoilers.
            </span>
            <button
              type="button"
              onClick={() =>
                setRevealedSpoilers((prev) => ({ ...prev, [item.id]: true }))
              }
              className="inline-flex items-center gap-1 rounded-lg bg-amber-400/20 px-2.5 py-1 text-[11px] font-bold text-amber-200 hover:bg-amber-400/30"
            >
              <Eye className="h-3 w-3" />
              <span>Reveal Spoiler</span>
            </button>
          </div>
        ) : (
          <div className="mt-2.5">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200">
              {item.body}
            </p>
            {item.isSpoiler && (
              <button
                type="button"
                onClick={() =>
                  setRevealedSpoilers((prev) => ({ ...prev, [item.id]: false }))
                }
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:underline"
              >
                <EyeOff className="h-3 w-3" />
                <span>Hide spoiler</span>
              </button>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2.5">
          <ReactionBar
            targetType="comment"
            targetId={item.id}
            initialReactions={item.reactions}
            isAuthenticated={Boolean(currentUserId)}
            compact
          />

          {!isReply && currentUserId && (
            <button
              type="button"
              onClick={() => {
                setReplyingToId(isReplying ? null : item.id);
                setReplyBody("");
                setReplySpoiler(false);
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-primary"
            >
              <Reply className="h-3.5 w-3.5" />
              <span>{isReplying ? "Cancel Reply" : "Reply"}</span>
            </button>
          )}
        </div>

        {isReplying && (
          <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
            <textarea
              rows={2}
              maxLength={2000}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder={`Reply to @${item.author.username}...`}
              className="w-full rounded-lg border border-white/10 bg-[#10131c] p-2.5 text-xs text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={replySpoiler}
                  onChange={(e) => setReplySpoiler(e.target.checked)}
                  className="accent-primary"
                />
                <span>Spoiler warning</span>
              </label>
              <button
                type="button"
                disabled={isPending || !replyBody.trim()}
                onClick={() => handleCreateReply(item.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                <span>Post Reply</span>
              </button>
            </div>
          </div>
        )}

        {item.replies.length > 0 && (
          <div className="mt-3 space-y-2 border-l-2 border-white/10 pl-3 md:pl-4">
            {item.replies.map((rep) => renderCommentNode(rep, true))}
          </div>
        )}
      </div>
    );
  };

  const defaultLabel =
    contextLabel ||
    (episodeNumber
      ? `Episode ${episodeNumber} Comments`
      : chapterNumber !== null && chapterNumber !== undefined
        ? `Chapter ${chapterNumber} Comments`
        : "Community Comments");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h3 className="text-base font-bold text-white">{defaultLabel}</h3>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-xs font-semibold text-slate-300">
            {totalTopLevel}
          </span>
        </div>
      </div>

      {/* Composer */}
      {currentUserId ? (
        <form
          onSubmit={handleCreateTopLevel}
          className="space-y-3 rounded-2xl border border-white/10 bg-[#141824] p-4"
        >
          <textarea
            rows={3}
            maxLength={2000}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder={
              episodeNumber
                ? `Share your thoughts on Episode ${episodeNumber}...`
                : chapterNumber !== null && chapterNumber !== undefined
                  ? `Share your thoughts on Chapter ${chapterNumber}...`
                  : "Join the conversation..."
            }
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-xs leading-relaxed text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={newIsSpoiler}
                onChange={(e) => setNewIsSpoiler(e.target.checked)}
                className="accent-primary"
              />
              <span>Mark as spoiler</span>
            </label>
            <button
              type="submit"
              disabled={isPending || !newBody.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white transition hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isPending ? "Posting..." : "Post Comment"}</span>
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#141824] px-4 py-3">
          <p className="text-xs text-slate-300">
            Sign in to post comments, reply to others, and react.
          </p>
          <Link
            href="/login"
            className="rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-white hover:bg-primary/90"
          >
            Sign In
          </Link>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center text-xs text-slate-400">
          Loading comments...
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-center">
          <p className="text-xs text-slate-400">
            No comments yet. Start the discussion above!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => renderCommentNode(c, false))}

          {hasMore && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  void loadComments(next);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-bold text-white hover:bg-white/[0.08]"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                <span>
                  Load More Comments ({comments.length} of {totalTopLevel})
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
          contentType="comment"
          contentId={reportTarget.id}
          contentLabel={reportTarget.label}
        />
      )}
    </div>
  );
}

export default CommentList;
