"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Lock,
  Calendar,
  BookOpen,
  MessageSquare,
  Flag,
  Settings,
  Star,
  Shield,
} from "lucide-react";
import {
  BlockUserButton,
  ReportContentModal,
} from "@/components/community-action-modals";

export interface PublicProfileContribution {
  id: string;
  kind: "review" | "discussion" | "question";
  title: string | null;
  body: string;
  mediaTitle: string | null;
  mediaSlug: string | null;
  mediaType: "anime" | "manga" | null;
  score?: number | null;
  createdAt: string;
}

export function PublicProfileClient({
  profile,
  contributions,
  currentUserId,
  initialBlocked,
}: {
  profile: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    profileVisibility: "public" | "private";
    createdAt: string | null;
    isOwner: boolean;
  };
  contributions: PublicProfileContribution[];
  currentUserId: string | null;
  initialBlocked: boolean;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"reviews" | "discussions">("reviews");

  const isPrivateToViewer =
    profile.profileVisibility === "private" && !profile.isOwner;

  const reviews = contributions.filter((c) => c.kind === "review");
  const discussions = contributions.filter((c) => c.kind !== "review");

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      {/* Profile Header Card */}
      <section className="rounded-3xl border border-white/10 bg-[#10131c] p-6 md:p-8 shadow-xl">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-primary/40 bg-primary/15 text-2xl font-black uppercase text-white">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt={profile.username}
                  className="h-full w-full object-cover"
                />
              ) : (
                profile.username.slice(0, 2)
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold text-white">
                  {profile.displayName || profile.username}
                </h1>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                  @{profile.username}
                </span>
                {profile.profileVisibility === "private" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                    <Lock className="h-3 w-3" />
                    Private Profile
                  </span>
                )}
              </div>

              {!isPrivateToViewer && profile.bio && (
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
                  {profile.bio}
                </p>
              )}

              {!isPrivateToViewer && profile.createdAt && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  <span>
                    Joined {new Date(profile.createdAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {profile.isOwner ? (
              <>
                <Link
                  href="/profile"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90"
                >
                  <span>My Profile Dashboard</span>
                </Link>
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>Privacy Settings</span>
                </Link>
              </>
            ) : (
              currentUserId && (
                <>
                  <BlockUserButton
                    targetUserId={profile.id}
                    targetUsername={profile.username}
                    initialBlocked={initialBlocked}
                  />
                  <button
                    type="button"
                    onClick={() => setReportOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-rose-500/40 hover:text-rose-300"
                  >
                    <Flag className="h-3.5 w-3.5" />
                    <span>Report Profile</span>
                  </button>
                </>
              )
            )}
          </div>
        </div>
      </section>

      {/* Private Profile Notice */}
      {isPrivateToViewer ? (
        <section className="rounded-3xl border border-amber-500/25 bg-[#10131c] p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-white">
            This Profile is Private
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-400">
            @{profile.username} has set their profile visibility to Private. Personal profile details and activity are hidden. Public community reviews and discussions remain accessible below.
          </p>
        </section>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-xs text-slate-300">
          <Shield className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            Personal watchlists, reading lists, watch history, and favorites are strictly private to the account owner.
          </span>
        </div>
      )}

      {/* Public Contributions (Reviews & Discussions remain public independently of profile visibility) */}
      <section className="space-y-4 rounded-3xl border border-white/10 bg-[#10131c] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("reviews")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "reviews"
                  ? "bg-primary text-white"
                  : "border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white"
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Public Reviews ({reviews.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("discussions")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "discussions"
                  ? "bg-primary text-white"
                  : "border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Public Discussions ({discussions.length})</span>
            </button>
          </div>
        </div>

        {activeTab === "reviews" ? (
          reviews.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No public reviews published by @{profile.username} yet.
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((rev) => (
                <article
                  key={rev.id}
                  className="rounded-2xl border border-white/10 bg-[#141824] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {rev.mediaTitle &&
                        (rev.mediaSlug && rev.mediaType ? (
                          <Link
                            href={`/${rev.mediaType}/${rev.mediaSlug}`}
                            className="rounded-lg bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary hover:underline"
                          >
                            {rev.mediaTitle}
                          </Link>
                        ) : (
                          <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300">
                            {rev.mediaTitle}
                          </span>
                        ))}
                      <span className="text-[11px] text-slate-400">
                        {new Date(rev.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    {rev.score !== null && rev.score !== undefined && (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-xs font-bold text-amber-300">
                        <Star className="h-3 w-3 fill-amber-300" />
                        {rev.score} / 10
                      </span>
                    )}
                  </div>
                  {rev.title && (
                    <h3 className="mt-2 text-sm font-bold text-white">
                      {rev.title}
                    </h3>
                  )}
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                    {rev.body}
                  </p>
                </article>
              ))}
            </div>
          )
        ) : discussions.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            No public discussions started by @{profile.username} yet.
          </div>
        ) : (
          <div className="space-y-3">
            {discussions.map((disc) => (
              <article
                key={disc.id}
                className="rounded-2xl border border-white/10 bg-[#141824] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-lg bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold uppercase text-primary">
                    {disc.kind}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {new Date(disc.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {disc.title && (
                  <h3 className="mt-2 text-sm font-bold text-white">
                    {disc.title}
                  </h3>
                )}
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                  {disc.body}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <ReportContentModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        contentType="profile"
        contentId={profile.id}
        contentLabel={`profile @${profile.username}`}
      />
    </div>
  );
}
