"use client";

import { useState, useTransition } from "react";
import {
  ThumbsUp,
  Sparkles,
  Flame,
  Flag,
  Ban,
  X,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  toggleReactionAction,
  submitContentReportAction,
  blockUserAction,
  unblockUserAction,
  type ReactionSummary,
  type ReactionTargetType,
  type ReactionType,
  type ReportCategory,
  type ReportContentType,
} from "@/lib/actions/communityActions";

const REPORT_CATEGORIES: Array<{ value: ReportCategory; label: string; desc: string }> = [
  { value: "spam", label: "Spam", desc: "Repetitive, promotional, or bot content" },
  { value: "harassment", label: "Harassment", desc: "Targeted bullying, insults, or threats" },
  { value: "hate_speech", label: "Hate speech", desc: "Attacks against protected groups" },
  { value: "sexual_content", label: "Sexual or inappropriate content", desc: "NSFW or explicit material" },
  { value: "spoilers", label: "Spoilers without warning", desc: "Unmarked plot spoilers" },
  { value: "misinformation", label: "Misinformation", desc: "Deliberately false or misleading info" },
  { value: "other", label: "Other", desc: "Violates community guidelines in another way" },
];

export function ReactionBar({
  targetType,
  targetId,
  initialReactions,
  isAuthenticated,
  compact = false,
  onAuthRequired,
}: {
  targetType: ReactionTargetType;
  targetId: string;
  initialReactions: ReactionSummary;
  isAuthenticated: boolean;
  compact?: boolean;
  onAuthRequired?: () => void;
}) {
  const [reactions, setReactions] = useState<ReactionSummary>(initialReactions);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleToggle = (type: ReactionType) => {
    setErrorMsg(null);
    if (!isAuthenticated) {
      if (onAuthRequired) onAuthRequired();
      else setErrorMsg("Sign in to react");
      return;
    }

    startTransition(async () => {
      const res = await toggleReactionAction({
        targetType,
        targetId,
        reactionType: type,
      });
      if (!res.success) {
        setErrorMsg(res.error || "Could not react");
      } else if (res.reactions) {
        setReactions(res.reactions);
      }
    });
  };

  const items: Array<{
    type: ReactionType;
    label: string;
    icon: typeof ThumbsUp;
    count: number;
  }> = [
    { type: "like", label: "Like", icon: ThumbsUp, count: reactions.like },
    { type: "helpful", label: "Helpful", icon: Sparkles, count: reactions.helpful },
    { type: "fire", label: "Fire", icon: Flame, count: reactions.fire },
  ];

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = reactions.userReaction === item.type;
        return (
          <button
            key={item.type}
            type="button"
            disabled={isPending}
            onClick={() => handleToggle(item.type)}
            title={`${item.label} (${item.count})`}
            className={`inline-flex items-center gap-1.5 rounded-full border transition ${
              compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
            } font-semibold ${
              active
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white"
            } disabled:opacity-50`}
          >
            <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            <span>{item.label}</span>
            {item.count > 0 && (
              <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px]">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
      {errorMsg && (
        <span className="text-[11px] font-medium text-amber-300">{errorMsg}</span>
      )}
    </div>
  );
}

export function ReportContentModal({
  isOpen,
  onClose,
  contentType,
  contentId,
  contentLabel,
}: {
  isOpen: boolean;
  onClose: () => void;
  contentType: ReportContentType;
  contentId: string;
  contentLabel?: string;
}) {
  const [category, setCategory] = useState<ReportCategory>("spam");
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await submitContentReportAction({
        contentType,
        contentId,
        category,
        explanation,
      });
      if (!res.success) {
        setError(res.error || "Failed to submit report.");
        return;
      }
      setSubmitted(true);
    });
  };

  const resetAndClose = () => {
    setSubmitted(false);
    setError(null);
    setExplanation("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Report content"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#10131c] p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-rose-400" />
            <h3 className="text-base font-bold text-white">
              Report {contentLabel || contentType.replace("_", " ")}
            </h3>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {submitted ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
            <h4 className="mt-3 text-sm font-bold text-white">Report Submitted</h4>
            <p className="mt-1 text-xs text-slate-400">
              Thank you for keeping Nayozu safe. Our moderation team will review this report shortly.
            </p>
            <button
              type="button"
              onClick={resetAndClose}
              className="mt-5 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-white hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Reason for report
              </label>
              <div className="mt-2 space-y-1.5">
                {REPORT_CATEGORIES.map((cat) => (
                  <label
                    key={cat.value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-left transition ${
                      category === cat.value
                        ? "border-primary/50 bg-primary/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <input
                      type="radio"
                      name="reportCategory"
                      value={cat.value}
                      checked={category === cat.value}
                      onChange={() => setCategory(cat.value)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <p className="text-xs font-semibold text-white">{cat.label}</p>
                      <p className="text-[11px] text-slate-400">{cat.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Additional Context (Optional)
              </label>
              <textarea
                rows={3}
                maxLength={1000}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder="Provide any relevant details for moderators..."
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={resetAndClose}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {isPending ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function BlockUserButton({
  targetUserId,
  targetUsername,
  initialBlocked = false,
  onBlockedChange,
  compact = false,
}: {
  targetUserId: string;
  targetUsername: string;
  initialBlocked?: boolean;
  onBlockedChange?: (blocked: boolean) => void;
  compact?: boolean;
}) {
  const [blocked, setBlocked] = useState(initialBlocked);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleToggleBlock = () => {
    setError(null);
    startTransition(async () => {
      if (blocked) {
        const res = await unblockUserAction({ blockedUserId: targetUserId });
        if (!res.success) {
          setError(res.error || "Failed to unblock");
          return;
        }
        setBlocked(false);
        onBlockedChange?.(false);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("nayozu:friends-updated"));
        }
      } else {
        const res = await blockUserAction({ blockedUserId: targetUserId });
        if (!res.success) {
          setError(res.error || "Failed to block");
          return;
        }
        setBlocked(true);
        onBlockedChange?.(true);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("nayozu:friends-updated"));
        }
      }
    });
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={isPending}
        onClick={handleToggleBlock}
        title={blocked ? `Unblock @${targetUsername}` : `Block @${targetUsername}`}
        className={`inline-flex items-center gap-1 rounded-lg border font-semibold transition ${
          compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
        } ${
          blocked
            ? "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
            : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
        } disabled:opacity-50`}
      >
        <Ban className="h-3 w-3" />
        <span>{isPending ? "..." : blocked ? "Blocked" : "Block User"}</span>
      </button>
      {error && <span className="text-[11px] text-rose-300">{error}</span>}
    </div>
  );
}
