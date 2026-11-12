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
  profileVisibility?: "public" | "private";
  blockedUsers?: Array<{
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    blockedAt: string;
  }>;
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
  avatarUrl?: string;
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

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_AVATAR_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
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
 * Inspect the binary magic bytes of an uploaded file buffer to verify it is a genuine
 * JPEG, PNG, GIF, or WebP image and not a disguised executable, HTML, or SVG XSS payload.
 */
function verifyImageMagicBytes(bytes: Uint8Array, mimeType: string): boolean {
  if (bytes.length < 12) return false;

  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  if (mimeType === "image/gif") {
    // GIF87a or GIF89a
    return (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) &&
      bytes[5] === 0x61
    );
  }

  if (mimeType === "image/webp") {
    // RIFF....WEBP
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }

  return false;
}

/**
 * Upload an avatar image file to the user's own folder (`<user.id>/...`) in the
 * Supabase Storage `avatars` bucket and persist the public URL to `public.profiles`.
 */
export async function uploadAvatarAction(
  formData: FormData
): Promise<SettingsActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to upload an avatar.",
    };
  }

  const rawFile = formData.get("avatar");
  if (!rawFile || !(rawFile instanceof File)) {
    return {
      success: false,
      error: "Please select an image file to upload.",
    };
  }

  if (rawFile.size <= 0) {
    return {
      success: false,
      error: "Selected file is empty.",
    };
  }

  if (rawFile.size > MAX_AVATAR_BYTES) {
    return {
      success: false,
      error: "Avatar image must be 2 MB or smaller.",
    };
  }

  const ext = ALLOWED_AVATAR_MIME_TYPES[rawFile.type];
  if (!ext) {
    return {
      success: false,
      error:
        "Invalid file format. Only JPEG, PNG, WebP, and GIF images are allowed.",
    };
  }

  const arrayBuffer = await rawFile.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (!verifyImageMagicBytes(bytes, rawFile.type)) {
    return {
      success: false,
      error:
        "File content does not match a valid image signature. Upload rejected for security.",
    };
  }

  const storagePath = `${user.id}/avatar-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(storagePath, bytes, {
      contentType: rawFile.type,
      upsert: true,
    });

  if (uploadError) {
    return {
      success: false,
      error: uploadError.message || "Failed to upload avatar image.",
    };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(storagePath);

  const now = new Date().toISOString();
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({
      avatar_url: publicUrl,
      updated_at: now,
    })
    .eq("id", user.id);

  if (profileErr) {
    return {
      success: false,
      error: profileErr.message || "Failed to update profile avatar URL.",
    };
  }

  await supabase.auth.updateUser({
    data: {
      avatar_url: publicUrl,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath("/community");

  return {
    success: true,
    avatarUrl: publicUrl,
    message: "Avatar uploaded and saved to your profile.",
  };
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

  // Check if username is already claimed by another user (escape _ so ILIKE treats it literally)
  const escapedUsername = cleanUsername.replace(/[%_\\]/g, "\\$&");
  const { data: existingUsername } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", escapedUsername)
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
    // Handle atomic unique index violation (e.g. concurrent username update race)
    if (
      upsertError.code === "23505" ||
      upsertError.message?.toLowerCase().includes("idx_profiles_username_lower") ||
      upsertError.message?.toLowerCase().includes("profiles_username_key")
    ) {
      return {
        success: false,
        error: `The username @${cleanUsername} is already taken. Please choose another.`,
      };
    }

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

export async function updateProfileVisibilityAction(input: {
  visibility: "public" | "private";
}): Promise<SettingsActionResult> {
  const visibility = input.visibility === "private" ? "private" : "public";
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to update profile visibility.",
    };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({
      profile_visibility: visibility,
      updated_at: now,
    })
    .eq("id", user.id);

  if (error) {
    return {
      success: false,
      error: "Failed to update profile visibility.",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/profile");
  return {
    success: true,
    message: `Profile visibility set to ${visibility === "public" ? "Public" : "Private"}.`,
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

  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) {
    return {
      success: false,
      error: "New password must contain at least one letter and one number.",
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
