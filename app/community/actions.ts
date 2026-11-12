"use server";

import { revalidatePath } from "next/cache";
import {
  createDiscussionAction,
  createDiscussionReplyAction,
  upsertReviewAction,
  createMediaCommentAction,
} from "@/lib/actions/communityActions";
import { createClient } from "@/lib/supabase/server";

export interface CreateCommunityPostInput {
  postType: "discussion" | "question" | "review";
  animeId?: string | null;
  mediaType?: "anime" | "manga" | null;
  title?: string | null;
  body: string;
  score?: number | null;
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

  if (input.postType === "review") {
    if (!rawAnimeId || rawAnimeId === "community") {
      return {
        success: false,
        error: "Please select an anime or manga title to publish a review.",
      };
    }

    const mediaType =
      rawAnimeId.startsWith("manga:") || input.mediaType === "manga"
        ? "manga"
        : "anime";

    const res = await upsertReviewAction({
      externalId: rawAnimeId,
      mediaType,
      title: cleanTitle || null,
      body: cleanBody,
      score: input.score ?? null,
    });
    return { success: res.success, error: res.error };
  }

  // Discussion or Question -> stored in public.discussions
  const fallbackTitle =
    cleanTitle ||
    cleanBody
      .split("\n")[0]
      .slice(0, 90)
      .trim() ||
    (input.postType === "question" ? "Community Question" : "Community Discussion");

  const res = await createDiscussionAction({
    title: fallbackTitle,
    body: cleanBody,
    category: input.postType === "question" ? "question" : "discussion",
    mediaId: rawAnimeId && rawAnimeId !== "community" ? rawAnimeId : null,
    mediaType:
      rawAnimeId.startsWith("manga:") || input.mediaType === "manga"
        ? "manga"
        : rawAnimeId
          ? "anime"
          : null,
    isSpoiler: Boolean(input.isSpoiler),
  });

  return { success: res.success, error: res.error };
}

export async function createCommunityReplyAction(input: {
  parentCommentId: string;
  animeId: string;
  body: string;
  isDiscussionTable?: boolean;
}): Promise<CreateCommunityPostResult> {
  const cleanBody = (input.body ?? "").trim();
  if (!cleanBody) {
    return { success: false, error: "Reply cannot be empty." };
  }

  const supabase = await createClient();
  const { data: disc } = await supabase
    .from("discussions")
    .select("id")
    .eq("id", input.parentCommentId)
    .maybeSingle();

  if (disc || input.isDiscussionTable) {
    const res = await createDiscussionReplyAction({
      discussionId: input.parentCommentId,
      body: cleanBody,
    });
    return { success: res.success, error: res.error };
  }

  const res = await createMediaCommentAction({
    externalId: input.animeId || "community",
    mediaType: input.animeId?.startsWith("manga:") ? "manga" : "anime",
    parentCommentId: input.parentCommentId,
    body: cleanBody,
  });

  revalidatePath("/community");
  return { success: res.success, error: res.error };
}
