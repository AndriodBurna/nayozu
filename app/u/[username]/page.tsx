import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  checkIsBlockedBetweenWithClient,
  findFriendshipBetweenUsersWithClient,
  resolveFriendshipStatusForViewer,
  type FriendshipRelationshipStatus,
} from "@/lib/friends/friendsService";
import {
  PublicProfileClient,
  type PublicProfileContribution,
} from "./public-profile-client";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username: rawParam } = await params;
  const decodedUsername = decodeURIComponent(rawParam ?? "").trim();
  if (!decodedUsername) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id ?? null;

  // Query via security-definer helper or safe select that enforces privacy on the server
  const escapedUsername = decodedUsername.replace(/[%_\\]/g, "\\$&");
  const { data: profileRow } = await supabase
    .from("profiles")
    .select(
      "id, username, display_name, avatar_url, bio, profile_visibility, created_at"
    )
    .ilike("username", escapedUsername)
    .maybeSingle();

  if (!profileRow) {
    notFound();
  }

  const isOwner = Boolean(currentUserId && currentUserId === profileRow.id);
  const visibility: "public" | "private" =
    profileRow.profile_visibility === "private" ? "private" : "public";

  // Check block and friendship status for current viewer
  let initialBlocked = false;
  let initialBlockedEitherWay = false;
  let initialFriendshipStatus: FriendshipRelationshipStatus = isOwner
    ? "self"
    : "none";
  let initialFriendshipId: string | null = null;

  if (currentUserId && !isOwner) {
    const [{ data: blockRow }, blockedEitherWay, friendshipRow] =
      await Promise.all([
        supabase
          .from("user_blocks")
          .select("id")
          .eq("blocker_id", currentUserId)
          .eq("blocked_id", profileRow.id)
          .maybeSingle(),
        checkIsBlockedBetweenWithClient(supabase, currentUserId, profileRow.id),
        findFriendshipBetweenUsersWithClient(
          supabase,
          currentUserId,
          profileRow.id
        ),
      ]);
    initialBlocked = Boolean(blockRow);
    initialBlockedEitherWay = blockedEitherWay;
    initialFriendshipStatus = resolveFriendshipStatusForViewer({
      viewerId: currentUserId,
      targetUserId: profileRow.id,
      row: friendshipRow,
      isBlocked: blockedEitherWay,
    });
    initialFriendshipId = friendshipRow?.id ?? null;
  }

  const isAcceptedFriend = initialFriendshipStatus === "friends";
  const allowPersonalDetails =
    !initialBlockedEitherWay &&
    (visibility === "public" || isOwner || isAcceptedFriend);

  // Load public reviews and discussions (public contributions remain public independently of profile visibility)
  const [{ data: reviews }, { data: ratings }, { data: discussions }, { data: mediaRows }] =
    await Promise.all([
      supabase
        .from("anime_reviews")
        .select("id, anime_id, title, body, created_at")
        .eq("user_id", profileRow.id)
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("anime_ratings")
        .select("anime_id, score")
        .eq("user_id", profileRow.id),
      supabase
        .from("discussions")
        .select("id, anime_id, media_type, category, title, body, created_at")
        .eq("user_id", profileRow.id)
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("anime")
        .select("external_id, slug, title_romaji, title_english, media_type")
        .limit(200),
    ]);

  const mediaMap = new Map<
    string,
    { title: string; slug: string; mediaType: "anime" | "manga" }
  >();
  for (const m of mediaRows ?? []) {
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
  for (const r of ratings ?? []) {
    scoreByMedia.set(r.anime_id, Number(r.score));
  }

  const contributions: PublicProfileContribution[] = [];

  for (const rev of reviews ?? []) {
    const m = mediaMap.get(rev.anime_id);
    contributions.push({
      id: rev.id,
      kind: "review",
      title: rev.title,
      body: rev.body,
      mediaTitle: m?.title ?? `Title #${rev.anime_id}`,
      mediaSlug: m?.slug ?? null,
      mediaType:
        rev.anime_id.startsWith("manga:") ? "manga" : m?.mediaType ?? "anime",
      score: scoreByMedia.get(rev.anime_id) ?? null,
      createdAt: rev.created_at,
    });
  }

  for (const d of discussions ?? []) {
    const m =
      d.anime_id && d.anime_id !== "community"
        ? mediaMap.get(d.anime_id)
        : undefined;
    contributions.push({
      id: d.id,
      kind: d.category === "question" ? "question" : "discussion",
      title: d.title,
      body: d.body,
      mediaTitle: m?.title ?? null,
      mediaSlug: m?.slug ?? null,
      mediaType:
        d.media_type === "anime" || d.media_type === "manga"
          ? d.media_type
          : m?.mediaType ?? null,
      createdAt: d.created_at,
    });
  }

  return (
    <PublicProfileClient
      profile={{
        id: profileRow.id,
        username: profileRow.username,
        displayName: profileRow.display_name || profileRow.username,
        avatarUrl: profileRow.avatar_url ?? null,
        bio: allowPersonalDetails ? profileRow.bio ?? null : null,
        profileVisibility: visibility,
        createdAt: allowPersonalDetails ? profileRow.created_at ?? null : null,
        isOwner,
      }}
      contributions={contributions}
      currentUserId={currentUserId}
      initialBlocked={initialBlocked}
      initialBlockedEitherWay={initialBlockedEitherWay}
      initialFriendshipStatus={initialFriendshipStatus}
      initialFriendshipId={initialFriendshipId}
    />
  );
}
