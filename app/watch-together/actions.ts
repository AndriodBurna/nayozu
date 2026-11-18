"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  classifyWatchRoomLifecycle,
  computeActiveRoomParticipants,
  fetchSharedWatchTogetherRooms,
  parseWatchRoomPayloadSync,
  parseWatchRoomPresenceRecord,
  pruneWatchRoomActiveParticipantsSnapshot,
  resolveBidirectionalBlockedSet,
  serializeWatchRoomPresenceRecord,
  withWatchRoomJoinLock,
  type WatchRoomHostProfile,
  type WatchRoomLifecycleState,
  type WatchRoomParticipantSnapshot,
  type WatchRoomPayload,
  type WatchRoomPrivacy,
  type WatchRoomResolvedDTO,
  type WatchRoomStatus,
} from "@/lib/watch-together/roomService";

export type {
  WatchRoomLifecycleState,
  WatchRoomParticipantSnapshot,
  WatchRoomPayload,
  WatchRoomPrivacy,
  WatchRoomResolvedDTO,
  WatchRoomStatus,
};

export interface CreateWatchRoomInput {
  roomTitle: string;
  description?: string;
  animeExternalId: string;
  episodeNumber?: number;
  language?: "sub" | "dub";
  privacy?: WatchRoomPrivacy;
  accessCode?: string;
  maxParticipants?: number;
}

export interface WatchRoomActionResult {
  success: boolean;
  roomId?: string;
  error?: string;
}

function hashAccessCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

export async function parseWatchRoomPayload(
  rawBody: string
): Promise<WatchRoomPayload | null> {
  return parseWatchRoomPayloadSync(rawBody);
}

async function checkUserAllowed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<boolean> {
  const { data: restrictions } = await supabase
    .from("user_restrictions")
    .select("status, restriction_type, restricted_until")
    .eq("user_id", userId);

  if (Array.isArray(restrictions) && restrictions.length > 0) {
    const nowMs = Date.now();
    const active = restrictions.find(
      (r) =>
        r.status === "active" &&
        r.restriction_type !== "warning" &&
        (!r.restricted_until || new Date(r.restricted_until).getTime() > nowMs)
    );
    if (active) {
      return false;
    }
  }
  return true;
}

async function upsertUserRoomPresenceRow(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  roomId: string;
  userId: string;
  status: "active" | "left";
  nowIso: string;
}): Promise<void> {
  const { supabase, roomId, userId, status, nowIso } = params;
  try {
    const { data: existingRows } = await supabase
      .from("anime_comments")
      .select("id, body")
      .eq("anime_id", "watch_room")
      .eq("parent_comment_id", roomId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    const presenceRow = (existingRows ?? []).find(
      (r) => parseWatchRoomPresenceRecord(r.body) !== null
    );

    const serialized = serializeWatchRoomPresenceRecord({
      status,
      sessionKey: `user:${userId}`,
      lastSeenAt: nowIso,
    });

    if (presenceRow) {
      await supabase
        .from("anime_comments")
        .update({
          body: serialized,
          is_hidden: false,
          updated_at: nowIso,
        })
        .eq("id", presenceRow.id)
        .eq("user_id", userId);
    } else if (status === "active") {
      await supabase.from("anime_comments").insert({
        user_id: userId,
        anime_id: "watch_room",
        parent_comment_id: roomId,
        body: serialized,
        is_spoiler: false,
        is_hidden: false,
        created_at: nowIso,
        updated_at: nowIso,
      });
    }
  } catch {
    /* non-fatal best-effort presence persistence */
  }
}

export async function createWatchRoomAction(
  input: CreateWatchRoomInput
): Promise<WatchRoomActionResult> {
  const cleanTitle = (input.roomTitle ?? "").trim();
  const cleanDesc = (input.description ?? "").trim();
  const cleanAnimeId = (input.animeExternalId ?? "").trim();

  if (!cleanTitle || cleanTitle.length < 3) {
    return {
      success: false,
      error: "Room title must be at least 3 characters long.",
    };
  }
  if (cleanTitle.length > 80) {
    return {
      success: false,
      error: "Room title cannot exceed 80 characters.",
    };
  }
  if (!cleanAnimeId) {
    return {
      success: false,
      error: "Please select an anime title to watch.",
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
      error: "You must be signed in to create a Watch Together room.",
    };
  }

  const allowed = await checkUserAllowed(supabase, user.id);
  if (!allowed) {
    return {
      success: false,
      error: "Your account is currently restricted from creating rooms.",
    };
  }

  // Validate selected anime exists in database
  const { data: animeRow, error: animeErr } = await supabase
    .from("anime")
    .select(
      "external_id, slug, title_romaji, title_english, cover_image_url, episodes, status"
    )
    .eq("external_id", Number(cleanAnimeId))
    .eq("media_type", "anime")
    .maybeSingle();

  if (animeErr || !animeRow) {
    return {
      success: false,
      error: "Selected anime title could not be found in the catalog.",
    };
  }

  if (animeRow.status === "NOT_YET_RELEASED") {
    return {
      success: false,
      error: "Cannot start a watch room for an unreleased anime title.",
    };
  }

  const privacy: WatchRoomPrivacy =
    input.privacy === "private" ? "private" : "public";
  const rawCode = (input.accessCode ?? "").trim();
  if (privacy === "private" && rawCode.length < 4) {
    return {
      success: false,
      error: "Private rooms require an invite code of at least 4 characters.",
    };
  }

  // Ensure profile exists for the host and fetch visibility
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

  const { data: hostProfileRow } = await supabase
    .from("profiles")
    .select("username, display_name, avatar_url, profile_visibility")
    .eq("id", user.id)
    .maybeSingle();

  const hostUsername = hostProfileRow?.username || fallbackUsername;
  const hostDisplayName = hostProfileRow?.display_name || hostUsername;
  const hostAvatarUrl = hostProfileRow?.avatar_url ?? null;
  const hostIsPublic = hostProfileRow?.profile_visibility === "public";

  const maxEp = animeRow.episodes ? Number(animeRow.episodes) : 2000;
  const epNumber = Math.min(
    Math.max(Number(input.episodeNumber) || 1, 1),
    maxEp
  );
  const maxParticipants = Math.min(
    Math.max(Number(input.maxParticipants) || 8, 2),
    25
  );
  const now = new Date().toISOString();

  const payload: WatchRoomPayload = {
    version: 1,
    roomTitle: cleanTitle,
    description: cleanDesc ? cleanDesc.slice(0, 280) : null,
    animeExternalId: String(animeRow.external_id),
    animeSlug: animeRow.slug,
    animeTitle: animeRow.title_english || animeRow.title_romaji,
    animeCover: animeRow.cover_image_url ?? null,
    episodeNumber: epNumber,
    totalEpisodes: animeRow.episodes ? Number(animeRow.episodes) : null,
    language: input.language === "dub" ? "dub" : "sub",
    status: "live",
    privacy,
    accessCodeHash: privacy === "private" ? hashAccessCode(rawCode) : null,
    maxParticipants,
    timerSeconds: 0,
    isPlaying: false,
    timerUpdatedAt: now,
    lastHeartbeatAt: now,
    hostPresent: true,
    activeParticipants: [
      {
        key: `user:${user.id}`,
        userId: user.id,
        username: hostUsername,
        displayName: hostDisplayName,
        avatarUrl: hostAvatarUrl,
        isPublicProfile: hostIsPublic,
        role: "host",
        lastSeenAt: now,
      },
    ],
  };

  const { data: inserted, error: insertError } = await supabase
    .from("anime_comments")
    .insert({
      user_id: user.id,
      anime_id: "watch_room",
      parent_comment_id: null,
      body: JSON.stringify(payload),
      is_spoiler: false,
      is_hidden: false,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return {
      success: false,
      error: insertError?.message || "Failed to create Watch Together room.",
    };
  }

  revalidatePath("/watch-together");
  return { success: true, roomId: inserted.id };
}

export async function verifyWatchRoomAccessAction(input: {
  roomId: string;
  accessCode?: string;
}): Promise<{
  authorized: boolean;
  error?: string;
  participantCount?: number;
  maxParticipants?: number;
  lifecycleState?: WatchRoomLifecycleState;
}> {
  const cleanRoomId = (input.roomId ?? "").trim();
  if (!cleanRoomId || cleanRoomId.startsWith("showcase-")) {
    return {
      authorized: false,
      error: "This Watch Together room no longer exists.",
    };
  }

  const supabase = await createClient();
  return withWatchRoomJoinLock(cleanRoomId, async () => {
    const [{ data: roomRow, error }, { data: childRows }, { data: authData }] =
      await Promise.all([
        supabase
          .from("anime_comments")
          .select("id, user_id, body, is_hidden, created_at, updated_at")
          .eq("id", cleanRoomId)
          .eq("anime_id", "watch_room")
          .is("parent_comment_id", null)
          .maybeSingle(),
        supabase
          .from("anime_comments")
          .select("id, user_id, body, is_hidden, created_at, updated_at")
          .eq("anime_id", "watch_room")
          .eq("parent_comment_id", cleanRoomId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.auth.getUser(),
      ]);

    if (error || !roomRow || roomRow.is_hidden) {
      return {
        authorized: false,
        error: "This Watch Together room no longer exists.",
      };
    }

    const payload = parseWatchRoomPayloadSync(roomRow.body);
    if (!payload) {
      return { authorized: false, error: "Invalid room configuration." };
    }

    if (payload.status === "ended") {
      return {
        authorized: false,
        error: "This Watch Together session has already ended.",
        lifecycleState: "ended",
      };
    }

    const currentUserId = authData.user?.id ?? null;

    // Enforce bidirectional block check between viewer and room host
    if (currentUserId && currentUserId !== roomRow.user_id) {
      const blockedSet = await resolveBidirectionalBlockedSet(
        supabase,
        currentUserId,
        [roomRow.user_id]
      );
      if (blockedSet.has(roomRow.user_id)) {
        return {
          authorized: false,
          error: "This Watch Together room is unavailable.",
        };
      }
    }

    // Parse child presence records and chat timestamps to evaluate room lifecycle and capacity
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
          updatedAt:
            (child as { updated_at?: string | null }).updated_at ?? null,
          record: rec,
        });
      } else if (!child.is_hidden) {
        const chatMs = Date.parse(child.created_at);
        if (Number.isFinite(chatMs) && chatMs > latestChatAtMs) {
          latestChatAtMs = chatMs;
        }
      }
    }

    const hostFallbackProfile: WatchRoomHostProfile = {
      id: roomRow.user_id,
      username: `user_${roomRow.user_id.slice(0, 6)}`,
      displayName: `user_${roomRow.user_id.slice(0, 6)}`,
      avatarUrl: null,
      isPublicProfile: false,
    };

    const nowMs = Date.now();
    const updatedAt =
      (roomRow as { updated_at?: string | null }).updated_at ?? null;

    const { participantCount, activeUserIds, latestPresenceAtMs } =
      computeActiveRoomParticipants({
        hostId: roomRow.user_id,
        hostProfile: hostFallbackProfile,
        payload,
        roomCreatedAt: roomRow.created_at,
        roomUpdatedAt: updatedAt,
        presenceChildRows,
        nowMs,
      });

    const lifecycle = classifyWatchRoomLifecycle({
      payload,
      isHidden: Boolean(roomRow.is_hidden),
      roomCreatedAt: roomRow.created_at,
      roomUpdatedAt: updatedAt,
      latestPresenceAtMs,
      latestChatAtMs,
      participantCount,
      nowMs,
    });

    if (lifecycle.lifecycleState === "stale") {
      return {
        authorized: false,
        error: "This Watch Together room has expired due to inactivity.",
        lifecycleState: "stale",
      };
    }

    const isHost = Boolean(currentUserId && currentUserId === roomRow.user_id);

    // Verify private room invite code (or an accepted, unexpired host invitation) before checking capacity
    if (!isHost && payload.privacy === "private" && payload.accessCodeHash) {
      const provided = (input.accessCode ?? "").trim();
      let authorizedByAcceptedInvite = false;

      if (!provided && currentUserId) {
        try {
          const [{ data: inviteRow }, { data: friendshipRow }] =
            await Promise.all([
              supabase
                .from("watch_room_invitations")
                .select("id, status, expires_at")
                .eq("room_id", cleanRoomId)
                .eq("host_id", roomRow.user_id)
                .eq("invitee_id", currentUserId)
                .eq("status", "accepted")
                .maybeSingle(),
              supabase
                .from("friendships")
                .select("id, status")
                .or(
                  `and(requester_id.eq.${roomRow.user_id},addressee_id.eq.${currentUserId}),and(requester_id.eq.${currentUserId},addressee_id.eq.${roomRow.user_id})`
                )
                .eq("status", "accepted")
                .maybeSingle(),
            ]);

          if (
            inviteRow?.status === "accepted" &&
            Date.parse(inviteRow.expires_at) > nowMs &&
            friendshipRow?.status === "accepted"
          ) {
            authorizedByAcceptedInvite = true;
          }
        } catch {
          authorizedByAcceptedInvite = false;
        }
      }

      if (!authorizedByAcceptedInvite) {
        if (!provided) {
          return {
            authorized: false,
            error: "This room is private. Please enter the room invite code.",
          };
        }
        if (hashAccessCode(provided) !== payload.accessCodeHash) {
          return {
            authorized: false,
            error: "Incorrect room invite code. Access denied.",
          };
        }
      }
    }

    // Enforce room capacity on the server (allow re-entry if caller is host or already an active participant)
    const isAlreadyActiveParticipant = Boolean(
      currentUserId && activeUserIds.has(currentUserId)
    );
    if (
      !isHost &&
      !isAlreadyActiveParticipant &&
      participantCount >= payload.maxParticipants
    ) {
      return {
        authorized: false,
        error: `This Watch Together room is full (${payload.maxParticipants}/${payload.maxParticipants} participants).`,
        participantCount,
        maxParticipants: payload.maxParticipants,
        lifecycleState: "full",
      };
    }

    // Record active participant presence for authenticated users and re-verify deterministic slot ownership
    if (currentUserId) {
      const allowed = await checkUserAllowed(supabase, currentUserId);
      if (allowed) {
        const nowIso = new Date(nowMs).toISOString();
        await upsertUserRoomPresenceRow({
          supabase,
          roomId: cleanRoomId,
          userId: currentUserId,
          status: "active",
          nowIso,
        });

        // Post-write deterministic slot check to prevent cross-instance final-slot overbooking
        if (!isHost && !isAlreadyActiveParticipant) {
          const { data: postWriteRows } = await supabase
            .from("anime_comments")
            .select("id, user_id, body, is_hidden, created_at, updated_at")
            .eq("anime_id", "watch_room")
            .eq("parent_comment_id", cleanRoomId)
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
                updatedAt:
                  (child as { updated_at?: string | null }).updated_at ?? null,
                record: rec,
              });
            }
          }

          const postWriteCheck = computeActiveRoomParticipants({
            hostId: roomRow.user_id,
            hostProfile: hostFallbackProfile,
            payload,
            roomCreatedAt: roomRow.created_at,
            roomUpdatedAt: updatedAt,
            presenceChildRows: postWritePresence,
            nowMs: Date.now(),
          });

          if (!postWriteCheck.activeUserIds.has(currentUserId)) {
            await upsertUserRoomPresenceRow({
              supabase,
              roomId: cleanRoomId,
              userId: currentUserId,
              status: "left",
              nowIso: new Date().toISOString(),
            });
            return {
              authorized: false,
              error: `This Watch Together room is full (${payload.maxParticipants}/${payload.maxParticipants} participants).`,
              participantCount: payload.maxParticipants,
              maxParticipants: payload.maxParticipants,
              lifecycleState: "full",
            };
          }

          return {
            authorized: true,
            participantCount: postWriteCheck.participantCount,
            maxParticipants: payload.maxParticipants,
            lifecycleState:
              postWriteCheck.participantCount >= payload.maxParticipants
                ? "full"
                : "active",
          };
        }
      }
    }

    const updatedCount =
      currentUserId && !isAlreadyActiveParticipant && !isHost
        ? Math.min(participantCount + 1, payload.maxParticipants)
        : participantCount;

    return {
      authorized: true,
      participantCount: updatedCount,
      maxParticipants: payload.maxParticipants,
      lifecycleState:
        updatedCount >= payload.maxParticipants ? "full" : "active",
    };
  });
}

export async function heartbeatWatchRoomAction(input: {
  roomId: string;
  activeParticipants?: WatchRoomParticipantSnapshot[];
}): Promise<{ success: boolean; error?: string }> {
  const cleanRoomId = (input.roomId ?? "").trim();
  if (!cleanRoomId || cleanRoomId.startsWith("showcase-")) {
    return { success: false, error: "Invalid room ID." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Unauthenticated." };
  }

  const nowIso = new Date().toISOString();

  // Always refresh the caller's own presence row
  await upsertUserRoomPresenceRow({
    supabase,
    roomId: cleanRoomId,
    userId: user.id,
    status: "active",
    nowIso,
  });

  // If the caller is the room host, also update the room payload's heartbeat and Realtime participant snapshot
  const { data: roomRow } = await supabase
    .from("anime_comments")
    .select("id, user_id, body, is_hidden")
    .eq("id", cleanRoomId)
    .eq("anime_id", "watch_room")
    .is("parent_comment_id", null)
    .maybeSingle();

  if (!roomRow || roomRow.is_hidden || roomRow.user_id !== user.id) {
    return { success: true };
  }

  const existing = parseWatchRoomPayloadSync(roomRow.body);
  if (!existing || existing.status === "ended") {
    return { success: true };
  }

  const blockedSet = await resolveBidirectionalBlockedSet(supabase, user.id);
  const nextActiveParticipants = pruneWatchRoomActiveParticipantsSnapshot({
    existing: existing.activeParticipants,
    liveRealtimeParticipants: Array.isArray(input.activeParticipants)
      ? input.activeParticipants
      : undefined,
    hostId: user.id,
    maxParticipants: existing.maxParticipants,
    blockedSet,
    nowIso,
  });

  const updatedPayload: WatchRoomPayload = {
    ...existing,
    lastHeartbeatAt: nowIso,
    hostPresent: true,
    activeParticipants: nextActiveParticipants,
  };

  await supabase
    .from("anime_comments")
    .update({
      body: JSON.stringify(updatedPayload),
      updated_at: nowIso,
    })
    .eq("id", cleanRoomId)
    .eq("user_id", user.id);

  return { success: true };
}

export async function leaveWatchRoomAction(input: {
  roomId: string;
}): Promise<{ success: boolean }> {
  const cleanRoomId = (input.roomId ?? "").trim();
  if (!cleanRoomId || cleanRoomId.startsWith("showcase-")) {
    return { success: true };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: true };
  }

  const nowIso = new Date().toISOString();
  await upsertUserRoomPresenceRow({
    supabase,
    roomId: cleanRoomId,
    userId: user.id,
    status: "left",
    nowIso,
  });

  // If the caller is the room host, mark hostPresent: false and purge guest snapshots
  const { data: roomRow } = await supabase
    .from("anime_comments")
    .select("id, user_id, body, is_hidden")
    .eq("id", cleanRoomId)
    .eq("anime_id", "watch_room")
    .is("parent_comment_id", null)
    .maybeSingle();

  if (roomRow && !roomRow.is_hidden && roomRow.user_id === user.id) {
    const existing = parseWatchRoomPayloadSync(roomRow.body);
    if (existing && existing.status !== "ended") {
      const updatedPayload: WatchRoomPayload = {
        ...existing,
        hostPresent: false,
        activeParticipants: pruneWatchRoomActiveParticipantsSnapshot({
          existing: existing.activeParticipants,
          hostId: user.id,
          maxParticipants: existing.maxParticipants,
          nowIso,
          hostLeaving: true,
        }),
      };
      await supabase
        .from("anime_comments")
        .update({
          body: JSON.stringify(updatedPayload),
          updated_at: nowIso,
        })
        .eq("id", cleanRoomId)
        .eq("user_id", user.id);
    }
  }

  revalidatePath("/watch-together");
  return { success: true };
}

export async function updateWatchRoomStateAction(input: {
  roomId: string;
  episodeNumber?: number;
  language?: "sub" | "dub";
  status?: WatchRoomStatus;
  timerSeconds?: number;
  isPlaying?: boolean;
}): Promise<WatchRoomActionResult> {
  const cleanRoomId = (input.roomId ?? "").trim();
  if (!cleanRoomId || cleanRoomId.startsWith("showcase-")) {
    return {
      success: false,
      error: "Room not found.",
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
      error: "You must be signed in to manage a Watch Together room.",
    };
  }

  const { data: roomRow, error: fetchError } = await supabase
    .from("anime_comments")
    .select("id, user_id, body")
    .eq("id", cleanRoomId)
    .eq("anime_id", "watch_room")
    .is("parent_comment_id", null)
    .maybeSingle();

  if (fetchError || !roomRow) {
    return { success: false, error: "Room not found." };
  }

  // Server-side host permission enforcement
  if (roomRow.user_id !== user.id) {
    return {
      success: false,
      error:
        "Permission denied: Only the room host can update playback state or room settings.",
    };
  }

  const existing = parseWatchRoomPayloadSync(roomRow.body);
  if (!existing) {
    return { success: false, error: "Corrupted room state." };
  }

  const nowIso = new Date().toISOString();
  const nextStatus = input.status ?? existing.status;
  const maxEp = existing.totalEpisodes || 2000;

  const updated: WatchRoomPayload = {
    ...existing,
    episodeNumber:
      typeof input.episodeNumber === "number"
        ? Math.min(Math.max(input.episodeNumber, 1), maxEp)
        : existing.episodeNumber,
    language: input.language
      ? input.language === "dub"
        ? "dub"
        : "sub"
      : existing.language,
    status: nextStatus,
    timerSeconds:
      typeof input.timerSeconds === "number"
        ? Math.max(Math.floor(input.timerSeconds), 0)
        : existing.timerSeconds,
    isPlaying:
      nextStatus === "ended"
        ? false
        : typeof input.isPlaying === "boolean"
          ? input.isPlaying
          : existing.isPlaying,
    timerUpdatedAt: nowIso,
    lastHeartbeatAt: nowIso,
    hostPresent: nextStatus !== "ended",
    activeParticipants:
      nextStatus === "ended"
        ? []
        : pruneWatchRoomActiveParticipantsSnapshot({
            existing: existing.activeParticipants,
            hostId: user.id,
            maxParticipants: existing.maxParticipants,
            nowIso,
          }),
  };

  const { error: updateError } = await supabase
    .from("anime_comments")
    .update({
      body: JSON.stringify(updated),
      is_hidden: updated.status === "ended",
      updated_at: nowIso,
    })
    .eq("id", cleanRoomId)
    .eq("user_id", user.id);

  if (updateError) {
    return {
      success: false,
      error: updateError.message || "Failed to update room state.",
    };
  }

  if (updated.status === "ended") {
    await upsertUserRoomPresenceRow({
      supabase,
      roomId: cleanRoomId,
      userId: user.id,
      status: "left",
      nowIso,
    });

    try {
      await supabase
        .from("watch_room_invitations")
        .update({
          status: "expired",
          responded_at: nowIso,
          updated_at: nowIso,
        })
        .eq("room_id", cleanRoomId)
        .eq("host_id", user.id)
        .eq("status", "pending");
    } catch {
      /* non-fatal */
    }
  }

  revalidatePath("/watch-together");
  return { success: true, roomId: cleanRoomId };
}

export async function sendWatchRoomChatAction(input: {
  roomId: string;
  message: string;
  accessCode?: string;
}): Promise<{
  success: boolean;
  error?: string;
  chatMessage?: {
    id: string;
    body: string;
    createdAt: string;
    author: { username: string; avatarUrl: string | null };
  };
}> {
  const cleanRoomId = (input.roomId ?? "").trim();
  const cleanMessage = (input.message ?? "").trim();

  if (!cleanMessage) {
    return { success: false, error: "Chat message cannot be empty." };
  }
  if (cleanMessage.length > 500) {
    return {
      success: false,
      error: "Chat message cannot exceed 500 characters.",
    };
  }
  if (!cleanRoomId || cleanRoomId.startsWith("showcase-")) {
    return {
      success: false,
      error: "This Watch Together room does not support chat.",
    };
  }
  // Prevent forging structured presence records via chat input
  if (parseWatchRoomPresenceRecord(cleanMessage) !== null) {
    return {
      success: false,
      error: "Invalid chat message format.",
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
      error: "You must be signed in to send messages in room chat.",
    };
  }

  const allowed = await checkUserAllowed(supabase, user.id);
  if (!allowed) {
    return {
      success: false,
      error: "Your account is currently restricted from sending chat messages.",
    };
  }

  // Server-side room access validation before allowing chat post
  const access = await verifyWatchRoomAccessAction({
    roomId: cleanRoomId,
    accessCode: input.accessCode,
  });
  if (!access.authorized) {
    return {
      success: false,
      error: access.error || "You do not have permission to chat in this room.",
    };
  }

  const fallbackUsername =
    (user.user_metadata?.username as string | undefined) ||
    user.email?.split("@")[0] ||
    `user_${user.id.slice(0, 6)}`;

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("username, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("anime_comments")
    .insert({
      user_id: user.id,
      anime_id: "watch_room",
      parent_comment_id: cleanRoomId,
      body: cleanMessage,
      is_spoiler: false,
      is_hidden: false,
      created_at: now,
      updated_at: now,
    })
    .select("id, created_at")
    .single();

  if (insertError || !inserted) {
    return {
      success: false,
      error: insertError?.message || "Failed to send chat message.",
    };
  }

  revalidatePath("/watch-together");
  return {
    success: true,
    chatMessage: {
      id: inserted.id,
      body: cleanMessage,
      createdAt: inserted.created_at,
      author: {
        username: profileRow?.username || fallbackUsername,
        avatarUrl: profileRow?.avatar_url ?? null,
      },
    },
  };
}

export async function getWatchTogetherLobbyDataAction(): Promise<{
  success: boolean;
  error?: string;
  rooms: WatchRoomResolvedDTO[];
}> {
  try {
    const supabase = await createClient();
    const { lobbyRooms } = await fetchSharedWatchTogetherRooms(supabase);
    return {
      success: true,
      rooms: lobbyRooms,
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to load Watch Together rooms.",
      rooms: [],
    };
  }
}
