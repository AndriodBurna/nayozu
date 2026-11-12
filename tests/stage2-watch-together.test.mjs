import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  PARTICIPANT_ACTIVE_TTL_MS,
  STALE_ROOM_TTL_MS,
  MAX_ROOM_IDLE_WITHOUT_HOST_MS,
  parseWatchRoomPayloadSync,
  parseWatchRoomPresenceRecord,
  serializeWatchRoomPresenceRecord,
  resolveWatchRoomMediaMetadata,
  computeActiveRoomParticipants,
  deduplicateRealtimeParticipants,
  classifyWatchRoomLifecycle,
  pruneWatchRoomActiveParticipantsSnapshot,
  withWatchRoomJoinLock,
  fetchSharedWatchTogetherRooms,
} from "../lib/watch-together/roomService.ts";

const ROOT = process.cwd();

function readProjectFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function makeRoomPayloadJson(overrides = {}) {
  return JSON.stringify({
    version: 1,
    roomTitle: "Frieren Finale Marathon",
    description: null,
    animeExternalId: "52991",
    animeSlug: "sousou-no-frieren",
    animeTitle: "Sousou no Frieren",
    animeCover: "https://cdn.nayozu.local/frieren.jpg",
    episodeNumber: 28,
    totalEpisodes: 28,
    language: "sub",
    status: "live",
    privacy: "public",
    accessCodeHash: null,
    maxParticipants: 8,
    timerSeconds: 0,
    isPlaying: true,
    timerUpdatedAt: "2026-11-12T12:00:00.000Z",
    lastHeartbeatAt: "2026-11-12T12:00:00.000Z",
    hostPresent: true,
    ...overrides,
  });
}

/**
 * Helper to build a deterministic mock Supabase client for testing
 * fetchSharedWatchTogetherRooms end-to-end.
 */
function createMockSupabase({
  roomRows = [],
  animeRows = [],
  profileRows = [],
  rpcBlockRows = [],
  userBlocksRows = [],
  currentUserId = null,
} = {}) {
  const hiddenUpdates = [];

  const client = {
    hiddenUpdates,
    auth: {
      getUser: async () => ({
        data: { user: currentUserId ? { id: currentUserId } : null },
        error: null,
      }),
    },
    rpc: async (fnName) => {
      if (fnName === "get_bidirectional_blocked_user_ids") {
        return { data: rpcBlockRows, error: null };
      }
      if (fnName === "is_blocked_between") {
        return { data: false, error: null };
      }
      return { data: null, error: new Error(`Unexpected RPC: ${fnName}`) };
    },
    from: (table) => {
      if (table === "user_blocks") {
        return {
          select: () => ({
            or: async () => ({ data: userBlocksRows, error: null }),
          }),
        };
      }

      if (table === "anime") {
        return {
          select: () => ({
            in: async (_col, externalIds) => ({
              data: animeRows.filter((a) =>
                externalIds.map(String).includes(String(a.external_id))
              ),
              error: null,
            }),
          }),
        };
      }

      if (table === "profiles") {
        return {
          select: () => ({
            in: async (_col, ids) => ({
              data: profileRows.filter((p) => ids.includes(p.id)),
              error: null,
            }),
          }),
        };
      }

      if (table === "anime_comments") {
        const state = {
          mode: "select",
          filters: {},
          isNullCol: null,
          inFilter: null,
          updatePayload: null,
        };

        const builder = {
          select: () => builder,
          update: (payload) => {
            state.mode = "update";
            state.updatePayload = payload;
            return builder;
          },
          is: (col, val) => {
            if (val === null) state.isNullCol = col;
            return builder;
          },
          eq: (col, val) => {
            state.filters[col] = val;
            if (state.mode === "update" && col === "anime_id") {
              hiddenUpdates.push({
                ids: state.inFilter?.vals ?? [],
                userId: state.filters.user_id,
                payload: state.updatePayload,
              });
              return Promise.resolve({ data: null, error: null });
            }
            return builder;
          },
          in: (col, vals) => {
            state.inFilter = { col, vals };
            return builder;
          },
          order: () => builder,
          limit: async () => {
            let filtered = roomRows.filter(
              (r) => r.anime_id === "watch_room" && r.is_hidden === false
            );
            if (state.isNullCol === "parent_comment_id") {
              filtered = filtered.filter((r) => !r.parent_comment_id);
            }
            if (state.inFilter?.col === "parent_comment_id") {
              filtered = filtered.filter((r) =>
                state.inFilter.vals.includes(r.parent_comment_id)
              );
            }
            return { data: filtered, error: null };
          },
        };

        return builder;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return client;
}

test("1. Correct room title and artwork resolution (canonical DB hydration + honest fallback, no fake artwork or placeholder titles)", () => {
  const payload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      roomTitle: "Frieren Finale Marathon",
      animeExternalId: "52991",
      animeTitle: "Stale Snapshot Title",
      animeCover: "https://example.com/stale-cover.jpg",
      episodeNumber: 28,
    })
  );

  assert.ok(payload);

  // Resolves canonical title, cover, slug, and total episodes from anime row
  const resolvedWithCanonical = resolveWatchRoomMediaMetadata(payload, {
    external_id: 52991,
    slug: "sousou-no-frieren",
    title_romaji: "Sousou no Frieren",
    title_english: "Frieren: Beyond Journey's End",
    cover_image_url: "https://cdn.nayozu.local/frieren-canonical.jpg",
    banner_image_url: null,
    episodes: 28,
    status: "FINISHED",
    media_type: "anime",
  });

  assert.ok(resolvedWithCanonical);
  assert.equal(
    resolvedWithCanonical.animeTitle,
    "Frieren: Beyond Journey's End"
  );
  assert.equal(
    resolvedWithCanonical.animeCover,
    "https://cdn.nayozu.local/frieren-canonical.jpg"
  );
  assert.equal(resolvedWithCanonical.animeSlug, "sousou-no-frieren");
  assert.equal(resolvedWithCanonical.totalEpisodes, 28);
  assert.equal(resolvedWithCanonical.episodeNumber, 28);

  // When artwork cannot be resolved and snapshot has no cover URL, returns null (honest fallback, never unrelated anime cover)
  const payloadNoCover = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      roomTitle: "Late Night Watch",
      animeExternalId: "99999",
      animeTitle: "Unknown Indie Short",
      animeCover: null,
      episodeNumber: 1,
    })
  );
  const resolvedWithoutCover = resolveWatchRoomMediaMetadata(
    payloadNoCover,
    null
  );
  assert.ok(resolvedWithoutCover);
  assert.equal(resolvedWithoutCover.animeCover, null);
  assert.equal(resolvedWithoutCover.animeTitle, "Unknown Indie Short");

  // Generic placeholder anime titles ("untitled", "placeholder", "unknown anime") are rejected when DB row is absent
  const placeholderAnimePayload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      roomTitle: "Some Room",
      animeExternalId: "99999",
      animeTitle: "Untitled",
      animeCover: null,
    })
  );
  const rejectedPlaceholder = resolveWatchRoomMediaMetadata(
    placeholderAnimePayload,
    null
  );
  assert.equal(rejectedPlaceholder, null);

  // Verify buildShowcaseRooms (fabricated rooms hosted by Kaito, LunaRin, Mochi) was completely removed
  const pageSrc = readProjectFile("app/watch-together/page.tsx");
  assert.ok(!pageSrc.includes("buildShowcaseRooms"));
  assert.ok(!pageSrc.includes("LunaRin"));
});

test("2. Active participant counting (counts host + active presence records, never counts chat messages)", async () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const recentIso = new Date(nowMs - 30_000).toISOString();

  // Mix of 3 plain-text chat messages and 2 active participant presence records in anime_comments
  const mockSupabase = createMockSupabase({
    roomRows: [
      {
        id: "room-1",
        user_id: "host-1",
        anime_id: "watch_room",
        parent_comment_id: null,
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: makeRoomPayloadJson({
          roomTitle: "Test Room",
          animeExternalId: "52991",
          lastHeartbeatAt: recentIso,
          timerUpdatedAt: recentIso,
        }),
      },
      // 3 plain-text chat messages from different users
      {
        id: "chat-1",
        user_id: "chat-only-1",
        anime_id: "watch_room",
        parent_comment_id: "room-1",
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: "This opening theme never misses!",
      },
      {
        id: "chat-2",
        user_id: "chat-only-2",
        anime_id: "watch_room",
        parent_comment_id: "room-1",
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: "Agreed, peak animation.",
      },
      {
        id: "chat-3",
        user_id: "chat-only-3",
        anime_id: "watch_room",
        parent_comment_id: "room-1",
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: "Wait for the next scene!",
      },
      // 2 structured active presence records
      {
        id: "presence-viewer-1",
        user_id: "viewer-1",
        anime_id: "watch_room",
        parent_comment_id: "room-1",
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: serializeWatchRoomPresenceRecord({
          status: "active",
          sessionKey: "user:viewer-1",
          lastSeenAt: recentIso,
        }),
      },
      {
        id: "presence-viewer-2",
        user_id: "viewer-2",
        anime_id: "watch_room",
        parent_comment_id: "room-1",
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: serializeWatchRoomPresenceRecord({
          status: "active",
          sessionKey: "user:viewer-2",
          lastSeenAt: recentIso,
        }),
      },
    ],
    animeRows: [
      {
        external_id: 52991,
        slug: "sousou-no-frieren",
        title_romaji: "Sousou no Frieren",
        title_english: "Frieren: Beyond Journey's End",
        cover_image_url: "https://cdn.nayozu.local/frieren.jpg",
        banner_image_url: null,
        episodes: 28,
        status: "FINISHED",
        media_type: "anime",
      },
    ],
    profileRows: [
      {
        id: "host-1",
        username: "host_user",
        display_name: "Host User",
        avatar_url: null,
        profile_visibility: "public",
      },
      {
        id: "viewer-1",
        username: "akira",
        display_name: "Akira",
        avatar_url: null,
        profile_visibility: "public",
      },
      {
        id: "viewer-2",
        username: "ren",
        display_name: "Ren",
        avatar_url: null,
        profile_visibility: "private",
      },
    ],
  });

  const shared = await fetchSharedWatchTogetherRooms(mockSupabase, {
    currentUserId: null,
    nowMs,
  });

  assert.equal(shared.lobbyRooms.length, 1);
  const room = shared.lobbyRooms[0];

  // Must count strictly host (1) + viewer-1 (1) + viewer-2 (1) = 3, NOT 3 + 3 chat messages
  assert.equal(room.participantCount, 3);
  assert.equal(room.participants.length, 3);
  assert.equal(room.participants[0].role, "host");
  assert.equal(room.participants[0].userId, "host-1");

  // Chat messages are separated cleanly from presence rows
  assert.equal(room.chatMessages.length, 3);

  // Private profile visibility is respected on participants
  const viewer2 = room.participants.find((p) => p.userId === "viewer-2");
  assert.ok(viewer2);
  assert.equal(viewer2.isPublicProfile, false);
});

test("3. Duplicate participant prevention across multiple sessions, heartbeats, and Realtime state", () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const t1 = new Date(nowMs - 40_000).toISOString();
  const t2 = new Date(nowMs - 10_000).toISOString();

  // Same user has multiple presence rows AND appears in payload.activeParticipants
  const presenceChildRows = [
    {
      userId: "viewer-dup",
      isHidden: false,
      createdAt: t1,
      updatedAt: t1,
      record: parseWatchRoomPresenceRecord(
        serializeWatchRoomPresenceRecord({
          status: "active",
          sessionKey: "user:viewer-dup",
          lastSeenAt: t1,
        })
      ),
      profile: {
        id: "viewer-dup",
        username: "dup_user",
        displayName: "Dup User",
        avatarUrl: null,
        isPublicProfile: true,
      },
    },
    {
      userId: "viewer-dup",
      isHidden: false,
      createdAt: t2,
      updatedAt: t2,
      record: parseWatchRoomPresenceRecord(
        serializeWatchRoomPresenceRecord({
          status: "active",
          sessionKey: "user:viewer-dup",
          lastSeenAt: t2,
        })
      ),
      profile: {
        id: "viewer-dup",
        username: "dup_user",
        displayName: "Dup User",
        avatarUrl: null,
        isPublicProfile: true,
      },
    },
  ];

  const payload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      lastHeartbeatAt: t2,
      activeParticipants: [
        {
          key: "user:host-1",
          userId: "host-1",
          username: "host_user",
          displayName: "Host User",
          avatarUrl: null,
          isPublicProfile: true,
          role: "host",
          lastSeenAt: t2,
        },
        {
          key: "user:viewer-dup",
          userId: "viewer-dup",
          username: "dup_user",
          displayName: "Dup User Synced",
          avatarUrl: null,
          isPublicProfile: true,
          role: "viewer",
          lastSeenAt: t2,
        },
      ],
    })
  );

  const computed = computeActiveRoomParticipants({
    hostId: "host-1",
    hostProfile: {
      id: "host-1",
      username: "host_user",
      displayName: "Host User",
      avatarUrl: null,
      isPublicProfile: true,
    },
    payload,
    roomCreatedAt: t1,
    roomUpdatedAt: t2,
    presenceChildRows,
    blockedSet: new Set(),
    nowMs,
  });

  assert.equal(computed.participantCount, 2);

  // Also test deduplicateRealtimeParticipants for client-side Realtime channel state
  const dedupedRealtime = deduplicateRealtimeParticipants(
    {
      "tab-1": [
        {
          userId: "viewer-dup",
          username: "dup_user",
          displayName: "Dup User",
          isPublicProfile: true,
          role: "viewer",
          joinedAt: t1,
        },
      ],
      "tab-2": [
        {
          userId: "viewer-dup",
          username: "dup_user",
          displayName: "Dup User",
          isPublicProfile: true,
          role: "viewer",
          joinedAt: t2,
        },
      ],
      "guest-key": [
        {
          userId: "guest_abc",
          username: "Guest_abc",
          displayName: "Guest Viewer",
          isPublicProfile: false,
          role: "guest",
          joinedAt: t1,
        },
        {
          userId: "guest_abc",
          username: "Guest_abc",
          displayName: "Guest Viewer Reconnect",
          isPublicProfile: false,
          role: "guest",
          joinedAt: t2,
        },
      ],
    },
    { hostId: "host-1", maxParticipants: 8 }
  );

  assert.equal(dedupedRealtime.length, 2);
});

test("4. Participant removal after leaving or presence heartbeat expiry", () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const activeIso = new Date(nowMs - 20_000).toISOString();
  const expiredIso = new Date(
    nowMs - PARTICIPANT_ACTIVE_TTL_MS - 60_000
  ).toISOString();

  const presenceChildRows = [
    // Viewer A joined then explicitly left
    {
      userId: "viewer-left",
      isHidden: false,
      createdAt: activeIso,
      updatedAt: activeIso,
      record: parseWatchRoomPresenceRecord(
        serializeWatchRoomPresenceRecord({
          status: "left",
          sessionKey: "user:viewer-left",
          lastSeenAt: activeIso,
        })
      ),
    },
    // Viewer B disconnected without explicit leave and TTL expired
    {
      userId: "viewer-expired",
      isHidden: false,
      createdAt: expiredIso,
      updatedAt: expiredIso,
      record: parseWatchRoomPresenceRecord(
        serializeWatchRoomPresenceRecord({
          status: "active",
          sessionKey: "user:viewer-expired",
          lastSeenAt: expiredIso,
        })
      ),
    },
    // Viewer C is currently active
    {
      userId: "viewer-active",
      isHidden: false,
      createdAt: activeIso,
      updatedAt: activeIso,
      record: parseWatchRoomPresenceRecord(
        serializeWatchRoomPresenceRecord({
          status: "active",
          sessionKey: "user:viewer-active",
          lastSeenAt: activeIso,
        })
      ),
    },
  ];

  const payload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      lastHeartbeatAt: activeIso,
      // Even if payload snapshot still had viewer-left before host's next sync, explicit "left" row removes them
      activeParticipants: [
        {
          key: "user:viewer-left",
          userId: "viewer-left",
          username: "left_user",
          displayName: "Left User",
          avatarUrl: null,
          isPublicProfile: true,
          role: "viewer",
          lastSeenAt: activeIso,
        },
      ],
    })
  );

  const computed = computeActiveRoomParticipants({
    hostId: "host-1",
    hostProfile: {
      id: "host-1",
      username: "host_user",
      displayName: "Host User",
      avatarUrl: null,
      isPublicProfile: true,
    },
    payload,
    roomCreatedAt: activeIso,
    roomUpdatedAt: activeIso,
    presenceChildRows,
    blockedSet: new Set(),
    nowMs,
  });

  // Only host-1 and viewer-active remain
  assert.equal(computed.participantCount, 2);
  assert.deepEqual(
    computed.participants.map((p) => p.userId),
    ["host-1", "viewer-active"]
  );
});

test("5. Full room classification and joining rejection", () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const recentIso = new Date(nowMs - 15_000).toISOString();

  const payload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      maxParticipants: 4,
      lastHeartbeatAt: recentIso,
      timerUpdatedAt: recentIso,
    })
  );

  const lifecycle = classifyWatchRoomLifecycle({
    payload,
    isHidden: false,
    roomCreatedAt: recentIso,
    roomUpdatedAt: recentIso,
    latestPresenceAtMs: nowMs - 15_000,
    latestChatAtMs: 0,
    participantCount: 4,
    nowMs,
  });

  assert.equal(lifecycle.lifecycleState, "full");
  assert.equal(lifecycle.isFull, true);
  assert.equal(lifecycle.isJoinable, false);

  // Verify server-side join guard in app/watch-together/actions.ts rejects full rooms for non-participants
  const actionsSrc = readProjectFile("app/watch-together/actions.ts");
  assert.ok(actionsSrc.includes("participantCount >= payload.maxParticipants"));
  assert.ok(actionsSrc.includes("This Watch Together room is full"));

  // Verify count never exceeds maxParticipants
  const clampedPayload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      maxParticipants: 2,
      lastHeartbeatAt: recentIso,
      activeParticipants: [
        {
          key: "guest:1",
          userId: null,
          username: "g1",
          displayName: "G1",
          avatarUrl: null,
          isPublicProfile: false,
          role: "guest",
          lastSeenAt: recentIso,
        },
        {
          key: "guest:2",
          userId: null,
          username: "g2",
          displayName: "G2",
          avatarUrl: null,
          isPublicProfile: false,
          role: "guest",
          lastSeenAt: recentIso,
        },
      ],
    })
  );

  const clamped = computeActiveRoomParticipants({
    hostId: "host-1",
    hostProfile: {
      id: "host-1",
      username: "host_user",
      displayName: "Host User",
      avatarUrl: null,
      isPublicProfile: true,
    },
    payload: clampedPayload,
    roomCreatedAt: recentIso,
    roomUpdatedAt: recentIso,
    presenceChildRows: [],
    blockedSet: new Set(),
    nowMs,
  });

  assert.equal(clamped.participantCount, 2);
});

test("6. Ended room classification and joining rejection", () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const recentIso = new Date(nowMs - 15_000).toISOString();

  const endedPayload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      status: "ended",
      lastHeartbeatAt: recentIso,
    })
  );

  assert.equal(
    classifyWatchRoomLifecycle({
      payload: endedPayload,
      isHidden: false,
      roomCreatedAt: recentIso,
      roomUpdatedAt: recentIso,
      participantCount: 1,
      nowMs,
    }).lifecycleState,
    "ended"
  );

  const livePayload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      status: "live",
      lastHeartbeatAt: recentIso,
    })
  );

  assert.equal(
    classifyWatchRoomLifecycle({
      payload: livePayload,
      isHidden: true,
      roomCreatedAt: recentIso,
      roomUpdatedAt: recentIso,
      participantCount: 1,
      nowMs,
    }).lifecycleState,
    "ended"
  );

  const actionsSrc = readProjectFile("app/watch-together/actions.ts");
  assert.ok(actionsSrc.includes('if (payload.status === "ended")'));
  assert.ok(
    actionsSrc.includes("This Watch Together session has already ended.")
  );
});

test("7. Stale room filtering and idempotent cleanup", async () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const staleIso = new Date(nowMs - STALE_ROOM_TTL_MS - 60_000).toISOString();
  const hostAbandonedIso = new Date(
    nowMs - MAX_ROOM_IDLE_WITHOUT_HOST_MS - 60_000
  ).toISOString();
  const activeIso = new Date(nowMs - 60_000).toISOString();
  const tenMinAgoIso = new Date(nowMs - 10 * 60_000).toISOString();

  // Room idle beyond STALE_ROOM_TTL_MS (2 hours) is classified as stale
  const stalePayload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      timerUpdatedAt: staleIso,
      lastHeartbeatAt: staleIso,
    })
  );
  assert.equal(
    classifyWatchRoomLifecycle({
      payload: stalePayload,
      isHidden: false,
      roomCreatedAt: staleIso,
      roomUpdatedAt: staleIso,
      participantCount: 0,
      nowMs,
    }).lifecycleState,
    "stale"
  );

  // Room where host has been gone beyond MAX_ROOM_IDLE_WITHOUT_HOST_MS (6 hours) is stale even if recent chat occurred
  const hostGonePayload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      timerUpdatedAt: hostAbandonedIso,
      lastHeartbeatAt: hostAbandonedIso,
    })
  );
  assert.equal(
    classifyWatchRoomLifecycle({
      payload: hostGonePayload,
      isHidden: false,
      roomCreatedAt: hostAbandonedIso,
      roomUpdatedAt: hostAbandonedIso,
      latestChatAtMs: nowMs - 10_000,
      participantCount: 1,
      nowMs,
    }).lifecycleState,
    "stale"
  );

  // Temporary host disconnect (e.g. 10 minutes) does NOT prematurely kill an active room
  const briefDisconnectPayload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      timerUpdatedAt: tenMinAgoIso,
      lastHeartbeatAt: tenMinAgoIso,
    })
  );
  assert.equal(
    classifyWatchRoomLifecycle({
      payload: briefDisconnectPayload,
      isHidden: false,
      roomCreatedAt: tenMinAgoIso,
      roomUpdatedAt: tenMinAgoIso,
      participantCount: 2,
      nowMs,
    }).lifecycleState,
    "active"
  );

  // Verify fetchSharedWatchTogetherRooms excludes stale rooms and idempotently hides own stale rooms
  const mockSupabase = createMockSupabase({
    currentUserId: "user-1",
    roomRows: [
      {
        id: "stale-own-room",
        anime_id: "watch_room",
        user_id: "user-1",
        parent_comment_id: null,
        is_hidden: false,
        created_at: staleIso,
        updated_at: staleIso,
        body: makeRoomPayloadJson({
          roomTitle: "Abandoned Room",
          animeExternalId: "52991",
          timerUpdatedAt: staleIso,
          lastHeartbeatAt: staleIso,
        }),
      },
      {
        id: "active-room",
        anime_id: "watch_room",
        user_id: "user-2",
        parent_comment_id: null,
        is_hidden: false,
        created_at: activeIso,
        updated_at: activeIso,
        body: makeRoomPayloadJson({
          roomTitle: "Fresh Live Room",
          animeExternalId: "52991",
          timerUpdatedAt: activeIso,
          lastHeartbeatAt: activeIso,
        }),
      },
    ],
    animeRows: [
      {
        external_id: 52991,
        slug: "fresh-anime",
        title_romaji: "Fresh Anime",
        title_english: "Fresh Anime",
        cover_image_url: "https://cdn.nayozu.local/fresh.jpg",
        banner_image_url: null,
        episodes: 12,
        status: "FINISHED",
        media_type: "anime",
      },
    ],
    profileRows: [
      {
        id: "user-2",
        username: "active_host",
        display_name: "Active Host",
        avatar_url: null,
        profile_visibility: "public",
      },
    ],
  });

  const shared = await fetchSharedWatchTogetherRooms(mockSupabase, {
    currentUserId: "user-1",
    nowMs,
  });

  assert.equal(shared.lobbyRooms.length, 1);
  assert.equal(shared.lobbyRooms[0].id, "active-room");
  assert.equal(shared.drawerRooms.length, 1);
  assert.equal(shared.drawerRooms[0].id, "active-room");
  assert.equal(mockSupabase.hiddenUpdates.length, 1);
  assert.deepEqual(mockSupabase.hiddenUpdates[0].ids, ["stale-own-room"]);
});

test("8. Host ownership and authorization enforced on server", () => {
  const actionsSrc = readProjectFile("app/watch-together/actions.ts");

  // Server action updateWatchRoomStateAction checks authentication and roomRow.user_id !== user.id
  assert.ok(actionsSrc.includes("export async function updateWatchRoomStateAction"));
  assert.ok(actionsSrc.includes("if (roomRow.user_id !== user.id)"));
  assert.ok(
    actionsSrc.includes(
      "Permission denied: Only the room host can update playback state or room settings."
    )
  );
  // And scopes the UPDATE query with .eq("user_id", user.id)
  assert.ok(actionsSrc.includes('.eq("user_id", user.id)'));

  // Client UI only grants isHost when Boolean(currentUser && currentUser.id === activeRoom.hostId)
  const clientSrc = readProjectFile(
    "app/watch-together/watch-together-client.tsx"
  );
  assert.ok(
    clientSrc.includes(
      "Boolean(currentUser && currentUser.id === activeRoom.hostId)"
    )
  );
});

test("9. Guest browsing and joining vs authenticated-only creation and chat", () => {
  const actionsSrc = readProjectFile("app/watch-together/actions.ts");
  const clientSrc = readProjectFile(
    "app/watch-together/watch-together-client.tsx"
  );
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");

  // verifyWatchRoomAccessAction allows unauthenticated guests to join public active rooms,
  // while requiring a valid invite code for private rooms
  assert.ok(actionsSrc.includes("export async function verifyWatchRoomAccessAction"));
  assert.ok(
    actionsSrc.includes(
      'if (!isHost && payload.privacy === "private" && payload.accessCodeHash)'
    )
  );
  assert.ok(
    actionsSrc.includes("Incorrect room invite code. Access denied.")
  );

  // Guests cannot create rooms or send persistent chat messages on the server
  assert.ok(
    actionsSrc.includes(
      "You must be signed in to create a Watch Together room."
    )
  );
  assert.ok(
    actionsSrc.includes(
      "You must be signed in to send messages in room chat."
    )
  );

  // Users cannot forge presence JSON payloads via chat
  assert.ok(
    actionsSrc.includes("if (parseWatchRoomPresenceRecord(cleanMessage) !== null)")
  );

  // Lobby and Drawer allow guests to click Join on public rooms
  assert.ok(rightPanelSrc.includes("handleJoinWatchRoom(room)"));
  assert.ok(clientSrc.includes("handleSelectRoom(room)"));
});

test("10. Bidirectional block filtering across hosts, participants, and chat messages", async () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const recentIso = new Date(nowMs - 20_000).toISOString();

  const mockSupabase = createMockSupabase({
    currentUserId: "viewer-me",
    rpcBlockRows: [{ excluded_user_id: "blocked-user" }],
    roomRows: [
      // Room hosted by blocked user -> must be excluded completely
      {
        id: "blocked-host-room",
        anime_id: "watch_room",
        user_id: "blocked-user",
        parent_comment_id: null,
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: makeRoomPayloadJson({
          roomTitle: "Blocked Host Room",
          animeExternalId: "52991",
          timerUpdatedAt: recentIso,
          lastHeartbeatAt: recentIso,
        }),
      },
      // Room hosted by unblocked user, containing a blocked participant and blocked chat message
      {
        id: "clean-host-room",
        anime_id: "watch_room",
        user_id: "clean-host",
        parent_comment_id: null,
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: makeRoomPayloadJson({
          roomTitle: "Clean Host Room",
          animeExternalId: "52991",
          timerUpdatedAt: recentIso,
          lastHeartbeatAt: recentIso,
        }),
      },
      {
        id: "blocked-presence",
        parent_comment_id: "clean-host-room",
        anime_id: "watch_room",
        user_id: "blocked-user",
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: serializeWatchRoomPresenceRecord({
          status: "active",
          sessionKey: "user:blocked-user",
          lastSeenAt: recentIso,
        }),
      },
      {
        id: "blocked-chat",
        parent_comment_id: "clean-host-room",
        anime_id: "watch_room",
        user_id: "blocked-user",
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: "Message from blocked user",
      },
      {
        id: "allowed-chat",
        parent_comment_id: "clean-host-room",
        anime_id: "watch_room",
        user_id: "clean-host",
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: "Welcome everyone!",
      },
    ],
    animeRows: [
      {
        external_id: 52991,
        slug: "sousou-no-frieren",
        title_romaji: "Sousou no Frieren",
        title_english: "Frieren: Beyond Journey's End",
        cover_image_url: "https://cdn.nayozu.local/frieren.jpg",
        banner_image_url: null,
        episodes: 28,
        status: "FINISHED",
        media_type: "anime",
      },
    ],
    profileRows: [
      {
        id: "clean-host",
        username: "clean_host",
        display_name: "Clean Host",
        avatar_url: null,
        profile_visibility: "public",
      },
    ],
  });

  const shared = await fetchSharedWatchTogetherRooms(mockSupabase, {
    currentUserId: "viewer-me",
    nowMs,
  });

  // Blocked host's room is excluded from both lobby and drawer
  assert.equal(shared.lobbyRooms.length, 1);
  assert.equal(shared.lobbyRooms[0].id, "clean-host-room");
  assert.equal(shared.drawerRooms.length, 1);
  assert.equal(shared.drawerRooms[0].id, "clean-host-room");

  // Blocked participant and blocked chat message are excluded from the allowed room
  const room = shared.lobbyRooms[0];
  assert.equal(room.participantCount, 1);
  assert.ok(!room.participants.some((p) => p.userId === "blocked-user"));
  assert.equal(room.chatMessages.length, 1);
  assert.equal(room.chatMessages[0].body, "Welcome everyone!");
});

test("11. Drawer and Lobby data consistency via shared roomService", async () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const recentIso = new Date(nowMs - 25_000).toISOString();

  const mockSupabase = createMockSupabase({
    roomRows: [
      // Joinable public room
      {
        id: "room-joinable",
        anime_id: "watch_room",
        user_id: "host-a",
        parent_comment_id: null,
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: makeRoomPayloadJson({
          roomTitle: "Dungeon Meshi Dinner Party",
          animeExternalId: "52701",
          animeTitle: "Dungeon Meshi",
          episodeNumber: 12,
          privacy: "public",
          status: "live",
          maxParticipants: 6,
          language: "sub",
          timerUpdatedAt: recentIso,
          lastHeartbeatAt: recentIso,
        }),
      },
      // Full public room (2/2) -> shown in Lobby as Full, excluded from Drawer joinable preview
      {
        id: "room-full",
        anime_id: "watch_room",
        user_id: "host-b",
        parent_comment_id: null,
        is_hidden: false,
        created_at: recentIso,
        updated_at: recentIso,
        body: makeRoomPayloadJson({
          roomTitle: "Duo Rewatch",
          animeExternalId: "52701",
          animeTitle: "Dungeon Meshi",
          episodeNumber: 1,
          privacy: "public",
          status: "live",
          maxParticipants: 2,
          language: "dub",
          timerUpdatedAt: recentIso,
          lastHeartbeatAt: recentIso,
          activeParticipants: [
            {
              key: "user:host-b",
              userId: "host-b",
              username: "laios",
              displayName: "Laios",
              avatarUrl: null,
              isPublicProfile: true,
              role: "host",
              lastSeenAt: recentIso,
            },
            {
              key: "user:partner-b",
              userId: "partner-b",
              username: "marcille",
              displayName: "Marcille",
              avatarUrl: null,
              isPublicProfile: true,
              role: "viewer",
              lastSeenAt: recentIso,
            },
          ],
        }),
      },
    ],
    animeRows: [
      {
        external_id: 52701,
        slug: "dungeon-meshi",
        title_romaji: "Dungeon Meshi",
        title_english: "Delicious in Dungeon",
        cover_image_url: "https://cdn.nayozu.local/dungeon-meshi.jpg",
        banner_image_url: null,
        episodes: 24,
        status: "FINISHED",
        media_type: "anime",
      },
    ],
    profileRows: [
      {
        id: "host-a",
        username: "senshi_cook",
        display_name: "Senshi",
        avatar_url: null,
        profile_visibility: "public",
      },
      {
        id: "host-b",
        username: "laios",
        display_name: "Laios",
        avatar_url: null,
        profile_visibility: "public",
      },
    ],
  });

  const shared = await fetchSharedWatchTogetherRooms(mockSupabase, {
    currentUserId: null,
    nowMs,
  });

  assert.equal(shared.lobbyRooms.length, 2);
  assert.equal(shared.drawerRooms.length, 1);

  const lobbyJoinable = shared.lobbyRooms.find((r) => r.id === "room-joinable");
  const drawerJoinable = shared.drawerRooms[0];

  assert.ok(lobbyJoinable);
  assert.equal(drawerJoinable.id, lobbyJoinable.id);
  assert.equal(drawerJoinable.roomTitle, lobbyJoinable.roomTitle);
  assert.equal(drawerJoinable.animeTitle, lobbyJoinable.animeTitle);
  assert.equal(drawerJoinable.animeCover, lobbyJoinable.animeCover);
  assert.equal(drawerJoinable.episodeNumber, lobbyJoinable.episodeNumber);
  assert.equal(drawerJoinable.totalEpisodes, lobbyJoinable.totalEpisodes);
  assert.equal(drawerJoinable.participantCount, lobbyJoinable.participantCount);
  assert.equal(drawerJoinable.maxParticipants, lobbyJoinable.maxParticipants);
  assert.equal(drawerJoinable.status, lobbyJoinable.status);
  assert.equal(drawerJoinable.host.username, lobbyJoinable.host.username);

  const lobbyFull = shared.lobbyRooms.find((r) => r.id === "room-full");
  assert.ok(lobbyFull);
  assert.equal(lobbyFull.lifecycleState, "full");
  assert.equal(lobbyFull.participantCount, 2);

  // Confirm both communityActions.ts and app/watch-together/page.tsx call fetchSharedWatchTogetherRooms
  const communityActionsSrc = readProjectFile(
    "lib/actions/communityActions.ts"
  );
  const watchPageSrc = readProjectFile("app/watch-together/page.tsx");
  assert.ok(communityActionsSrc.includes("fetchSharedWatchTogetherRooms"));
  assert.ok(watchPageSrc.includes("fetchSharedWatchTogetherRooms"));
});

test("12. Realtime subscription cleanup and leave lifecycle", () => {
  const clientSrc = readProjectFile(
    "app/watch-together/watch-together-client.tsx"
  );
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");

  // Watch Together active room effect cleans up heartbeat timer, untracks presence, and removes channel
  assert.ok(clientSrc.includes("window.clearInterval(heartbeatTimer)"));
  assert.ok(clientSrc.includes("void channel.untrack()"));
  assert.ok(clientSrc.includes("void supabase.removeChannel(channel)"));
  assert.ok(clientSrc.includes("leaveWatchRoomAction"));

  // Right panel cleans up presence channel and window event listener
  assert.ok(rightPanelSrc.includes("void supabase.removeChannel(channel)"));
  assert.ok(
    rightPanelSrc.includes(
      'window.removeEventListener(\n        "nayozu:watch-rooms-updated"'
    ) ||
      rightPanelSrc.includes(
        'window.removeEventListener("nayozu:watch-rooms-updated"'
      )
  );
});

test("13. Empty, loading, and error states exist in both Drawer and Lobby", () => {
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");
  const clientSrc = readProjectFile(
    "app/watch-together/watch-together-client.tsx"
  );

  // Drawer Watch Together states
  assert.ok(rightPanelSrc.includes("No live public parties right now"));
  assert.ok(rightPanelSrc.includes("joinError"));
  assert.ok(rightPanelSrc.includes("loading ?"));

  // Lobby Watch Together states
  assert.ok(clientSrc.includes("No active Watch Together rooms right now."));
  assert.ok(
    clientSrc.includes("No Watch Together rooms match your current filter.")
  );
  assert.ok(clientSrc.includes("lobbyError"));
  assert.ok(clientSrc.includes("lobbyLoading"));
  assert.ok(clientSrc.includes("Refresh Rooms"));
});

test("14. Stage 2.1 — Guest presence reliability across host/guest disconnect and reconnect scenarios", () => {
  const t0Ms = Date.parse("2026-11-12T12:00:00.000Z");
  const t0Iso = new Date(t0Ms).toISOString();

  // Initial room snapshot: Host + 1 Guest present at t0
  const initialActive = pruneWatchRoomActiveParticipantsSnapshot({
    existing: [],
    liveRealtimeParticipants: [
      {
        key: "user:host-1",
        userId: "host-1",
        username: "host_user",
        displayName: "Host User",
        avatarUrl: null,
        isPublicProfile: true,
        role: "host",
        lastSeenAt: t0Iso,
      },
      {
        key: "guest:guest_xyz",
        userId: null,
        username: "Guest_xyz",
        displayName: "Guest_xyz",
        avatarUrl: null,
        isPublicProfile: false,
        role: "guest",
        lastSeenAt: t0Iso,
      },
    ],
    hostId: "host-1",
    maxParticipants: 8,
    nowIso: t0Iso,
    nowMs: t0Ms,
  });
  assert.equal(initialActive.length, 2);

  // Scenario A: Host reconnects at t0 + 60s BEFORE Realtime channel has synced (liveRealtimeParticipants: undefined).
  // The guest's lastSeenAt MUST NOT be refreshed to t0 + 60s; it remains t0Iso so it expires on schedule.
  const t1Ms = t0Ms + 60_000;
  const t1Iso = new Date(t1Ms).toISOString();
  const afterPreSyncHeartbeat = pruneWatchRoomActiveParticipantsSnapshot({
    existing: initialActive,
    liveRealtimeParticipants: undefined,
    hostId: "host-1",
    maxParticipants: 8,
    nowIso: t1Iso,
    nowMs: t1Ms,
  });
  const guestEntryAfterPreSync = afterPreSyncHeartbeat.find(
    (p) => p.role === "guest"
  );
  assert.ok(guestEntryAfterPreSync);
  assert.equal(guestEntryAfterPreSync.lastSeenAt, t0Iso);

  // Scenario B: Host disconnects and guest disconnects; 3m TTL expires (t0 + 181s).
  // Even without a live Realtime sync, pruning removes the expired guest.
  const tExpiredMs = t0Ms + PARTICIPANT_ACTIVE_TTL_MS + 1000;
  const tExpiredIso = new Date(tExpiredMs).toISOString();
  const afterTtlExpiry = pruneWatchRoomActiveParticipantsSnapshot({
    existing: afterPreSyncHeartbeat,
    liveRealtimeParticipants: undefined,
    hostId: "host-1",
    maxParticipants: 8,
    nowIso: tExpiredIso,
    nowMs: tExpiredMs,
  });
  assert.equal(
    afterTtlExpiry.some((p) => p.role === "guest"),
    false
  );

  // Scenario C: Host returns (or is online) after guest has already disconnected.
  // Live Realtime presence contains only [Host] -> guest is purged immediately (even before 3m TTL).
  const afterHostRealtimeSync = pruneWatchRoomActiveParticipantsSnapshot({
    existing: initialActive,
    liveRealtimeParticipants: [
      {
        key: "user:host-1",
        userId: "host-1",
        username: "host_user",
        displayName: "Host User",
        avatarUrl: null,
        isPublicProfile: true,
        role: "host",
        lastSeenAt: t1Iso,
      },
    ],
    hostId: "host-1",
    maxParticipants: 8,
    nowIso: t1Iso,
    nowMs: t1Ms,
  });
  assert.equal(afterHostRealtimeSync.length, 1);
  assert.equal(afterHostRealtimeSync[0].userId, "host-1");

  // Scenario D: Host explicitly leaves/closes the room (hostLeaving: true).
  // Host and all guest entries are immediately stripped from the room snapshot.
  const afterHostLeave = pruneWatchRoomActiveParticipantsSnapshot({
    existing: initialActive,
    hostId: "host-1",
    maxParticipants: 8,
    nowIso: t1Iso,
    nowMs: t1Ms,
    hostLeaving: true,
  });
  assert.equal(afterHostLeave.length, 0);
});

test("15. Stage 2.1 — Stale rooms owned by other users are excluded without unauthorized DB updates, and chat volume never crowds out top-level rooms", async () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const staleIso = new Date(nowMs - STALE_ROOM_TTL_MS - 120_000).toISOString();
  const activeIso = new Date(nowMs - 20_000).toISOString();

  // Generate 130 chat messages on the active room to verify they never crowd out top-level rooms
  const manyChatRows = Array.from({ length: 130 }, (_, idx) => ({
    id: `chat-msg-${idx}`,
    anime_id: "watch_room",
    user_id: "user-other",
    parent_comment_id: "active-room-1",
    is_hidden: false,
    created_at: activeIso,
    updated_at: activeIso,
    body: `Chat message #${idx}`,
  }));

  const mockSupabase = createMockSupabase({
    currentUserId: "viewer-me",
    roomRows: [
      // Stale room owned by ANOTHER user ("user-other")
      {
        id: "stale-other-user-room",
        anime_id: "watch_room",
        user_id: "user-other",
        parent_comment_id: null,
        is_hidden: false,
        created_at: staleIso,
        updated_at: staleIso,
        body: makeRoomPayloadJson({
          roomTitle: "Other User Abandoned Room",
          animeExternalId: "52991",
          timerUpdatedAt: staleIso,
          lastHeartbeatAt: staleIso,
        }),
      },
      // Active room with 130 chat messages
      {
        id: "active-room-1",
        anime_id: "watch_room",
        user_id: "user-other",
        parent_comment_id: null,
        is_hidden: false,
        created_at: activeIso,
        updated_at: activeIso,
        body: makeRoomPayloadJson({
          roomTitle: "Busy Chat Room",
          animeExternalId: "52991",
          timerUpdatedAt: activeIso,
          lastHeartbeatAt: activeIso,
        }),
      },
      ...manyChatRows,
    ],
    animeRows: [
      {
        external_id: 52991,
        slug: "sousou-no-frieren",
        title_romaji: "Sousou no Frieren",
        title_english: "Frieren: Beyond Journey's End",
        cover_image_url: "https://cdn.nayozu.local/frieren.jpg",
        banner_image_url: null,
        episodes: 28,
        status: "FINISHED",
        media_type: "anime",
      },
    ],
    profileRows: [
      {
        id: "user-other",
        username: "other_host",
        display_name: "Other Host",
        avatar_url: null,
        profile_visibility: "public",
      },
    ],
  });

  const shared = await fetchSharedWatchTogetherRooms(mockSupabase, {
    currentUserId: "viewer-me",
    nowMs,
  });

  // Stale room owned by another user is excluded from both Lobby and Drawer
  assert.equal(shared.lobbyRooms.length, 1);
  assert.equal(shared.lobbyRooms[0].id, "active-room-1");
  assert.equal(shared.drawerRooms.length, 1);
  assert.equal(shared.drawerRooms[0].id, "active-room-1");

  // Viewer does NOT attempt to update/hide a room owned by another user
  assert.equal(mockSupabase.hiddenUpdates.length, 0);

  //Participant count is still 1 (host only), completely unaffected by 130 chat messages
  assert.equal(shared.lobbyRooms[0].participantCount, 1);
});

test("16. Stage 2.1 — Concurrent final-slot join enforcement and host/participant reconnect safety", async () => {
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const roomCreatedIso = new Date(nowMs - 60_000).toISOString();

  // Room has maxParticipants = 2, and Host ("host-1") is already occupying slot 1 -> only 1 slot left!
  const payload = parseWatchRoomPayloadSync(
    makeRoomPayloadJson({
      maxParticipants: 2,
      timerUpdatedAt: roomCreatedIso,
      lastHeartbeatAt: roomCreatedIso,
    })
  );
  const hostProfile = {
    id: "host-1",
    username: "host_user",
    displayName: "Host User",
    avatarUrl: null,
    isPublicProfile: true,
  };

  // Shared in-memory presence store simulating concurrent database writes
  const storedPresenceRows = [];
  let writeClock = nowMs;

  async function simulateVerifyAndJoin(callerUserId) {
    return withWatchRoomJoinLock("room-cap-2", async () => {
      // Yield to event loop to simulate async network I/O during concurrent requests
      await new Promise((r) => setTimeout(r, 5));

      const preCheck = computeActiveRoomParticipants({
        hostId: "host-1",
        hostProfile,
        payload,
        roomCreatedAt: roomCreatedIso,
        roomUpdatedAt: roomCreatedIso,
        presenceChildRows: storedPresenceRows,
        nowMs,
      });

      const isHost = callerUserId === "host-1";
      const isAlreadyActive = preCheck.activeUserIds.has(callerUserId);

      if (
        !isHost &&
        !isAlreadyActive &&
        preCheck.participantCount >= payload.maxParticipants
      ) {
        return {
          authorized: false,
          participantCount: preCheck.participantCount,
          lifecycleState: "full",
        };
      }

      // Upsert caller's active presence row
      writeClock += 1;
      const writeIso = new Date(writeClock).toISOString();
      const existingIdx = storedPresenceRows.findIndex(
        (r) => r.userId === callerUserId
      );
      const record = parseWatchRoomPresenceRecord(
        serializeWatchRoomPresenceRecord({
          status: "active",
          sessionKey: `user:${callerUserId}`,
          lastSeenAt: writeIso,
        })
      );
      if (existingIdx >= 0) {
        storedPresenceRows[existingIdx] = {
          ...storedPresenceRows[existingIdx],
          isHidden: false,
          updatedAt: writeIso,
          record,
        };
      } else {
        storedPresenceRows.push({
          userId: callerUserId,
          isHidden: false,
          createdAt: writeIso,
          updatedAt: writeIso,
          record,
        });
      }

      const postCheck = computeActiveRoomParticipants({
        hostId: "host-1",
        hostProfile,
        payload,
        roomCreatedAt: roomCreatedIso,
        roomUpdatedAt: roomCreatedIso,
        presenceChildRows: storedPresenceRows,
        nowMs: writeClock,
      });

      if (!isHost && !isAlreadyActive && !postCheck.activeUserIds.has(callerUserId)) {
        return {
          authorized: false,
          participantCount: payload.maxParticipants,
          lifecycleState: "full",
        };
      }

      return {
        authorized: true,
        participantCount: postCheck.participantCount,
        lifecycleState:
          postCheck.participantCount >= payload.maxParticipants
            ? "full"
            : "active",
      };
    });
  }

  // Two users ("user-race-a" and "user-race-b") simultaneously attempt to join the final slot
  const [resA, resB] = await Promise.all([
    simulateVerifyAndJoin("user-race-a"),
    simulateVerifyAndJoin("user-race-b"),
  ]);

  // Exactly one succeeds and one is rejected; capacity never exceeds 2
  const authorizedResults = [resA, resB].filter((r) => r.authorized);
  const rejectedResults = [resA, resB].filter((r) => !r.authorized);
  assert.equal(authorizedResults.length, 1);
  assert.equal(rejectedResults.length, 1);
  assert.equal(authorizedResults[0].participantCount, 2);
  assert.equal(authorizedResults[0].lifecycleState, "full");
  assert.equal(rejectedResults[0].participantCount, 2);
  assert.equal(rejectedResults[0].lifecycleState, "full");

  // Reconnecting as the existing active participant ("user-race-a") succeeds without consuming a 3rd slot
  const reconnectParticipant = await simulateVerifyAndJoin("user-race-a");
  assert.equal(reconnectParticipant.authorized, true);
  assert.equal(reconnectParticipant.participantCount, 2);

  // Reconnecting as the Host ("host-1") succeeds when room is 2/2 without consuming a 3rd slot
  const reconnectHost = await simulateVerifyAndJoin("host-1");
  assert.equal(reconnectHost.authorized, true);
  assert.equal(reconnectHost.participantCount, 2);
});

