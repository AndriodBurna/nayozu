import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { ReactionSummary, ReactionTargetType } from "@/lib/actions/communityActions";
import CommunityClient, {
  type CommunityPostItem,
  type CommunityReplyItem,
  type MediaOption,
} from "./community-client";

export const metadata: Metadata = {
  title: "Community | NAYOZU",
  description:
    "Join anime and manga discussions, read community reviews, and ask questions on Nayozu.",
};

interface RawProfile {
  username: string | null;
  display_name?: string | null;
  avatar_url: string | null;
}

interface RawDiscussionRow {
  id: string;
  user_id: string;
  anime_id: string;
  media_type: "community" | "anime" | "manga";
  category: "discussion" | "question";
  title: string;
  body: string;
  is_spoiler: boolean;
  is_locked: boolean;
  is_hidden: boolean;
  created_at: string;
  profiles: RawProfile | RawProfile[] | null;
}

interface RawDiscussionReplyRow {
  id: string;
  discussion_id: string;
  user_id: string;
  body: string;
  is_spoiler: boolean;
  is_hidden: boolean;
  created_at: string;
  profiles: RawProfile | RawProfile[] | null;
}

interface RawCommentRow {
  id: string;
  user_id: string;
  anime_id: string;
  parent_comment_id: string | null;
  body: string;
  is_spoiler: boolean;
  is_hidden: boolean;
  created_at: string;
  profiles: RawProfile | RawProfile[] | null;
}

interface RawReviewRow {
  id: string;
  user_id: string;
  anime_id: string;
  title: string | null;
  body: string;
  is_hidden?: boolean;
  created_at: string;
  profiles: RawProfile | RawProfile[] | null;
}

interface RawMediaRow {
  external_id: number;
  slug: string;
  title_romaji: string;
  title_english: string | null;
  media_type: string;
}

function normalizeProfile(raw: RawProfile | RawProfile[] | null, userId: string) {
  const p = Array.isArray(raw) ? raw[0] : raw;
  const fallback = `user_${userId.slice(0, 6)}`;
  return {
    id: userId,
    username: p?.username || fallback,
    displayName: p?.display_name || p?.username || fallback,
    avatarUrl: p?.avatar_url ?? null,
  };
}

function parseCommentTitleAndBody(rawBody: string): {
  kind: "discussion" | "question";
  title: string | null;
  body: string;
} {
  const trimmed = rawBody.trim();
  const isQuestionPrefix = /^\[question\]\s*/i.test(trimmed);
  const cleaned = trimmed.replace(/^\[question\]\s*/i, "");

  const paragraphs = cleaned.split(/\n\n+/);
  let title: string | null = null;
  let body = cleaned;

  if (paragraphs.length > 1 && paragraphs[0].length <= 140) {
    title = paragraphs[0].trim();
    body = paragraphs.slice(1).join("\n\n").trim();
  }

  const isQuestion =
    isQuestionPrefix ||
    Boolean(title && title.endsWith("?")) ||
    (!title && body.length < 220 && body.endsWith("?"));

  return {
    kind: isQuestion ? "question" : "discussion",
    title,
    body,
  };
}

export default async function CommunityPage({
  searchParams,
}: {
  searchParams?: Promise<{ discussion?: string | string[] }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const rawDiscParam = resolvedSearchParams?.discussion;
  const initialDiscussionId = Array.isArray(rawDiscParam)
    ? rawDiscParam[0] ?? null
    : rawDiscParam ?? null;

  const supabase = await createClient();

  let loadError: string | null = null;
  let currentUser: {
    id: string;
    username: string;
    avatarUrl: string | null;
  } | null = null;

  try {
    const [
      discussionsRes,
      discussionRepliesRes,
      commentsRes,
      reviewsRes,
      mediaRes,
      authRes,
    ] = await Promise.all([
      supabase
        .from("discussions")
        .select(
          `
          id,
          user_id,
          anime_id,
          media_type,
          category,
          title,
          body,
          is_spoiler,
          is_locked,
          is_hidden,
          created_at,
          profiles ( username, display_name, avatar_url )
        `
        )
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(80),

      supabase
        .from("discussion_replies")
        .select(
          `
          id,
          discussion_id,
          user_id,
          body,
          is_spoiler,
          is_hidden,
          created_at,
          profiles ( username, display_name, avatar_url )
        `
        )
        .eq("is_hidden", false)
        .order("created_at", { ascending: true })
        .limit(300),

      supabase
        .from("anime_comments")
        .select(
          `
          id,
          user_id,
          anime_id,
          parent_comment_id,
          body,
          is_spoiler,
          is_hidden,
          created_at,
          profiles ( username, display_name, avatar_url )
        `
        )
        .eq("is_hidden", false)
        .neq("anime_id", "watch_room")
        .is("episode_number", null)
        .is("chapter_number", null)
        .order("created_at", { ascending: false })
        .limit(80),

      supabase
        .from("anime_reviews")
        .select(
          `
          id,
          user_id,
          anime_id,
          title,
          body,
          is_hidden,
          created_at,
          profiles ( username, display_name, avatar_url )
        `
        )
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(50),

      supabase
        .from("anime")
        .select("external_id, slug, title_romaji, title_english, media_type")
        .order("popularity", { ascending: false, nullsFirst: false })
        .limit(80),

      supabase.auth.getUser(),
    ]);

    if (commentsRes.error && reviewsRes.error && discussionsRes.error) {
      loadError = commentsRes.error.message;
    }

    const user = authRes.data?.user;
    const blockedUserIds = new Set<string>();

    if (user) {
      const [{ data: profileData }, { data: blocksData }] = await Promise.all([
        supabase
          .from("profiles")
          .select("username, display_name, avatar_url")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("user_blocks")
          .select("blocker_id, blocked_id")
          .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`),
      ]);

      for (const b of blocksData ?? []) {
        if (b.blocker_id === user.id) blockedUserIds.add(b.blocked_id);
        if (b.blocked_id === user.id) blockedUserIds.add(b.blocker_id);
      }

      const fallbackUsername =
        profileData?.username ||
        (user.user_metadata?.username as string | undefined) ||
        user.email?.split("@")[0] ||
        `user_${user.id.slice(0, 6)}`;

      currentUser = {
        id: user.id,
        username: fallbackUsername,
        avatarUrl: profileData?.avatar_url ?? null,
      };
    }

    const rawMedia = (mediaRes.data ?? []) as RawMediaRow[];
    const mediaMap = new Map<
      string,
      { title: string; slug: string; mediaType: "anime" | "manga" }
    >();
    const mediaOptions: MediaOption[] = [];

    for (const m of rawMedia) {
      const mediaType = m.media_type === "manga" ? "manga" : "anime";
      const canonicalKey =
        mediaType === "manga" ? `manga:${m.external_id}` : String(m.external_id);
      const title = m.title_english || m.title_romaji;

      mediaMap.set(canonicalKey, { title, slug: m.slug, mediaType });
      mediaMap.set(String(m.external_id), { title, slug: m.slug, mediaType });
      mediaOptions.push({
        externalId: canonicalKey,
        title,
        slug: m.slug,
        mediaType,
      });
    }

    const rawDiscussions = (
      (discussionsRes.data ?? []) as unknown as RawDiscussionRow[]
    ).filter((r) => !blockedUserIds.has(r.user_id));

    const rawDiscReplies = (
      (discussionRepliesRes.data ?? []) as unknown as RawDiscussionReplyRow[]
    ).filter((r) => !blockedUserIds.has(r.user_id));

    const rawComments = (
      (commentsRes.data ?? []) as unknown as RawCommentRow[]
    ).filter((r) => !blockedUserIds.has(r.user_id));

    const rawReviews = (
      (reviewsRes.data ?? []) as unknown as RawReviewRow[]
    ).filter((r) => !blockedUserIds.has(r.user_id));

    // Fetch reactions for all loaded entities
    const allTargetIds = [
      ...rawDiscussions.map((d) => d.id),
      ...rawDiscReplies.map((r) => r.id),
      ...rawComments.map((c) => c.id),
      ...rawReviews.map((r) => r.id),
    ];

    const reactionsByKey = new Map<string, ReactionSummary>();
    if (allTargetIds.length > 0) {
      const { data: reactionRows } = await supabase
        .from("content_reactions")
        .select("target_type, target_id, user_id, reaction_type")
        .in("target_id", allTargetIds);

      for (const r of reactionRows ?? []) {
        const key = `${r.target_type}:${r.target_id}`;
        let summary = reactionsByKey.get(key);
        if (!summary) {
          summary = { like: 0, helpful: 0, fire: 0, userReaction: null };
          reactionsByKey.set(key, summary);
        }
        const rt = r.reaction_type as string;
        if (rt === "like" || rt === "helpful" || rt === "fire") {
          summary[rt] += 1;
          if (user && r.user_id === user.id) {
            summary.userReaction = rt;
          }
        }
      }
    }

    const getReaction = (
      targetType: ReactionTargetType,
      targetId: string
    ): ReactionSummary =>
      reactionsByKey.get(`${targetType}:${targetId}`) ?? {
        like: 0,
        helpful: 0,
        fire: 0,
        userReaction: null,
      };

    // Group discussion_replies by discussion_id
    const discRepliesByParent = new Map<string, CommunityReplyItem[]>();
    for (const row of rawDiscReplies) {
      const list = discRepliesByParent.get(row.discussion_id) ?? [];
      list.push({
        id: row.id,
        userId: row.user_id,
        body: row.body,
        createdAt: row.created_at,
        author: normalizeProfile(row.profiles, row.user_id),
        targetType: "discussion_reply",
        reactions: getReaction("discussion_reply", row.id),
      });
      discRepliesByParent.set(row.discussion_id, list);
    }

    // Group legacy comment replies by parent_comment_id
    const commentRepliesByParent = new Map<string, CommunityReplyItem[]>();
    const topLevelComments: RawCommentRow[] = [];

    for (const row of rawComments) {
      if (row.parent_comment_id) {
        const list = commentRepliesByParent.get(row.parent_comment_id) ?? [];
        list.push({
          id: row.id,
          userId: row.user_id,
          body: row.body,
          createdAt: row.created_at,
          author: normalizeProfile(row.profiles, row.user_id),
          targetType: "comment",
          reactions: getReaction("comment", row.id),
        });
        commentRepliesByParent.set(row.parent_comment_id, list);
      } else {
        topLevelComments.push(row);
      }
    }

    const posts: CommunityPostItem[] = [];

    // 1. Dedicated discussions table
    for (const d of rawDiscussions) {
      const mediaKey = d.anime_id || "community";
      const mediaInfo = mediaMap.get(mediaKey);
      posts.push({
        id: d.id,
        rawId: d.id,
        userId: d.user_id,
        kind: d.category === "question" ? "question" : "discussion",
        sourceTable: "discussions",
        targetType: "discussion",
        animeId: mediaKey,
        mediaTitle:
          mediaKey === "community"
            ? "General Community"
            : mediaInfo?.title ?? `Title #${mediaKey}`,
        mediaSlug: mediaInfo?.slug ?? null,
        mediaType:
          d.media_type === "anime" || d.media_type === "manga"
            ? d.media_type
            : mediaInfo?.mediaType ?? null,
        title: d.title,
        body: d.body,
        isSpoiler: Boolean(d.is_spoiler),
        isLocked: Boolean(d.is_locked),
        createdAt: d.created_at,
        author: normalizeProfile(d.profiles, d.user_id),
        reactions: getReaction("discussion", d.id),
        replies: discRepliesByParent.get(d.id) ?? [],
      });
    }

    // 2. Legacy top-level community comments
    for (const c of topLevelComments) {
      const parsed = parseCommentTitleAndBody(c.body);
      const mediaInfo = mediaMap.get(String(c.anime_id));
      const replies = (commentRepliesByParent.get(c.id) ?? []).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      posts.push({
        id: c.id,
        rawId: c.id,
        userId: c.user_id,
        kind: parsed.kind,
        sourceTable: "anime_comments",
        targetType: "comment",
        animeId: String(c.anime_id),
        mediaTitle:
          c.anime_id === "community"
            ? "General Community"
            : mediaInfo?.title ?? `Anime #${c.anime_id}`,
        mediaSlug: mediaInfo?.slug ?? null,
        mediaType: mediaInfo?.mediaType ?? null,
        title: parsed.title,
        body: parsed.body,
        isSpoiler: Boolean(c.is_spoiler),
        isLocked: false,
        createdAt: c.created_at,
        author: normalizeProfile(c.profiles, c.user_id),
        reactions: getReaction("comment", c.id),
        replies,
      });
    }

    // 3. Reviews
    for (const r of rawReviews) {
      const mediaInfo = mediaMap.get(String(r.anime_id));
      posts.push({
        id: `review-${r.id}`,
        rawId: r.id,
        userId: r.user_id,
        kind: "review",
        sourceTable: "anime_reviews",
        targetType: "review",
        animeId: String(r.anime_id),
        mediaTitle: mediaInfo?.title ?? `Title #${r.anime_id}`,
        mediaSlug: mediaInfo?.slug ?? null,
        mediaType:
          String(r.anime_id).startsWith("manga:")
            ? "manga"
            : mediaInfo?.mediaType ?? "anime",
        title: r.title,
        body: r.body,
        isSpoiler: false,
        isLocked: false,
        createdAt: r.created_at,
        author: normalizeProfile(r.profiles, r.user_id),
        reactions: getReaction("review", r.id),
        replies: [],
      });
    }

    posts.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return (
      <CommunityClient
        initialPosts={posts}
        mediaOptions={mediaOptions}
        currentUser={currentUser}
        loadError={loadError}
        initialDiscussionId={initialDiscussionId}
      />
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load community feed";
    return (
      <CommunityClient
        initialPosts={[]}
        mediaOptions={[]}
        currentUser={null}
        loadError={message}
        initialDiscussionId={initialDiscussionId}
      />
    );
  }
}
