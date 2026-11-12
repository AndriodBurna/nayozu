import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadUserLibraryBundle } from "@/lib/services/userLibraryServer";
import ProfileClient, { type ProfilePageData } from "./profile-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Profile | Nayozu",
  description:
    "View and manage your Nayozu profile, username, bio, personal anime and manga libraries, reviews, discussions, and comments.",
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : {};
  const initialTab = resolvedParams?.tab || "watchlist";

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?next=/profile");
  }

  const fallbackUsername =
    (user.user_metadata?.username as string | undefined) ||
    user.email?.split("@")[0]?.replace(/[^a-zA-Z0-9_-]/g, "_") ||
    `user_${user.id.slice(0, 8)}`;

  const fallbackDisplayName =
    (user.user_metadata?.display_name as string | undefined) || fallbackUsername;

  const fallbackAvatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) || "";

  // Ensure profile row exists in public.profiles (graceful self-healing)
  await supabase.from("profiles").upsert(
    {
      id: user.id,
      username: fallbackUsername,
      display_name: fallbackDisplayName,
      avatar_url: fallbackAvatarUrl || null,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );

  const [
    profileRes,
    roleRes,
    libraryBundle,
    reviewsRes,
    ratingsRes,
    discussionsRes,
    commentsRes,
    mediaRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle(),
    loadUserLibraryBundle(),
    supabase
      .from("anime_reviews")
      .select("id, anime_id, title, body, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("anime_ratings")
      .select("anime_id, score")
      .eq("user_id", user.id),
    supabase
      .from("discussions")
      .select(
        "id, anime_id, media_type, category, title, body, is_locked, created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("anime_comments")
      .select(
        "id, anime_id, media_type, episode_number, chapter_number, body, created_at"
      )
      .eq("user_id", user.id)
      .neq("anime_id", "watch_room")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("anime")
      .select("external_id, slug, title_romaji, title_english, media_type")
      .limit(200),
  ]);

  const mediaMap = new Map<
    string,
    { title: string; slug: string; mediaType: "anime" | "manga" }
  >();
  for (const m of mediaRes.data ?? []) {
    const mt = m.media_type === "manga" ? "manga" : "anime";
    const title = m.title_english || m.title_romaji;
    mediaMap.set(String(m.external_id), { title, slug: m.slug, mediaType: mt });
    if (mt === "manga") {
      mediaMap.set(`manga:${m.external_id}`, {
        title,
        slug: m.slug,
        mediaType: "manga",
      });
    }
  }

  const scoreByMedia = new Map<string, number>();
  for (const r of ratingsRes.data ?? []) {
    scoreByMedia.set(r.anime_id, Number(r.score));
  }

  const profileRow = profileRes.data;

  const initialProfile: ProfilePageData = {
    id: user.id,
    email: user.email ?? null,
    username: profileRow?.username || fallbackUsername,
    displayName:
      profileRow?.display_name || fallbackDisplayName || fallbackUsername,
    avatarUrl: profileRow?.avatar_url || fallbackAvatarUrl || "",
    bio: profileRow?.bio || "",
    profileVisibility:
      profileRow?.profile_visibility === "private" ? "private" : "public",
    role: roleRes.data?.role || "user",
    createdAt: profileRow?.created_at || user.created_at || null,
    updatedAt: profileRow?.updated_at || null,
    initialTab,
    animeWatchlist: libraryBundle.animeWatchlist,
    mangaReadingList: libraryBundle.mangaReadingList,
    favorites: libraryBundle.favorites,
    historyItems: libraryBundle.historyItems,
    myReviews: (reviewsRes.data ?? []).map((r) => {
      const m = mediaMap.get(r.anime_id);
      return {
        id: r.id,
        animeId: r.anime_id,
        mediaTitle: m?.title ?? `Title #${r.anime_id}`,
        mediaSlug: m?.slug ?? null,
        mediaType:
          r.anime_id.startsWith("manga:") ? "manga" : m?.mediaType ?? "anime",
        title: r.title,
        body: r.body,
        score: scoreByMedia.get(r.anime_id) ?? null,
        createdAt: r.created_at,
      };
    }),
    myDiscussions: (discussionsRes.data ?? []).map((d) => {
      const m =
        d.anime_id && d.anime_id !== "community"
          ? mediaMap.get(d.anime_id)
          : undefined;
      return {
        id: d.id,
        category: d.category === "question" ? "question" : "discussion",
        title: d.title,
        body: d.body,
        mediaTitle: m?.title ?? null,
        mediaSlug: m?.slug ?? null,
        mediaType:
          d.media_type === "anime" || d.media_type === "manga"
            ? d.media_type
            : m?.mediaType ?? null,
        isLocked: Boolean(d.is_locked),
        createdAt: d.created_at,
      };
    }),
    myComments: (commentsRes.data ?? []).map((c) => {
      const m = mediaMap.get(c.anime_id);
      return {
        id: c.id,
        animeId: c.anime_id,
        mediaTitle:
          c.anime_id === "community"
            ? "General Community"
            : m?.title ?? `Title #${c.anime_id}`,
        mediaSlug: m?.slug ?? null,
        mediaType:
          c.media_type === "manga" ? "manga" : m?.mediaType ?? "anime",
        episodeNumber: c.episode_number ?? null,
        chapterNumber: c.chapter_number ?? null,
        body: c.body,
        createdAt: c.created_at,
      };
    }),
  };

  return <ProfileClient initialProfile={initialProfile} />;
}
