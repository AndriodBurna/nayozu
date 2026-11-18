import { createClient } from "@/lib/supabase/server";
import { getBlockedUsersAction } from "@/lib/actions/communityActions";
import SettingsClient from "./settings-client";
import type {
  AccentColorId,
  ProfileSettingsData,
  ThemeModeId,
  UserPreferences,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings | NAYOZU",
  description:
    "Manage your Nayozu profile, appearance, privacy, notifications, and account security.",
};

const VALID_ACCENTS: readonly AccentColorId[] = [
  "emerald",
  "blue",
  "purple",
  "pink",
  "amber",
  "red",
  "white",
];

const VALID_THEME_MODES: readonly ThemeModeId[] = ["dark", "light", "system"];

function extractPreferences(
  raw: unknown,
  profileRow?: Record<string, unknown> | null
): UserPreferences {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    accentColor: VALID_ACCENTS.includes(obj.accentColor as AccentColorId)
      ? (obj.accentColor as AccentColorId)
      : "purple",
    themeMode: VALID_THEME_MODES.includes(obj.themeMode as ThemeModeId)
      ? (obj.themeMode as ThemeModeId)
      : "dark",
    reducedMotion:
      typeof obj.reducedMotion === "boolean" ? obj.reducedMotion : false,
    defaultSpoilerProtection:
      typeof obj.defaultSpoilerProtection === "boolean"
        ? obj.defaultSpoilerProtection
        : true,
    showActivityInCommunity:
      typeof profileRow?.share_activity_with_friends === "boolean"
        ? profileRow.share_activity_with_friends
        : typeof obj.showActivityInCommunity === "boolean"
        ? obj.showActivityInCommunity
        : true,
    shareLibraryActivityWithFriends:
      typeof profileRow?.share_library_activity_with_friends === "boolean"
        ? profileRow.share_library_activity_with_friends
        : typeof obj.shareLibraryActivityWithFriends === "boolean"
        ? obj.shareLibraryActivityWithFriends
        : true,
    notifyEpisodeReleases:
      typeof obj.notifyEpisodeReleases === "boolean"
        ? obj.notifyEpisodeReleases
        : true,
    notifyCommunityReplies:
      typeof obj.notifyCommunityReplies === "boolean"
        ? obj.notifyCommunityReplies
        : true,
    notifyWatchTogetherInvites:
      typeof profileRow?.notify_watch_together_invites === "boolean"
        ? profileRow.notify_watch_together_invites
        : typeof obj.notifyWatchTogetherInvites === "boolean"
        ? obj.notifyWatchTogetherInvites
        : true,
  };
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <SettingsClient initialData={null} />;
  }

  const fallbackUsername =
    (user.user_metadata?.username as string | undefined) ||
    user.email?.split("@")[0]?.replace(/[^a-zA-Z0-9_-]/g, "_") ||
    `user_${user.id.slice(0, 8)}`;

  const [
    profileRes,
    roleRes,
    libCountRes,
    ratingsCountRes,
    reviewsCountRes,
    commentsCountRes,
    blockedRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_anime_library")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("anime_ratings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("anime_reviews")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("anime_comments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    getBlockedUsersAction(),
  ]);

  const profileRow = profileRes.data;
  const preferences = extractPreferences(
    user.user_metadata?.preferences,
    profileRow
  );

  const initialData: ProfileSettingsData = {
    id: user.id,
    email: user.email ?? null,
    username: profileRow?.username || fallbackUsername,
    displayName:
      profileRow?.display_name ||
      (user.user_metadata?.display_name as string | undefined) ||
      profileRow?.username ||
      fallbackUsername,
    avatarUrl:
      profileRow?.avatar_url ||
      (user.user_metadata?.avatar_url as string | undefined) ||
      "",
    bio: profileRow?.bio || "",
    profileVisibility:
      profileRow?.profile_visibility === "private" ? "private" : "public",
    blockedUsers: blockedRes.blockedUsers,
    createdAt: profileRow?.created_at || user.created_at || null,
    updatedAt: profileRow?.updated_at || null,
    lastSignInAt: user.last_sign_in_at || null,
    authProvider:
      (user.app_metadata?.provider as string | undefined) || "email",
    role: roleRes.data?.role || "user",
    libraryCount: libCountRes.count ?? 0,
    ratingsCount: ratingsCountRes.count ?? 0,
    reviewsCount: reviewsCountRes.count ?? 0,
    commentsCount: commentsCountRes.count ?? 0,
    preferences,
  };

  return <SettingsClient initialData={initialData} />;
}
