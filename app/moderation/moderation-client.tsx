"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldAlert,
  Flag,
  Ban,
  History,
  Users,
  EyeOff,
  Eye,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  resolveReportAction,
  moderateContentAction,
  issueUserRestrictionAction,
  revokeUserRestrictionAction,
  manageUserRoleAction,
  type ReportCategory,
  type ReportContentType,
} from "@/lib/actions/communityActions";

export interface ModerationReportItem {
  id: string;
  contentType: ReportContentType;
  contentId: string;
  category: ReportCategory;
  reason: string;
  explanation: string | null;
  status: "pending" | "reviewing" | "resolved" | "dismissed";
  resolutionNotes: string | null;
  createdAt: string;
  reporter: {
    id: string;
    username: string;
  };
  targetAuthor: {
    id: string | null;
    username: string;
  };
  contentPreview: string;
  isHidden: boolean;
  isLocked: boolean;
}

export interface ModerationRestrictionItem {
  id: string;
  userId: string;
  username: string;
  restrictionType: "warning" | "temporary_suspension" | "permanent_suspension";
  status: "active" | "expired" | "revoked";
  reason: string;
  restrictedUntil: string | null;
  createdAt: string;
}

export interface ModerationLogItem {
  id: string;
  moderatorUsername: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string;
}

export interface ModerationUserRoleItem {
  id: string;
  username: string;
  displayName: string | null;
  role: "user" | "moderator" | "admin";
}

export function ModerationClient({
  viewerRole,
  initialReports,
  initialRestrictions,
  initialLogs,
  initialUsers,
}: {
  viewerRole: "moderator" | "admin";
  initialReports: ModerationReportItem[];
  initialRestrictions: ModerationRestrictionItem[];
  initialLogs: ModerationLogItem[];
  initialUsers: ModerationUserRoleItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [activeTab, setActiveTab] = useState<
    "reports" | "restrictions" | "logs" | "roles"
  >("reports");

  // Filters for reports
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [sortDate, setSortDate] = useState<"newest" | "oldest">("newest");

  const [notesByReport, setNotesByReport] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Restriction form state
  const [targetUserId, setTargetUserId] = useState("");
  const [restrictionType, setRestrictionType] = useState<
    "warning" | "temporary_suspension" | "permanent_suspension"
  >("warning");
  const [durationHours, setDurationHours] = useState(24);
  const [restrictionReason, setRestrictionReason] = useState("");

  const filteredReports = useMemo(() => {
    return initialReports
      .filter((r) => {
        if (filterStatus !== "all" && r.status !== filterStatus) return false;
        if (filterCategory !== "all" && r.category !== filterCategory)
          return false;
        if (filterType !== "all" && r.contentType !== filterType) return false;
        return true;
      })
      .sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        return sortDate === "oldest" ? ta - tb : tb - ta;
      });
  }, [initialReports, filterStatus, filterCategory, filterType, sortDate]);

  const handleResolveReport = (
    reportId: string,
    status: "reviewing" | "resolved" | "dismissed"
  ) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await resolveReportAction({
        reportId,
        status,
        resolutionNotes: notesByReport[reportId] ?? "",
      });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Failed to update report.",
        });
        return;
      }
      setFeedback({
        type: "success",
        text: `Report marked as ${status}.`,
      });
      router.refresh();
    });
  };

  const handleModerateContent = (
    targetType: "review" | "discussion" | "discussion_reply" | "comment",
    targetId: string,
    action: "hide" | "restore" | "lock" | "unlock"
  ) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await moderateContentAction({
        targetType,
        targetId,
        action,
      });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Moderation action failed.",
        });
        return;
      }
      setFeedback({
        type: "success",
        text: `Successfully executed '${action}' on ${targetType}.`,
      });
      router.refresh();
    });
  };

  const handleIssueRestriction = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const res = await issueUserRestrictionAction({
        targetUserId,
        restrictionType,
        reason: restrictionReason,
        durationHours:
          restrictionType === "temporary_suspension" ? durationHours : null,
      });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Failed to issue restriction.",
        });
        return;
      }
      setRestrictionReason("");
      setFeedback({
        type: "success",
        text: "User restriction issued and logged.",
      });
      router.refresh();
    });
  };

  const handleRevokeRestriction = (restrictionId: string) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await revokeUserRestrictionAction({ restrictionId });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Failed to revoke restriction.",
        });
        return;
      }
      setFeedback({
        type: "success",
        text: "Restriction has been revoked.",
      });
      router.refresh();
    });
  };

  const handleRoleChange = (
    userId: string,
    role: "user" | "moderator" | "admin"
  ) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await manageUserRoleAction({ targetUserId: userId, role });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Failed to update role.",
        });
        return;
      }
      setFeedback({
        type: "success",
        text: `Role updated to ${role}.`,
      });
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* Header */}
      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#14192a] via-[#10131c] to-[#0b0e17] p-6 md:p-8 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>Nayozu Safety & Moderation ({viewerRole})</span>
            </div>
            <h1 className="mt-2 text-2xl md:text-3xl font-extrabold text-white">
              Moderation Dashboard
            </h1>
            <p className="mt-1 text-xs md:text-sm text-slate-400">
              Review user reports, hide or restore content, lock discussions, manage user restrictions, and audit moderation logs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("reports")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "reports"
                  ? "bg-primary text-white"
                  : "border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white"
              }`}
            >
              <Flag className="h-3.5 w-3.5" />
              <span>Reports ({initialReports.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("restrictions")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "restrictions"
                  ? "bg-primary text-white"
                  : "border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white"
              }`}
            >
              <Ban className="h-3.5 w-3.5" />
              <span>Restrictions ({initialRestrictions.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "logs"
                  ? "bg-primary text-white"
                  : "border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white"
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>Audit Logs ({initialLogs.length})</span>
            </button>
            {viewerRole === "admin" && (
              <button
                type="button"
                onClick={() => setActiveTab("roles")}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                  activeTab === "roles"
                    ? "bg-primary text-white"
                    : "border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white"
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Manage Roles</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {feedback && (
        <div
          className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-xs font-medium ${
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/10 text-rose-200"
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: REPORTS QUEUE */}
      {activeTab === "reports" && (
        <section className="space-y-4 rounded-3xl border border-white/10 bg-[#10131c] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <h2 className="text-base font-bold text-white">
              Submitted Reports ({filteredReports.length})
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-xl border border-white/10 bg-[#151a28] px-3 py-1.5 text-xs text-white"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="reviewing">Reviewing</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
              </select>

              <select
                aria-label="Filter by category"
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="rounded-xl border border-white/10 bg-[#151a28] px-3 py-1.5 text-xs text-white"
              >
                <option value="all">All Categories</option>
                <option value="spam">Spam</option>
                <option value="harassment">Harassment</option>
                <option value="hate_speech">Hate speech</option>
                <option value="sexual_content">Sexual content</option>
                <option value="spoilers">Spoilers</option>
                <option value="misinformation">Misinformation</option>
                <option value="other">Other</option>
              </select>

              <select
                aria-label="Filter by content type"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="rounded-xl border border-white/10 bg-[#151a28] px-3 py-1.5 text-xs text-white"
              >
                <option value="all">All Content Types</option>
                <option value="review">Reviews</option>
                <option value="discussion">Discussions</option>
                <option value="discussion_reply">Discussion Replies</option>
                <option value="comment">Comments</option>
                <option value="profile">Profiles</option>
              </select>

              <select
                aria-label="Sort by date"
                value={sortDate}
                onChange={(e) =>
                  setSortDate(e.target.value as "newest" | "oldest")
                }
                className="rounded-xl border border-white/10 bg-[#151a28] px-3 py-1.5 text-xs text-white"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>
          </div>

          {filteredReports.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              No reports match the current filters.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredReports.map((rep) => (
                <article
                  key={rep.id}
                  className="rounded-2xl border border-white/10 bg-[#141824] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase text-rose-300">
                        {rep.category.replace("_", " ")}
                      </span>
                      <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-slate-300">
                        {rep.contentType.replace("_", " ")}
                      </span>
                      <span
                        className={`rounded-lg px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                          rep.status === "resolved"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : rep.status === "dismissed"
                              ? "bg-slate-500/20 text-slate-300"
                              : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {rep.status}
                      </span>
                      {rep.isHidden && (
                        <span className="rounded-lg bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-200">
                          Hidden / Removed
                        </span>
                      )}
                      {rep.isLocked && (
                        <span className="rounded-lg bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                          Locked
                        </span>
                      )}
                    </div>

                    <span className="text-[11px] text-slate-400">
                      Reported {new Date(rep.createdAt).toLocaleString()} by{" "}
                      <Link
                        href={`/u/${encodeURIComponent(rep.reporter.username)}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        @{rep.reporter.username}
                      </Link>
                    </span>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-black/30 p-3 text-xs text-slate-200">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                      <span>
                        Author:{" "}
                        <Link
                          href={`/u/${encodeURIComponent(rep.targetAuthor.username)}`}
                          className="font-bold text-white hover:text-primary"
                        >
                          @{rep.targetAuthor.username}
                        </Link>
                      </span>
                      <span>ID: {rep.contentId.slice(0, 10)}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{rep.contentPreview}</p>
                    {rep.explanation && (
                      <p className="mt-2 border-t border-white/10 pt-2 text-[11px] text-amber-200">
                        <strong>Reporter note:</strong> {rep.explanation}
                      </p>
                    )}
                  </div>

                  {/* Content Enforcement + Report Status Controls */}
                  <div className="flex flex-col gap-3 pt-1 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      {rep.contentType !== "profile" && (
                        <>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              handleModerateContent(
                                rep.contentType as
                                  | "review"
                                  | "discussion"
                                  | "discussion_reply"
                                  | "comment",
                                rep.contentId,
                                rep.isHidden ? "restore" : "hide"
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                          >
                            {rep.isHidden ? (
                              <>
                                <Eye className="h-3.5 w-3.5 text-emerald-400" />
                                <span>Restore Content</span>
                              </>
                            ) : (
                              <>
                                <EyeOff className="h-3.5 w-3.5 text-rose-400" />
                                <span>Remove / Hide Content</span>
                              </>
                            )}
                          </button>

                          {rep.contentType === "discussion" && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() =>
                                handleModerateContent(
                                  "discussion",
                                  rep.contentId,
                                  rep.isLocked ? "unlock" : "lock"
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/20"
                            >
                              {rep.isLocked ? (
                                <>
                                  <Unlock className="h-3.5 w-3.5" />
                                  <span>Unlock Discussion</span>
                                </>
                              ) : (
                                <>
                                  <Lock className="h-3.5 w-3.5" />
                                  <span>Lock Discussion</span>
                                </>
                              )}
                            </button>
                          )}
                        </>
                      )}

                      {rep.targetAuthor.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setTargetUserId(rep.targetAuthor.id!);
                            setRestrictionReason(
                              `Report #${rep.id.slice(0, 6)} (${rep.category})`
                            );
                            setActiveTab("restrictions");
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          <span>Restrict User</span>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        placeholder="Resolution notes..."
                        value={notesByReport[rep.id] ?? rep.resolutionNotes ?? ""}
                        onChange={(e) =>
                          setNotesByReport((prev) => ({
                            ...prev,
                            [rep.id]: e.target.value,
                          }))
                        }
                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-slate-500"
                      />
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleResolveReport(rep.id, "reviewing")}
                        className="inline-flex items-center gap-1 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200"
                      >
                        <Clock className="h-3.5 w-3.5" />
                        <span>Reviewing</span>
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleResolveReport(rep.id, "resolved")}
                        className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Resolve</span>
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleResolveReport(rep.id, "dismissed")}
                        className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Dismiss</span>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: USER RESTRICTIONS */}
      {activeTab === "restrictions" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <form
            onSubmit={handleIssueRestriction}
            className="space-y-4 rounded-3xl border border-white/10 bg-[#10131c] p-5 h-fit"
          >
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h2 className="text-base font-bold text-white">
                Issue User Restriction
              </h2>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Select User
              </label>
              <select
                required
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#151a28] px-3 py-2 text-xs text-white"
              >
                <option value="">Choose a user...</option>
                {initialUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    @{u.username} ({u.role})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Restriction Type
              </label>
              <select
                value={restrictionType}
                onChange={(e) =>
                  setRestrictionType(
                    e.target.value as
                      | "warning"
                      | "temporary_suspension"
                      | "permanent_suspension"
                  )
                }
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#151a28] px-3 py-2 text-xs text-white"
              >
                <option value="warning">Warning (Logged on account)</option>
                <option value="temporary_suspension">
                  Temporary Posting Suspension
                </option>
                <option value="permanent_suspension">
                  Permanent Posting Suspension
                </option>
              </select>
            </div>

            {restrictionType === "temporary_suspension" && (
              <div>
                <label className="block text-xs font-semibold text-slate-300">
                  Duration (Hours)
                </label>
                <input
                  type="number"
                  min={1}
                  max={8760}
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#151a28] px-3 py-2 text-xs text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Reason
              </label>
              <textarea
                rows={3}
                required
                value={restrictionReason}
                onChange={(e) => setRestrictionReason(e.target.value)}
                placeholder="Explain the policy violation..."
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#151a28] px-3 py-2 text-xs text-white"
              />
            </div>

            <button
              type="submit"
              disabled={isPending || !targetUserId}
              className="w-full rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {isPending ? "Applying..." : "Apply Restriction"}
            </button>
          </form>

          <section className="space-y-3 rounded-3xl border border-white/10 bg-[#10131c] p-5">
            <h2 className="text-base font-bold text-white border-b border-white/10 pb-3">
              User Restrictions History ({initialRestrictions.length})
            </h2>

            {initialRestrictions.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No user restrictions have been issued.
              </p>
            ) : (
              <div className="space-y-2.5">
                {initialRestrictions.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#141824] p-4"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/u/${encodeURIComponent(r.username)}`}
                          className="text-xs font-bold text-white hover:text-primary"
                        >
                          @{r.username}
                        </Link>
                        <span className="rounded-lg bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-300">
                          {r.restrictionType.replace("_", " ")}
                        </span>
                        <span
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase ${
                            r.status === "active"
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-slate-500/20 text-slate-400"
                          }`}
                        >
                          {r.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-300">{r.reason}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Issued {new Date(r.createdAt).toLocaleString()}
                        {r.restrictedUntil
                          ? ` · Expires ${new Date(r.restrictedUntil).toLocaleString()}`
                          : ""}
                      </p>
                    </div>

                    {r.status === "active" && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleRevokeRestriction(r.id)}
                        className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 3: MODERATION LOGS */}
      {activeTab === "logs" && (
        <section className="space-y-4 rounded-3xl border border-white/10 bg-[#10131c] p-6">
          <h2 className="text-base font-bold text-white border-b border-white/10 pb-3">
            Moderation Audit Log ({initialLogs.length})
          </h2>

          {initialLogs.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              No moderation actions recorded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {initialLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#141824] px-4 py-3 text-xs"
                >
                  <div>
                    <span className="font-bold text-primary">
                      @{log.moderatorUsername}
                    </span>{" "}
                    <span className="text-slate-300">performed</span>{" "}
                    <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white">
                      {log.action}
                    </span>{" "}
                    <span className="text-slate-400">
                      on {log.targetType} ({log.targetId.slice(0, 8)})
                    </span>
                    {log.reason && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Reason: {log.reason}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 4: ROLE MANAGEMENT (ADMIN ONLY) */}
      {activeTab === "roles" && viewerRole === "admin" && (
        <section className="space-y-4 rounded-3xl border border-white/10 bg-[#10131c] p-6">
          <div>
            <h2 className="text-base font-bold text-white">
              Administrator Role Management
            </h2>
            <p className="text-xs text-slate-400">
              Assign or revoke Moderator and Administrator roles in{" "}
              <code>public.user_roles</code>.
            </p>
          </div>

          <div className="space-y-2">
            {initialUsers.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#141824] px-4 py-3"
              >
                <div>
                  <p className="text-xs font-bold text-white">
                    {u.displayName || `@${u.username}`}{" "}
                    <span className="text-slate-400">(@{u.username})</span>
                  </p>
                  <p className="text-[11px] text-slate-500">ID: {u.id}</p>
                </div>

                <div className="flex items-center gap-2">
                  {(["user", "moderator", "admin"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={isPending || u.role === r}
                      onClick={() => handleRoleChange(u.id, r)}
                      className={`rounded-lg px-3 py-1 text-xs font-bold uppercase transition ${
                        u.role === r
                          ? "bg-primary text-white"
                          : "border border-white/10 bg-white/5 text-slate-400 hover:text-white"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
