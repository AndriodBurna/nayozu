"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchSharedWatchTogetherRooms } from "@/lib/watch-together/roomService";

export type MediaType = "anime" | "manga";
export type ReactionType = "like" | "helpful" | "fire";
export type ReactionTargetType =
  | "review"
  | "discussion"
  | "discussion_reply"
  | "comment";
export type ReportContentType =
  | "review"
  | "discussion"
  | "discussion_reply"
  | "comment"
  | "profile";
export type ReportCategory =
  | "spam"
  | "harassment"
  | "hate_speech"
  | "sexual_content"
  | "spoilers"
  | "misinformation"
  | "other";
export type ReviewSortOption = "newest" | "oldest" | "highest" | "lowest";

export interface ReactionSummary {
  like: number;
  helpful: number;
  fire: number;
  userReaction: ReactionType | null;
}

export interface ReviewItemDTO {
  id: string;
  userId: string;
  animeId: string;
  title: string | null;
  body: string;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
  score: number | null;
  author: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  reactions: ReactionSummary;
}

export interface MediaCommentDTO {
  id: string;
  userId: string;
  animeId: string;
  mediaType: MediaType;
  episodeNumber: number | null;
  chapterNumber: number | null;
  parentCommentId: string | null;
  body: string;
  isSpoiler: boolean;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  reactions: ReactionSummary;
  replies: MediaCommentDTO[];
}

function buildCanonicalMediaKey(
  externalId: string | number,
  mediaType: MediaType = "anime"
): string {
  const raw = String(externalId ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("manga:")) {
    return mediaType === "manga" ? raw : raw.replace(/^manga:/, "");
  }
  return mediaType === "manga" ? `manga:${raw}` : raw;
}

const VALID_REPORT_CATEGORIES: ReportCategory[] = [
  "spam",
  "harassment",
  "hate_speech",
  "sexual_content",
  "spoilers",
  "misinformation",
  "other",
];

const VALID_REACTION_TYPES: ReactionType[] = ["like", "helpful", "fire"];

async function ensureUserProfileAndCheckRestriction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> }
): Promise<{ allowed: boolean; error?: string }> {
  const fallbackUsername =
    (user.user_metadata?.username as string | undefined) ||
    user.email?.split("@")[0] ||
    `user_${user.id.slice(0, 8)}`;

  await supabase.from("profiles").upsert(
    {
      id: user.id,
      username: fallbackUsername,
      display_name:
        (user.user_metadata?.display_name as string | undefined) ||
        fallbackUsername,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );

  const { data: restrictions } = await supabase
    .from("user_restrictions")
    .select("status, restriction_type, restricted_until, reason")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (Array.isArray(restrictions) && restrictions.length > 0) {
    const nowMs = Date.now();
    const active = restrictions.find(
      (r) =>
        r.restriction_type !== "warning" &&
        (!r.restricted_until || new Date(r.restricted_until).getTime() > nowMs)
    );
    if (active) {
      return {
        allowed: false,
        error: `Your account is currently suspended from posting (${active.reason}).`,
      };
    }
  }

  return { allowed: true };
}

async function getCurrentUserRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<"user" | "moderator" | "admin"> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.role === "admin" || data?.role === "moderator") {
    return data.role;
  }
  return "user";
}

async function getBlockedUserSetWithMeta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string | null
): Promise<{ set: Set<string>; bidirectionalRpcSucceeded: boolean }> {
  const set = new Set<string>();
  if (!userId) return { set, bidirectionalRpcSucceeded: true };

  const [rpcRes, tableRes] = await Promise.all([
    supabase.rpc("get_bidirectional_blocked_user_ids"),
    supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
  ]);

  let bidirectionalRpcSucceeded = false;
  if (!rpcRes.error && Array.isArray(rpcRes.data)) {
    bidirectionalRpcSucceeded = true;
    for (const entry of rpcRes.data) {
      if (typeof entry === "string" && entry) {
        set.add(entry);
      } else if (
        entry &&
        typeof entry === "object" &&
        "excluded_user_id" in entry &&
        typeof (entry as { excluded_user_id?: unknown }).excluded_user_id === "string"
      ) {
        set.add((entry as { excluded_user_id: string }).excluded_user_id);
      }
    }
  }

  for (const row of tableRes.data ?? []) {
    if (row.blocker_id === userId) set.add(row.blocked_id);
    if (row.blocked_id === userId) set.add(row.blocker_id);
  }

  return { set, bidirectionalRpcSucceeded };
}

async function getBlockedUserSet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string | null
): Promise<Set<string>> {
  const { set } = await getBlockedUserSetWithMeta(supabase, userId);
  return set;
}

async function isBlockedBetween(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userA: string,
  userB: string
): Promise<boolean> {
  if (!userA || !userB || userA === userB) return false;

  const rpcRes = await supabase.rpc("is_blocked_between", {
    user_a: userA,
    user_b: userB,
  });
  if (!rpcRes.error && typeof rpcRes.data === "boolean") {
    return rpcRes.data;
  }

  const { data } = await supabase
    .from("user_blocks")
    .select("id")
    .or(
      `and(blocker_id.eq.${userA},blocked_id.eq.${userB}),and(blocker_id.eq.${userB},blocked_id.eq.${userA})`
    )
    .limit(1);

  return Boolean(data && data.length > 0);
}

async function fetchReactionsMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  targetType: ReactionTargetType,
  targetIds: string[],
  currentUserId: string | null
): Promise<Map<string, ReactionSummary>> {
  const map = new Map<string, ReactionSummary>();
  for (const id of targetIds) {
    map.set(id, { like: 0, helpful: 0, fire: 0, userReaction: null });
  }
  if (targetIds.length === 0) return map;

  const { data } = await supabase
    .from("content_reactions")
    .select("target_id, user_id, reaction_type")
    .eq("target_type", targetType)
    .in("target_id", targetIds);

  for (const row of data ?? []) {
    const entry = map.get(row.target_id);
    if (!entry) continue;
    const rt = row.reaction_type as ReactionType;
    if (rt === "like" || rt === "helpful" || rt === "fire") {
      entry[rt] += 1;
      if (currentUserId && row.user_id === currentUserId) {
        entry.userReaction = rt;
      }
    }
  }
  return map;
}

// ============================================================================
// 1. RATINGS & REVIEWS
// ============================================================================

export async function submitRatingAction(input: {
  externalId: string | number;
  mediaType?: MediaType;
  score: number;
}): Promise<{
  success: boolean;
  error?: string;
  averageScore?: number | null;
  ratingCount?: number;
  userScore?: number;
}> {
  const mediaType: MediaType = input.mediaType === "manga" ? "manga" : "anime";
  const mediaKey = buildCanonicalMediaKey(input.externalId, mediaType);
  const score = Math.round(Number(input.score));

  if (!mediaKey) {
    return { success: false, error: "Invalid media identifier." };
  }
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    return {
      success: false,
      error: "Rating score must be a whole number between 1 and 10.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in to rate titles." };
  }

  const check = await ensureUserProfileAndCheckRestriction(supabase, user);
  if (!check.allowed) {
    return { success: false, error: check.error };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("anime_ratings").upsert(
    {
      user_id: user.id,
      anime_id: mediaKey,
      score,
      updated_at: now,
    },
    { onConflict: "user_id,anime_id" }
  );

  if (error) {
    return {
      success: false,
      error: "Failed to save rating. Please try again.",
    };
  }

  const { data: allRatings } = await supabase
    .from("anime_ratings")
    .select("score")
    .eq("anime_id", mediaKey);

  const count = allRatings?.length ?? 0;
  const avg =
    count > 0
      ? Number(
          (
            allRatings!.reduce((acc, r) => acc + Number(r.score || 0), 0) /
            count
          ).toFixed(1)
        )
      : null;

  revalidatePath("/community");
  revalidatePath("/profile");
  return {
    success: true,
    averageScore: avg,
    ratingCount: count,
    userScore: score,
  };
}

export async function removeRatingAction(input: {
  externalId: string | number;
  mediaType?: MediaType;
}): Promise<{
  success: boolean;
  error?: string;
  averageScore?: number | null;
  ratingCount?: number;
}> {
  const mediaType: MediaType = input.mediaType === "manga" ? "manga" : "anime";
  const mediaKey = buildCanonicalMediaKey(input.externalId, mediaType);
  if (!mediaKey) {
    return { success: false, error: "Invalid media identifier." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in." };
  }

  const { error } = await supabase
    .from("anime_ratings")
    .delete()
    .eq("user_id", user.id)
    .eq("anime_id", mediaKey);

  if (error) {
    return { success: false, error: "Failed to remove rating." };
  }

  const { data: allRatings } = await supabase
    .from("anime_ratings")
    .select("score")
    .eq("anime_id", mediaKey);

  const count = allRatings?.length ?? 0;
  const avg =
    count > 0
      ? Number(
          (
            allRatings!.reduce((acc, r) => acc + Number(r.score || 0), 0) /
            count
          ).toFixed(1)
        )
      : null;

  revalidatePath("/community");
  revalidatePath("/profile");
  return { success: true, averageScore: avg, ratingCount: count };
}

export async function upsertReviewAction(input: {
  externalId: string | number;
  mediaType?: MediaType;
  title?: string | null;
  body: string;
  score?: number | null;
}): Promise<{ success: boolean; error?: string; reviewId?: string }> {
  const mediaType: MediaType = input.mediaType === "manga" ? "manga" : "anime";
  const mediaKey = buildCanonicalMediaKey(input.externalId, mediaType);
  const cleanTitle = (input.title ?? "").trim();
  const cleanBody = (input.body ?? "").trim();

  if (!mediaKey || mediaKey === "community") {
    return {
      success: false,
      error: "Please select a valid anime or manga title to review.",
    };
  }
  if (cleanBody.length < 10) {
    return {
      success: false,
      error: "Review body must be at least 10 characters long.",
    };
  }
  if (cleanBody.length > 5000) {
    return {
      success: false,
      error: "Review body cannot exceed 5,000 characters.",
    };
  }
  if (cleanTitle.length > 160) {
    return {
      success: false,
      error: "Review title cannot exceed 160 characters.",
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
      error: "You must be signed in to write or edit a review.",
    };
  }

  const check = await ensureUserProfileAndCheckRestriction(supabase, user);
  if (!check.allowed) {
    return { success: false, error: check.error };
  }

  const now = new Date().toISOString();

  if (input.score !== undefined && input.score !== null) {
    const score = Math.round(Number(input.score));
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      return {
        success: false,
        error: "Rating score must be between 1 and 10.",
      };
    }
    await supabase.from("anime_ratings").upsert(
      {
        user_id: user.id,
        anime_id: mediaKey,
        score,
        updated_at: now,
      },
      { onConflict: "user_id,anime_id" }
    );
  }

  const { data: saved, error } = await supabase
    .from("anime_reviews")
    .upsert(
      {
        user_id: user.id,
        anime_id: mediaKey,
        title: cleanTitle || null,
        body: cleanBody,
        is_hidden: false,
        updated_at: now,
      },
      { onConflict: "user_id,anime_id" }
    )
    .select("id")
    .single();

  if (error || !saved) {
    return {
      success: false,
      error: "Failed to save your review. Please try again.",
    };
  }

  revalidatePath("/community");
  revalidatePath("/profile");
  return { success: true, reviewId: saved.id };
}

export async function deleteReviewAction(input: {
  reviewId: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.reviewId ?? "").trim();
  if (!cleanId) {
    return { success: false, error: "Invalid review ID." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in." };
  }

  const { data: review } = await supabase
    .from("anime_reviews")
    .select("id, user_id")
    .eq("id", cleanId)
    .maybeSingle();

  if (!review) {
    return { success: false, error: "Review not found." };
  }

  const role = await getCurrentUserRole(supabase, user.id);
  if (review.user_id !== user.id && role === "user") {
    return {
      success: false,
      error: "You do not have permission to delete this review.",
    };
  }

  const { error } = await supabase
    .from("anime_reviews")
    .delete()
    .eq("id", cleanId);

  if (error) {
    return { success: false, error: "Failed to delete review." };
  }

  revalidatePath("/community");
  revalidatePath("/profile");
  return { success: true };
}

export async function fetchMediaReviewsAndRatingsAction(input: {
  externalId: string | number;
  mediaType?: MediaType;
  sortBy?: ReviewSortOption;
  page?: number;
  limit?: number;
}): Promise<{
  averageScore: number | null;
  ratingCount: number;
  userScore: number | null;
  userReview: ReviewItemDTO | null;
  reviews: ReviewItemDTO[];
  totalReviews: number;
  hasMore: boolean;
  currentUserId: string | null;
}> {
  const mediaType: MediaType = input.mediaType === "manga" ? "manga" : "anime";
  const mediaKey = buildCanonicalMediaKey(input.externalId, mediaType);
  const sortBy: ReviewSortOption = input.sortBy ?? "newest";
  const page = Math.max(Number(input.page) || 1, 1);
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id ?? null;

  const blockedSet = await getBlockedUserSet(supabase, currentUserId);

  const [{ data: ratingsRows }, { data: reviewsRows }] = await Promise.all([
    supabase
      .from("anime_ratings")
      .select("user_id, score")
      .eq("anime_id", mediaKey),
    supabase
      .from("anime_reviews")
      .select(
        "id, user_id, anime_id, title, body, is_hidden, created_at, updated_at"
      )
      .eq("anime_id", mediaKey)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false }),
  ]);

  const ratingsList = ratingsRows ?? [];
  const ratingCount = ratingsList.length;
  const averageScore =
    ratingCount > 0
      ? Number(
          (
            ratingsList.reduce((acc, r) => acc + Number(r.score || 0), 0) /
            ratingCount
          ).toFixed(1)
        )
      : null;

  const scoreByUser = new Map<string, number>();
  for (const r of ratingsList) {
    scoreByUser.set(r.user_id, Number(r.score));
  }
  const userScore = currentUserId ? scoreByUser.get(currentUserId) ?? null : null;

  const visibleRawReviews = (reviewsRows ?? []).filter(
    (rev) => !blockedSet.has(rev.user_id)
  );

  const authorIds = Array.from(
    new Set(visibleRawReviews.map((r) => r.user_id))
  );
  const profileMap = new Map<
    string,
    { username: string; display_name: string | null; avatar_url: string | null }
  >();

  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", authorIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p);
    }
  }

  const reactionsMap = await fetchReactionsMap(
    supabase,
    "review",
    visibleRawReviews.map((r) => r.id),
    currentUserId
  );

  const mapped: ReviewItemDTO[] = visibleRawReviews.map((r) => {
    const prof = profileMap.get(r.user_id);
    return {
      id: r.id,
      userId: r.user_id,
      animeId: r.anime_id,
      title: r.title,
      body: r.body,
      isHidden: Boolean(r.is_hidden),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      score: scoreByUser.get(r.user_id) ?? null,
      author: {
        id: r.user_id,
        username: prof?.username || `user_${r.user_id.slice(0, 6)}`,
        displayName: prof?.display_name ?? null,
        avatarUrl: prof?.avatar_url ?? null,
      },
      reactions: reactionsMap.get(r.id) ?? {
        like: 0,
        helpful: 0,
        fire: 0,
        userReaction: null,
      },
    };
  });

  mapped.sort((a, b) => {
    if (sortBy === "oldest") {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    if (sortBy === "highest") {
      const sa = a.score ?? -1;
      const sb = b.score ?? -1;
      if (sb !== sa) return sb - sa;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    if (sortBy === "lowest") {
      const sa = a.score ?? 99;
      const sb = b.score ?? 99;
      if (sa !== sb) return sa - sb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const userReview = currentUserId
    ? mapped.find((m) => m.userId === currentUserId) ?? null
    : null;

  const start = (page - 1) * limit;
  const paginated = mapped.slice(start, start + limit);

  return {
    averageScore,
    ratingCount,
    userScore,
    userReview,
    reviews: paginated,
    totalReviews: mapped.length,
    hasMore: start + limit < mapped.length,
    currentUserId,
  };
}

// ============================================================================
// 2. DISCUSSIONS & REPLIES
// ============================================================================

export async function createDiscussionAction(input: {
  title: string;
  body: string;
  category?: "discussion" | "question";
  mediaId?: string | null;
  mediaType?: MediaType | null;
  isSpoiler?: boolean;
}): Promise<{ success: boolean; error?: string; discussionId?: string }> {
  const cleanTitle = (input.title ?? "").trim();
  const cleanBody = (input.body ?? "").trim();
  const category = input.category === "question" ? "question" : "discussion";
  const rawMediaId = (input.mediaId ?? "").trim();

  if (cleanTitle.length < 3) {
    return {
      success: false,
      error: "Discussion title must be at least 3 characters long.",
    };
  }
  if (cleanTitle.length > 200) {
    return {
      success: false,
      error: "Discussion title cannot exceed 200 characters.",
    };
  }
  if (cleanBody.length < 3) {
    return {
      success: false,
      error: "Discussion content must be at least 3 characters long.",
    };
  }
  if (cleanBody.length > 10000) {
    return {
      success: false,
      error: "Discussion content cannot exceed 10,000 characters.",
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
      error: "You must be signed in to start a discussion.",
    };
  }

  const check = await ensureUserProfileAndCheckRestriction(supabase, user);
  if (!check.allowed) {
    return { success: false, error: check.error };
  }

  let resolvedMediaType: "community" | "anime" | "manga" = "community";
  let resolvedMediaId = "community";

  if (rawMediaId && rawMediaId !== "community") {
    if (rawMediaId.startsWith("manga:")) {
      resolvedMediaType = "manga";
      resolvedMediaId = rawMediaId;
    } else if (input.mediaType === "manga") {
      resolvedMediaType = "manga";
      resolvedMediaId = `manga:${rawMediaId}`;
    } else {
      resolvedMediaType = "anime";
      resolvedMediaId = rawMediaId;
    }
  }

  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from("discussions")
    .insert({
      user_id: user.id,
      anime_id: resolvedMediaId,
      media_type: resolvedMediaType,
      category,
      title: cleanTitle,
      body: cleanBody,
      is_spoiler: Boolean(input.isSpoiler),
      is_locked: false,
      is_hidden: false,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return {
      success: false,
      error: "Failed to publish discussion. Please try again.",
    };
  }

  revalidatePath("/community");
  revalidatePath("/profile");
  return { success: true, discussionId: inserted.id };
}

export async function updateDiscussionAction(input: {
  discussionId: string;
  title: string;
  body: string;
  isSpoiler?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.discussionId ?? "").trim();
  const cleanTitle = (input.title ?? "").trim();
  const cleanBody = (input.body ?? "").trim();

  if (!cleanId) return { success: false, error: "Invalid discussion ID." };
  if (cleanTitle.length < 3 || cleanTitle.length > 200) {
    return {
      success: false,
      error: "Title must be between 3 and 200 characters.",
    };
  }
  if (cleanBody.length < 3 || cleanBody.length > 10000) {
    return {
      success: false,
      error: "Content must be between 3 and 10,000 characters.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in." };
  }

  const { data: existing } = await supabase
    .from("discussions")
    .select("id, user_id, is_locked")
    .eq("id", cleanId)
    .maybeSingle();

  if (!existing) {
    return { success: false, error: "Discussion not found." };
  }

  const role = await getCurrentUserRole(supabase, user.id);
  if (existing.user_id !== user.id && role === "user") {
    return {
      success: false,
      error: "You can only edit your own discussions.",
    };
  }

  const { error } = await supabase
    .from("discussions")
    .update({
      title: cleanTitle,
      body: cleanBody,
      is_spoiler:
        typeof input.isSpoiler === "boolean" ? input.isSpoiler : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleanId);

  if (error) {
    return { success: false, error: "Failed to update discussion." };
  }

  revalidatePath("/community");
  revalidatePath("/profile");
  return { success: true };
}

export async function deleteDiscussionAction(input: {
  discussionId: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.discussionId ?? "").trim();
  if (!cleanId) return { success: false, error: "Invalid discussion ID." };

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in." };
  }

  const { data: existing } = await supabase
    .from("discussions")
    .select("id, user_id")
    .eq("id", cleanId)
    .maybeSingle();

  if (!existing) {
    return { success: false, error: "Discussion not found." };
  }

  const role = await getCurrentUserRole(supabase, user.id);
  if (existing.user_id !== user.id && role === "user") {
    return {
      success: false,
      error: "You can only delete your own discussions.",
    };
  }

  const { error } = await supabase
    .from("discussions")
    .delete()
    .eq("id", cleanId);

  if (error) {
    return { success: false, error: "Failed to delete discussion." };
  }

  revalidatePath("/community");
  revalidatePath("/profile");
  return { success: true };
}

export async function createDiscussionReplyAction(input: {
  discussionId: string;
  parentReplyId?: string | null;
  body: string;
  isSpoiler?: boolean;
}): Promise<{ success: boolean; error?: string; replyId?: string }> {
  const cleanDiscussionId = (input.discussionId ?? "").trim();
  const cleanBody = (input.body ?? "").trim();

  if (!cleanDiscussionId) {
    return { success: false, error: "Invalid discussion ID." };
  }
  if (!cleanBody) {
    return { success: false, error: "Reply cannot be empty." };
  }
  if (cleanBody.length > 4000) {
    return {
      success: false,
      error: "Reply cannot exceed 4,000 characters.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in to reply." };
  }

  const check = await ensureUserProfileAndCheckRestriction(supabase, user);
  if (!check.allowed) {
    return { success: false, error: check.error };
  }

  const { data: discussion } = await supabase
    .from("discussions")
    .select("id, user_id, is_locked, is_hidden")
    .eq("id", cleanDiscussionId)
    .maybeSingle();

  if (!discussion || discussion.is_hidden) {
    return { success: false, error: "Discussion is no longer available." };
  }
  if (discussion.is_locked) {
    return {
      success: false,
      error: "This discussion has been locked by a moderator.",
    };
  }

  const blockedWithAuthor = await isBlockedBetween(
    supabase,
    user.id,
    discussion.user_id
  );
  if (blockedWithAuthor) {
    return {
      success: false,
      error: "You cannot reply to this discussion due to user block settings.",
    };
  }

  if (input.parentReplyId) {
    const { data: parentReply } = await supabase
      .from("discussion_replies")
      .select("id, user_id, is_hidden")
      .eq("id", input.parentReplyId)
      .maybeSingle();

    if (!parentReply || parentReply.is_hidden) {
      return { success: false, error: "Parent reply not found." };
    }
    const blockedParent = await isBlockedBetween(
      supabase,
      user.id,
      parentReply.user_id
    );
    if (blockedParent) {
      return {
        success: false,
        error: "You cannot reply to this user due to block settings.",
      };
    }
  }

  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from("discussion_replies")
    .insert({
      discussion_id: cleanDiscussionId,
      user_id: user.id,
      parent_reply_id: input.parentReplyId ?? null,
      body: cleanBody,
      is_spoiler: Boolean(input.isSpoiler),
      is_hidden: false,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { success: false, error: "Failed to post reply." };
  }

  revalidatePath("/community");
  revalidatePath("/profile");
  return { success: true, replyId: inserted.id };
}

export async function updateDiscussionReplyAction(input: {
  replyId: string;
  body: string;
  isSpoiler?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.replyId ?? "").trim();
  const cleanBody = (input.body ?? "").trim();

  if (!cleanId) return { success: false, error: "Invalid reply ID." };
  if (!cleanBody || cleanBody.length > 4000) {
    return {
      success: false,
      error: "Reply must be between 1 and 4,000 characters.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in." };
  }

  const { data: existing } = await supabase
    .from("discussion_replies")
    .select("id, user_id")
    .eq("id", cleanId)
    .maybeSingle();

  if (!existing) return { success: false, error: "Reply not found." };

  const role = await getCurrentUserRole(supabase, user.id);
  if (existing.user_id !== user.id && role === "user") {
    return { success: false, error: "You can only edit your own replies." };
  }

  const { error } = await supabase
    .from("discussion_replies")
    .update({
      body: cleanBody,
      is_spoiler:
        typeof input.isSpoiler === "boolean" ? input.isSpoiler : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleanId);

  if (error) return { success: false, error: "Failed to update reply." };

  revalidatePath("/community");
  revalidatePath("/profile");
  return { success: true };
}

export async function deleteDiscussionReplyAction(input: {
  replyId: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.replyId ?? "").trim();
  if (!cleanId) return { success: false, error: "Invalid reply ID." };

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in." };
  }

  const { data: existing } = await supabase
    .from("discussion_replies")
    .select("id, user_id")
    .eq("id", cleanId)
    .maybeSingle();

  if (!existing) return { success: false, error: "Reply not found." };

  const role = await getCurrentUserRole(supabase, user.id);
  if (existing.user_id !== user.id && role === "user") {
    return { success: false, error: "You can only delete your own replies." };
  }

  const { error } = await supabase
    .from("discussion_replies")
    .delete()
    .eq("id", cleanId);

  if (error) return { success: false, error: "Failed to delete reply." };

  revalidatePath("/community");
  revalidatePath("/profile");
  return { success: true };
}

// ============================================================================
// 3. EPISODE, CHAPTER & MEDIA COMMENTS
// ============================================================================

export async function fetchMediaCommentsAction(input: {
  externalId: string | number;
  mediaType?: MediaType;
  episodeNumber?: number | null;
  chapterNumber?: number | null;
  page?: number;
  limit?: number;
}): Promise<{
  comments: MediaCommentDTO[];
  totalTopLevel: number;
  hasMore: boolean;
  currentUserId: string | null;
}> {
  const mediaType: MediaType = input.mediaType === "manga" ? "manga" : "anime";
  const mediaKey = buildCanonicalMediaKey(input.externalId, mediaType);
  const rawLegacyKey = String(input.externalId ?? "").trim();
  const page = Math.max(Number(input.page) || 1, 1);
  const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 50);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id ?? null;

  const blockedSet = await getBlockedUserSet(supabase, currentUserId);

  let query = supabase
    .from("anime_comments")
    .select(
      "id, user_id, anime_id, media_type, episode_number, chapter_number, parent_comment_id, body, is_spoiler, is_hidden, created_at, updated_at"
    )
    .eq("is_hidden", false)
    .order("created_at", { ascending: true });

  if (mediaType === "manga") {
    query = query.eq("anime_id", mediaKey);
  } else {
    query = query
      .in("anime_id", [mediaKey, rawLegacyKey])
      .eq("media_type", "anime");
  }

  if (
    typeof input.episodeNumber === "number" &&
    Number.isFinite(input.episodeNumber)
  ) {
    query = query.eq("episode_number", input.episodeNumber);
  } else if (
    typeof input.chapterNumber === "number" &&
    Number.isFinite(input.chapterNumber)
  ) {
    query = query.eq("chapter_number", input.chapterNumber);
  } else {
    query = query.is("episode_number", null).is("chapter_number", null);
  }

  const { data: rows } = await query;
  const visibleRows = (rows ?? []).filter(
    (r) =>
      r.anime_id !== "watch_room" &&
      r.anime_id !== "community" &&
      !blockedSet.has(r.user_id)
  );

  const authorIds = Array.from(new Set(visibleRows.map((r) => r.user_id)));
  const profileMap = new Map<
    string,
    { username: string; display_name: string | null; avatar_url: string | null }
  >();

  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", authorIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p);
    }
  }

  const reactionsMap = await fetchReactionsMap(
    supabase,
    "comment",
    visibleRows.map((r) => r.id),
    currentUserId
  );

  const dtoMap = new Map<string, MediaCommentDTO>();
  for (const r of visibleRows) {
    const prof = profileMap.get(r.user_id);
    dtoMap.set(r.id, {
      id: r.id,
      userId: r.user_id,
      animeId: r.anime_id,
      mediaType: r.media_type === "manga" ? "manga" : "anime",
      episodeNumber: r.episode_number ?? null,
      chapterNumber: r.chapter_number ?? null,
      parentCommentId: r.parent_comment_id ?? null,
      body: r.body,
      isSpoiler: Boolean(r.is_spoiler),
      isHidden: Boolean(r.is_hidden),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: {
        id: r.user_id,
        username: prof?.username || `user_${r.user_id.slice(0, 6)}`,
        displayName: prof?.display_name ?? null,
        avatarUrl: prof?.avatar_url ?? null,
      },
      reactions: reactionsMap.get(r.id) ?? {
        like: 0,
        helpful: 0,
        fire: 0,
        userReaction: null,
      },
      replies: [],
    });
  }

  const topLevel: MediaCommentDTO[] = [];
  for (const item of dtoMap.values()) {
    if (item.parentCommentId && dtoMap.has(item.parentCommentId)) {
      dtoMap.get(item.parentCommentId)!.replies.push(item);
    } else if (!item.parentCommentId) {
      topLevel.push(item);
    }
  }

  topLevel.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const totalTopLevel = topLevel.length;
  const end = page * limit;
  const paginated = topLevel.slice(0, end);

  return {
    comments: paginated,
    totalTopLevel,
    hasMore: end < totalTopLevel,
    currentUserId,
  };
}

export async function createMediaCommentAction(input: {
  externalId: string | number;
  mediaType?: MediaType;
  episodeNumber?: number | null;
  chapterNumber?: number | null;
  parentCommentId?: string | null;
  body: string;
  isSpoiler?: boolean;
}): Promise<{
  success: boolean;
  error?: string;
  comment?: MediaCommentDTO;
}> {
  const mediaType: MediaType = input.mediaType === "manga" ? "manga" : "anime";
  const mediaKey = buildCanonicalMediaKey(input.externalId, mediaType);
  const cleanBody = (input.body ?? "").trim();

  if (!mediaKey) {
    return { success: false, error: "Invalid media identifier." };
  }
  if (!cleanBody) {
    return { success: false, error: "Comment cannot be empty." };
  }
  if (cleanBody.length > 2000) {
    return {
      success: false,
      error: "Comment cannot exceed 2,000 characters.",
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
      error: "You must be signed in to post a comment.",
    };
  }

  const check = await ensureUserProfileAndCheckRestriction(supabase, user);
  if (!check.allowed) {
    return { success: false, error: check.error };
  }

  let epNum: number | null =
    typeof input.episodeNumber === "number" && input.episodeNumber >= 1
      ? Math.floor(input.episodeNumber)
      : null;
  let chNum: number | null =
    typeof input.chapterNumber === "number" && input.chapterNumber >= 0
      ? Number(input.chapterNumber)
      : null;

  if (input.parentCommentId) {
    const { data: parent } = await supabase
      .from("anime_comments")
      .select(
        "id, user_id, is_hidden, episode_number, chapter_number, media_type"
      )
      .eq("id", input.parentCommentId)
      .maybeSingle();

    if (!parent || parent.is_hidden) {
      return {
        success: false,
        error: "The comment you are replying to is no longer available.",
      };
    }

    const blocked = await isBlockedBetween(supabase, user.id, parent.user_id);
    if (blocked) {
      return {
        success: false,
        error: "You cannot reply to this user due to block settings.",
      };
    }

    epNum = parent.episode_number ?? epNum;
    chNum = parent.chapter_number ?? chNum;
  }

  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from("anime_comments")
    .insert({
      user_id: user.id,
      anime_id: mediaKey,
      media_type: mediaType,
      episode_number: epNum,
      chapter_number: chNum,
      parent_comment_id: input.parentCommentId ?? null,
      body: cleanBody,
      is_spoiler: Boolean(input.isSpoiler),
      is_hidden: false,
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, user_id, anime_id, media_type, episode_number, chapter_number, parent_comment_id, body, is_spoiler, is_hidden, created_at, updated_at"
    )
    .single();

  if (error || !inserted) {
    return {
      success: false,
      error: "Failed to save comment. Please try again.",
    };
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("username, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  revalidatePath("/profile");
  return {
    success: true,
    comment: {
      id: inserted.id,
      userId: inserted.user_id,
      animeId: inserted.anime_id,
      mediaType: inserted.media_type === "manga" ? "manga" : "anime",
      episodeNumber: inserted.episode_number ?? null,
      chapterNumber: inserted.chapter_number ?? null,
      parentCommentId: inserted.parent_comment_id ?? null,
      body: inserted.body,
      isSpoiler: Boolean(inserted.is_spoiler),
      isHidden: Boolean(inserted.is_hidden),
      createdAt: inserted.created_at,
      updatedAt: inserted.updated_at,
      author: {
        id: user.id,
        username: prof?.username || `user_${user.id.slice(0, 6)}`,
        displayName: prof?.display_name ?? null,
        avatarUrl: prof?.avatar_url ?? null,
      },
      reactions: { like: 0, helpful: 0, fire: 0, userReaction: null },
      replies: [],
    },
  };
}

export async function updateMediaCommentAction(input: {
  commentId: string;
  body: string;
  isSpoiler?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.commentId ?? "").trim();
  const cleanBody = (input.body ?? "").trim();

  if (!cleanId) return { success: false, error: "Invalid comment ID." };
  if (!cleanBody || cleanBody.length > 2000) {
    return {
      success: false,
      error: "Comment must be between 1 and 2,000 characters.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in." };
  }

  const { data: existing } = await supabase
    .from("anime_comments")
    .select("id, user_id")
    .eq("id", cleanId)
    .maybeSingle();

  if (!existing) return { success: false, error: "Comment not found." };

  const role = await getCurrentUserRole(supabase, user.id);
  if (existing.user_id !== user.id && role === "user") {
    return { success: false, error: "You can only edit your own comments." };
  }

  const { error } = await supabase
    .from("anime_comments")
    .update({
      body: cleanBody,
      is_spoiler:
        typeof input.isSpoiler === "boolean" ? input.isSpoiler : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleanId);

  if (error) return { success: false, error: "Failed to update comment." };

  revalidatePath("/profile");
  return { success: true };
}

export async function deleteMediaCommentAction(input: {
  commentId: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.commentId ?? "").trim();
  if (!cleanId) return { success: false, error: "Invalid comment ID." };

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in." };
  }

  const { data: existing } = await supabase
    .from("anime_comments")
    .select("id, user_id")
    .eq("id", cleanId)
    .maybeSingle();

  if (!existing) return { success: false, error: "Comment not found." };

  const role = await getCurrentUserRole(supabase, user.id);
  if (existing.user_id !== user.id && role === "user") {
    return { success: false, error: "You can only delete your own comments." };
  }

  const { error } = await supabase
    .from("anime_comments")
    .delete()
    .eq("id", cleanId);

  if (error) return { success: false, error: "Failed to delete comment." };

  revalidatePath("/profile");
  return { success: true };
}

// ============================================================================
// 4. REACTIONS (Reviews, Discussions, Discussion Replies, Comments)
// ============================================================================

export async function toggleReactionAction(input: {
  targetType: ReactionTargetType;
  targetId: string;
  reactionType: ReactionType;
}): Promise<{
  success: boolean;
  error?: string;
  reactions?: ReactionSummary;
}> {
  const cleanId = (input.targetId ?? "").trim();
  const targetType = input.targetType;
  const reactionType = input.reactionType;

  if (!cleanId) {
    return { success: false, error: "Invalid content target." };
  }
  if (!VALID_REACTION_TYPES.includes(reactionType)) {
    return { success: false, error: "Invalid reaction type." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to react to content.",
    };
  }

  const check = await ensureUserProfileAndCheckRestriction(supabase, user);
  if (!check.allowed) {
    return { success: false, error: check.error };
  }

  // Verify target exists, is not hidden, and author has not blocked viewer
  let ownerId: string | null = null;
  let isHidden = false;

  if (targetType === "review") {
    const { data } = await supabase
      .from("anime_reviews")
      .select("user_id, is_hidden")
      .eq("id", cleanId)
      .maybeSingle();
    if (!data) return { success: false, error: "Review not found." };
    ownerId = data.user_id;
    isHidden = Boolean(data.is_hidden);
  } else if (targetType === "discussion") {
    const { data } = await supabase
      .from("discussions")
      .select("user_id, is_hidden")
      .eq("id", cleanId)
      .maybeSingle();
    if (!data) return { success: false, error: "Discussion not found." };
    ownerId = data.user_id;
    isHidden = Boolean(data.is_hidden);
  } else if (targetType === "discussion_reply") {
    const { data } = await supabase
      .from("discussion_replies")
      .select("user_id, is_hidden")
      .eq("id", cleanId)
      .maybeSingle();
    if (!data) return { success: false, error: "Reply not found." };
    ownerId = data.user_id;
    isHidden = Boolean(data.is_hidden);
  } else if (targetType === "comment") {
    const { data } = await supabase
      .from("anime_comments")
      .select("user_id, is_hidden")
      .eq("id", cleanId)
      .maybeSingle();
    if (!data) return { success: false, error: "Comment not found." };
    ownerId = data.user_id;
    isHidden = Boolean(data.is_hidden);
  } else {
    return { success: false, error: "Unsupported reaction target." };
  }

  if (isHidden) {
    return {
      success: false,
      error: "Cannot react to hidden or removed content.",
    };
  }

  if (ownerId && (await isBlockedBetween(supabase, user.id, ownerId))) {
    return {
      success: false,
      error: "Cannot react to this user's content due to block settings.",
    };
  }

  const { data: existing } = await supabase
    .from("content_reactions")
    .select("id, reaction_type")
    .eq("user_id", user.id)
    .eq("target_type", targetType)
    .eq("target_id", cleanId)
    .maybeSingle();

  if (existing) {
    if (existing.reaction_type === reactionType) {
      await supabase.from("content_reactions").delete().eq("id", existing.id);
    } else {
      await supabase
        .from("content_reactions")
        .update({ reaction_type: reactionType })
        .eq("id", existing.id);
    }
  } else {
    const { error: insertErr } = await supabase
      .from("content_reactions")
      .insert({
        user_id: user.id,
        target_type: targetType,
        target_id: cleanId,
        reaction_type: reactionType,
      });
    if (insertErr) {
      return { success: false, error: "Failed to save reaction." };
    }
  }

  const updatedMap = await fetchReactionsMap(
    supabase,
    targetType,
    [cleanId],
    user.id
  );

  return {
    success: true,
    reactions: updatedMap.get(cleanId) ?? {
      like: 0,
      helpful: 0,
      fire: 0,
      userReaction: null,
    },
  };
}

// ============================================================================
// 5. REPORTING SYSTEM
// ============================================================================

export async function submitContentReportAction(input: {
  contentType: ReportContentType;
  contentId: string;
  category: ReportCategory;
  explanation?: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.contentId ?? "").trim();
  const contentType = input.contentType;
  const category = input.category;
  const cleanExplanation = (input.explanation ?? "").trim();

  if (!cleanId) {
    return { success: false, error: "Invalid target ID." };
  }
  if (!VALID_REPORT_CATEGORIES.includes(category)) {
    return { success: false, error: "Please select a valid report category." };
  }
  if (cleanExplanation.length > 1000) {
    return {
      success: false,
      error: "Explanation cannot exceed 1,000 characters.",
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
      error: "You must be signed in to submit a report.",
    };
  }

  await ensureUserProfileAndCheckRestriction(supabase, user);

  // Verify target exists and prevent self-reporting
  let targetOwnerId: string | null = null;
  if (contentType === "profile") {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", cleanId)
      .maybeSingle();
    if (!data) return { success: false, error: "Profile not found." };
    targetOwnerId = data.id;
  } else if (contentType === "review") {
    const { data } = await supabase
      .from("anime_reviews")
      .select("user_id")
      .eq("id", cleanId)
      .maybeSingle();
    if (!data) return { success: false, error: "Review not found." };
    targetOwnerId = data.user_id;
  } else if (contentType === "discussion") {
    const { data } = await supabase
      .from("discussions")
      .select("user_id")
      .eq("id", cleanId)
      .maybeSingle();
    if (!data) return { success: false, error: "Discussion not found." };
    targetOwnerId = data.user_id;
  } else if (contentType === "discussion_reply") {
    const { data } = await supabase
      .from("discussion_replies")
      .select("user_id")
      .eq("id", cleanId)
      .maybeSingle();
    if (!data) return { success: false, error: "Reply not found." };
    targetOwnerId = data.user_id;
  } else if (contentType === "comment") {
    const { data } = await supabase
      .from("anime_comments")
      .select("user_id")
      .eq("id", cleanId)
      .maybeSingle();
    if (!data) return { success: false, error: "Comment not found." };
    targetOwnerId = data.user_id;
  } else {
    return { success: false, error: "Unsupported report target." };
  }

  if (targetOwnerId === user.id) {
    return { success: false, error: "You cannot report your own content." };
  }

  // Check duplicate active report
  const { data: existingReport } = await supabase
    .from("content_reports")
    .select("id, status")
    .eq("reporter_id", user.id)
    .eq("content_type", contentType)
    .eq("content_id", cleanId)
    .in("status", ["pending", "reviewing"])
    .maybeSingle();

  if (existingReport) {
    return {
      success: false,
      error:
        "You have already submitted an active report for this item. Our moderation team is reviewing it.",
    };
  }

  const reasonSummary = cleanExplanation
    ? `[${category}] ${cleanExplanation}`
    : `[${category}]`;

  const { error } = await supabase.from("content_reports").insert({
    reporter_id: user.id,
    content_type: contentType,
    content_id: cleanId,
    category,
    explanation: cleanExplanation || null,
    reason: reasonSummary,
    status: "pending",
  });

  if (error) {
    if (error.code === "23505") {
      return {
        success: false,
        error: "You already have an open report for this item.",
      };
    }
    return {
      success: false,
      error: "Failed to submit report. Please try again.",
    };
  }

  revalidatePath("/moderation");
  revalidatePath("/admin/moderation");
  return { success: true };
}

// ============================================================================
// 6. USER BLOCKING
// ============================================================================

export async function blockUserAction(input: {
  blockedUserId: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanBlockedId = (input.blockedUserId ?? "").trim();
  if (!cleanBlockedId) {
    return { success: false, error: "Invalid user ID." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in to block a user." };
  }

  if (user.id === cleanBlockedId) {
    return { success: false, error: "You cannot block yourself." };
  }

  await ensureUserProfileAndCheckRestriction(supabase, user);

  const { error } = await supabase.from("user_blocks").upsert(
    {
      blocker_id: user.id,
      blocked_id: cleanBlockedId,
    },
    { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
  );

  if (error) {
    return { success: false, error: "Failed to block user." };
  }

  revalidatePath("/community");
  revalidatePath("/settings");
  revalidatePath("/profile");
  return { success: true };
}

export async function unblockUserAction(input: {
  blockedUserId: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanBlockedId = (input.blockedUserId ?? "").trim();
  if (!cleanBlockedId) {
    return { success: false, error: "Invalid user ID." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in." };
  }

  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", cleanBlockedId);

  if (error) {
    return { success: false, error: "Failed to unblock user." };
  }

  revalidatePath("/community");
  revalidatePath("/settings");
  revalidatePath("/profile");
  return { success: true };
}

export async function getBlockedUsersAction(): Promise<{
  blockedUsers: Array<{
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    blockedAt: string;
  }>;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { blockedUsers: [] };

  const { data: blocks } = await supabase
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", user.id)
    .order("created_at", { ascending: false });

  if (!blocks || blocks.length === 0) return { blockedUsers: [] };

  const ids = blocks.map((b) => b.blocked_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", ids);

  const profMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  return {
    blockedUsers: blocks.map((b) => {
      const p = profMap.get(b.blocked_id);
      return {
        id: b.blocked_id,
        username: p?.username || `user_${b.blocked_id.slice(0, 6)}`,
        displayName: p?.display_name ?? null,
        avatarUrl: p?.avatar_url ?? null,
        blockedAt: b.created_at,
      };
    }),
  };
}

// ============================================================================
// 7. MODERATION & ADMIN ENFORCEMENT
// ============================================================================

async function requireModeratorOrAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{
  authorized: boolean;
  userId?: string;
  role?: "moderator" | "admin";
  error?: string;
}> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { authorized: false, error: "Authentication required." };
  }

  const role = await getCurrentUserRole(supabase, user.id);
  if (role !== "moderator" && role !== "admin") {
    return {
      authorized: false,
      error: "Moderator or administrator privileges required.",
    };
  }

  return { authorized: true, userId: user.id, role };
}

export async function resolveReportAction(input: {
  reportId: string;
  status: "reviewing" | "resolved" | "dismissed";
  resolutionNotes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.reportId ?? "").trim();
  const cleanNotes = (input.resolutionNotes ?? "").trim();

  if (!cleanId) return { success: false, error: "Invalid report ID." };
  if (!["reviewing", "resolved", "dismissed"].includes(input.status)) {
    return { success: false, error: "Invalid report status." };
  }

  const supabase = await createClient();
  const mod = await requireModeratorOrAdmin(supabase);
  if (!mod.authorized || !mod.userId) {
    return { success: false, error: mod.error };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("content_reports")
    .update({
      status: input.status,
      resolution_notes: cleanNotes || null,
      resolved_by: mod.userId,
      resolved_at: input.status === "reviewing" ? null : now,
      updated_at: now,
    })
    .eq("id", cleanId);

  if (error) {
    return { success: false, error: "Failed to update report status." };
  }

  await supabase.from("moderation_logs").insert({
    actor_id: mod.userId,
    actor_role: mod.role || "moderator",
    action_type: `report_${input.status}`,
    target_type: "report",
    target_id: cleanId,
    reason: cleanNotes || `Marked report as ${input.status}`,
  });

  revalidatePath("/moderation");
  revalidatePath("/admin/moderation");
  return { success: true };
}

export async function moderateContentAction(input: {
  targetType: "review" | "discussion" | "discussion_reply" | "comment";
  targetId: string;
  action: "hide" | "restore" | "lock" | "unlock" | "delete";
  reason?: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.targetId ?? "").trim();
  const cleanReason = (input.reason ?? "").trim() || `Moderation: ${input.action}`;

  if (!cleanId) return { success: false, error: "Invalid target ID." };

  const supabase = await createClient();
  const mod = await requireModeratorOrAdmin(supabase);
  if (!mod.authorized || !mod.userId) {
    return { success: false, error: mod.error };
  }

  const now = new Date().toISOString();

  if (input.action === "lock" || input.action === "unlock") {
    if (input.targetType !== "discussion") {
      return {
        success: false,
        error: "Only discussions can be locked or unlocked.",
      };
    }
    const { error } = await supabase
      .from("discussions")
      .update({
        is_locked: input.action === "lock",
        updated_at: now,
      })
      .eq("id", cleanId);

    if (error) {
      return { success: false, error: "Failed to update discussion lock state." };
    }
  } else if (input.action === "hide" || input.action === "restore") {
    const hiddenVal = input.action === "hide";
    const tableMap = {
      review: "anime_reviews",
      discussion: "discussions",
      discussion_reply: "discussion_replies",
      comment: "anime_comments",
    } as const;
    const tableName = tableMap[input.targetType];
    if (!tableName) {
      return { success: false, error: "Invalid content type." };
    }

    const { error } = await supabase
      .from(tableName)
      .update({ is_hidden: hiddenVal, updated_at: now })
      .eq("id", cleanId);

    if (error) {
      return {
        success: false,
        error: `Failed to ${input.action} content.`,
      };
    }
  } else if (input.action === "delete") {
    const tableMap = {
      review: "anime_reviews",
      discussion: "discussions",
      discussion_reply: "discussion_replies",
      comment: "anime_comments",
    } as const;
    const tableName = tableMap[input.targetType];
    if (!tableName) {
      return { success: false, error: "Invalid content type." };
    }

    const { error } = await supabase.from(tableName).delete().eq("id", cleanId);
    if (error) {
      return { success: false, error: "Failed to delete content." };
    }
  } else {
    return { success: false, error: "Unsupported moderation action." };
  }

  await supabase.from("moderation_logs").insert({
    actor_id: mod.userId,
    actor_role: mod.role || "moderator",
    action_type: `${input.action}_${input.targetType}`,
    target_type: input.targetType,
    target_id: cleanId,
    reason: cleanReason,
  });

  revalidatePath("/community");
  revalidatePath("/moderation");
  revalidatePath("/admin/moderation");
  return { success: true };
}

export async function issueUserRestrictionAction(input: {
  targetUserId: string;
  restrictionType: "warning" | "temporary_suspension" | "permanent_suspension";
  reason: string;
  durationHours?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const cleanUserId = (input.targetUserId ?? "").trim();
  const cleanReason = (input.reason ?? "").trim();

  if (!cleanUserId) return { success: false, error: "Invalid user ID." };
  if (cleanReason.length < 3) {
    return {
      success: false,
      error: "Please provide a clear reason (at least 3 characters).",
    };
  }

  const supabase = await createClient();
  const mod = await requireModeratorOrAdmin(supabase);
  if (!mod.authorized || !mod.userId) {
    return { success: false, error: mod.error };
  }

  if (cleanUserId === mod.userId) {
    return {
      success: false,
      error: "You cannot apply a restriction to your own account.",
    };
  }

  const targetRole = await getCurrentUserRole(supabase, cleanUserId);
  if (targetRole === "admin") {
    return {
      success: false,
      error: "Cannot apply restrictions to an administrator.",
    };
  }
  if (targetRole === "moderator" && mod.role !== "admin") {
    return {
      success: false,
      error: "Only administrators can restrict a moderator.",
    };
  }

  let restrictedUntil: string | null = null;
  if (input.restrictionType === "temporary_suspension") {
    const hours = Math.max(Number(input.durationHours) || 24, 1);
    restrictedUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  }

  const { data: inserted, error } = await supabase
    .from("user_restrictions")
    .insert({
      user_id: cleanUserId,
      restriction_type: input.restrictionType,
      status: "active",
      reason: cleanReason,
      restricted_until: restrictedUntil,
      created_by: mod.userId,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { success: false, error: "Failed to apply user restriction." };
  }

  await supabase.from("moderation_logs").insert({
    actor_id: mod.userId,
    actor_role: mod.role || "moderator",
    action_type: `issue_${input.restrictionType}`,
    target_type: "user",
    target_id: cleanUserId,
    target_user_id: cleanUserId,
    reason: cleanReason,
    metadata: {
      restriction_id: inserted.id,
      restricted_until: restrictedUntil,
    },
  });

  revalidatePath("/moderation");
  revalidatePath("/admin/moderation");
  return { success: true };
}

export async function revokeUserRestrictionAction(input: {
  restrictionId: string;
  reason?: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanId = (input.restrictionId ?? "").trim();
  const cleanReason =
    (input.reason ?? "").trim() || "Restriction revoked by moderator";

  if (!cleanId) return { success: false, error: "Invalid restriction ID." };

  const supabase = await createClient();
  const mod = await requireModeratorOrAdmin(supabase);
  if (!mod.authorized || !mod.userId) {
    return { success: false, error: mod.error };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("user_restrictions")
    .update({
      status: "revoked",
      revoked_at: now,
      revoked_by: mod.userId,
    })
    .eq("id", cleanId)
    .select("user_id")
    .maybeSingle();

  if (error || !updated) {
    return { success: false, error: "Failed to revoke restriction." };
  }

  await supabase.from("moderation_logs").insert({
    actor_id: mod.userId,
    actor_role: mod.role || "moderator",
    action_type: "revoke_restriction",
    target_type: "user",
    target_id: updated.user_id,
    target_user_id: updated.user_id,
    reason: cleanReason,
    metadata: { restriction_id: cleanId },
  });

  revalidatePath("/moderation");
  revalidatePath("/admin/moderation");
  return { success: true };
}

export async function manageUserRoleAction(input: {
  targetUserId: string;
  role: "user" | "moderator" | "admin";
}): Promise<{ success: boolean; error?: string }> {
  const cleanUserId = (input.targetUserId ?? "").trim();
  if (!cleanUserId) return { success: false, error: "Invalid user ID." };
  if (!["user", "moderator", "admin"].includes(input.role)) {
    return { success: false, error: "Invalid role." };
  }

  const supabase = await createClient();
  const mod = await requireModeratorOrAdmin(supabase);
  if (!mod.authorized || !mod.userId || mod.role !== "admin") {
    return {
      success: false,
      error: "Administrator privileges are required to manage user roles.",
    };
  }

  if (cleanUserId === mod.userId && input.role !== "admin") {
    return {
      success: false,
      error: "You cannot demote your own administrator account.",
    };
  }

  const { error } = await supabase.from("user_roles").upsert(
    {
      user_id: cleanUserId,
      role: input.role,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return { success: false, error: "Failed to update user role." };
  }

  await supabase.from("moderation_logs").insert({
    actor_id: mod.userId,
    actor_role: mod.role || "admin",
    action_type: `set_role_${input.role}`,
    target_type: "user",
    target_id: cleanUserId,
    target_user_id: cleanUserId,
    reason: `Role updated to ${input.role}`,
  });

  revalidatePath("/moderation");
  revalidatePath("/admin/moderation");
  return { success: true };
}

// ============================================================================
// 7. COMMUNITY & ACTIVITY RIGHT PANEL DATA
// ============================================================================

export interface RightPanelUserProfileDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileVisibility: "public" | "private";
}

export interface RightPanelCommunityMemberDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isPublicProfile: boolean;
  recentActivity: string | null;
  lastActiveAt: string | null;
}

export interface RightPanelWatchRoomDTO {
  id: string;
  roomTitle: string;
  animeExternalId: string;
  animeSlug: string;
  animeTitle: string;
  animeCover: string | null;
  episodeNumber: number;
  totalEpisodes: number | null;
  language: "sub" | "dub";
  status: "live" | "intermission";
  privacy: "public";
  maxParticipants: number;
  participantCount: number;
  createdAt: string;
  host: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isPublicProfile: boolean;
  };
}

export interface RightPanelTrendingDiscussionDTO {
  id: string;
  title: string;
  category: "discussion" | "question";
  replyCount: number;
  reactionCount: number;
  createdAt: string;
  latestActivityAt: string;
  mediaTitle: string | null;
  mediaSlug: string | null;
  mediaType: "anime" | "manga" | null;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isPublicProfile: boolean;
  };
}

export interface RightPanelDataResponse {
  success: boolean;
  error?: string;
  currentUserProfile: RightPanelUserProfileDTO | null;
  blockedUserIds: string[];
  friendshipSystemAvailable: boolean;
  friends: RightPanelCommunityMemberDTO[];
  activeMembers: RightPanelCommunityMemberDTO[];
  watchRooms: RightPanelWatchRoomDTO[];
  trendingDiscussions: RightPanelTrendingDiscussionDTO[];
}

export async function getRightPanelDataAction(): Promise<RightPanelDataResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const currentUserId = user?.id ?? null;
    const { set: blockedSet, bidirectionalRpcSucceeded } =
      await getBlockedUserSetWithMeta(supabase, currentUserId);

    // 1. Fetch current user profile if authenticated
    let currentUserProfile: RightPanelUserProfileDTO | null = null;
    if (user) {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, profile_visibility")
        .eq("id", user.id)
        .maybeSingle();

      const fallbackUsername =
        profileRow?.username ||
        (user.user_metadata?.username as string | undefined) ||
        user.email?.split("@")[0] ||
        `user_${user.id.slice(0, 8)}`;

      const fallbackDisplayName =
        profileRow?.display_name ||
        (user.user_metadata?.display_name as string | undefined) ||
        fallbackUsername;

      currentUserProfile = {
        id: user.id,
        username: fallbackUsername,
        displayName: fallbackDisplayName,
        avatarUrl:
          profileRow?.avatar_url ||
          (user.user_metadata?.avatar_url as string | undefined) ||
          null,
        profileVisibility:
          profileRow?.profile_visibility === "private" ? "private" : "public",
      };
    }

    // 2. Fetch shared Watch Together rooms & Discussions in parallel
    const [sharedWatchData, discussionsRes] = await Promise.all([
      fetchSharedWatchTogetherRooms(supabase, {
        currentUserId,
        precomputedBlockedSet: blockedSet,
      }),
      supabase
        .from("discussions")
        .select(
          "id, user_id, anime_id, media_type, category, title, body, is_hidden, created_at"
        )
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (discussionsRes.error) {
      throw new Error(discussionsRes.error.message);
    }

    const initialDiscussions = discussionsRes.data ?? [];

    // If `get_bidirectional_blocked_user_ids` RPC is not yet deployed on a remote DB,
    // verify candidate author/host/participant IDs with the existing `is_blocked_between`
    // SECURITY DEFINER RPC so bidirectional blocking is enforced in both directions.
    if (currentUserId && !bidirectionalRpcSucceeded) {
      const initialCandidates = new Set<string>();
      for (const r of sharedWatchData.lobbyRooms) {
        if (r.hostId && r.hostId !== currentUserId && !blockedSet.has(r.hostId)) {
          initialCandidates.add(r.hostId);
        }
      }
      for (const d of initialDiscussions) {
        if (d.user_id && d.user_id !== currentUserId && !blockedSet.has(d.user_id)) {
          initialCandidates.add(d.user_id);
        }
      }
      if (initialCandidates.size > 0) {
        await Promise.all(
          Array.from(initialCandidates).map(async (candidateId) => {
            const blocked = await isBlockedBetween(
              supabase,
              currentUserId,
              candidateId
            );
            if (blocked) blockedSet.add(candidateId);
          })
        );
      }
    }

    const rawDiscussions = initialDiscussions.filter(
      (d) => !blockedSet.has(d.user_id)
    );

    const discussionIds = rawDiscussions.map((d) => d.id);

    // Fetch discussion replies & reactions for those discussions (with bounded limits)
    const [repliesRes, reactionsRes] = await Promise.all([
      discussionIds.length > 0
        ? supabase
            .from("discussion_replies")
            .select("id, discussion_id, user_id, is_hidden, created_at")
            .in("discussion_id", discussionIds)
            .eq("is_hidden", false)
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
      discussionIds.length > 0
        ? supabase
            .from("content_reactions")
            .select("target_id, user_id, reaction_type")
            .eq("target_type", "discussion")
            .in("target_id", discussionIds)
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (currentUserId && !bidirectionalRpcSucceeded) {
      const secondaryCandidates = new Set<string>();
      for (const r of repliesRes.data ?? []) {
        if (r.user_id && r.user_id !== currentUserId && !blockedSet.has(r.user_id)) {
          secondaryCandidates.add(r.user_id);
        }
      }
      for (const rx of reactionsRes.data ?? []) {
        if (rx.user_id && rx.user_id !== currentUserId && !blockedSet.has(rx.user_id)) {
          secondaryCandidates.add(rx.user_id);
        }
      }
      if (secondaryCandidates.size > 0) {
        await Promise.all(
          Array.from(secondaryCandidates).map(async (candidateId) => {
            const blocked = await isBlockedBetween(
              supabase,
              currentUserId,
              candidateId
            );
            if (blocked) blockedSet.add(candidateId);
          })
        );
      }
    }

    const validReplies = (repliesRes.data ?? []).filter(
      (r) => !blockedSet.has(r.user_id)
    );
    const validReactions = (reactionsRes.data ?? []).filter(
      (r) => !blockedSet.has(r.user_id)
    );

    // Collect all user IDs and media external IDs we need profiles/titles for
    const profileIdsSet = new Set<string>();
    const mediaExternalIdsSet = new Set<number>();

    for (const hostId of sharedWatchData.hostActivityMap.keys()) {
      if (!blockedSet.has(hostId)) {
        profileIdsSet.add(hostId);
      }
    }
    for (const d of rawDiscussions) {
      profileIdsSet.add(d.user_id);
      const rawKey = String(d.anime_id ?? "").replace(/^manga:/, "");
      const numId = Number(rawKey);
      if (Number.isFinite(numId) && numId > 0) {
        mediaExternalIdsSet.add(numId);
      }
    }
    for (const r of validReplies) {
      profileIdsSet.add(r.user_id);
    }

    const profileIds = Array.from(profileIdsSet);
    const mediaExternalIds = Array.from(mediaExternalIdsSet);

    const [profilesRes, mediaRes] = await Promise.all([
      profileIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, username, display_name, avatar_url, profile_visibility")
            .in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      mediaExternalIds.length > 0
        ? supabase
            .from("anime")
            .select("external_id, slug, title_romaji, title_english, media_type")
            .in("external_id", mediaExternalIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const profileMap = new Map<
      string,
      {
        id: string;
        username: string;
        displayName: string;
        avatarUrl: string | null;
        isPublicProfile: boolean;
      }
    >();

    for (const p of profilesRes.data ?? []) {
      const fallback = `user_${p.id.slice(0, 6)}`;
      const username = p.username || fallback;
      profileMap.set(p.id, {
        id: p.id,
        username,
        displayName: p.display_name || username,
        avatarUrl: p.avatar_url ?? null,
        isPublicProfile: p.profile_visibility === "public",
      });
    }

    const getAuthorProfile = (userId: string) => {
      const existing = profileMap.get(userId);
      if (existing) return existing;
      const fallback = `user_${userId.slice(0, 6)}`;
      return {
        id: userId,
        username: fallback,
        displayName: fallback,
        avatarUrl: null,
        isPublicProfile: false,
      };
    };

    const mediaMap = new Map<
      string,
      { title: string; slug: string; mediaType: "anime" | "manga" }
    >();
    for (const m of mediaRes.data ?? []) {
      const mType: "anime" | "manga" =
        m.media_type === "manga" ? "manga" : "anime";
      const info = {
        title: m.title_english || m.title_romaji,
        slug: m.slug,
        mediaType: mType,
      };
      mediaMap.set(String(m.external_id), info);
      if (mType === "manga") {
        mediaMap.set(`manga:${m.external_id}`, info);
      }
    }

    // 3. Build Public Joinable Watch Together Rooms from the shared service
    const watchRooms: RightPanelWatchRoomDTO[] = sharedWatchData.drawerRooms
      .filter((r) => !blockedSet.has(r.hostId))
      .map((room) => ({
        id: room.id,
        roomTitle: room.roomTitle,
        animeExternalId: room.animeExternalId,
        animeSlug: room.animeSlug,
        animeTitle: room.animeTitle,
        animeCover: room.animeCover,
        episodeNumber: room.episodeNumber,
        totalEpisodes: room.totalEpisodes,
        language: room.language,
        status: room.status,
        privacy: "public" as const,
        maxParticipants: room.maxParticipants,
        participantCount: room.participantCount,
        createdAt: room.createdAt,
        host: room.host,
      }));

    const memberActivityMap = new Map<
      string,
      { recentActivity: string; lastActiveAt: string }
    >();
    for (const [hostId, activity] of sharedWatchData.hostActivityMap.entries()) {
      if (!blockedSet.has(hostId)) {
        memberActivityMap.set(hostId, activity);
      }
    }

    // 4. Build Trending Community Discussions
    const replyStatsByDiscussion = new Map<
      string,
      { count: number; latestAt: string | null }
    >();

    for (const reply of validReplies) {
      const curr = replyStatsByDiscussion.get(reply.discussion_id) ?? {
        count: 0,
        latestAt: null,
      };
      curr.count += 1;
      if (
        !curr.latestAt ||
        new Date(reply.created_at).getTime() > new Date(curr.latestAt).getTime()
      ) {
        curr.latestAt = reply.created_at;
      }
      replyStatsByDiscussion.set(reply.discussion_id, curr);

      if (!memberActivityMap.has(reply.user_id)) {
        memberActivityMap.set(reply.user_id, {
          recentActivity: "Replied in Community",
          lastActiveAt: reply.created_at,
        });
      }
    }

    const reactionCountByDiscussion = new Map<string, number>();
    for (const rx of validReactions) {
      reactionCountByDiscussion.set(
        rx.target_id,
        (reactionCountByDiscussion.get(rx.target_id) ?? 0) + 1
      );
    }

    const allTrendingCandidates: (RightPanelTrendingDiscussionDTO & {
      score: number;
    })[] = [];

    for (const d of rawDiscussions) {
      const replyStats = replyStatsByDiscussion.get(d.id) ?? {
        count: 0,
        latestAt: null,
      };
      const reactionCount = reactionCountByDiscussion.get(d.id) ?? 0;
      const latestActivityAt =
        replyStats.latestAt &&
        new Date(replyStats.latestAt).getTime() > new Date(d.created_at).getTime()
          ? replyStats.latestAt
          : d.created_at;

      const mediaKey = String(d.anime_id ?? "community");
      const mediaInfo = mediaMap.get(mediaKey);
      const mediaTitle =
        mediaKey === "community"
          ? "General Community"
          : mediaInfo?.title ?? null;

      const author = getAuthorProfile(d.user_id);

      if (!memberActivityMap.has(d.user_id)) {
        memberActivityMap.set(d.user_id, {
          recentActivity:
            d.category === "question"
              ? `Asked: ${d.title}`
              : `Posted: ${d.title}`,
          lastActiveAt: d.created_at,
        });
      }

      // Score combines reply engagement, reactions, and recency boost
      const ageHours = Math.max(
        0,
        (Date.now() - new Date(latestActivityAt).getTime()) / (1000 * 3600)
      );
      const recencyBonus = Math.max(0, 24 - ageHours) * 0.1;
      const score = replyStats.count * 3 + reactionCount * 2 + recencyBonus;

      allTrendingCandidates.push({
        id: d.id,
        title: d.title,
        category: d.category === "question" ? "question" : "discussion",
        replyCount: replyStats.count,
        reactionCount,
        createdAt: d.created_at,
        latestActivityAt,
        mediaTitle,
        mediaSlug: mediaInfo?.slug ?? null,
        mediaType:
          d.media_type === "anime" || d.media_type === "manga"
            ? d.media_type
            : mediaInfo?.mediaType ?? null,
        author,
        score,
      });
    }

    allTrendingCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (
        new Date(b.latestActivityAt).getTime() -
        new Date(a.latestActivityAt).getTime()
      );
    });

    const trendingDiscussions: RightPanelTrendingDiscussionDTO[] =
      allTrendingCandidates.slice(0, 4).map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        replyCount: item.replyCount,
        reactionCount: item.reactionCount,
        createdAt: item.createdAt,
        latestActivityAt: item.latestActivityAt,
        mediaTitle: item.mediaTitle,
        mediaSlug: item.mediaSlug,
        mediaType: item.mediaType,
        author: item.author,
      }));

    // 5. Build Active Public Community Members list (excluding current user and blocked users)
    const activeMembers: RightPanelCommunityMemberDTO[] = [];
    for (const [uid, activity] of memberActivityMap.entries()) {
      if (uid === currentUserId || blockedSet.has(uid)) continue;
      const prof = getAuthorProfile(uid);
      if (!prof.isPublicProfile) continue;
      activeMembers.push({
        id: uid,
        username: prof.username,
        displayName: prof.displayName,
        avatarUrl: prof.avatarUrl,
        isPublicProfile: prof.isPublicProfile,
        recentActivity: activity.recentActivity,
        lastActiveAt: activity.lastActiveAt,
      });
    }

    activeMembers.sort((a, b) => {
      const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
      const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
      return tb - ta;
    });

    return {
      success: true,
      currentUserProfile,
      blockedUserIds: Array.from(blockedSet),
      friendshipSystemAvailable: false,
      friends: [],
      activeMembers: activeMembers.slice(0, 6),
      watchRooms: watchRooms.slice(0, 4),
      trendingDiscussions,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load activity panel data.";
    return {
      success: false,
      error: message,
      currentUserProfile: null,
      blockedUserIds: [],
      friendshipSystemAvailable: false,
      friends: [],
      activeMembers: [],
      watchRooms: [],
      trendingDiscussions: [],
    };
  }
}
