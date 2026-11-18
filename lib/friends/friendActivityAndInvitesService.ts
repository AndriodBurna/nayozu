import {
  checkIsBlockedBetweenWithClient,
  checkUserRestrictedWithClient,
  findFriendshipBetweenUsersWithClient,
  getBidirectionalBlockedSetWithClient,
  type FriendshipRow,
  type SupabaseLikeClient,
} from "@/lib/friends/friendsService";
import {
  classifyWatchRoomLifecycle,
  computeActiveRoomParticipants,
  parseWatchRoomPayloadSync,
  parseWatchRoomPresenceRecord,
  resolveWatchRoomMediaMetadata,
  serializeWatchRoomPresenceRecord,
  STALE_ROOM_TTL_MS,
  withWatchRoomJoinLock,
  type RawWatchRoomAnimeRow,
  type WatchRoomHostProfile,
  type WatchRoomLifecycleState,
} from "@/lib/watch-together/roomService";

// ============================================================================
// Feature A: Friend Activity Feed Types
// ============================================================================

export type FriendActivityType =
  | "started_watching"
  | "completed_anime"
  | "updated_watching_progress"
  | "started_reading"
  | "completed_manga"
  | "updated_reading_progress"
  | "published_review"
  | "published_discussion"
  | "watch_room_active";

export type FriendActivityFilter =
  | "all"
  | "watching_reading"
  | "reviews_discussions"
  | "watch_together";

export interface FriendActivityActorDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isPublicProfile: boolean;
}

export interface FriendActivityMediaDTO {
  externalId: string;
  slug: string | null;
  title: string;
  coverImage: string | null;
  mediaType: "anime" | "manga";
}

export interface FriendActivityItemDTO {
  id: string;
  activityType: FriendActivityType;
  actor: FriendActivityActorDTO;
  description: string;
  media: FriendActivityMediaDTO | null;
  title: string | null;
  excerpt: string | null;
  isSpoiler: boolean;
  score: number | null;
  progress: number | null;
  totalUnits: number | null;
  linkUrl: string;
  createdAt: string;
}

export interface FriendActivityFeedResult {
  success: boolean;
  items: FriendActivityItemDTO[];
  totalCount: number;
  page: number;
  limit: number;
  hasMore: boolean;
  acceptedFriendsCount: number;
  error?: string;
}

export interface ActivityPrivacySettingsDTO {
  shareActivityWithFriends: boolean;
  shareLibraryActivityWithFriends: boolean;
  notifyWatchTogetherInvites: boolean;
}

// ============================================================================
// Feature B: Watch Together Invitation Types
// ============================================================================

export type WatchRoomInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

export interface WatchRoomInvitationRow {
  id: string;
  room_id: string;
  host_id: string;
  invitee_id: string;
  status: WatchRoomInvitationStatus;
  room_title_snapshot: string;
  anime_external_id: string;
  anime_slug: string | null;
  anime_title: string;
  anime_cover: string | null;
  episode_number: number;
  room_privacy: "public" | "private";
  created_at: string;
  updated_at: string;
  responded_at: string | null;
  expires_at: string;
}

export interface WatchRoomInvitationDTO {
  id: string;
  roomId: string;
  hostId: string;
  inviteeId: string;
  status: WatchRoomInvitationStatus;
  roomTitle: string;
  animeExternalId: string;
  animeSlug: string | null;
  animeTitle: string;
  animeCover: string | null;
  episodeNumber: number;
  roomPrivacy: "public" | "private";
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
  expiresAt: string;
  host: FriendActivityActorDTO;
  invitee: FriendActivityActorDTO;
  isRoomActive: boolean;
  roomParticipantCount: number | null;
  roomMaxParticipants: number | null;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function toTimestampMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function parseMediaStorageKey(rawAnimeId: string): {
  externalId: number | null;
  rawExternalId: string;
  mediaType: "anime" | "manga";
  isFavoriteEntry: boolean;
} {
  const trimmed = String(rawAnimeId ?? "").trim();
  if (trimmed.startsWith("fav:")) {
    return {
      externalId: null,
      rawExternalId: trimmed,
      mediaType: "anime",
      isFavoriteEntry: true,
    };
  }
  if (trimmed.startsWith("manga:")) {
    const rawExt = trimmed.slice("manga:".length).trim();
    const num = Number(rawExt);
    return {
      externalId: Number.isFinite(num) && num > 0 ? num : null,
      rawExternalId: rawExt,
      mediaType: "manga",
      isFavoriteEntry: false,
    };
  }
  if (trimmed.startsWith("anime:")) {
    const rawExt = trimmed.slice("anime:".length).trim();
    const num = Number(rawExt);
    return {
      externalId: Number.isFinite(num) && num > 0 ? num : null,
      rawExternalId: rawExt,
      mediaType: "anime",
      isFavoriteEntry: false,
    };
  }
  const num = Number(trimmed);
  return {
    externalId: Number.isFinite(num) && num > 0 ? num : null,
    rawExternalId: trimmed,
    mediaType: "anime",
    isFavoriteEntry: false,
  };
}

function buildExcerpt(body: string | null | undefined, maxLen = 180): string | null {
  const clean = String(body ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

// ============================================================================
// Feature A: Friend Activity Feed Implementation
// ============================================================================

export async function getActivityPrivacySettingsWithClient(
  supabase: SupabaseLikeClient,
  viewerId: string
): Promise<ActivityPrivacySettingsDTO> {
  const defaults: ActivityPrivacySettingsDTO = {
    shareActivityWithFriends: true,
    shareLibraryActivityWithFriends: true,
    notifyWatchTogetherInvites: true,
  };
  if (!viewerId) return defaults;

  try {
    const { data } = await supabase
      .from("profiles")
      .select(
        "share_activity_with_friends, share_library_activity_with_friends, notify_watch_together_invites"
      )
      .eq("id", viewerId)
      .maybeSingle();

    if (!data) return defaults;
    return {
      shareActivityWithFriends: data.share_activity_with_friends !== false,
      shareLibraryActivityWithFriends:
        data.share_library_activity_with_friends !== false,
      notifyWatchTogetherInvites: data.notify_watch_together_invites !== false,
    };
  } catch {
    return defaults;
  }
}

export async function updateActivityPrivacySettingsWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string;
    shareActivityWithFriends?: boolean;
    shareLibraryActivityWithFriends?: boolean;
    notifyWatchTogetherInvites?: boolean;
  }
): Promise<{
  success: boolean;
  settings: ActivityPrivacySettingsDTO;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const current = await getActivityPrivacySettingsWithClient(supabase, viewerId);

  if (!viewerId) {
    return {
      success: false,
      settings: current,
      error: "You must be signed in to update activity privacy settings.",
    };
  }

  const next: ActivityPrivacySettingsDTO = {
    shareActivityWithFriends:
      typeof input.shareActivityWithFriends === "boolean"
        ? input.shareActivityWithFriends
        : current.shareActivityWithFriends,
    shareLibraryActivityWithFriends:
      typeof input.shareLibraryActivityWithFriends === "boolean"
        ? input.shareLibraryActivityWithFriends
        : current.shareLibraryActivityWithFriends,
    notifyWatchTogetherInvites:
      typeof input.notifyWatchTogetherInvites === "boolean"
        ? input.notifyWatchTogetherInvites
        : current.notifyWatchTogetherInvites,
  };

  const { error } = await supabase
    .from("profiles")
    .update({
      share_activity_with_friends: next.shareActivityWithFriends,
      share_library_activity_with_friends: next.shareLibraryActivityWithFriends,
      notify_watch_together_invites: next.notifyWatchTogetherInvites,
      updated_at: new Date().toISOString(),
    })
    .eq("id", viewerId);

  if (error) {
    return {
      success: false,
      settings: current,
      error: "Failed to save activity privacy preferences.",
    };
  }

  return {
    success: true,
    settings: next,
  };
}

/**
 * Fetches the authenticated user's Friend Activity Feed.
 * Security & privacy enforcement:
 * - Only authenticated, non-restricted users can view the feed.
 * - Only activities from ACCEPTED friends (`status === 'accepted'`) are ever included.
 * - Bidirectionally blocked users and actively restricted users are strictly excluded.
 * - Respects each friend's `share_activity_with_friends` and `share_library_activity_with_friends`
 *   settings stored on `public.profiles`.
 * - Never exposes personal library entries with `status` in (`planned`, `on_hold`, `dropped`) or `fav:*`.
 * - Never exposes private Watch Together rooms unless the viewer has an active/accepted invitation from that host.
 * - Preserves `isSpoiler` on discussions/reviews so spoiler content is masked until revealed.
 * - Deterministic deduplication and bounded chronological pagination.
 */
export async function getFriendActivityFeedWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string | null | undefined;
    page?: number;
    limit?: number;
    filter?: FriendActivityFilter;
    nowMs?: number;
  }
): Promise<FriendActivityFeedResult> {
  const viewerId = (input.viewerId ?? "").trim();
  const page = Math.max(Math.floor(Number(input.page) || 1), 1);
  const limit = Math.min(Math.max(Math.floor(Number(input.limit) || 12), 1), 30);
  const filter: FriendActivityFilter = input.filter ?? "all";
  const nowMs = input.nowMs ?? Date.now();

  if (!viewerId) {
    return {
      success: false,
      items: [],
      totalCount: 0,
      page,
      limit,
      hasMore: false,
      acceptedFriendsCount: 0,
      error: "You must be signed in to view your friends' activity feed.",
    };
  }

  const viewerRestriction = await checkUserRestrictedWithClient(
    supabase,
    viewerId
  );
  if (viewerRestriction.restricted) {
    return {
      success: false,
      items: [],
      totalCount: 0,
      page,
      limit,
      hasMore: false,
      acceptedFriendsCount: 0,
      error: viewerRestriction.reason || "Your account is currently restricted.",
    };
  }

  const [blockedSet, friendshipsRes] = await Promise.all([
    getBidirectionalBlockedSetWithClient(supabase, viewerId),
    supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status")
      .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`)
      .eq("status", "accepted"),
  ]);

  const rawFriendRows = (friendshipsRes?.data ?? []) as FriendshipRow[];
  const candidateFriendIds = new Set<string>();
  for (const row of rawFriendRows) {
    if (row.status !== "accepted") continue;
    const friendId =
      row.requester_id === viewerId ? row.addressee_id : row.requester_id;
    if (friendId && friendId !== viewerId && !blockedSet.has(friendId)) {
      candidateFriendIds.add(friendId);
    }
  }

  if (candidateFriendIds.size === 0) {
    return {
      success: true,
      items: [],
      totalCount: 0,
      page,
      limit,
      hasMore: false,
      acceptedFriendsCount: 0,
    };
  }

  const candidateIdsArray = Array.from(candidateFriendIds);
  const [profilesRes, restrictionsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, username, display_name, avatar_url, profile_visibility, share_activity_with_friends, share_library_activity_with_friends"
      )
      .in("id", candidateIdsArray),
    supabase
      .from("user_restrictions")
      .select("user_id, status, restriction_type, restricted_until")
      .in("user_id", candidateIdsArray)
      .eq("status", "active"),
  ]);

  const restrictedFriendIds = new Set<string>();
  for (const r of restrictionsRes?.data ?? []) {
    if (
      r.restriction_type !== "warning" &&
      (!r.restricted_until || new Date(r.restricted_until).getTime() > nowMs)
    ) {
      restrictedFriendIds.add(r.user_id);
    }
  }

  const actorMap = new Map<string, FriendActivityActorDTO>();
  const permittedFriendIds: string[] = [];
  const libraryPermittedFriendIds: string[] = [];
  let acceptedFriendsCount = 0;

  for (const p of profilesRes?.data ?? []) {
    if (!p?.id || blockedSet.has(p.id) || restrictedFriendIds.has(p.id)) {
      continue;
    }
    acceptedFriendsCount += 1;

    const fallback = `user_${p.id.slice(0, 6)}`;
    const username = p.username || fallback;
    actorMap.set(p.id, {
      id: p.id,
      username,
      displayName: p.display_name || username,
      avatarUrl: p.avatar_url ?? null,
      isPublicProfile: p.profile_visibility === "public",
    });

    // Enforce friend's activity sharing preference
    if (p.share_activity_with_friends === false) {
      continue;
    }
    permittedFriendIds.push(p.id);

    if (p.share_library_activity_with_friends !== false) {
      libraryPermittedFriendIds.push(p.id);
    }
  }

  if (permittedFriendIds.length === 0) {
    return {
      success: true,
      items: [],
      totalCount: 0,
      page,
      limit,
      hasMore: false,
      acceptedFriendsCount,
    };
  }

  const permittedSet = new Set(permittedFriendIds);
  const libraryPermittedSet = new Set(libraryPermittedFriendIds);

  const includeWatchingReading =
    filter === "all" || filter === "watching_reading";
  const includeReviewsDiscussions =
    filter === "all" || filter === "reviews_discussions";
  const includeWatchTogether = filter === "all" || filter === "watch_together";

  // 1. Fetch library activities via database SECURITY DEFINER RPC (or fallback in test mocks)
  const fetchLibraryPromise = (async () => {
    if (!includeWatchingReading || libraryPermittedFriendIds.length === 0) {
      return [];
    }

    if (typeof supabase.rpc === "function") {
      try {
        const rpcRes = await supabase.rpc(
          "get_permitted_friend_library_activities",
          { p_limit: 80 }
        );
        if (!rpcRes?.error && Array.isArray(rpcRes?.data)) {
          return rpcRes.data.filter(
            (r: { user_id?: string; status?: string; anime_id?: string }) =>
              r?.user_id &&
              libraryPermittedSet.has(r.user_id) &&
              (r.status === "watching" || r.status === "completed") &&
              !String(r.anime_id ?? "").startsWith("fav:")
          );
        }
      } catch {
        // Fall through to bounded query for in-memory test mocks
      }
    }

    const { data } = await supabase
      .from("user_anime_library")
      .select("id, user_id, anime_id, status, progress, created_at, updated_at")
      .in("user_id", libraryPermittedFriendIds)
      .order("updated_at", { ascending: false })
      .limit(80);

    return (data ?? []).filter(
      (r: { user_id?: string; status?: string; anime_id?: string }) =>
        r?.user_id &&
        libraryPermittedSet.has(r.user_id) &&
        (r.status === "watching" || r.status === "completed") &&
        !String(r.anime_id ?? "").startsWith("fav:")
    );
  })();

  // 2. Fetch published reviews & ratings from permitted friends
  const fetchReviewsPromise = (async () => {
    if (!includeReviewsDiscussions) return { reviews: [], ratings: [] };
    const [revRes, ratRes] = await Promise.all([
      supabase
        .from("anime_reviews")
        .select(
          "id, user_id, anime_id, title, body, rating, is_hidden, created_at, updated_at"
        )
        .in("user_id", permittedFriendIds)
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("anime_ratings")
        .select("user_id, anime_id, score")
        .in("user_id", permittedFriendIds)
        .limit(100),
    ]);
    return {
      reviews: revRes?.data ?? [],
      ratings: ratRes?.data ?? [],
    };
  })();

  // 3. Fetch published discussions from permitted friends
  const fetchDiscussionsPromise = (async () => {
    if (!includeReviewsDiscussions) return [];
    const { data } = await supabase
      .from("discussions")
      .select(
        "id, user_id, anime_id, media_type, category, title, body, is_spoiler, is_hidden, created_at"
      )
      .in("user_id", permittedFriendIds)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(50);
    return data ?? [];
  })();

  // 4. Fetch active Watch Together rooms hosted by or joined by permitted friends
  const fetchWatchRoomsPromise = (async () => {
    if (!includeWatchTogether) {
      return { topRooms: [], childRows: [], viewerInvites: [] };
    }
    const [topRes, invitesRes] = await Promise.all([
      supabase
        .from("anime_comments")
        .select(
          "id, user_id, anime_id, parent_comment_id, body, is_hidden, created_at, updated_at"
        )
        .eq("anime_id", "watch_room")
        .is("parent_comment_id", null)
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("watch_room_invitations")
        .select("room_id, host_id, invitee_id, status, expires_at")
        .eq("invitee_id", viewerId)
        .limit(40),
    ]);

    const topRooms = (topRes?.data ?? []).filter(
      (r: { parent_comment_id?: string | null }) => !r.parent_comment_id
    );
    const topRoomIds = topRooms.map((r: { id: string }) => r.id);

    const childRes =
      topRoomIds.length > 0
        ? await supabase
            .from("anime_comments")
            .select(
              "id, user_id, anime_id, parent_comment_id, body, is_hidden, created_at, updated_at"
            )
            .eq("anime_id", "watch_room")
            .in("parent_comment_id", topRoomIds)
            .eq("is_hidden", false)
            .order("created_at", { ascending: false })
            .limit(200)
        : { data: [] };

    return {
      topRooms,
      childRows: childRes?.data ?? [],
      viewerInvites: invitesRes?.data ?? [],
    };
  })();

  const [libraryRows, { reviews, ratings }, discussionRows, watchRoomsData] =
    await Promise.all([
      fetchLibraryPromise,
      fetchReviewsPromise,
      fetchDiscussionsPromise,
      fetchWatchRoomsPromise,
    ]);

  // Collect all external media IDs for canonical catalog hydration
  const mediaExternalIdsSet = new Set<number>();

  for (const row of libraryRows) {
    const parsed = parseMediaStorageKey(row.anime_id);
    if (parsed.externalId) mediaExternalIdsSet.add(parsed.externalId);
  }
  for (const rev of reviews) {
    const parsed = parseMediaStorageKey(rev.anime_id);
    if (parsed.externalId) mediaExternalIdsSet.add(parsed.externalId);
  }
  for (const disc of discussionRows) {
    if (disc.anime_id && disc.anime_id !== "community") {
      const parsed = parseMediaStorageKey(disc.anime_id);
      if (parsed.externalId) mediaExternalIdsSet.add(parsed.externalId);
    }
  }
  for (const roomRow of watchRoomsData.topRooms) {
    const payload = parseWatchRoomPayloadSync(roomRow.body);
    if (payload) {
      const num = Number(payload.animeExternalId);
      if (Number.isFinite(num) && num > 0) mediaExternalIdsSet.add(num);
    }
  }

  const mediaMap = new Map<
    string,
    {
      externalId: string;
      slug: string | null;
      title: string;
      coverImage: string | null;
      mediaType: "anime" | "manga";
      totalUnits: number | null;
      rawRow: RawWatchRoomAnimeRow;
    }
  >();

  if (mediaExternalIdsSet.size > 0) {
    const { data: mediaRows } = await supabase
      .from("anime")
      .select(
        "external_id, slug, title_romaji, title_english, cover_image_url, episodes, chapters, status, media_type"
      )
      .in("external_id", Array.from(mediaExternalIdsSet));

    for (const m of mediaRows ?? []) {
      const mType: "anime" | "manga" =
        m.media_type === "manga" ? "manga" : "anime";
      const title = m.title_english || m.title_romaji;
      const totalUnits =
        mType === "manga"
          ? m.chapters
            ? Number(m.chapters)
            : null
          : m.episodes
          ? Number(m.episodes)
          : null;
      const entry = {
        externalId: String(m.external_id),
        slug: m.slug ?? null,
        title,
        coverImage: m.cover_image_url ?? null,
        mediaType: mType,
        totalUnits,
        rawRow: m as RawWatchRoomAnimeRow,
      };
      mediaMap.set(`${mType}:${m.external_id}`, entry);
      if (!mediaMap.has(String(m.external_id))) {
        mediaMap.set(String(m.external_id), entry);
      }
    }
  }

  const resolveMedia = (
    rawAnimeId: string,
    hintType?: "anime" | "manga" | null
  ) => {
    const parsed = parseMediaStorageKey(rawAnimeId);
    const effectiveType =
      hintType === "manga" || parsed.mediaType === "manga" ? "manga" : "anime";
    if (!parsed.externalId) return null;
    return (
      mediaMap.get(`${effectiveType}:${parsed.externalId}`) ||
      mediaMap.get(String(parsed.externalId)) ||
      null
    );
  };

  const dedupedItems = new Map<string, FriendActivityItemDTO>();

  // Build Library Activity Items
  for (const row of libraryRows) {
    if (!libraryPermittedSet.has(row.user_id)) continue;
    const actor = actorMap.get(row.user_id);
    if (!actor) continue;

    const parsed = parseMediaStorageKey(row.anime_id);
    if (parsed.isFavoriteEntry || !parsed.externalId) continue;

    const mediaInfo = resolveMedia(row.anime_id, parsed.mediaType);
    if (!mediaInfo) continue;

    const progress = Math.max(Math.floor(Number(row.progress) || 0), 0);
    const isManga = mediaInfo.mediaType === "manga";

    let activityType: FriendActivityType;
    let description: string;

    if (row.status === "completed") {
      activityType = isManga ? "completed_manga" : "completed_anime";
      description = isManga
        ? `Completed reading ${mediaInfo.title}`
        : `Completed watching ${mediaInfo.title}`;
    } else if (row.status === "watching") {
      if (progress <= 1) {
        activityType = isManga ? "started_reading" : "started_watching";
        description = isManga
          ? progress === 1
            ? `Started reading ${mediaInfo.title} · Chapter 1`
            : `Started reading ${mediaInfo.title}`
          : progress === 1
          ? `Started watching ${mediaInfo.title} · Episode 1`
          : `Started watching ${mediaInfo.title}`;
      } else {
        activityType = isManga
          ? "updated_reading_progress"
          : "updated_watching_progress";
        description = isManga
          ? `Read up to Chapter ${progress} of ${mediaInfo.title}`
          : `Watched up to Episode ${progress} of ${mediaInfo.title}`;
      }
    } else {
      continue;
    }

    const linkUrl = mediaInfo.slug
      ? `/${mediaInfo.mediaType}/${mediaInfo.slug}`
      : `/${mediaInfo.mediaType}`;
    const createdAt = row.updated_at || row.created_at;
    if (!createdAt) continue;

    const id = `${activityType}:${actor.id}:${mediaInfo.mediaType}:${mediaInfo.externalId}`;
    dedupedItems.set(id, {
      id,
      activityType,
      actor,
      description,
      media: {
        externalId: mediaInfo.externalId,
        slug: mediaInfo.slug,
        title: mediaInfo.title,
        coverImage: mediaInfo.coverImage,
        mediaType: mediaInfo.mediaType,
      },
      title: null,
      excerpt: null,
      isSpoiler: false,
      score: null,
      progress: progress > 0 ? progress : null,
      totalUnits: mediaInfo.totalUnits,
      linkUrl,
      createdAt,
    });
  }

  // Build Review Activity Items
  const ratingMap = new Map<string, number>();
  for (const r of ratings) {
    ratingMap.set(`${r.user_id}:${r.anime_id}`, Number(r.score));
  }

  for (const rev of reviews) {
    if (rev.is_hidden || !permittedSet.has(rev.user_id)) continue;
    const actor = actorMap.get(rev.user_id);
    if (!actor) continue;

    const mediaInfo = resolveMedia(rev.anime_id);
    if (!mediaInfo) continue;

    const score =
      typeof rev.rating === "number"
        ? rev.rating
        : ratingMap.get(`${rev.user_id}:${rev.anime_id}`) ?? null;

    const linkUrl = mediaInfo.slug
      ? `/${mediaInfo.mediaType}/${mediaInfo.slug}`
      : "/community";
    const id = `published_review:${actor.id}:${rev.id}`;

    dedupedItems.set(id, {
      id,
      activityType: "published_review",
      actor,
      description:
        score !== null
          ? `Published a review for ${mediaInfo.title} (${score}/10)`
          : `Published a review for ${mediaInfo.title}`,
      media: {
        externalId: mediaInfo.externalId,
        slug: mediaInfo.slug,
        title: mediaInfo.title,
        coverImage: mediaInfo.coverImage,
        mediaType: mediaInfo.mediaType,
      },
      title: rev.title ? String(rev.title).trim() : null,
      excerpt: buildExcerpt(rev.body),
      isSpoiler: false,
      score,
      progress: null,
      totalUnits: mediaInfo.totalUnits,
      linkUrl,
      createdAt: rev.created_at,
    });
  }

  // Build Discussion Activity Items
  for (const disc of discussionRows) {
    if (disc.is_hidden || !permittedSet.has(disc.user_id)) continue;
    const actor = actorMap.get(disc.user_id);
    if (!actor) continue;

    const isGeneral = !disc.anime_id || disc.anime_id === "community";
    const mediaInfo = isGeneral
      ? null
      : resolveMedia(
          disc.anime_id,
          disc.media_type === "manga" ? "manga" : "anime"
        );

    const id = `published_discussion:${actor.id}:${disc.id}`;
    const isQuestion = disc.category === "question";
    const description = mediaInfo
      ? isQuestion
        ? `Asked a question about ${mediaInfo.title}`
        : `Started a discussion on ${mediaInfo.title}`
      : isQuestion
      ? "Asked a question in Community"
      : "Started a discussion in Community";

    dedupedItems.set(id, {
      id,
      activityType: "published_discussion",
      actor,
      description,
      media: mediaInfo
        ? {
            externalId: mediaInfo.externalId,
            slug: mediaInfo.slug,
            title: mediaInfo.title,
            coverImage: mediaInfo.coverImage,
            mediaType: mediaInfo.mediaType,
          }
        : null,
      title: disc.title ? String(disc.title).trim() : null,
      excerpt: buildExcerpt(disc.body),
      isSpoiler: Boolean(disc.is_spoiler),
      score: null,
      progress: null,
      totalUnits: null,
      linkUrl: `/community?discussion=${disc.id}`,
      createdAt: disc.created_at,
    });
  }

  // Build Watch Together Room Activity Items
  const authorizedPrivateRoomIds = new Set<string>();
  for (const inv of watchRoomsData.viewerInvites) {
    if (
      inv &&
      inv.invitee_id === viewerId &&
      (inv.status === "pending" || inv.status === "accepted") &&
      toTimestampMs(inv.expires_at) > nowMs
    ) {
      authorizedPrivateRoomIds.add(inv.room_id);
    }
  }

  const childRowsByRoom = new Map<
    string,
    Array<{
      userId: string;
      isHidden: boolean;
      createdAt: string;
      updatedAt?: string | null;
      record: NonNullable<ReturnType<typeof parseWatchRoomPresenceRecord>>;
    }>
  >();
  const latestChatByRoom = new Map<string, number>();

  for (const child of watchRoomsData.childRows) {
    const roomId = child.parent_comment_id;
    if (!roomId || blockedSet.has(child.user_id)) continue;
    const rec = parseWatchRoomPresenceRecord(child.body);
    if (rec) {
      const list = childRowsByRoom.get(roomId) ?? [];
      list.push({
        userId: child.user_id,
        isHidden: Boolean(child.is_hidden),
        createdAt: child.created_at,
        updatedAt: child.updated_at ?? null,
        record: rec,
      });
      childRowsByRoom.set(roomId, list);
    } else if (!child.is_hidden) {
      const chatMs = toTimestampMs(child.created_at);
      const prev = latestChatByRoom.get(roomId) ?? 0;
      if (chatMs > prev) latestChatByRoom.set(roomId, chatMs);
    }
  }

  for (const roomRow of watchRoomsData.topRooms) {
    if (roomRow.is_hidden || blockedSet.has(roomRow.user_id)) continue;
    const payload = parseWatchRoomPayloadSync(roomRow.body);
    if (!payload) continue;

    // Never expose private rooms unless viewer has a valid active invitation from the host
    if (
      payload.privacy === "private" &&
      !authorizedPrivateRoomIds.has(roomRow.id)
    ) {
      continue;
    }

    const mediaInfo = resolveMedia(payload.animeExternalId, "anime");
    const resolvedMedia = resolveWatchRoomMediaMetadata(
      payload,
      mediaInfo?.rawRow ?? null
    );
    if (!resolvedMedia) continue;

    const hostFallback: WatchRoomHostProfile = actorMap.get(roomRow.user_id) ?? {
      id: roomRow.user_id,
      username: `user_${roomRow.user_id.slice(0, 6)}`,
      displayName: `user_${roomRow.user_id.slice(0, 6)}`,
      avatarUrl: null,
      isPublicProfile: false,
    };

    const presenceRows = childRowsByRoom.get(roomRow.id) ?? [];
    const { participantCount, activeUserIds, latestPresenceAtMs } =
      computeActiveRoomParticipants({
        hostId: roomRow.user_id,
        hostProfile: hostFallback,
        payload,
        roomCreatedAt: roomRow.created_at,
        roomUpdatedAt: roomRow.updated_at ?? null,
        presenceChildRows: presenceRows,
        blockedSet,
        nowMs,
      });

    const lifecycle = classifyWatchRoomLifecycle({
      payload,
      isHidden: Boolean(roomRow.is_hidden),
      roomCreatedAt: roomRow.created_at,
      roomUpdatedAt: roomRow.updated_at ?? null,
      latestPresenceAtMs,
      latestChatAtMs: latestChatByRoom.get(roomRow.id) ?? 0,
      participantCount,
      nowMs,
    });

    if (
      lifecycle.lifecycleState === "ended" ||
      lifecycle.lifecycleState === "stale"
    ) {
      continue;
    }

    // Check if the host is a permitted friend
    if (permittedSet.has(roomRow.user_id)) {
      const hostActor = actorMap.get(roomRow.user_id);
      if (hostActor) {
        const id = `watch_room_active:${hostActor.id}:${roomRow.id}`;
        dedupedItems.set(id, {
          id,
          activityType: "watch_room_active",
          actor: hostActor,
          description: `Hosting Watch Together · ${resolvedMedia.animeTitle} (Ep ${resolvedMedia.episodeNumber})`,
          media: {
            externalId: resolvedMedia.animeExternalId,
            slug: resolvedMedia.animeSlug || null,
            title: resolvedMedia.animeTitle,
            coverImage: resolvedMedia.animeCover,
            mediaType: "anime",
          },
          title:
            payload.privacy === "private"
              ? "Private Watch Together Room"
              : payload.roomTitle,
          excerpt:
            payload.privacy === "private"
              ? null
              : buildExcerpt(payload.description, 140),
          isSpoiler: false,
          score: null,
          progress: resolvedMedia.episodeNumber,
          totalUnits: resolvedMedia.totalEpisodes,
          linkUrl: `/watch-together?room=${roomRow.id}`,
          createdAt: lifecycle.lastActivityAt || roomRow.created_at,
        });
      }
    }

    // Also check if any permitted friend is an active participant in a public room
    if (payload.privacy === "public") {
      for (const participantId of activeUserIds) {
        if (
          participantId === roomRow.user_id ||
          !permittedSet.has(participantId)
        ) {
          continue;
        }
        const participantActor = actorMap.get(participantId);
        if (!participantActor) continue;

        const id = `watch_room_active:${participantActor.id}:${roomRow.id}`;
        dedupedItems.set(id, {
          id,
          activityType: "watch_room_active",
          actor: participantActor,
          description: `Joined Watch Together · ${resolvedMedia.animeTitle} (Ep ${resolvedMedia.episodeNumber})`,
          media: {
            externalId: resolvedMedia.animeExternalId,
            slug: resolvedMedia.animeSlug || null,
            title: resolvedMedia.animeTitle,
            coverImage: resolvedMedia.animeCover,
            mediaType: "anime",
          },
          title: payload.roomTitle,
          excerpt: null,
          isSpoiler: false,
          score: null,
          progress: resolvedMedia.episodeNumber,
          totalUnits: resolvedMedia.totalEpisodes,
          linkUrl: `/watch-together?room=${roomRow.id}`,
          createdAt: lifecycle.lastActivityAt || roomRow.created_at,
        });
      }
    }
  }

  const allItems = Array.from(dedupedItems.values()).sort((a, b) => {
    const diff = toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  const totalCount = allItems.length;
  const offset = (page - 1) * limit;
  const pagedItems = allItems.slice(offset, offset + limit);
  const hasMore = offset + pagedItems.length < totalCount;

  return {
    success: true,
    items: pagedItems,
    totalCount,
    page,
    limit,
    hasMore,
    acceptedFriendsCount,
  };
}

// ============================================================================
// Feature B: Watch Together Friend Invitations Implementation
// ============================================================================

async function syncWatchRoomInviteNotificationFallback(
  supabase: SupabaseLikeClient,
  input: {
    invitation: WatchRoomInvitationRow;
    hostDisplayName: string;
  }
): Promise<void> {
  const { invitation, hostDisplayName } = input;
  const dedupeKey = `watch_room_invite_received:${invitation.room_id}:${invitation.invitee_id}`;

  try {
    const { data: inviteeProfile } = await supabase
      .from("profiles")
      .select("notify_watch_together_invites")
      .eq("id", invitation.invitee_id)
      .maybeSingle();

    if (inviteeProfile?.notify_watch_together_invites === false) {
      return;
    }

    const title = `${hostDisplayName || "A friend"} invited you to Watch Together`.slice(
      0,
      200
    );
    const body =
      invitation.room_privacy === "private"
        ? `Invited you to join a private Watch Together room for ${invitation.anime_title} · Ep ${invitation.episode_number}`.slice(
            0,
            500
          )
        : `${invitation.room_title_snapshot} · ${invitation.anime_title} (Ep ${invitation.episode_number})`.slice(
            0,
            500
          );
    const linkUrl = `/watch-together?room=${invitation.room_id}&invite=${invitation.id}`;

    // Check if notification already exists (created by DB trigger)
    const { data: existing } = await supabase
      .from("user_notifications")
      .select("id")
      .eq("user_id", invitation.invitee_id)
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();

    if (existing?.id) return;

    await supabase.from("user_notifications").upsert(
      {
        user_id: invitation.invitee_id,
        actor_id: invitation.host_id,
        notification_type: "watch_room_invite_received",
        dedupe_key: dedupeKey,
        title,
        body,
        link_url: linkUrl,
        is_read: false,
        created_at: invitation.created_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,dedupe_key" }
    );
  } catch {
    // Trigger handles notification creation in PostgreSQL when direct client INSERT is disabled
  }
}

export async function sendWatchRoomInvitationWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string | null | undefined;
    roomId: string;
    inviteeUserId: string;
    nowMs?: number;
  }
): Promise<{
  success: boolean;
  invitationId?: string;
  status?: WatchRoomInvitationStatus;
  message?: string;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const roomId = (input.roomId ?? "").trim();
  const inviteeUserId = (input.inviteeUserId ?? "").trim();
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!viewerId) {
    return {
      success: false,
      error: "You must be signed in as the room host to invite friends.",
    };
  }

  if (!roomId || roomId.startsWith("showcase-")) {
    return {
      success: false,
      error: "Invalid Watch Together room.",
    };
  }

  if (!inviteeUserId || viewerId === inviteeUserId) {
    return {
      success: false,
      error: "Please select a valid friend to invite.",
    };
  }

  // 1. Check restrictions, blocks, and accepted friendship in parallel
  const [hostRestriction, inviteeRestriction, isBlocked, friendshipRow] =
    await Promise.all([
      checkUserRestrictedWithClient(supabase, viewerId),
      checkUserRestrictedWithClient(supabase, inviteeUserId),
      checkIsBlockedBetweenWithClient(supabase, viewerId, inviteeUserId),
      findFriendshipBetweenUsersWithClient(supabase, viewerId, inviteeUserId),
    ]);

  if (hostRestriction.restricted) {
    return {
      success: false,
      error:
        hostRestriction.reason ||
        "Your account is currently restricted from sending invitations.",
    };
  }

  if (inviteeRestriction.restricted) {
    return {
      success: false,
      error: "This user cannot receive invitations at this time.",
    };
  }

  if (isBlocked) {
    return {
      success: false,
      error: "You cannot send a Watch Together invitation to this user.",
    };
  }

  if (!friendshipRow || friendshipRow.status !== "accepted") {
    return {
      success: false,
      error: "You can only invite accepted friends to a Watch Together room.",
    };
  }

  // 2. Load and validate the Watch Together room & its live lifecycle/capacity
  const [{ data: roomRow, error: roomErr }, { data: childRows }] =
    await Promise.all([
      supabase
        .from("anime_comments")
        .select("id, user_id, body, is_hidden, created_at, updated_at")
        .eq("id", roomId)
        .eq("anime_id", "watch_room")
        .is("parent_comment_id", null)
        .maybeSingle(),
      supabase
        .from("anime_comments")
        .select("id, user_id, body, is_hidden, created_at, updated_at")
        .eq("anime_id", "watch_room")
        .eq("parent_comment_id", roomId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  if (roomErr || !roomRow || roomRow.is_hidden) {
    return {
      success: false,
      error: "This Watch Together room no longer exists.",
    };
  }

  // Enforce host ownership
  if (roomRow.user_id !== viewerId) {
    return {
      success: false,
      error: "Only the room host can invite friends to this Watch Together room.",
    };
  }

  const payload = parseWatchRoomPayloadSync(roomRow.body);
  if (!payload) {
    return {
      success: false,
      error: "Invalid Watch Together room configuration.",
    };
  }

  if (payload.status === "ended") {
    return {
      success: false,
      error: "Cannot send invitations to a Watch Together room that has ended.",
    };
  }

  const presenceChildRows: Array<{
    userId: string;
    isHidden: boolean;
    createdAt: string;
    updatedAt?: string | null;
    record: NonNullable<ReturnType<typeof parseWatchRoomPresenceRecord>>;
  }> = [];
  let latestChatAtMs = 0;

  for (const child of childRows ?? []) {
    const rec = parseWatchRoomPresenceRecord(child.body);
    if (rec) {
      presenceChildRows.push({
        userId: child.user_id,
        isHidden: Boolean(child.is_hidden),
        createdAt: child.created_at,
        updatedAt: child.updated_at ?? null,
        record: rec,
      });
    } else if (!child.is_hidden) {
      const chatMs = toTimestampMs(child.created_at);
      if (chatMs > latestChatAtMs) latestChatAtMs = chatMs;
    }
  }

  const hostFallback: WatchRoomHostProfile = {
    id: viewerId,
    username: `user_${viewerId.slice(0, 6)}`,
    displayName: `user_${viewerId.slice(0, 6)}`,
    avatarUrl: null,
    isPublicProfile: false,
  };

  const { participantCount, activeUserIds, latestPresenceAtMs } =
    computeActiveRoomParticipants({
      hostId: viewerId,
      hostProfile: hostFallback,
      payload,
      roomCreatedAt: roomRow.created_at,
      roomUpdatedAt: roomRow.updated_at ?? null,
      presenceChildRows,
      nowMs,
    });

  const lifecycle = classifyWatchRoomLifecycle({
    payload,
    isHidden: Boolean(roomRow.is_hidden),
    roomCreatedAt: roomRow.created_at,
    roomUpdatedAt: roomRow.updated_at ?? null,
    latestPresenceAtMs,
    latestChatAtMs,
    participantCount,
    nowMs,
  });

  if (lifecycle.lifecycleState === "stale") {
    return {
      success: false,
      error: "Cannot send invitations to an expired or inactive room.",
    };
  }

  if (activeUserIds.has(inviteeUserId)) {
    return {
      success: false,
      error: "This friend is already in your Watch Together room.",
    };
  }

  if (lifecycle.isFull || participantCount >= payload.maxParticipants) {
    return {
      success: false,
      error: `Cannot send invitations because this room is full (${payload.maxParticipants}/${payload.maxParticipants}).`,
    };
  }

  // 3. Check for existing active invitations for (roomId, inviteeUserId)
  const { data: existingInvites } = await supabase
    .from("watch_room_invitations")
    .select(
      "id, room_id, host_id, invitee_id, status, expires_at, created_at, updated_at"
    )
    .eq("room_id", roomId)
    .eq("invitee_id", inviteeUserId)
    .order("created_at", { ascending: false });

  for (const existing of (existingInvites ?? []) as WatchRoomInvitationRow[]) {
    if (existing.status === "pending") {
      if (toTimestampMs(existing.expires_at) <= nowMs) {
        await supabase
          .from("watch_room_invitations")
          .update({
            status: "expired",
            responded_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", existing.id);
      } else {
        return {
          success: false,
          invitationId: existing.id,
          status: "pending",
          error:
            "An active invitation has already been sent to this friend for this room.",
        };
      }
    } else if (existing.status === "accepted") {
      return {
        success: false,
        invitationId: existing.id,
        status: "accepted",
        error: "This friend has already accepted an invitation to this room.",
      };
    }
  }

  // 4. Resolve canonical anime metadata and host display name
  const numExtId = Number(payload.animeExternalId);
  const [{ data: animeRow }, { data: hostProfile }] = await Promise.all([
    Number.isFinite(numExtId) && numExtId > 0
      ? supabase
          .from("anime")
          .select(
            "external_id, slug, title_romaji, title_english, cover_image_url, episodes, status, media_type"
          )
          .eq("external_id", numExtId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("profiles")
      .select("username, display_name")
      .eq("id", viewerId)
      .maybeSingle(),
  ]);

  const resolvedMedia = resolveWatchRoomMediaMetadata(
    payload,
    (animeRow as RawWatchRoomAnimeRow | null) ?? null
  );
  if (!resolvedMedia) {
    return {
      success: false,
      error: "Unable to resolve anime metadata for this room.",
    };
  }

  const expiresAtIso = new Date(nowMs + STALE_ROOM_TTL_MS).toISOString();

  const { data: inserted, error: insertErr } = await supabase
    .from("watch_room_invitations")
    .insert({
      room_id: roomId,
      host_id: viewerId,
      invitee_id: inviteeUserId,
      status: "pending",
      room_title_snapshot: payload.roomTitle.slice(0, 120),
      anime_external_id: resolvedMedia.animeExternalId,
      anime_slug: resolvedMedia.animeSlug || null,
      anime_title: resolvedMedia.animeTitle.slice(0, 200),
      anime_cover: resolvedMedia.animeCover,
      episode_number: resolvedMedia.episodeNumber,
      room_privacy: payload.privacy,
      created_at: nowIso,
      updated_at: nowIso,
      expires_at: expiresAtIso,
    })
    .select(
      "id, room_id, host_id, invitee_id, status, room_title_snapshot, anime_external_id, anime_slug, anime_title, anime_cover, episode_number, room_privacy, created_at, updated_at, responded_at, expires_at"
    )
    .maybeSingle();

  if (insertErr || !inserted) {
    if (insertErr?.code === "23505") {
      return {
        success: false,
        error:
          "An active invitation has already been sent to this friend for this room.",
      };
    }
    return {
      success: false,
      error: insertErr?.message || "Failed to send Watch Together invitation.",
    };
  }

  const hostDisplayName =
    hostProfile?.display_name || hostProfile?.username || "A friend";

  await syncWatchRoomInviteNotificationFallback(supabase, {
    invitation: inserted as WatchRoomInvitationRow,
    hostDisplayName,
  });

  return {
    success: true,
    invitationId: inserted.id,
    status: "pending",
    message: "Watch Together invitation sent!",
  };
}

/**
 * Accepts a pending Watch Together invitation.
 * Revalidates live room eligibility, host friendship, blocks, expiry, and room capacity
 * inside `withWatchRoomJoinLock` so concurrent invitation acceptances never exceed `maxParticipants`.
 */
export async function acceptWatchRoomInvitationWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string | null | undefined;
    invitationId: string;
    nowMs?: number;
  }
): Promise<{
  success: boolean;
  roomId?: string;
  status?: WatchRoomInvitationStatus;
  lifecycleState?: WatchRoomLifecycleState;
  participantCount?: number;
  maxParticipants?: number;
  message?: string;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const invitationId = (input.invitationId ?? "").trim();
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!viewerId) {
    return {
      success: false,
      error: "You must be signed in to accept a Watch Together invitation.",
    };
  }

  if (!invitationId) {
    return {
      success: false,
      error: "Invalid invitation ID.",
    };
  }

  const { data: rawInvite, error: fetchErr } = await supabase
    .from("watch_room_invitations")
    .select(
      "id, room_id, host_id, invitee_id, status, room_title_snapshot, anime_external_id, anime_slug, anime_title, anime_cover, episode_number, room_privacy, created_at, updated_at, responded_at, expires_at"
    )
    .eq("id", invitationId)
    .maybeSingle();

  if (fetchErr || !rawInvite) {
    return {
      success: false,
      error: "Watch Together invitation not found.",
    };
  }

  const invitation = rawInvite as WatchRoomInvitationRow;

  // 1. Only the intended recipient can accept
  if (invitation.invitee_id !== viewerId) {
    return {
      success: false,
      error: "You are not authorized to accept this Watch Together invitation.",
    };
  }

  // 2. Prevent reusing cancelled, expired, declined, or already-accepted invitations
  if (invitation.status === "cancelled") {
    return {
      success: false,
      status: "cancelled",
      error: "This Watch Together invitation was cancelled by the host.",
    };
  }
  if (invitation.status === "declined") {
    return {
      success: false,
      status: "declined",
      error: "This Watch Together invitation was already declined.",
    };
  }
  if (invitation.status === "expired") {
    return {
      success: false,
      status: "expired",
      error: "This Watch Together invitation has expired.",
    };
  }
  if (invitation.status === "accepted") {
    return {
      success: false,
      status: "accepted",
      error: "This Watch Together invitation has already been accepted.",
    };
  }

  // 3. Check expiration timestamp
  if (toTimestampMs(invitation.expires_at) <= nowMs) {
    await supabase
      .from("watch_room_invitations")
      .update({
        status: "expired",
        responded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", invitation.id)
      .eq("status", "pending");

    return {
      success: false,
      status: "expired",
      error: "This Watch Together invitation has expired.",
    };
  }

  // 4. Revalidate restrictions, blocks, and accepted friendship between host and invitee
  const [viewerRestriction, hostRestriction, isBlocked, friendshipRow] =
    await Promise.all([
      checkUserRestrictedWithClient(supabase, viewerId),
      checkUserRestrictedWithClient(supabase, invitation.host_id),
      checkIsBlockedBetweenWithClient(supabase, invitation.host_id, viewerId),
      findFriendshipBetweenUsersWithClient(
        supabase,
        invitation.host_id,
        viewerId
      ),
    ]);

  if (viewerRestriction.restricted || hostRestriction.restricted) {
    return {
      success: false,
      error:
        viewerRestriction.reason ||
        "Cannot accept invitation due to an active account restriction.",
    };
  }

  if (isBlocked) {
    return {
      success: false,
      error: "This Watch Together room is unavailable.",
    };
  }

  if (!friendshipRow || friendshipRow.status !== "accepted") {
    return {
      success: false,
      error:
        "You must be accepted friends with the host to accept this invitation.",
    };
  }

  // 5. Revalidate room state and capacity inside the per-room join lock
  return withWatchRoomJoinLock(invitation.room_id, async () => {
    const [{ data: roomRow, error: roomErr }, { data: childRows }] =
      await Promise.all([
        supabase
          .from("anime_comments")
          .select("id, user_id, body, is_hidden, created_at, updated_at")
          .eq("id", invitation.room_id)
          .eq("anime_id", "watch_room")
          .is("parent_comment_id", null)
          .maybeSingle(),
        supabase
          .from("anime_comments")
          .select("id, user_id, body, is_hidden, created_at, updated_at")
          .eq("anime_id", "watch_room")
          .eq("parent_comment_id", invitation.room_id)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

    if (
      roomErr ||
      !roomRow ||
      roomRow.is_hidden ||
      roomRow.user_id !== invitation.host_id
    ) {
      await supabase
        .from("watch_room_invitations")
        .update({
          status: "expired",
          responded_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", invitation.id)
        .eq("status", "pending");

      return {
        success: false,
        status: "expired" as const,
        lifecycleState: "ended" as const,
        error: "This Watch Together room no longer exists.",
      };
    }

    const payload = parseWatchRoomPayloadSync(roomRow.body);
    if (!payload || payload.status === "ended") {
      await supabase
        .from("watch_room_invitations")
        .update({
          status: "expired",
          responded_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", invitation.id)
        .eq("status", "pending");

      return {
        success: false,
        status: "expired" as const,
        lifecycleState: "ended" as const,
        error: "This Watch Together session has already ended.",
      };
    }

    const presenceChildRows: Array<{
      userId: string;
      isHidden: boolean;
      createdAt: string;
      updatedAt?: string | null;
      record: NonNullable<ReturnType<typeof parseWatchRoomPresenceRecord>>;
    }> = [];
    let latestChatAtMs = 0;

    for (const child of childRows ?? []) {
      const rec = parseWatchRoomPresenceRecord(child.body);
      if (rec) {
        presenceChildRows.push({
          userId: child.user_id,
          isHidden: Boolean(child.is_hidden),
          createdAt: child.created_at,
          updatedAt: child.updated_at ?? null,
          record: rec,
        });
      } else if (!child.is_hidden) {
        const chatMs = toTimestampMs(child.created_at);
        if (chatMs > latestChatAtMs) latestChatAtMs = chatMs;
      }
    }

    const hostFallback: WatchRoomHostProfile = {
      id: roomRow.user_id,
      username: `user_${roomRow.user_id.slice(0, 6)}`,
      displayName: `user_${roomRow.user_id.slice(0, 6)}`,
      avatarUrl: null,
      isPublicProfile: false,
    };

    const { participantCount, activeUserIds, latestPresenceAtMs } =
      computeActiveRoomParticipants({
        hostId: roomRow.user_id,
        hostProfile: hostFallback,
        payload,
        roomCreatedAt: roomRow.created_at,
        roomUpdatedAt: roomRow.updated_at ?? null,
        presenceChildRows,
        nowMs,
      });

    const lifecycle = classifyWatchRoomLifecycle({
      payload,
      isHidden: Boolean(roomRow.is_hidden),
      roomCreatedAt: roomRow.created_at,
      roomUpdatedAt: roomRow.updated_at ?? null,
      latestPresenceAtMs,
      latestChatAtMs,
      participantCount,
      nowMs,
    });

    if (lifecycle.lifecycleState === "stale") {
      await supabase
        .from("watch_room_invitations")
        .update({
          status: "expired",
          responded_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", invitation.id)
        .eq("status", "pending");

      return {
        success: false,
        status: "expired" as const,
        lifecycleState: "stale" as const,
        error: "This Watch Together room has expired due to inactivity.",
      };
    }

    const isAlreadyActive = activeUserIds.has(viewerId);
    if (!isAlreadyActive && participantCount >= payload.maxParticipants) {
      return {
        success: false,
        lifecycleState: "full" as const,
        participantCount,
        maxParticipants: payload.maxParticipants,
        error: `This Watch Together room is full (${payload.maxParticipants}/${payload.maxParticipants} participants).`,
      };
    }

    // Upsert active participant presence row for the invitee
    const existingPresenceRow = (childRows ?? []).find(
      (r: { user_id?: string; body?: string }) =>
        r.user_id === viewerId &&
        parseWatchRoomPresenceRecord(String(r.body ?? "")) !== null
    );
    const activeSerialized = serializeWatchRoomPresenceRecord({
      status: "active",
      sessionKey: `user:${viewerId}`,
      lastSeenAt: nowIso,
    });

    if (existingPresenceRow) {
      await supabase
        .from("anime_comments")
        .update({
          body: activeSerialized,
          is_hidden: false,
          updated_at: nowIso,
        })
        .eq("id", existingPresenceRow.id)
        .eq("user_id", viewerId);
    } else {
      await supabase.from("anime_comments").insert({
        user_id: viewerId,
        anime_id: "watch_room",
        parent_comment_id: invitation.room_id,
        body: activeSerialized,
        is_spoiler: false,
        is_hidden: false,
        created_at: nowIso,
        updated_at: nowIso,
      });
    }

    // Post-write deterministic slot check to prevent cross-instance final-slot overbooking
    const { data: postWriteRows } = await supabase
      .from("anime_comments")
      .select("id, user_id, body, is_hidden, created_at, updated_at")
      .eq("anime_id", "watch_room")
      .eq("parent_comment_id", invitation.room_id)
      .order("created_at", { ascending: false })
      .limit(100);

    const postWritePresence: typeof presenceChildRows = [];
    for (const child of postWriteRows ?? []) {
      const rec = parseWatchRoomPresenceRecord(child.body);
      if (rec) {
        postWritePresence.push({
          userId: child.user_id,
          isHidden: Boolean(child.is_hidden),
          createdAt: child.created_at,
          updatedAt: child.updated_at ?? null,
          record: rec,
        });
      }
    }

    const postWriteCheck = computeActiveRoomParticipants({
      hostId: roomRow.user_id,
      hostProfile: hostFallback,
      payload,
      roomCreatedAt: roomRow.created_at,
      roomUpdatedAt: roomRow.updated_at ?? null,
      presenceChildRows: postWritePresence,
      nowMs,
    });

    if (!postWriteCheck.activeUserIds.has(viewerId)) {
      const leftSerialized = serializeWatchRoomPresenceRecord({
        status: "left",
        sessionKey: `user:${viewerId}`,
        lastSeenAt: nowIso,
      });
      await supabase
        .from("anime_comments")
        .update({
          body: leftSerialized,
          updated_at: nowIso,
        })
        .eq("anime_id", "watch_room")
        .eq("parent_comment_id", invitation.room_id)
        .eq("user_id", viewerId);

      return {
        success: false,
        lifecycleState: "full" as const,
        participantCount: payload.maxParticipants,
        maxParticipants: payload.maxParticipants,
        error: `This Watch Together room is full (${payload.maxParticipants}/${payload.maxParticipants} participants).`,
      };
    }

    // Mark the invitation as accepted
    const { data: updatedInvite, error: updateErr } = await supabase
      .from("watch_room_invitations")
      .update({
        status: "accepted",
        responded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", invitation.id)
      .eq("invitee_id", viewerId)
      .eq("status", "pending")
      .select("id, status")
      .maybeSingle();

    if (updateErr || !updatedInvite) {
      return {
        success: false,
        error:
          updateErr?.message ||
          "Unable to accept Watch Together invitation. It may have expired or been cancelled.",
      };
    }

    // Mark notification as read
    try {
      const dedupeKey = `watch_room_invite_received:${invitation.room_id}:${viewerId}`;
      await supabase
        .from("user_notifications")
        .update({ is_read: true, updated_at: nowIso })
        .eq("user_id", viewerId)
        .eq("dedupe_key", dedupeKey);
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      roomId: invitation.room_id,
      status: "accepted" as const,
      lifecycleState:
        postWriteCheck.participantCount >= payload.maxParticipants
          ? ("full" as const)
          : ("active" as const),
      participantCount: postWriteCheck.participantCount,
      maxParticipants: payload.maxParticipants,
      message: "Invitation accepted! Joining Watch Together room...",
    };
  });
}

export async function declineWatchRoomInvitationWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string | null | undefined;
    invitationId: string;
    nowMs?: number;
  }
): Promise<{
  success: boolean;
  status?: WatchRoomInvitationStatus;
  message?: string;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const invitationId = (input.invitationId ?? "").trim();
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();

  if (!viewerId) {
    return {
      success: false,
      error: "You must be signed in to decline an invitation.",
    };
  }

  const { data: rawInvite } = await supabase
    .from("watch_room_invitations")
    .select("id, room_id, host_id, invitee_id, status")
    .eq("id", invitationId)
    .maybeSingle();

  if (!rawInvite) {
    return { success: false, error: "Invitation not found." };
  }

  if (rawInvite.invitee_id !== viewerId) {
    return {
      success: false,
      error: "Only the invited recipient can decline this invitation.",
    };
  }

  if (rawInvite.status !== "pending") {
    return {
      success: false,
      status: rawInvite.status,
      error: `Invitation is already ${rawInvite.status}.`,
    };
  }

  const { error: updateErr } = await supabase
    .from("watch_room_invitations")
    .update({
      status: "declined",
      responded_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", invitationId)
    .eq("invitee_id", viewerId)
    .eq("status", "pending");

  if (updateErr) {
    return {
      success: false,
      error: "Failed to decline invitation.",
    };
  }

  try {
    const dedupeKey = `watch_room_invite_received:${rawInvite.room_id}:${viewerId}`;
    await supabase
      .from("user_notifications")
      .update({ is_read: true, updated_at: nowIso })
      .eq("user_id", viewerId)
      .eq("dedupe_key", dedupeKey);
  } catch {
    // Non-fatal
  }

  return {
    success: true,
    status: "declined",
    message: "Watch Together invitation declined.",
  };
}

export async function cancelWatchRoomInvitationWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string | null | undefined;
    invitationId: string;
    nowMs?: number;
  }
): Promise<{
  success: boolean;
  status?: WatchRoomInvitationStatus;
  message?: string;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const invitationId = (input.invitationId ?? "").trim();
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();

  if (!viewerId) {
    return {
      success: false,
      error: "You must be signed in to cancel an invitation.",
    };
  }

  const { data: rawInvite } = await supabase
    .from("watch_room_invitations")
    .select("id, room_id, host_id, invitee_id, status")
    .eq("id", invitationId)
    .maybeSingle();

  if (!rawInvite) {
    return { success: false, error: "Invitation not found." };
  }

  if (rawInvite.host_id !== viewerId) {
    return {
      success: false,
      error: "Only the room host can cancel this invitation.",
    };
  }

  if (rawInvite.status !== "pending") {
    return {
      success: false,
      status: rawInvite.status,
      error: `Invitation is already ${rawInvite.status}.`,
    };
  }

  const { error: updateErr } = await supabase
    .from("watch_room_invitations")
    .update({
      status: "cancelled",
      responded_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", invitationId)
    .eq("host_id", viewerId)
    .eq("status", "pending");

  if (updateErr) {
    return {
      success: false,
      error: "Failed to cancel invitation.",
    };
  }

  try {
    const dedupeKey = `watch_room_invite_received:${rawInvite.room_id}:${rawInvite.invitee_id}`;
    await supabase
      .from("user_notifications")
      .delete()
      .eq("user_id", rawInvite.invitee_id)
      .eq("dedupe_key", dedupeKey);
  } catch {
    // Non-fatal
  }

  return {
    success: true,
    status: "cancelled",
    message: "Watch Together invitation cancelled.",
  };
}

export async function getWatchRoomInvitationsForUserWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string | null | undefined;
    roomId?: string | null;
    nowMs?: number;
  }
): Promise<{
  success: boolean;
  incomingInvitations: WatchRoomInvitationDTO[];
  roomOutgoingInvitations: WatchRoomInvitationDTO[];
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const roomId = (input.roomId ?? "").trim();
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!viewerId) {
    return {
      success: false,
      incomingInvitations: [],
      roomOutgoingInvitations: [],
      error: "You must be signed in to view invitations.",
    };
  }

  const [blockedSet, friendshipsRes, incomingRes, outgoingRes] =
    await Promise.all([
      getBidirectionalBlockedSetWithClient(supabase, viewerId),
      supabase
        .from("friendships")
        .select("id, requester_id, addressee_id, status")
        .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`)
        .eq("status", "accepted"),
      supabase
        .from("watch_room_invitations")
        .select(
          "id, room_id, host_id, invitee_id, status, room_title_snapshot, anime_external_id, anime_slug, anime_title, anime_cover, episode_number, room_privacy, created_at, updated_at, responded_at, expires_at"
        )
        .eq("invitee_id", viewerId)
        .order("created_at", { ascending: false })
        .limit(30),
      roomId
        ? supabase
            .from("watch_room_invitations")
            .select(
              "id, room_id, host_id, invitee_id, status, room_title_snapshot, anime_external_id, anime_slug, anime_title, anime_cover, episode_number, room_privacy, created_at, updated_at, responded_at, expires_at"
            )
            .eq("room_id", roomId)
            .eq("host_id", viewerId)
            .order("created_at", { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [] }),
    ]);

  const acceptedFriendIds = new Set<string>();
  for (const f of (friendshipsRes?.data ?? []) as FriendshipRow[]) {
    if (f.status !== "accepted") continue;
    const otherId =
      f.requester_id === viewerId ? f.addressee_id : f.requester_id;
    if (otherId && !blockedSet.has(otherId)) {
      acceptedFriendIds.add(otherId);
    }
  }

  const rawIncoming = ((incomingRes?.data ?? []) as WatchRoomInvitationRow[]).filter(
    (inv) =>
      inv.invitee_id === viewerId &&
      !blockedSet.has(inv.host_id) &&
      acceptedFriendIds.has(inv.host_id)
  );

  const rawOutgoing = ((outgoingRes?.data ?? []) as WatchRoomInvitationRow[]).filter(
    (inv) =>
      inv.host_id === viewerId &&
      !blockedSet.has(inv.invitee_id) &&
      acceptedFriendIds.has(inv.invitee_id)
  );

  const allRows = [...rawIncoming, ...rawOutgoing];
  const roomIds = Array.from(new Set(allRows.map((r) => r.room_id)));
  const userIds = new Set<string>([viewerId]);
  for (const r of allRows) {
    userIds.add(r.host_id);
    userIds.add(r.invitee_id);
  }

  const [profilesRes, roomsRes, childRowsRes] = await Promise.all([
    userIds.size > 0
      ? supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url, profile_visibility")
          .in("id", Array.from(userIds))
      : Promise.resolve({ data: [] }),
    roomIds.length > 0
      ? supabase
          .from("anime_comments")
          .select("id, user_id, body, is_hidden, created_at, updated_at")
          .in("id", roomIds)
          .eq("anime_id", "watch_room")
          .is("parent_comment_id", null)
      : Promise.resolve({ data: [] }),
    roomIds.length > 0
      ? supabase
          .from("anime_comments")
          .select(
            "id, user_id, parent_comment_id, body, is_hidden, created_at, updated_at"
          )
          .eq("anime_id", "watch_room")
          .in("parent_comment_id", roomIds)
          .eq("is_hidden", false)
          .limit(200)
      : Promise.resolve({ data: [] }),
  ]);

  const profileMap = new Map<string, FriendActivityActorDTO>();
  for (const p of profilesRes?.data ?? []) {
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

  const getActor = (uid: string): FriendActivityActorDTO =>
    profileMap.get(uid) ?? {
      id: uid,
      username: `user_${uid.slice(0, 6)}`,
      displayName: `user_${uid.slice(0, 6)}`,
      avatarUrl: null,
      isPublicProfile: false,
    };

  const childRowsByRoom = new Map<
    string,
    Array<{
      userId: string;
      isHidden: boolean;
      createdAt: string;
      updatedAt?: string | null;
      record: NonNullable<ReturnType<typeof parseWatchRoomPresenceRecord>>;
    }>
  >();
  const latestChatByRoom = new Map<string, number>();

  for (const child of childRowsRes?.data ?? []) {
    const rId = child.parent_comment_id;
    if (!rId) continue;
    const rec = parseWatchRoomPresenceRecord(child.body);
    if (rec) {
      const list = childRowsByRoom.get(rId) ?? [];
      list.push({
        userId: child.user_id,
        isHidden: Boolean(child.is_hidden),
        createdAt: child.created_at,
        updatedAt: child.updated_at ?? null,
        record: rec,
      });
      childRowsByRoom.set(rId, list);
    } else if (!child.is_hidden) {
      const chatMs = toTimestampMs(child.created_at);
      const prev = latestChatByRoom.get(rId) ?? 0;
      if (chatMs > prev) latestChatByRoom.set(rId, chatMs);
    }
  }

  const roomStateMap = new Map<
    string,
    {
      isActive: boolean;
      participantCount: number;
      maxParticipants: number;
    }
  >();

  for (const rRow of roomsRes?.data ?? []) {
    const payload = parseWatchRoomPayloadSync(rRow.body);
    if (!payload || rRow.is_hidden || payload.status === "ended") {
      roomStateMap.set(rRow.id, {
        isActive: false,
        participantCount: 0,
        maxParticipants: payload?.maxParticipants ?? 8,
      });
      continue;
    }

    const hostActor = getActor(rRow.user_id);
    const { participantCount, latestPresenceAtMs } =
      computeActiveRoomParticipants({
        hostId: rRow.user_id,
        hostProfile: hostActor,
        payload,
        roomCreatedAt: rRow.created_at,
        roomUpdatedAt: rRow.updated_at ?? null,
        presenceChildRows: childRowsByRoom.get(rRow.id) ?? [],
        nowMs,
      });

    const lifecycle = classifyWatchRoomLifecycle({
      payload,
      isHidden: Boolean(rRow.is_hidden),
      roomCreatedAt: rRow.created_at,
      roomUpdatedAt: rRow.updated_at ?? null,
      latestPresenceAtMs,
      latestChatAtMs: latestChatByRoom.get(rRow.id) ?? 0,
      participantCount,
      nowMs,
    });

    roomStateMap.set(rRow.id, {
      isActive:
        lifecycle.lifecycleState === "active" ||
        lifecycle.lifecycleState === "full",
      participantCount,
      maxParticipants: payload.maxParticipants,
    });
  }

  const expiredIdsToSync: string[] = [];

  const mapRowToDto = (row: WatchRoomInvitationRow): WatchRoomInvitationDTO => {
    const roomState = roomStateMap.get(row.room_id);
    const isExpiredByTime = toTimestampMs(row.expires_at) <= nowMs;
    const isRoomGoneOrEnded = !roomState || !roomState.isActive;

    let effectiveStatus = row.status;
    if (
      row.status === "pending" &&
      (isExpiredByTime || isRoomGoneOrEnded)
    ) {
      effectiveStatus = "expired";
      expiredIdsToSync.push(row.id);
    }

    return {
      id: row.id,
      roomId: row.room_id,
      hostId: row.host_id,
      inviteeId: row.invitee_id,
      status: effectiveStatus,
      roomTitle:
        row.room_privacy === "private" &&
        effectiveStatus !== "accepted" &&
        row.host_id !== viewerId
          ? "Private Watch Together Room"
          : row.room_title_snapshot,
      animeExternalId: row.anime_external_id,
      animeSlug: row.anime_slug,
      animeTitle: row.anime_title,
      animeCover: row.anime_cover,
      episodeNumber: row.episode_number,
      roomPrivacy: row.room_privacy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      respondedAt: row.responded_at,
      expiresAt: row.expires_at,
      host: getActor(row.host_id),
      invitee: getActor(row.invitee_id),
      isRoomActive: Boolean(roomState?.isActive),
      roomParticipantCount: roomState?.participantCount ?? null,
      roomMaxParticipants: roomState?.maxParticipants ?? null,
    };
  };

  const incomingInvitations = rawIncoming.map(mapRowToDto);
  const roomOutgoingInvitations = rawOutgoing.map(mapRowToDto);

  if (expiredIdsToSync.length > 0) {
    try {
      await supabase
        .from("watch_room_invitations")
        .update({
          status: "expired",
          responded_at: nowIso,
          updated_at: nowIso,
        })
        .in("id", expiredIdsToSync)
        .eq("status", "pending");
    } catch {
      // Non-fatal
    }
  }

  return {
    success: true,
    incomingInvitations,
    roomOutgoingInvitations,
  };
}
