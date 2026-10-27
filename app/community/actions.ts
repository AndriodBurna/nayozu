"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface CreateCommunityPostInput {
  postType: "discussion" | "question" | "review";
  animeId?: string | null;
  title?: string | null;
  body: string;
  isSpoiler?: boolean;
}

export interface CreateCommunityPostResult {
  success: boolean;
  error?: string;
}

export async function createCommunityPostAction(
  input: CreateCommunityPostInput
): Promise<CreateCommunityPostResult> {
  const cleanBody = (input.body ?? "").trim();
  const cleanTitle = (input.title ?? "").trim();
  const rawAnimeId = (input.animeId ?? "").trim();

  if (!cleanBody) {
    return { success: false, error: "Post content cannot be empty." };
  }

  if (cleanBody.length > 4000) {
    return {
      success: false,
      error: "Post content cannot exceed 4,000 characters.",
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
      error: "You must be signed in to publish a community post.",
    };
  }

  // Ensure a profile row exists for the authenticated user so foreign-key joins succeed
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

  // Check if user has an active posting restriction
  const { data: restrictions } = await supabase
    .from("user_restrictions")
    .select("restriction_type, expires_at")
    .eq("user_id", user.id);

  if (Array.isArray(restrictions) && restrictions.length > 0) {
    const nowMs = Date.now();
    const activeRestriction = restrictions.find(
      (r) => !r.expires_at || new Date(r.expires_at).getTime() > nowMs
    );
    if (activeRestriction) {
      return {
        success: false,
        error: "Your account is currently restricted from posting.",
      };
    }
  }

  const now = new Date().toISOString();

  if (input.postType === "review") {
    if (!rawAnimeId || rawAnimeId === "community") {
      return {
        success: false,
        error: "Please select an anime or manga title to publish a review.",
      };
    }

    const { error } = await supabase.from("anime_reviews").insert({
      user_id: user.id,
      anime_id: rawAnimeId,
      title: cleanTitle || null,
      body: cleanBody,
      created_at: now,
      updated_at: now,
    });

    if (error) {
      return {
        success: false,
        error: error.message || "Failed to save review to database.",
      };
    }

    revalidatePath("/community");
    return { success: true };
  }

  // Discussion or Question -> stored in anime_comments
  let finalBody = cleanBody;
  if (input.postType === "question") {
    const hasQuestionMark = cleanBody.includes("?") || cleanTitle.includes("?");
    if (cleanTitle) {
      finalBody = `[Question] ${cleanTitle}${hasQuestionMark ? "" : "?"}\n\n${cleanBody}`;
    } else if (!cleanBody.toLowerCase().startsWith("[question]")) {
      finalBody = `[Question] ${cleanBody}`;
    }
  } else if (cleanTitle) {
    finalBody = `${cleanTitle}\n\n${cleanBody}`;
  }

  const targetAnimeId = rawAnimeId || "community";

  const { error } = await supabase.from("anime_comments").insert({
    user_id: user.id,
    anime_id: targetAnimeId,
    parent_comment_id: null,
    body: finalBody,
    is_spoiler: Boolean(input.isSpoiler),
    is_hidden: false,
    created_at: now,
    updated_at: now,
  });

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to save discussion post to database.",
    };
  }

  revalidatePath("/community");
  return { success: true };
}

export async function createCommunityReplyAction(input: {
  parentCommentId: string;
  animeId: string;
  body: string;
}): Promise<CreateCommunityPostResult> {
  const cleanBody = (input.body ?? "").trim();
  if (!cleanBody) {
    return { success: false, error: "Reply cannot be empty." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to reply.",
    };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("anime_comments").insert({
    user_id: user.id,
    anime_id: input.animeId || "community",
    parent_comment_id: input.parentCommentId,
    body: cleanBody,
    is_spoiler: false,
    is_hidden: false,
    created_at: now,
    updated_at: now,
  });

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to save reply.",
    };
  }

  revalidatePath("/community");
  return { success: true };
}
