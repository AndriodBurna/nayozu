"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  acceptFriendRequestWithClient,
  cancelFriendRequestWithClient,
  checkIsBlockedBetweenWithClient,
  declineFriendRequestWithClient,
  findFriendshipBetweenUsersWithClient,
  getFriendsOverviewWithClient,
  removeFriendWithClient,
  resolveFriendshipStatusForViewer,
  searchUsersForFriendsWithClient,
  sendFriendRequestWithClient,
  type FriendProfileSummaryDTO,
  type FriendshipRelationshipStatus,
  type FriendsOverviewDTO,
  type UserNotificationDTO,
} from "@/lib/friends/friendsService";
import {
  acceptWatchRoomInvitationWithClient,
  cancelWatchRoomInvitationWithClient,
  declineWatchRoomInvitationWithClient,
  getActivityPrivacySettingsWithClient,
  getFriendActivityFeedWithClient,
  getWatchRoomInvitationsForUserWithClient,
  sendWatchRoomInvitationWithClient,
  updateActivityPrivacySettingsWithClient,
  type ActivityPrivacySettingsDTO,
  type FriendActivityFeedResult,
  type FriendActivityFilter,
  type FriendActivityItemDTO,
  type WatchRoomInvitationDTO,
  type WatchRoomInvitationStatus,
} from "@/lib/friends/friendActivityAndInvitesService";

export type {
  ActivityPrivacySettingsDTO,
  FriendActivityFeedResult,
  FriendActivityFilter,
  FriendActivityItemDTO,
  WatchRoomInvitationDTO,
  WatchRoomInvitationStatus,
};

async function ensureAuthAndProfile() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, user: null };
  }

  const fallbackUsername =
    (user.user_metadata?.username as string | undefined) ||
    user.email?.split("@")[0]?.replace(/[^a-zA-Z0-9_-]/g, "_") ||
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

  return { supabase, user };
}

function revalidateFriendRoutes() {
  revalidatePath("/profile");
  revalidatePath("/community");
}

export async function sendFriendRequestAction(input: {
  targetUserId: string;
}): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  friendshipId?: string;
  autoAccepted?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        status: "none",
        error: "You must be signed in to send a friend request.",
      };
    }

    const res = await sendFriendRequestWithClient(supabase, {
      viewerId: user.id,
      targetUserId: input.targetUserId,
    });

    if (res.success) {
      revalidateFriendRoutes();
    }
    return res;
  } catch (err) {
    return {
      success: false,
      status: "none",
      error:
        err instanceof Error
          ? err.message
          : "Unable to send friend request right now.",
    };
  }
}

export async function acceptFriendRequestAction(input: {
  friendshipId?: string;
  requesterUserId?: string;
}): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  friendshipId?: string;
  message?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        status: "none",
        error: "You must be signed in to accept a friend request.",
      };
    }

    const res = await acceptFriendRequestWithClient(supabase, {
      viewerId: user.id,
      friendshipId: input.friendshipId,
      requesterUserId: input.requesterUserId,
    });

    if (res.success) {
      revalidateFriendRoutes();
    }
    return res;
  } catch (err) {
    return {
      success: false,
      status: "none",
      error:
        err instanceof Error
          ? err.message
          : "Unable to accept friend request right now.",
    };
  }
}

export async function declineFriendRequestAction(input: {
  friendshipId?: string;
  requesterUserId?: string;
}): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  message?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        status: "none",
        error: "You must be signed in to decline a friend request.",
      };
    }

    const res = await declineFriendRequestWithClient(supabase, {
      viewerId: user.id,
      friendshipId: input.friendshipId,
      requesterUserId: input.requesterUserId,
    });

    if (res.success) {
      revalidateFriendRoutes();
    }
    return res;
  } catch (err) {
    return {
      success: false,
      status: "none",
      error:
        err instanceof Error
          ? err.message
          : "Unable to decline friend request right now.",
    };
  }
}

export async function cancelFriendRequestAction(input: {
  friendshipId?: string;
  targetUserId?: string;
}): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  message?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        status: "none",
        error: "You must be signed in to cancel a friend request.",
      };
    }

    const res = await cancelFriendRequestWithClient(supabase, {
      viewerId: user.id,
      friendshipId: input.friendshipId,
      targetUserId: input.targetUserId,
    });

    if (res.success) {
      revalidateFriendRoutes();
    }
    return res;
  } catch (err) {
    return {
      success: false,
      status: "none",
      error:
        err instanceof Error
          ? err.message
          : "Unable to cancel friend request right now.",
    };
  }
}

export async function removeFriendAction(input: {
  friendshipId?: string;
  friendUserId?: string;
}): Promise<{
  success: boolean;
  status: FriendshipRelationshipStatus;
  message?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        status: "none",
        error: "You must be signed in to remove a friend.",
      };
    }

    const res = await removeFriendWithClient(supabase, {
      viewerId: user.id,
      friendshipId: input.friendshipId,
      friendUserId: input.friendUserId,
    });

    if (res.success) {
      revalidateFriendRoutes();
    }
    return res;
  } catch (err) {
    return {
      success: false,
      status: "none",
      error:
        err instanceof Error
          ? err.message
          : "Unable to remove friend right now.",
    };
  }
}

export async function searchUsersForFriendsAction(input: {
  query: string;
  limit?: number;
}): Promise<{
  success: boolean;
  results: FriendProfileSummaryDTO[];
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        results: [],
        error: "You must be signed in to search for users.",
      };
    }

    return await searchUsersForFriendsWithClient(supabase, {
      viewerId: user.id,
      query: input.query,
      limit: input.limit,
    });
  } catch (err) {
    return {
      success: false,
      results: [],
      error:
        err instanceof Error
          ? err.message
          : "Unable to search users right now.",
    };
  }
}

export async function getFriendsOverviewAction(): Promise<{
  success: boolean;
  data: FriendsOverviewDTO;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        data: {
          friends: [],
          incomingRequests: [],
          outgoingRequests: [],
          notifications: [],
          unreadNotificationCount: 0,
        },
        error: "You must be signed in to view friends.",
      };
    }

    return await getFriendsOverviewWithClient(supabase, user.id);
  } catch (err) {
    return {
      success: false,
      data: {
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
        notifications: [],
        unreadNotificationCount: 0,
      },
      error:
        err instanceof Error
          ? err.message
          : "Unable to load friends overview right now.",
    };
  }
}

export async function getFriendshipStatusForUserAction(input: {
  targetUserId: string;
}): Promise<{
  relationshipStatus: FriendshipRelationshipStatus;
  friendshipId: string | null;
}> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !input.targetUserId) {
      return { relationshipStatus: "none", friendshipId: null };
    }

    if (user.id === input.targetUserId) {
      return { relationshipStatus: "self", friendshipId: null };
    }

    const [blocked, row] = await Promise.all([
      checkIsBlockedBetweenWithClient(supabase, user.id, input.targetUserId),
      findFriendshipBetweenUsersWithClient(
        supabase,
        user.id,
        input.targetUserId
      ),
    ]);

    return {
      relationshipStatus: resolveFriendshipStatusForViewer({
        viewerId: user.id,
        targetUserId: input.targetUserId,
        row,
        isBlocked: blocked,
      }),
      friendshipId: row?.id ?? null,
    };
  } catch {
    return { relationshipStatus: "none", friendshipId: null };
  }
}

export async function getUserNotificationsAction(): Promise<{
  success: boolean;
  notifications: UserNotificationDTO[];
  unreadCount: number;
  incomingFriendRequestsCount: number;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: true,
        notifications: [],
        unreadCount: 0,
        incomingFriendRequestsCount: 0,
      };
    }

    const res = await getFriendsOverviewWithClient(supabase, user.id);
    return {
      success: res.success,
      notifications: res.data.notifications,
      unreadCount: res.data.unreadNotificationCount,
      incomingFriendRequestsCount: res.data.incomingRequests.length,
    };
  } catch {
    return {
      success: false,
      notifications: [],
      unreadCount: 0,
      incomingFriendRequestsCount: 0,
    };
  }
}

export async function markNotificationReadAction(input: {
  notificationId: string;
}): Promise<{ success: boolean }> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user || !input.notificationId) return { success: false };

    await supabase
      .from("user_notifications")
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq("id", input.notificationId)
      .eq("user_id", user.id);

    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function markAllNotificationsReadAction(): Promise<{
  success: boolean;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) return { success: false };

    await supabase
      .from("user_notifications")
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("is_read", false);

    return { success: true };
  } catch {
    return { success: false };
  }
}

// ============================================================================
// Stage 4: Friend Activity Feed & Watch Together Invitations Server Actions
// ============================================================================

export async function getFriendActivityFeedAction(input?: {
  page?: number;
  limit?: number;
  filter?: FriendActivityFilter;
}): Promise<FriendActivityFeedResult> {
  const page = Math.max(Math.floor(Number(input?.page) || 1), 1);
  const limit = Math.min(Math.max(Math.floor(Number(input?.limit) || 12), 1), 30);
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
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

    return await getFriendActivityFeedWithClient(supabase, {
      viewerId: user.id,
      page,
      limit,
      filter: input?.filter ?? "all",
    });
  } catch (err) {
    return {
      success: false,
      items: [],
      totalCount: 0,
      page,
      limit,
      hasMore: false,
      acceptedFriendsCount: 0,
      error:
        err instanceof Error
          ? err.message
          : "Unable to load friend activity feed right now.",
    };
  }
}

export async function getActivityPrivacySettingsAction(): Promise<{
  success: boolean;
  settings: ActivityPrivacySettingsDTO;
  error?: string;
}> {
  const defaults: ActivityPrivacySettingsDTO = {
    shareActivityWithFriends: true,
    shareLibraryActivityWithFriends: true,
    notifyWatchTogetherInvites: true,
  };
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        settings: defaults,
        error: "You must be signed in.",
      };
    }
    const settings = await getActivityPrivacySettingsWithClient(
      supabase,
      user.id
    );
    return { success: true, settings };
  } catch {
    return { success: false, settings: defaults };
  }
}

export async function updateActivityPrivacySettingsAction(input: {
  shareActivityWithFriends?: boolean;
  shareLibraryActivityWithFriends?: boolean;
  notifyWatchTogetherInvites?: boolean;
}): Promise<{
  success: boolean;
  settings: ActivityPrivacySettingsDTO;
  error?: string;
}> {
  const defaults: ActivityPrivacySettingsDTO = {
    shareActivityWithFriends: true,
    shareLibraryActivityWithFriends: true,
    notifyWatchTogetherInvites: true,
  };
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        settings: defaults,
        error: "You must be signed in to update activity privacy settings.",
      };
    }

    const res = await updateActivityPrivacySettingsWithClient(supabase, {
      viewerId: user.id,
      shareActivityWithFriends: input.shareActivityWithFriends,
      shareLibraryActivityWithFriends: input.shareLibraryActivityWithFriends,
      notifyWatchTogetherInvites: input.notifyWatchTogetherInvites,
    });

    if (res.success) {
      revalidateFriendRoutes();
      revalidatePath("/settings");
    }
    return res;
  } catch (err) {
    return {
      success: false,
      settings: defaults,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update activity privacy settings.",
    };
  }
}

export async function sendWatchRoomInvitationAction(input: {
  roomId: string;
  inviteeUserId: string;
}): Promise<{
  success: boolean;
  invitationId?: string;
  status?: WatchRoomInvitationStatus;
  message?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        error: "You must be signed in as the room host to invite friends.",
      };
    }

    const res = await sendWatchRoomInvitationWithClient(supabase, {
      viewerId: user.id,
      roomId: input.roomId,
      inviteeUserId: input.inviteeUserId,
    });

    if (res.success) {
      revalidatePath("/watch-together");
      revalidateFriendRoutes();
    }
    return res;
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Unable to send Watch Together invitation right now.",
    };
  }
}

export async function acceptWatchRoomInvitationAction(input: {
  invitationId: string;
}): Promise<{
  success: boolean;
  roomId?: string;
  status?: WatchRoomInvitationStatus;
  participantCount?: number;
  maxParticipants?: number;
  message?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        error: "You must be signed in to accept a Watch Together invitation.",
      };
    }

    const res = await acceptWatchRoomInvitationWithClient(supabase, {
      viewerId: user.id,
      invitationId: input.invitationId,
    });

    if (res.success) {
      revalidatePath("/watch-together");
      revalidateFriendRoutes();
    }
    return res;
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Unable to accept Watch Together invitation right now.",
    };
  }
}

export async function declineWatchRoomInvitationAction(input: {
  invitationId: string;
}): Promise<{
  success: boolean;
  status?: WatchRoomInvitationStatus;
  message?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        error: "You must be signed in to decline an invitation.",
      };
    }

    const res = await declineWatchRoomInvitationWithClient(supabase, {
      viewerId: user.id,
      invitationId: input.invitationId,
    });

    if (res.success) {
      revalidatePath("/watch-together");
      revalidateFriendRoutes();
    }
    return res;
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Unable to decline invitation right now.",
    };
  }
}

export async function cancelWatchRoomInvitationAction(input: {
  invitationId: string;
}): Promise<{
  success: boolean;
  status?: WatchRoomInvitationStatus;
  message?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: false,
        error: "You must be signed in to cancel an invitation.",
      };
    }

    const res = await cancelWatchRoomInvitationWithClient(supabase, {
      viewerId: user.id,
      invitationId: input.invitationId,
    });

    if (res.success) {
      revalidatePath("/watch-together");
      revalidateFriendRoutes();
    }
    return res;
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Unable to cancel invitation right now.",
    };
  }
}

export async function getWatchRoomInvitationsAction(input?: {
  roomId?: string | null;
}): Promise<{
  success: boolean;
  incomingInvitations: WatchRoomInvitationDTO[];
  roomOutgoingInvitations: WatchRoomInvitationDTO[];
  error?: string;
}> {
  try {
    const { supabase, user } = await ensureAuthAndProfile();
    if (!user) {
      return {
        success: true,
        incomingInvitations: [],
        roomOutgoingInvitations: [],
      };
    }

    return await getWatchRoomInvitationsForUserWithClient(supabase, {
      viewerId: user.id,
      roomId: input?.roomId ?? null,
    });
  } catch (err) {
    return {
      success: false,
      incomingInvitations: [],
      roomOutgoingInvitations: [],
      error:
        err instanceof Error
          ? err.message
          : "Unable to load Watch Together invitations.",
    };
  }
}
