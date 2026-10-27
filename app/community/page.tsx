import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
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

export default async function CommunityPage() {
  const supabase = await createClient();

  let loadError: string | null = null;
  let currentUser: {
    id: string;
    username: string;
    avatarUrl: string | null;
  } | null = null;

  try {
    const [commentsRes, reviewsRes, mediaRes, authRes] = await Promise.all([
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
        .order("created_at", { ascending: false })
        .limit(100),

      supabase
        .from("anime_reviews")
        .select(
          `
          id,
          user_id,
          anime_id,
          title,
          body,
          created_at,
          profiles ( username, display_name, avatar_url )
        `
        )
        .order("created_at", { ascending: false })
        .limit(50),

      supabase
        .from("anime")
        .select("external_id, slug, title_romaji, title_english, media_type")
        .order("popularity", { ascending: false, nullsFirst: false })
        .limit(60),

      supabase.auth.getUser(),
    ]);

    if (commentsRes.error && reviewsRes.error) {
      loadError = commentsRes.error.message;
    }

    const user = authRes.data?.user;
    if (user) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

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
      const extId = String(m.external_id);
      const title = m.title_english || m.title_romaji;
      const mediaType = m.media_type === "manga" ? "manga" : "anime";
      mediaMap.set(extId, { title, slug: m.slug, mediaType });
      mediaOptions.push({
        externalId: extId,
        title,
        slug: m.slug,
        mediaType,
      });
    }

    const rawComments = (commentsRes.data ?? []) as unknown as RawCommentRow[];
    const rawReviews = (reviewsRes.data ?? []) as unknown as RawReviewRow[];

    // Group replies by parent_comment_id
    const repliesByParent = new Map<string, CommunityReplyItem[]>();
    const topLevelComments: RawCommentRow[] = [];

    for (const row of rawComments) {
      if (row.parent_comment_id) {
        const list = repliesByParent.get(row.parent_comment_id) ?? [];
        list.push({
          id: row.id,
          body: row.body,
          createdAt: row.created_at,
          author: normalizeProfile(row.profiles, row.user_id),
        });
        repliesByParent.set(row.parent_comment_id, list);
      } else {
        topLevelComments.push(row);
      }
    }

    const posts: CommunityPostItem[] = [];

    for (const c of topLevelComments) {
      const parsed = parseCommentTitleAndBody(c.body);
      const mediaInfo = mediaMap.get(String(c.anime_id));
      const replies = (repliesByParent.get(c.id) ?? []).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      posts.push({
        id: c.id,
        kind: parsed.kind,
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
        createdAt: c.created_at,
        author: normalizeProfile(c.profiles, c.user_id),
        replies,
      });
    }

    for (const r of rawReviews) {
      const mediaInfo = mediaMap.get(String(r.anime_id));
      posts.push({
        id: `review-${r.id}`,
        kind: "review",
        animeId: String(r.anime_id),
        mediaTitle: mediaInfo?.title ?? `Anime #${r.anime_id}`,
        mediaSlug: mediaInfo?.slug ?? null,
        mediaType: mediaInfo?.mediaType ?? null,
        title: r.title,
        body: r.body,
        isSpoiler: false,
        createdAt: r.created_at,
        author: normalizeProfile(r.profiles, r.user_id),
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
      />
    );
  }
}
