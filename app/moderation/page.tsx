import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  ModerationClient,
  type ModerationLogItem,
  type ModerationReportItem,
  type ModerationRestrictionItem,
  type ModerationUserRoleItem,
} from "./moderation-client";
import type { ReportCategory, ReportContentType } from "@/lib/actions/communityActions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Moderation Dashboard | NAYOZU",
  description: "Moderator and administrator safety dashboard for Nayozu.",
};

export default async function ModerationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/moderation");
  }

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const viewerRole = roleRow?.role;
  if (viewerRole !== "moderator" && viewerRole !== "admin") {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
          <Lock className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold text-white">
          Moderator Access Required
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          This area is restricted to Nayozu moderators and administrators. Your account currently has the standard <code>user</code> role.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white hover:bg-primary/90"
          >
            Return Home
          </Link>
          <Link
            href="/community"
            className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            Community Hub
          </Link>
        </div>
      </div>
    );
  }

  const [
    { data: reportsData },
    { data: restrictionsData },
    { data: logsData },
    { data: profilesData },
    { data: rolesData },
  ] = await Promise.all([
    supabase
      .from("content_reports")
      .select(
        "id, reporter_id, content_type, content_id, category, reason, explanation, status, resolution_notes, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("user_restrictions")
      .select(
        "id, user_id, restriction_type, status, reason, restricted_until, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("moderation_logs")
      .select(
        "id, actor_id, action_type, target_type, target_id, reason, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("profiles")
      .select("id, username, display_name")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("user_roles").select("user_id, role"),
  ]);

  const profileMap = new Map<
    string,
    { username: string; display_name: string | null }
  >();
  for (const p of profilesData ?? []) {
    profileMap.set(p.id, {
      username: p.username,
      display_name: p.display_name ?? null,
    });
  }

  const roleMap = new Map<string, "user" | "moderator" | "admin">();
  for (const r of rolesData ?? []) {
    if (r.role === "admin" || r.role === "moderator") {
      roleMap.set(r.user_id, r.role);
    }
  }

  // Enrich reports with content preview and author info
  const reports: ModerationReportItem[] = [];
  for (const rep of reportsData ?? []) {
    let preview = "[Content deleted or unavailable]";
    let authorId: string | null = null;
    let isHidden = false;
    let isLocked = false;

    if (rep.content_type === "review") {
      const { data: rev } = await supabase
        .from("anime_reviews")
        .select("user_id, title, body, is_hidden")
        .eq("id", rep.content_id)
        .maybeSingle();
      if (rev) {
        authorId = rev.user_id;
        preview = rev.title ? `${rev.title}: ${rev.body}` : rev.body;
        isHidden = Boolean(rev.is_hidden);
      }
    } else if (rep.content_type === "discussion") {
      const { data: disc } = await supabase
        .from("discussions")
        .select("user_id, title, body, is_hidden, is_locked")
        .eq("id", rep.content_id)
        .maybeSingle();
      if (disc) {
        authorId = disc.user_id;
        preview = `${disc.title} — ${disc.body}`;
        isHidden = Boolean(disc.is_hidden);
        isLocked = Boolean(disc.is_locked);
      }
    } else if (rep.content_type === "discussion_reply") {
      const { data: drep } = await supabase
        .from("discussion_replies")
        .select("user_id, body, is_hidden")
        .eq("id", rep.content_id)
        .maybeSingle();
      if (drep) {
        authorId = drep.user_id;
        preview = drep.body;
        isHidden = Boolean(drep.is_hidden);
      }
    } else if (rep.content_type === "comment") {
      const { data: com } = await supabase
        .from("anime_comments")
        .select("user_id, body, is_hidden")
        .eq("id", rep.content_id)
        .maybeSingle();
      if (com) {
        authorId = com.user_id;
        preview = com.body;
        isHidden = Boolean(com.is_hidden);
      }
    } else if (rep.content_type === "profile") {
      const prof = profileMap.get(rep.content_id);
      authorId = rep.content_id;
      preview = prof
        ? `User profile @${prof.username} (${prof.display_name || "No display name"})`
        : `User profile ID ${rep.content_id}`;
    }

    const reporterProf = profileMap.get(rep.reporter_id);
    const authorProf = authorId ? profileMap.get(authorId) : undefined;

    reports.push({
      id: rep.id,
      contentType: rep.content_type as ReportContentType,
      contentId: rep.content_id,
      category: (rep.category || "other") as ReportCategory,
      reason: rep.reason,
      explanation: rep.explanation ?? null,
      status: rep.status as "pending" | "reviewing" | "resolved" | "dismissed",
      resolutionNotes: rep.resolution_notes ?? null,
      createdAt: rep.created_at,
      reporter: {
        id: rep.reporter_id,
        username:
          reporterProf?.username || `user_${rep.reporter_id.slice(0, 6)}`,
      },
      targetAuthor: {
        id: authorId,
        username:
          authorProf?.username ||
          (authorId ? `user_${authorId.slice(0, 6)}` : "unknown"),
      },
      contentPreview: preview.slice(0, 500),
      isHidden,
      isLocked,
    });
  }

  const restrictions: ModerationRestrictionItem[] = (
    restrictionsData ?? []
  ).map((r) => ({
    id: r.id,
    userId: r.user_id,
    username:
      profileMap.get(r.user_id)?.username || `user_${r.user_id.slice(0, 6)}`,
    restrictionType:
      (r.restriction_type as
        | "warning"
        | "temporary_suspension"
        | "permanent_suspension") || "warning",
    status: (r.status as "active" | "expired" | "revoked") || "active",
    reason: r.reason,
    restrictedUntil: r.restricted_until ?? null,
    createdAt: r.created_at,
  }));

  const logs: ModerationLogItem[] = (logsData ?? []).map((l) => ({
    id: l.id,
    moderatorUsername:
      profileMap.get(l.actor_id)?.username ||
      `mod_${l.actor_id.slice(0, 6)}`,
    action: l.action_type,
    targetType: l.target_type,
    targetId: l.target_id,
    reason: l.reason ?? null,
    createdAt: l.created_at,
  }));

  const users: ModerationUserRoleItem[] = (profilesData ?? []).map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.display_name ?? null,
    role: roleMap.get(p.id) ?? "user",
  }));

  return (
    <ModerationClient
      viewerRole={viewerRole}
      initialReports={reports}
      initialRestrictions={restrictions}
      initialLogs={logs}
      initialUsers={users}
    />
  );
}
