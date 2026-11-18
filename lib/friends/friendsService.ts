export type FriendshipStatus = "pending" | "accepted";

export type FriendshipRelationshipStatus =
  | "none"
  | "pending_outgoing"
  | "pending_incoming"
  | "friends"
  | "self"
  | "blocked";

export interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
  responded_at: string | null;
}

export interface FriendProfileSummaryDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileVisibility: "public" | "private";
  bio: string | null;
  friendshipId: string | null;
  relationshipStatus: FriendshipRelationshipStatus;
  isOnline: boolean;
  recentActivity: string | null;
  lastActiveAt: string | null;
  createdAt: string | null;
  respondedAt: string | null;
}

export interface UserNotificationDTO {
  id: string;
  userId: string;
  actorId: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  actorAvatarUrl: string | null;
  notificationType:
    | "friend_request_received"
    | "friend_request_accepted"
    | "watch_room_invite_received"
    | "system";
  dedupeKey: string;
  title: string;
  body: string | null;
  linkUrl: string;
  isRead: boolean;
  createdAt: string;
}

export interface FriendsOverviewDTO {
  friends: FriendProfileSummaryDTO[];
  incomingRequests: FriendProfileSummaryDTO[];
  outgoingRequests: FriendProfileSummaryDTO[];
  notifications: UserNotificationDTO[];
  unreadNotificationCount: number;
}

export interface GlobalPresencePayload {
  userId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
  isPublicProfile?: boolean;
  onlineAt?: string;
}

export interface FriendPairPresencePayload {
  userId?: string;
  onlineAt?: string;
}

export function buildCanonicalFriendshipPair(
  userA: string,
  userB: string
): { low: string; high: string; pairKey: string } {
  const a = String(userA ?? "").trim();
  const b = String(userB ?? "").trim();
  if (a <= b) {
    return { low: a, high: b, pairKey: `${a}:${b}` };
  }
  return { low: b, high: a, pairKey: `${b}:${a}` };
}

export function resolveFriendshipStatusForViewer(input: {
  viewerId: string | null | undefined;
  targetUserId: string | null | undefined;
  row?: Pick<FriendshipRow, "requester_id" | "addressee_id" | "status"> | null;
  isBlocked?: boolean;
}): FriendshipRelationshipStatus {
  const viewerId = (input.viewerId ?? "").trim();
  const targetUserId = (input.targetUserId ?? "").trim();
  if (!viewerId || !targetUserId) return "none";
  if (viewerId === targetUserId) return "self";
  if (input.isBlocked) return "blocked";

  const row = input.row;
  if (!row) return "none";

  const involvesPair =
    (row.requester_id === viewerId && row.addressee_id === targetUserId) ||
    (row.requester_id === targetUserId && row.addressee_id === viewerId);

  if (!involvesPair) return "none";

  if (row.status === "accepted") {
    return "friends";
  }

  if (row.status === "pending") {
    if (row.requester_id === viewerId) return "pending_outgoing";
    if (row.addressee_id === viewerId) return "pending_incoming";
  }

  return "none";
}

export function canBroadcastPublicPresence(
  user: { id: string } | null | undefined,
  profile:
    | { id: string; profileVisibility: "public" | "private" }
    | null
    | undefined
): boolean {
  if (!user?.id || !profile) return false;
  if (profile.id !== user.id) return false;
  return profile.profileVisibility === "public";
}

export function canBroadcastFriendPairPresence(
  user: { id: string } | null | undefined,
  friendUserId: string | null | undefined,
  options?: {
    acceptedFriendIds?: ReadonlySet<string>;
    blockedSet?: ReadonlySet<string>;
  }
): boolean {
  const viewerId = user?.id?.trim() ?? "";
  const targetId = friendUserId?.trim() ?? "";
  if (!viewerId || !targetId || viewerId === targetId) return false;
  if (options?.blockedSet?.has(targetId)) return false;
  if (options?.acceptedFriendIds && !options.acceptedFriendIds.has(targetId)) {
    return false;
  }
  return true;
}

/**
 * Deduplicates and filters public presence state across multiple tabs/sessions.
 * Never includes private profiles or blocked users.
 */
export function filterPublicPresenceState(
  presenceState: Record<string, GlobalPresencePayload[]>,
  options?: {
    blockedSet?: ReadonlySet<string>;
    knownPrivateUserIds?: ReadonlySet<string>;
  }
): Map<
  string,
  {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isPublicProfile: true;
    onlineAt: string | null;
  }
> {
  const nextMap = new Map<
    string,
    {
      userId: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      isPublicProfile: true;
      onlineAt: string | null;
    }
  >();
  const blockedSet = options?.blockedSet;
  const knownPrivateUserIds = options?.knownPrivateUserIds;

  for (const entries of Object.values(presenceState)) {
    if (!Array.isArray(entries)) continue;
    for (const item of entries) {
      if (!item?.userId || !item?.username) continue;
      if (item.isPublicProfile !== true) continue;
      if (blockedSet?.has(item.userId)) continue;
      if (knownPrivateUserIds?.has(item.userId)) continue;

      const existing = nextMap.get(item.userId);
      const itemOnlineAt = item.onlineAt ?? null;
      if (
        !existing ||
        (itemOnlineAt &&
          (!existing.onlineAt || itemOnlineAt > existing.onlineAt))
      ) {
        nextMap.set(item.userId, {
          userId: item.userId,
          username: item.username,
          displayName: item.displayName || item.username,
          avatarUrl: item.avatarUrl ?? null,
          isPublicProfile: true,
          onlineAt: itemOnlineAt,
        });
      }
    }
  }

  return nextMap;
}

/**
 * Filters friend-pair presence so only accepted, non-blocked friends are marked online.
 * Private profiles are visible ONLY to their accepted friends and never to strangers or guests.
 */
export function filterFriendPairPresenceState(
  presenceState: Record<string, FriendPairPresencePayload[]>,
  options: {
    viewerId: string | null | undefined;
    acceptedFriendIds: ReadonlySet<string>;
    blockedSet?: ReadonlySet<string>;
  }
): Set<string> {
  const onlineFriendIds = new Set<string>();
  const viewerId = options.viewerId?.trim() ?? "";
  if (!viewerId) return onlineFriendIds;

  for (const entries of Object.values(presenceState)) {
    if (!Array.isArray(entries)) continue;
    for (const item of entries) {
      const uid = item?.userId?.trim() ?? "";
      if (!uid || uid === viewerId) continue;
      if (options.blockedSet?.has(uid)) continue;
      if (!options.acceptedFriendIds.has(uid)) continue;
      onlineFriendIds.add(uid);
    }
  }

  return onlineFriendIds;
}

/**
 * Resolves whether a given user is visible as online to the viewer.
 * - Guests can only see public profiles on public presence.
 * - Blocked users never see each other's presence.
 * - Accepted friends can see each other's online status (via public presence or friend-pair presence).
 * - Non-friends can only see public profiles' online status, never private profiles.
 */
export function isUserOnlineForViewer(input: {
  viewerId: string | null | undefined;
  targetUserId: string;
  targetProfileVisibility: "public" | "private";
  isAcceptedFriend: boolean;
  isBlocked: boolean;
  publicOnlineMap: ReadonlyMap<string, unknown>;
  friendOnlineIds?: ReadonlySet<string>;
}): boolean {
  if (!input.targetUserId || input.isBlocked) return false;

  if (input.targetProfileVisibility === "public") {
    if (input.publicOnlineMap.has(input.targetUserId)) {
      return true;
    }
  }

  // Private profile (or friend via friend-pair channel): only visible to authenticated accepted friends
  if (
    Boolean(input.viewerId) &&
    input.isAcceptedFriend &&
    input.friendOnlineIds?.has(input.targetUserId)
  ) {
    return true;
  }

  return false;
}

/**
 * Server/Database Realtime authorization validator for `nayozu:friend-pair:<low>:<high>`.
 * Mirrors `public.can_access_friend_pair_realtime_topic(topic_text)` in Postgres (`realtime.messages` RLS).
 */
export function canAccessFriendPairRealtimeTopic(input: {
  callerId: string | null | undefined;
  topic: string | null | undefined;
  isCallerRestricted?: boolean;
  isBlockedBetweenPair?: boolean;
  friendshipRow?: Pick<
    FriendshipRow,
    "requester_id" | "addressee_id" | "status"
  > | null;
}): boolean {
  const callerId = (input.callerId ?? "").trim();
  const topic = (input.topic ?? "").trim();
  if (!callerId || !topic) return false;
  if (input.isCallerRestricted) return false;

  const prefix = "nayozu:friend-pair:";
  if (!topic.startsWith(prefix)) return false;

  const rest = topic.slice(prefix.length);
  const parts = rest.split(":");
  if (parts.length !== 2) return false;

  const [lowUid, highUid] = parts;
  if (!lowUid || !highUid || lowUid >= highUid) return false;

  // Caller must be one of the two users in the canonical pair
  if (callerId !== lowUid && callerId !== highUid) return false;

  // Bidirectional block immediately revokes access
  if (input.isBlockedBetweenPair) return false;

  const row = input.friendshipRow;
  if (!row || row.status !== "accepted") return false;

  const rowPair = buildCanonicalFriendshipPair(
    row.requester_id,
    row.addressee_id
  );
  return rowPair.low === lowUid && rowPair.high === highUid;
}

/**
 * Enforces immutability of friendship identity fields and valid status transitions on UPDATE.
 * Mirrors `public.enforce_friendship_update_immutability()` trigger in Postgres.
 */
export function validateFriendshipRowUpdateImmutability(input: {
  callerId: string | null | undefined;
  oldRow: FriendshipRow & { pair_user_low?: string; pair_user_high?: string };
  newRow: Partial<
    FriendshipRow & { pair_user_low?: string; pair_user_high?: string }
  >;
}): { valid: boolean; error?: string } {
  const callerId = (input.callerId ?? "").trim();
  const { oldRow, newRow } = input;

  if (!callerId) {
    return { valid: false, error: "Authentication required." };
  }

  if (newRow.id !== undefined && newRow.id !== oldRow.id) {
    return { valid: false, error: "Friendship id is immutable." };
  }

  if (
    newRow.requester_id !== undefined &&
    newRow.requester_id !== oldRow.requester_id
  ) {
    return { valid: false, error: "Friendship requester_id is immutable." };
  }

  if (
    newRow.addressee_id !== undefined &&
    newRow.addressee_id !== oldRow.addressee_id
  ) {
    return { valid: false, error: "Friendship addressee_id is immutable." };
  }

  const oldPair = buildCanonicalFriendshipPair(
    oldRow.requester_id,
    oldRow.addressee_id
  );
  if (
    (newRow.pair_user_low !== undefined &&
      newRow.pair_user_low !== oldPair.low) ||
    (newRow.pair_user_high !== undefined &&
      newRow.pair_user_high !== oldPair.high)
  ) {
    return {
      valid: false,
      error: "Friendship canonical pair columns are immutable.",
    };
  }

  if (
    newRow.created_at !== undefined &&
    newRow.created_at !== oldRow.created_at
  ) {
    return { valid: false, error: "Friendship created_at is immutable." };
  }

  const nextStatus = newRow.status ?? oldRow.status;
  if (oldRow.status === "accepted" && nextStatus !== "accepted") {
    return {
      valid: false,
      error: "Accepted friendship status cannot be reverted.",
    };
  }

  if (oldRow.status === "pending" && nextStatus !== "accepted") {
    return {
      valid: false,
      error: "Pending friendship can only transition to accepted.",
    };
  }

  if (callerId !== oldRow.addressee_id) {
    return {
      valid: false,
      error: "Only the intended addressee can accept a pending friend request.",
    };
  }

  return { valid: true };
}

// ============================================================================
// Database Client Interface for Testability & Server Action Reuse
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseLikeClient = any;

export async function checkIsBlockedBetweenWithClient(
  supabase: SupabaseLikeClient,
  userA: string,
  userB: string
): Promise<boolean> {
  if (!userA || !userB || userA === userB) return false;

  if (typeof supabase.rpc === "function") {
    const rpcRes = await supabase.rpc("is_blocked_between", {
      user_a: userA,
      user_b: userB,
    });
    if (!rpcRes?.error && typeof rpcRes?.data === "boolean") {
      return rpcRes.data;
    }
  }

  const { data } = await supabase
    .from("user_blocks")
    .select("id, blocker_id, blocked_id")
    .or(
      `and(blocker_id.eq.${userA},blocked_id.eq.${userB}),and(blocker_id.eq.${userB},blocked_id.eq.${userA})`
    )
    .limit(1);

  return Boolean(Array.isArray(data) && data.length > 0);
}

export async function getBidirectionalBlockedSetWithClient(
  supabase: SupabaseLikeClient,
  userId: string | null
): Promise<Set<string>> {
  const set = new Set<string>();
  if (!userId) return set;

  const [rpcRes, tableRes] = await Promise.all([
    typeof supabase.rpc === "function"
      ? supabase.rpc("get_bidirectional_blocked_user_ids")
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
  ]);

  if (!rpcRes?.error && Array.isArray(rpcRes?.data)) {
    for (const entry of rpcRes.data) {
      if (typeof entry === "string" && entry) {
        set.add(entry);
      } else if (
        entry &&
        typeof entry === "object" &&
        typeof entry.excluded_user_id === "string"
      ) {
        set.add(entry.excluded_user_id);
      }
    }
  }

  for (const row of tableRes?.data ?? []) {
    if (row.blocker_id === userId) set.add(row.blocked_id);
    if (row.blocked_id === userId) set.add(row.blocker_id);
  }

  return set;
}

export async function checkUserRestrictedWithClient(
  supabase: SupabaseLikeClient,
  userId: string
): Promise<{ restricted: boolean; reason?: string }> {
  if (!userId) return { restricted: true, reason: "Invalid user." };

  const { data: restrictions } = await supabase
    .from("user_restrictions")
    .select("status, restriction_type, restricted_until, reason")
    .eq("user_id", userId)
    .eq("status", "active");

  if (Array.isArray(restrictions) && restrictions.length > 0) {
    const nowMs = Date.now();
    const active = restrictions.find(
      (r: {
        restriction_type?: string;
        restricted_until?: string | null;
        reason?: string;
      }) =>
        r.restriction_type !== "warning" &&
        (!r.restricted_until || new Date(r.restricted_until).getTime() > nowMs)
    );
    if (active) {
      return {
        restricted: true,
        reason: `Your account is currently suspended from social actions (${active.reason || "policy violation"}).`,
      };
    }
  }

  return { restricted: false };
}

export async function findFriendshipBetweenUsersWithClient(
  supabase: SupabaseLikeClient,
  userA: string,
  userB: string
): Promise<FriendshipRow | null> {
  if (!userA || !userB || userA === userB) return null;

  const { data } = await supabase
    .from("friendships")
    .select(
      "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
    )
    .or(
      `and(requester_id.eq.${userA},addressee_id.eq.${userB}),and(requester_id.eq.${userB},addressee_id.eq.${userA})`
    )
    .maybeSingle();

  return (data as FriendshipRow | null) ?? null;
}

export async function upsertFriendNotificationWithClient(
  supabase: SupabaseLikeClient,
  input: {
    recipientUserId: string;
    actorUserId: string;
    actorDisplayName: string;
    notificationType: "friend_request_received" | "friend_request_accepted";
  }
): Promise<{ created: boolean; error?: string }> {
  const recipientId = (input.recipientUserId ?? "").trim();
  const actorId = (input.actorUserId ?? "").trim();
  const notifType = input.notificationType;

  if (!recipientId || !actorId || recipientId === actorId) {
    return {
      created: false,
      error: "Invalid notification actor or recipient.",
    };
  }

  if (
    notifType !== "friend_request_received" &&
    notifType !== "friend_request_accepted"
  ) {
    return { created: false, error: "Unsupported notification type." };
  }

  // Verify the actor is not restricted and no block exists between the users
  const [restriction, blocked, existingFriendship, actorProfileRes] =
    await Promise.all([
      checkUserRestrictedWithClient(supabase, actorId),
      checkIsBlockedBetweenWithClient(supabase, actorId, recipientId),
      findFriendshipBetweenUsersWithClient(supabase, actorId, recipientId),
      supabase
        .from("profiles")
        .select("id, username, display_name")
        .eq("id", actorId)
        .maybeSingle(),
    ]);

  if (restriction.restricted) {
    return {
      created: false,
      error: "Restricted users cannot create notifications.",
    };
  }

  if (blocked) {
    return {
      created: false,
      error: "Blocked users cannot create notifications.",
    };
  }

  // Verify a real matching friendship row exists in the database before creating any notification
  if (!existingFriendship) {
    return {
      created: false,
      error:
        notifType === "friend_request_received"
          ? "Cannot create friend_request_received notification without an active pending friend request."
          : "Cannot create friend_request_accepted notification without an accepted friendship where actor is addressee.",
    };
  }

  if (notifType === "friend_request_received") {
    if (
      existingFriendship.status !== "pending" ||
      existingFriendship.requester_id !== actorId ||
      existingFriendship.addressee_id !== recipientId
    ) {
      return {
        created: false,
        error:
          "Cannot create friend_request_received notification without an active pending friend request.",
      };
    }
  } else {
    if (
      existingFriendship.status !== "accepted" ||
      existingFriendship.requester_id !== recipientId ||
      existingFriendship.addressee_id !== actorId
    ) {
      return {
        created: false,
        error:
          "Cannot create friend_request_accepted notification without an accepted friendship where actor is addressee.",
      };
    }
  }

  // 1) Try the SECURITY DEFINER RPC (which works when direct client INSERT on user_notifications is disabled by RLS)
  if (typeof supabase.rpc === "function") {
    try {
      const rpcRes = await supabase.rpc(
        "create_verified_friend_notification",
        {
          target_user_id: recipientId,
          notif_type: notifType,
        }
      );
      if (!rpcRes?.error && rpcRes?.data === true) {
        return { created: true };
      }
    } catch {
      // Fall back to verified upsert for test mocks
    }
  }

  // 2) Server-verified canonical notification payload (never trusts arbitrary caller title/body/linkUrl)
  const verifiedActorName =
    actorProfileRes?.data?.display_name ||
    actorProfileRes?.data?.username ||
    input.actorDisplayName ||
    "A member";

  const dedupeKey = `${notifType}:${actorId}:${recipientId}`;
  const title =
    notifType === "friend_request_received"
      ? `${verifiedActorName} sent you a friend request`.slice(0, 200)
      : `${verifiedActorName} accepted your friend request`.slice(0, 200);
  const body =
    notifType === "friend_request_received"
      ? "Review and accept or decline this request in your Friends tab."
      : "You are now connected as friends on Nayozu.";
  const linkUrl =
    notifType === "friend_request_received"
      ? "/profile?tab=friends&subtab=incoming"
      : "/profile?tab=friends&subtab=friends";

  const relationshipEventAt =
    notifType === "friend_request_received"
      ? existingFriendship.created_at
      : existingFriendship.responded_at ||
        existingFriendship.updated_at ||
        existingFriendship.created_at;

  try {
    // Check if an existing notification already exists for this dedupe_key so repeated calls
    // for the same friendship event do not reset an already-read notification to unread.
    const existingNotifRes = await supabase
      .from("user_notifications")
      .select("id, is_read, created_at, updated_at")
      .eq("user_id", recipientId)
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();

    const existingNotif = existingNotifRes?.data as
      | {
          id: string;
          is_read: boolean;
          created_at: string;
          updated_at: string;
        }
      | null
      | undefined;

    const isSameRelationshipEvent =
      Boolean(existingNotif) &&
      (!relationshipEventAt ||
        !existingNotif?.created_at ||
        existingNotif.created_at >= relationshipEventAt);

    const nextIsRead = isSameRelationshipEvent
      ? Boolean(existingNotif?.is_read)
      : false;
    const nowIso = new Date().toISOString();
    const nextCreatedAt =
      isSameRelationshipEvent && existingNotif?.created_at
        ? existingNotif.created_at
        : relationshipEventAt && relationshipEventAt > nowIso
        ? relationshipEventAt
        : nowIso;

    const { error } = await supabase.from("user_notifications").upsert(
      {
        user_id: recipientId,
        actor_id: actorId,
        notification_type: notifType,
        dedupe_key: dedupeKey,
        title,
        body,
        link_url: linkUrl,
        is_read: nextIsRead,
        created_at: nextCreatedAt,
        updated_at:
          isSameRelationshipEvent && existingNotif?.updated_at
            ? existingNotif.updated_at
            : nowIso,
      },
      { onConflict: "user_id,dedupe_key" }
    );
    if (error) {
      return { created: false, error: error.message };
    }
    return { created: true };
  } catch {
    return { created: false };
  }
}

export async function cleanupFriendshipBetweenUsersWithClient(
  supabase: SupabaseLikeClient,
  userA: string,
  userB: string
): Promise<void> {
  if (!userA || !userB || userA === userB) return;

  try {
    await supabase
      .from("friendships")
      .delete()
      .or(
        `and(requester_id.eq.${userA},addressee_id.eq.${userB}),and(requester_id.eq.${userB},addressee_id.eq.${userA})`
      );
  } catch {
    // Ignore if table not migrated yet
  }

  try {
    await supabase
      .from("watch_room_invitations")
      .delete()
      .or(
        `and(host_id.eq.${userA},invitee_id.eq.${userB}),and(host_id.eq.${userB},invitee_id.eq.${userA})`
      );
  } catch {
    // Ignore if table not migrated yet
  }

  try {
    await supabase
      .from("user_notifications")
      .delete()
      .or(
        `and(user_id.eq.${userA},actor_id.eq.${userB}),and(user_id.eq.${userB},actor_id.eq.${userA})`
      );
  } catch {
    // Ignore if table not migrated yet
  }
}

export async function sendFriendRequestWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string;
    targetUserId: string;
  }
): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  friendshipId?: string;
  autoAccepted?: boolean;
  message?: string;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const targetUserId = (input.targetUserId ?? "").trim();

  if (!viewerId) {
    return {
      success: false,
      status: "none",
      error: "You must be signed in to send a friend request.",
    };
  }

  if (!targetUserId) {
    return {
      success: false,
      status: "none",
      error: "Invalid target user.",
    };
  }

  if (viewerId === targetUserId) {
    return {
      success: false,
      status: "self",
      error: "You cannot send a friend request to yourself.",
    };
  }

  const restriction = await checkUserRestrictedWithClient(supabase, viewerId);
  if (restriction.restricted) {
    return {
      success: false,
      status: "none",
      error: restriction.reason || "Your account is restricted from sending friend requests.",
    };
  }

  const blocked = await checkIsBlockedBetweenWithClient(
    supabase,
    viewerId,
    targetUserId
  );
  if (blocked) {
    return {
      success: false,
      status: "blocked",
      error: "Cannot send a friend request to this user due to block settings.",
    };
  }

  // Verify target profile exists and fetch both profiles for notification label
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .in("id", [viewerId, targetUserId]);

  const profileList = Array.isArray(profiles) ? profiles : [];
  const targetProfile = profileList.find((p: { id: string }) => p.id === targetUserId);
  const viewerProfile = profileList.find((p: { id: string }) => p.id === viewerId);

  if (!targetProfile) {
    return {
      success: false,
      status: "none",
      error: "User profile not found.",
    };
  }

  const targetRestriction = await checkUserRestrictedWithClient(
    supabase,
    targetUserId
  );
  if (targetRestriction.restricted) {
    return {
      success: false,
      status: "none",
      error: "This user cannot receive friend requests right now.",
    };
  }

  const existing = await findFriendshipBetweenUsersWithClient(
    supabase,
    viewerId,
    targetUserId
  );

  const viewerName =
    viewerProfile?.display_name || viewerProfile?.username || "A member";

  if (existing) {
    if (existing.status === "accepted") {
      return {
        success: false,
        status: "friends",
        friendshipId: existing.id,
        error: "You are already friends with this user.",
      };
    }

    if (existing.requester_id === viewerId) {
      return {
        success: false,
        status: "pending_outgoing",
        friendshipId: existing.id,
        error: "Friend request is already pending.",
      };
    }

    // Reverse pending request exists (targetUserId already requested viewerId) -> auto-accept mutual friendship!
    if (existing.addressee_id === viewerId && existing.status === "pending") {
      const nowIso = new Date().toISOString();
      const { data: updated, error: updateErr } = await supabase
        .from("friendships")
        .update({
          status: "accepted",
          responded_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", existing.id)
        .eq("addressee_id", viewerId)
        .eq("status", "pending")
        .select(
          "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
        )
        .maybeSingle();

      if (updateErr || !updated) {
        return {
          success: false,
          status: "pending_incoming",
          error: "Could not accept incoming friend request. Please try again.",
        };
      }

      try {
        await supabase
          .from("user_notifications")
          .update({ is_read: true, updated_at: nowIso })
          .eq("user_id", viewerId)
          .eq("actor_id", targetUserId)
          .eq("notification_type", "friend_request_received");
      } catch {
        // Ignore non-fatal notification update error
      }

      await upsertFriendNotificationWithClient(supabase, {
        recipientUserId: targetUserId,
        actorUserId: viewerId,
        actorDisplayName: viewerName,
        notificationType: "friend_request_accepted",
      });

      return {
        success: true,
        status: "friends",
        friendshipId: updated.id,
        autoAccepted: true,
        message: `Mutual request! You and @${targetProfile.username} are now friends.`,
      };
    }
  }

  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertErr } = await supabase
    .from("friendships")
    .insert({
      requester_id: viewerId,
      addressee_id: targetUserId,
      status: "pending",
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(
      "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
    )
    .maybeSingle();

  if (insertErr || !inserted) {
    if (insertErr?.code === "23505") {
      const concurrent = await findFriendshipBetweenUsersWithClient(
        supabase,
        viewerId,
        targetUserId
      );
      const resolved = resolveFriendshipStatusForViewer({
        viewerId,
        targetUserId,
        row: concurrent,
      });
      return {
        success: false,
        status: resolved,
        friendshipId: concurrent?.id,
        error:
          resolved === "friends"
            ? "You are already friends with this user."
            : "A friend request already exists between you and this user.",
      };
    }
    return {
      success: false,
      status: "none",
      error: "Failed to send friend request. Please try again.",
    };
  }

  await upsertFriendNotificationWithClient(supabase, {
    recipientUserId: targetUserId,
    actorUserId: viewerId,
    actorDisplayName: viewerName,
    notificationType: "friend_request_received",
  });

  return {
    success: true,
    status: "pending_outgoing",
    friendshipId: inserted.id,
    message: `Friend request sent to @${targetProfile.username}.`,
  };
}

export async function acceptFriendRequestWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string;
    friendshipId?: string;
    requesterUserId?: string;
  }
): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  friendshipId?: string;
  message?: string;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const friendshipId = (input.friendshipId ?? "").trim();
  const requesterUserId = (input.requesterUserId ?? "").trim();

  if (!viewerId) {
    return {
      success: false,
      status: "none",
      error: "You must be signed in to accept a friend request.",
    };
  }

  if (!friendshipId && !requesterUserId) {
    return {
      success: false,
      status: "none",
      error: "Invalid friend request identifier.",
    };
  }

  const restriction = await checkUserRestrictedWithClient(supabase, viewerId);
  if (restriction.restricted) {
    return {
      success: false,
      status: "none",
      error:
        restriction.reason ||
        "Your account is restricted from accepting friend requests.",
    };
  }

  let row: FriendshipRow | null = null;
  if (friendshipId) {
    const { data } = await supabase
      .from("friendships")
      .select(
        "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
      )
      .eq("id", friendshipId)
      .maybeSingle();
    row = (data as FriendshipRow | null) ?? null;
  } else if (requesterUserId) {
    row = await findFriendshipBetweenUsersWithClient(
      supabase,
      viewerId,
      requesterUserId
    );
  }

  if (!row) {
    return {
      success: false,
      status: "none",
      error: "Friend request not found or was already withdrawn.",
    };
  }

  if (row.requester_id !== viewerId && row.addressee_id !== viewerId) {
    return {
      success: false,
      status: "none",
      error: "You are not authorized to manage this friend request.",
    };
  }

  const otherUserId =
    row.requester_id === viewerId ? row.addressee_id : row.requester_id;

  const blocked = await checkIsBlockedBetweenWithClient(
    supabase,
    viewerId,
    otherUserId
  );
  if (blocked) {
    await cleanupFriendshipBetweenUsersWithClient(
      supabase,
      viewerId,
      otherUserId
    );
    return {
      success: false,
      status: "blocked",
      error: "Cannot accept this friend request due to block settings.",
    };
  }

  if (row.status === "accepted") {
    return {
      success: true,
      status: "friends",
      friendshipId: row.id,
      message: "You are already friends.",
    };
  }

  if (row.addressee_id !== viewerId) {
    return {
      success: false,
      status: "pending_outgoing",
      error: "Only the recipient can accept a pending friend request.",
    };
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("friendships")
    .update({
      status: "accepted",
      responded_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .eq("addressee_id", viewerId)
    .eq("status", "pending")
    .select(
      "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
    )
    .maybeSingle();

  if (updateErr || !updated) {
    return {
      success: false,
      status: "pending_incoming",
      error: "Failed to accept friend request. Please try again.",
    };
  }

  try {
    await supabase
      .from("user_notifications")
      .update({ is_read: true, updated_at: nowIso })
      .eq("user_id", viewerId)
      .eq("actor_id", row.requester_id)
      .eq("notification_type", "friend_request_received");
  } catch {
    // Non-fatal
  }

  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", viewerId)
    .maybeSingle();

  const viewerName =
    viewerProfile?.display_name || viewerProfile?.username || "A member";

  await upsertFriendNotificationWithClient(supabase, {
    recipientUserId: row.requester_id,
    actorUserId: viewerId,
    actorDisplayName: viewerName,
    notificationType: "friend_request_accepted",
  });

  return {
    success: true,
    status: "friends",
    friendshipId: updated.id,
    message: "Friend request accepted!",
  };
}

export async function declineFriendRequestWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string;
    friendshipId?: string;
    requesterUserId?: string;
  }
): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  message?: string;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const friendshipId = (input.friendshipId ?? "").trim();
  const requesterUserId = (input.requesterUserId ?? "").trim();

  if (!viewerId) {
    return {
      success: false,
      status: "none",
      error: "You must be signed in to decline a friend request.",
    };
  }

  let row: FriendshipRow | null = null;
  if (friendshipId) {
    const { data } = await supabase
      .from("friendships")
      .select(
        "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
      )
      .eq("id", friendshipId)
      .maybeSingle();
    row = (data as FriendshipRow | null) ?? null;
  } else if (requesterUserId) {
    row = await findFriendshipBetweenUsersWithClient(
      supabase,
      viewerId,
      requesterUserId
    );
  }

  if (!row) {
    return {
      success: false,
      status: "none",
      error: "Friend request not found.",
    };
  }

  if (row.addressee_id !== viewerId) {
    return {
      success: false,
      status:
        row.requester_id === viewerId ? "pending_outgoing" : "none",
      error: "Only the recipient can decline an incoming friend request.",
    };
  }

  if (row.status !== "pending") {
    return {
      success: false,
      status: "friends",
      error: "Cannot decline an already accepted friendship.",
    };
  }

  const { error: deleteErr } = await supabase
    .from("friendships")
    .delete()
    .eq("id", row.id)
    .eq("addressee_id", viewerId)
    .eq("status", "pending");

  if (deleteErr) {
    return {
      success: false,
      status: "pending_incoming",
      error: "Failed to decline friend request.",
    };
  }

  try {
    await supabase
      .from("user_notifications")
      .delete()
      .eq("user_id", viewerId)
      .eq("actor_id", row.requester_id)
      .eq("notification_type", "friend_request_received");
  } catch {
    // Non-fatal
  }

  return {
    success: true,
    status: "none",
    message: "Friend request declined.",
  };
}

export async function cancelFriendRequestWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string;
    friendshipId?: string;
    targetUserId?: string;
  }
): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  message?: string;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const friendshipId = (input.friendshipId ?? "").trim();
  const targetUserId = (input.targetUserId ?? "").trim();

  if (!viewerId) {
    return {
      success: false,
      status: "none",
      error: "You must be signed in to cancel a friend request.",
    };
  }

  let row: FriendshipRow | null = null;
  if (friendshipId) {
    const { data } = await supabase
      .from("friendships")
      .select(
        "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
      )
      .eq("id", friendshipId)
      .maybeSingle();
    row = (data as FriendshipRow | null) ?? null;
  } else if (targetUserId) {
    row = await findFriendshipBetweenUsersWithClient(
      supabase,
      viewerId,
      targetUserId
    );
  }

  if (!row) {
    return {
      success: false,
      status: "none",
      error: "Pending friend request not found.",
    };
  }

  if (row.requester_id !== viewerId) {
    return {
      success: false,
      status:
        row.addressee_id === viewerId ? "pending_incoming" : "none",
      error: "Only the sender can cancel an outgoing friend request.",
    };
  }

  if (row.status !== "pending") {
    return {
      success: false,
      status: "friends",
      error: "This request has already been accepted.",
    };
  }

  const { error: deleteErr } = await supabase
    .from("friendships")
    .delete()
    .eq("id", row.id)
    .eq("requester_id", viewerId)
    .eq("status", "pending");

  if (deleteErr) {
    return {
      success: false,
      status: "pending_outgoing",
      error: "Failed to cancel friend request.",
    };
  }

  try {
    await supabase
      .from("user_notifications")
      .delete()
      .eq("user_id", row.addressee_id)
      .eq("actor_id", viewerId)
      .eq("notification_type", "friend_request_received");
  } catch {
    // Non-fatal
  }

  return {
    success: true,
    status: "none",
    message: "Friend request cancelled.",
  };
}

export async function removeFriendWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string;
    friendshipId?: string;
    friendUserId?: string;
  }
): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  message?: string;
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const friendshipId = (input.friendshipId ?? "").trim();
  const friendUserId = (input.friendUserId ?? "").trim();

  if (!viewerId) {
    return {
      success: false,
      status: "none",
      error: "You must be signed in to remove a friend.",
    };
  }

  let row: FriendshipRow | null = null;
  if (friendshipId) {
    const { data } = await supabase
      .from("friendships")
      .select(
        "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
      )
      .eq("id", friendshipId)
      .maybeSingle();
    row = (data as FriendshipRow | null) ?? null;
  } else if (friendUserId) {
    row = await findFriendshipBetweenUsersWithClient(
      supabase,
      viewerId,
      friendUserId
    );
  }

  if (!row) {
    return {
      success: false,
      status: "none",
      error: "Friendship not found.",
    };
  }

  if (row.requester_id !== viewerId && row.addressee_id !== viewerId) {
    return {
      success: false,
      status: "none",
      error: "You are not authorized to remove this friendship.",
    };
  }

  if (row.status !== "accepted") {
    return {
      success: false,
      status: resolveFriendshipStatusForViewer({
        viewerId,
        targetUserId:
          row.requester_id === viewerId ? row.addressee_id : row.requester_id,
        row,
      }),
      error: "Users are not currently accepted friends.",
    };
  }

  const otherUserId =
    row.requester_id === viewerId ? row.addressee_id : row.requester_id;

  const { error: deleteErr } = await supabase
    .from("friendships")
    .delete()
    .eq("id", row.id);

  if (deleteErr) {
    return {
      success: false,
      status: "friends",
      error: "Failed to remove friend.",
    };
  }

  try {
    await supabase
      .from("watch_room_invitations")
      .delete()
      .eq("status", "pending")
      .or(
        `and(host_id.eq.${viewerId},invitee_id.eq.${otherUserId}),and(host_id.eq.${otherUserId},invitee_id.eq.${viewerId})`
      );
  } catch {
    // Non-fatal
  }

  try {
    await supabase
      .from("user_notifications")
      .delete()
      .or(
        `and(user_id.eq.${viewerId},actor_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},actor_id.eq.${viewerId})`
      );
  } catch {
    // Non-fatal
  }

  return {
    success: true,
    status: "none",
    message: "Friend removed.",
  };
}

/**
 * Searches users for friend discovery.
 * Security & privacy guarantees:
 * - Excludes self, bidirectionally blocked users, and actively restricted accounts.
 * - Never selects or returns email addresses or auth metadata.
 * - Respects `profile_visibility`:
 *   - Profiles with `profile_visibility = 'private'` are excluded from stranger discovery search
 *     unless an existing pending/accepted relationship already exists with the viewer,
 *     and their private bio is never exposed.
 */
export async function searchUsersForFriendsWithClient(
  supabase: SupabaseLikeClient,
  input: {
    viewerId: string;
    query: string;
    limit?: number;
  }
): Promise<{
  success: boolean;
  results: FriendProfileSummaryDTO[];
  error?: string;
}> {
  const viewerId = (input.viewerId ?? "").trim();
  const rawQuery = (input.query ?? "").trim();
  const maxLimit = Math.min(Math.max(input.limit ?? 20, 1), 30);

  if (!viewerId) {
    return {
      success: false,
      results: [],
      error: "You must be signed in to search for users.",
    };
  }

  const normalizedQuery = rawQuery.replace(/^@+/, "").trim().toLowerCase();
  if (!normalizedQuery) {
    return { success: true, results: [] };
  }

  const [blockedSet, friendshipsRes] = await Promise.all([
    getBidirectionalBlockedSetWithClient(supabase, viewerId),
    supabase
      .from("friendships")
      .select(
        "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
      )
      .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`),
  ]);

  const relationshipByUserId = new Map<string, FriendshipRow>();
  for (const row of (friendshipsRes?.data ?? []) as FriendshipRow[]) {
    const otherId =
      row.requester_id === viewerId ? row.addressee_id : row.requester_id;
    relationshipByUserId.set(otherId, row);
  }

  const escapedPattern = `%${normalizedQuery.replace(/[%_\\]/g, "\\$&")}%`;
  const { data: candidateProfiles, error: searchErr } = await supabase
    .from("profiles")
    .select(
      "id, username, display_name, avatar_url, bio, profile_visibility, created_at"
    )
    .or(`username.ilike.${escapedPattern},display_name.ilike.${escapedPattern}`)
    .limit(maxLimit * 3);

  if (searchErr) {
    return {
      success: false,
      results: [],
      error: "Unable to search users right now.",
    };
  }

  const rows = Array.isArray(candidateProfiles) ? candidateProfiles : [];
  const candidateIds = rows
    .map((r: { id: string }) => r.id)
    .filter((id: string) => id && id !== viewerId && !blockedSet.has(id));

  // Exclude actively restricted accounts from discovery
  const restrictedUserIds = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: activeRestrictions } = await supabase
      .from("user_restrictions")
      .select("user_id, status, restriction_type, restricted_until")
      .in("user_id", candidateIds)
      .eq("status", "active");

    const nowMs = Date.now();
    for (const r of activeRestrictions ?? []) {
      if (
        r.restriction_type !== "warning" &&
        (!r.restricted_until || new Date(r.restricted_until).getTime() > nowMs)
      ) {
        restrictedUserIds.add(r.user_id);
      }
    }
  }

  const results: FriendProfileSummaryDTO[] = [];
  for (const p of rows) {
    if (!p?.id || p.id === viewerId) continue;
    if (blockedSet.has(p.id)) continue;
    if (restrictedUserIds.has(p.id)) continue;

    const visibility: "public" | "private" =
      p.profile_visibility === "private" ? "private" : "public";
    const existingRow = relationshipByUserId.get(p.id) ?? null;

    // Private profile search restriction:
    // Strangers cannot discover private profiles via general search;
    // only users who already share a pending/accepted relationship can see the entry,
    // and private bio/createdAt are never exposed.
    if (visibility === "private" && !existingRow) {
      continue;
    }

    const uname = String(p.username ?? "").toLowerCase();
    const dname = String(p.display_name ?? "").toLowerCase();
    const matchesUsername = uname.includes(normalizedQuery);
    const matchesDisplayName =
      visibility === "public" && dname.includes(normalizedQuery);

    if (!matchesUsername && !matchesDisplayName) {
      continue;
    }

    const relationshipStatus = resolveFriendshipStatusForViewer({
      viewerId,
      targetUserId: p.id,
      row: existingRow,
      isBlocked: false,
    });

    results.push({
      id: p.id,
      username: p.username,
      displayName: p.display_name || p.username,
      avatarUrl: p.avatar_url ?? null,
      profileVisibility: visibility,
      bio: visibility === "public" ? p.bio ?? null : null,
      friendshipId: existingRow?.id ?? null,
      relationshipStatus,
      isOnline: false,
      recentActivity: null,
      lastActiveAt: null,
      createdAt: visibility === "public" ? p.created_at ?? null : null,
      respondedAt: existingRow?.responded_at ?? null,
    });

    if (results.length >= maxLimit) break;
  }

  // Sort exact username prefix matches first, then existing friends/requests
  results.sort((a, b) => {
    const aExact = a.username.toLowerCase() === normalizedQuery ? 0 : 1;
    const bExact = b.username.toLowerCase() === normalizedQuery ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aStarts = a.username.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
    const bStarts = b.username.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.username.localeCompare(b.username);
  });

  return {
    success: true,
    results,
  };
}

export async function getFriendsOverviewWithClient(
  supabase: SupabaseLikeClient,
  viewerId: string
): Promise<{
  success: boolean;
  data: FriendsOverviewDTO;
  error?: string;
}> {
  const empty: FriendsOverviewDTO = {
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    notifications: [],
    unreadNotificationCount: 0,
  };

  if (!viewerId) {
    return {
      success: false,
      data: empty,
      error: "You must be signed in to view friends.",
    };
  }

  const [blockedSet, friendshipsRes, notificationsRes] = await Promise.all([
    getBidirectionalBlockedSetWithClient(supabase, viewerId),
    supabase
      .from("friendships")
      .select(
        "id, requester_id, addressee_id, status, created_at, updated_at, responded_at"
      )
      .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`)
      .order("updated_at", { ascending: false }),
    supabase
      .from("user_notifications")
      .select(
        "id, user_id, actor_id, notification_type, dedupe_key, title, body, link_url, is_read, created_at"
      )
      .eq("user_id", viewerId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const friendshipRows = ((friendshipsRes?.data ?? []) as FriendshipRow[]).filter(
    (row) => {
      const otherId =
        row.requester_id === viewerId ? row.addressee_id : row.requester_id;
      return otherId && !blockedSet.has(otherId);
    }
  );

  const rawNotifications = Array.isArray(notificationsRes?.data)
    ? notificationsRes.data
    : [];

  const profileIdsToFetch = new Set<string>();
  for (const row of friendshipRows) {
    const otherId =
      row.requester_id === viewerId ? row.addressee_id : row.requester_id;
    if (otherId) profileIdsToFetch.add(otherId);
  }
  for (const n of rawNotifications) {
    if (n.actor_id && !blockedSet.has(n.actor_id)) {
      profileIdsToFetch.add(n.actor_id);
    }
  }

  const profileById = new Map<
    string,
    {
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      bio: string | null;
      profile_visibility: string | null;
      created_at: string | null;
    }
  >();

  if (profileIdsToFetch.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select(
        "id, username, display_name, avatar_url, bio, profile_visibility, created_at"
      )
      .in("id", Array.from(profileIdsToFetch));

    for (const p of profiles ?? []) {
      profileById.set(p.id, p);
    }
  }

  const friends: FriendProfileSummaryDTO[] = [];
  const incomingRequests: FriendProfileSummaryDTO[] = [];
  const outgoingRequests: FriendProfileSummaryDTO[] = [];

  for (const row of friendshipRows) {
    const otherId =
      row.requester_id === viewerId ? row.addressee_id : row.requester_id;
    const p = profileById.get(otherId);
    if (!p) continue;

    const visibility: "public" | "private" =
      p.profile_visibility === "private" ? "private" : "public";
    const relationshipStatus = resolveFriendshipStatusForViewer({
      viewerId,
      targetUserId: otherId,
      row,
      isBlocked: false,
    });

    const summary: FriendProfileSummaryDTO = {
      id: p.id,
      username: p.username,
      displayName: p.display_name || p.username,
      avatarUrl: p.avatar_url ?? null,
      profileVisibility: visibility,
      bio:
        visibility === "public" || relationshipStatus === "friends"
          ? p.bio ?? null
          : null,
      friendshipId: row.id,
      relationshipStatus,
      isOnline: false,
      recentActivity: null,
      lastActiveAt: row.updated_at ?? row.created_at ?? null,
      createdAt: row.created_at ?? null,
      respondedAt: row.responded_at ?? null,
    };

    if (relationshipStatus === "friends") {
      friends.push(summary);
    } else if (relationshipStatus === "pending_incoming") {
      incomingRequests.push(summary);
    } else if (relationshipStatus === "pending_outgoing") {
      outgoingRequests.push(summary);
    }
  }

  const notifications: UserNotificationDTO[] = [];
  let unreadNotificationCount = 0;

  for (const n of rawNotifications) {
    if (n.actor_id && blockedSet.has(n.actor_id)) continue;
    const actor = n.actor_id ? profileById.get(n.actor_id) : undefined;
    const isRead = Boolean(n.is_read);
    if (!isRead) unreadNotificationCount += 1;

    notifications.push({
      id: n.id,
      userId: n.user_id,
      actorId: n.actor_id ?? null,
      actorUsername: actor?.username ?? null,
      actorDisplayName: actor?.display_name || actor?.username || null,
      actorAvatarUrl: actor?.avatar_url ?? null,
      notificationType: n.notification_type,
      dedupeKey: n.dedupe_key,
      title: n.title,
      body: n.body ?? null,
      linkUrl: n.link_url || "/profile?tab=friends",
      isRead,
      createdAt: n.created_at,
    });
  }

  return {
    success: true,
    data: {
      friends,
      incomingRequests,
      outgoingRequests,
      notifications,
      unreadNotificationCount,
    },
  };
}
