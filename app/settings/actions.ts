"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AccentColorId =
  | "emerald"
  | "blue"
  | "purple"
  | "pink"
  | "amber"
  | "red"
  | "white";

export type ThemeModeId = "dark" | "light" | "system";

export interface UserPreferences {
  accentColor: AccentColorId;
  themeMode: ThemeModeId;
  reducedMotion: boolean;
  defaultSpoilerProtection: boolean;
  showActivityInCommunity: boolean;
  notifyEpisodeReleases: boolean;
  notifyCommunityReplies: boolean;
  notifyWatchTogetherInvites: boolean;
}

export interface ProfileSettingsData {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastSignInAt: string | null;
  authProvider: string;
  role: string;
  libraryCount: number;
  ratingsCount: number;
  reviewsCount: number;
  commentsCount: number;
  preferences: UserPreferences;
}

export interface SettingsActionResult {
  success: boolean;
  error?: string;
  message?: string;
  preferences?: UserPreferences;
  profile?: {
    username: string;
    displayName: string;
    avatarUrl: string;
    bio: string;
    updatedAt: string;
  };
}

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

const DEFAULT_PREFERENCES: UserPreferences = {
  accentColor: "purple",
  themeMode: "dark",
  reducedMotion: false,
  defaultSpoilerProtection: true,
  showActivityInCommunity: true,
  notifyEpisodeReleases: true,
  notifyCommunityReplies: true,
  notifyWatchTogetherInvites: true,
};

function sanitizePreferences(raw: unknown): UserPreferences {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const accent = VALID_ACCENTS.includes(obj.accentColor as AccentColorId)
    ? (obj.accentColor as AccentColorId)
    : DEFAULT_PREFERENCES.accentColor;

  const theme = VALID_THEME_MODES.includes(obj.themeMode as ThemeModeId)
    ? (obj.themeMode as ThemeModeId)
    : DEFAULT_PREFERENCES.themeMode;

  return {
    accentColor: accent,
    themeMode: theme,
    reducedMotion:
      typeof obj.reducedMotion === "boolean"
        ? obj.reducedMotion
        : DEFAULT_PREFERENCES.reducedMotion,
    defaultSpoilerProtection:
      typeof obj.defaultSpoilerProtection === "boolean"
        ? obj.defaultSpoilerProtection
        : DEFAULT_PREFERENCES.defaultSpoilerProtection,
    showActivityInCommunity:
      typeof obj.showActivityInCommunity === "boolean"
        ? obj.showActivityInCommunity
        : DEFAULT_PREFERENCES.showActivityInCommunity,
    notifyEpisodeReleases:
      typeof obj.notifyEpisodeReleases === "boolean"
        ? obj.notifyEpisodeReleases
        : DEFAULT_PREFERENCES.notifyEpisodeReleases,
    notifyCommunityReplies:
      typeof obj.notifyCommunityReplies === "boolean"
        ? obj.notifyCommunityReplies
        : DEFAULT_PREFERENCES.notifyCommunityReplies,
    notifyWatchTogetherInvites:
      typeof obj.notifyWatchTogetherInvites === "boolean"
        ? obj.notifyWatchTogetherInvites
        : DEFAULT_PREFERENCES.notifyWatchTogetherInvites,
  };
}

function isValidAvatarUrl(url: string): boolean {
  if (!url) return true;
  if (url.length > 500) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Update the authenticated user's profile in `public.profiles` and sync
 * `username`, `display_name`, and `avatar_url` to Supabase Auth `user_metadata`.
 */
export async function updateProfileSettingsAction(input: {
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
}): Promise<SettingsActionResult> {
  const cleanUsername = (input.username ?? "").trim();
  const cleanDisplayName = (input.displayName ?? "").trim();
  const cleanAvatarUrl = (input.avatarUrl ?? "").trim();
  const cleanBio = (input.bio ?? "").trim();

  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(cleanUsername)) {
    return {
      success: false,
      error:
        "Username must be 3–30 characters and contain only letters, numbers, underscores (_), or hyphens (-).",
    };
  }

  if (cleanDisplayName.length < 1 || cleanDisplayName.length > 60) {
    return {
      success: false,
      error: "Display name must be between 1 and 60 characters.",
    };
  }

  if (!isValidAvatarUrl(cleanAvatarUrl)) {
    return {
      success: false,
      error:
        "Avatar URL must be a valid http:// or https:// image link (max 500 characters), or left blank.",
    };
  }

  if (cleanBio.length > 500) {
    return {
      success: false,
      error: "Bio cannot exceed 500 characters.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to update your profile settings.",
    };
  }

  // Check if username is already claimed by another user
  const { data: existingUsername } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", cleanUsername)
    .neq("id", user.id)
    .maybeSingle();

  if (existingUsername) {
    return {
      success: false,
      error: `The username @${cleanUsername} is already taken. Please choose another.`,
    };
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      username: cleanUsername,
      display_name: cleanDisplayName,
      avatar_url: cleanAvatarUrl || null,
      bio: cleanBio || null,
      updated_at: now,
    },
    { onConflict: "id" }
  );

  if (upsertError) {
    return {
      success: false,
      error: upsertError.message || "Failed to update profile in database.",
    };
  }

  // Sync display metadata into Supabase Auth user_metadata so Header/Shell stay in sync
  await supabase.auth.updateUser({
    data: {
      username: cleanUsername,
      display_name: cleanDisplayName,
      avatar_url: cleanAvatarUrl || null,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath("/community");

  return {
    success: true,
    message: "Profile settings saved to your Nayozu account.",
    profile: {
      username: cleanUsername,
      displayName: cleanDisplayName,
      avatarUrl: cleanAvatarUrl,
      bio: cleanBio,
      updatedAt: now,
    },
  };
}

/**
 * Persist user appearance, privacy, and in-app notification preferences
 * inside the authenticated user's Supabase Auth `user_metadata.preferences`.
 */
export async function updateUserPreferencesAction(
  input: Partial<UserPreferences>
): Promise<SettingsActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to save account-wide preferences.",
    };
  }

  const currentPrefs = sanitizePreferences(user.user_metadata?.preferences);
  const nextPrefs = sanitizePreferences({
    ...currentPrefs,
    ...input,
  });

  const { error: updateErr } = await supabase.auth.updateUser({
    data: {
      preferences: nextPrefs,
    },
  });

  if (updateErr) {
    return {
      success: false,
      error: updateErr.message || "Failed to save account preferences.",
    };
  }

  revalidatePath("/settings");
  return {
    success: true,
    message: "Preferences saved to your account.",
    preferences: nextPrefs,
  };
}

/**
 * Update the authenticated user's password via Supabase Auth.
 */
export async function updatePasswordAction(input: {
  newPassword: string;
  confirmPassword: string;
}): Promise<SettingsActionResult> {
  const pwd = input.newPassword ?? "";
  const confirm = input.confirmPassword ?? "";

  if (pwd.length < 8) {
    return {
      success: false,
      error: "New password must be at least 8 characters long.",
    };
  }

  if (pwd.length > 128) {
    return {
      success: false,
      error: "New password cannot exceed 128 characters.",
    };
  }

  if (pwd !== confirm) {
    return {
      success: false,
      error: "New password and confirmation password do not match.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to update your password.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: pwd,
  });

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to update password.",
    };
  }

  return {
    success: true,
    message: "Your password has been updated.",
  };
}

/**
 * Safely clear all RLS-permitted user library & community activity data
 * (`user_anime_library`, `anime_ratings`, `anime_reviews`, `anime_comments`)
 * and reset profile fields after explicit confirmation.
 */
export async function clearAccountDataAction(input: {
  confirmationText: string;
}): Promise<SettingsActionResult> {
  const phrase = (input.confirmationText ?? "").trim();
  if (phrase !== "CLEAR MY DATA") {
    return {
      success: false,
      error: 'Please type the exact confirmation phrase "CLEAR MY DATA" to proceed.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to clear your account data.",
    };
  }

  // 1. Delete user's library entries (Watchlist, Reading List, Favorites)
  const { error: libErr } = await supabase
    .from("user_anime_library")
    .delete()
    .eq("user_id", user.id);

  if (libErr) {
    return {
      success: false,
      error: libErr.message || "Failed to clear library entries.",
    };
  }

  // 2. Delete user's ratings
  const { error: ratingErr } = await supabase
    .from("anime_ratings")
    .delete()
    .eq("user_id", user.id);

  if (ratingErr) {
    return {
      success: false,
      error: ratingErr.message || "Failed to clear ratings.",
    };
  }

  // 3. Delete user's reviews
  const { error: reviewErr } = await supabase
    .from("anime_reviews")
    .delete()
    .eq("user_id", user.id);

  if (reviewErr) {
    return {
      success: false,
      error: reviewErr.message || "Failed to clear reviews.",
    };
  }

  // 4. Delete user's comments (replies first, then top-level comments)
  await supabase
    .from("anime_comments")
    .delete()
    .eq("user_id", user.id)
    .not("parent_comment_id", "is", null);

  await supabase
    .from("anime_comments")
    .delete()
    .eq("user_id", user.id);

  // 5. Reset profile bio and avatar_url to clean defaults
  const fallbackUsername = `user_${user.id.slice(0, 8)}`;
  const now = new Date().toISOString();
  await supabase
    .from("profiles")
    .update({
      display_name: fallbackUsername,
      avatar_url: null,
      bio: null,
      updated_at: now,
    })
    .eq("id", user.id);

  await supabase.auth.updateUser({
    data: {
      display_name: fallbackUsername,
      avatar_url: null,
      preferences: DEFAULT_PREFERENCES,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath("/watchlist");
  revalidatePath("/reading-list");
  revalidatePath("/history");
  revalidatePath("/favorites");
  revalidatePath("/community");

  return {
    success: true,
    message:
      "All personal library entries, ratings, reviews, comments, and profile details have been cleared.",
  };
}
