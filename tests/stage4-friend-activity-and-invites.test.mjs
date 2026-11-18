import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = path.resolve(process.cwd(), `${specifier.slice(2)}.ts`);
      return nextResolve(pathToFileURL(target).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  acceptWatchRoomInvitationWithClient,
  cancelWatchRoomInvitationWithClient,
  declineWatchRoomInvitationWithClient,
  getActivityPrivacySettingsWithClient,
  getFriendActivityFeedWithClient,
  getWatchRoomInvitationsForUserWithClient,
  sendWatchRoomInvitationWithClient,
  updateActivityPrivacySettingsWithClient,
} = await import("../lib/friends/friendActivityAndInvitesService.ts");
const {
  buildCanonicalFriendshipPair,
  cleanupFriendshipBetweenUsersWithClient,
} = await import("../lib/friends/friendsService.ts");

const NOW_ISO = "2026-11-18T10:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const FUTURE_EXPIRES_ISO = new Date(NOW_MS + 60 * 60 * 1000).toISOString();
const PAST_EXPIRES_ISO = new Date(NOW_MS - 60 * 1000).toISOString();

function makeWatchRoomPayload(overrides = {}) {
  return JSON.stringify({
    version: 1,
    roomTitle: "Frieren Cozy Watch Party",
    description: "No manga spoilers please",
    animeExternalId: "154587",
    animeSlug: "frieren-beyond-journeys-end",
    animeTitle: "Frieren: Beyond Journey's End",
    animeCover: "https://cdn.example.com/frieren.jpg",
    episodeNumber: 4,
    totalEpisodes: 28,
    language: "sub",
    status: "live",
    privacy: "public",
    accessCodeHash: null,
    maxParticipants: 4,
    timerSeconds: 120,
    isPlaying: true,
    timerUpdatedAt: NOW_ISO,
    lastHeartbeatAt: NOW_ISO,
    hostPresent: true,
    activeParticipants: [
      {
        key: "user:user_host",
        userId: "user_host",
        username: "host_alice",
        displayName: "Alice Host",
        avatarUrl: null,
        isPublicProfile: true,
        role: "host",
        lastSeenAt: NOW_ISO,
      },
    ],
    ...overrides,
  });
}

/**
 * In-memory relational mock for Stage 4 Friend Activity & Watch Together Invitations.
 */
function createMockStage4Supabase(seed = {}) {
  let idCounter = 500;
  const state = {
    profiles: (seed.profiles ?? []).map((p) => ({
      profile_visibility: "public",
      share_activity_with_friends: true,
      share_library_activity_with_friends: true,
      notify_watch_together_invites: true,
      bio: null,
      avatar_url: null,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
      ...p,
    })),
    friendships: (seed.friendships ?? []).map((f) => ({ ...f })),
    user_blocks: (seed.user_blocks ?? []).map((b) => ({ ...b })),
    user_restrictions: (seed.user_restrictions ?? []).map((r) => ({ ...r })),
    user_notifications: (seed.user_notifications ?? []).map((n) => ({ ...n })),
    user_anime_library: (seed.user_anime_library ?? []).map((l) => ({ ...l })),
    anime_reviews: (seed.anime_reviews ?? []).map((r) => ({
      is_hidden: false,
      ...r,
    })),
    anime_ratings: (seed.anime_ratings ?? []).map((r) => ({ ...r })),
    discussions: (seed.discussions ?? []).map((d) => ({
      is_hidden: false,
      is_spoiler: false,
      ...d,
    })),
    anime_comments: (seed.anime_comments ?? []).map((c) => ({
      is_hidden: false,
      parent_comment_id: null,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
      ...c,
    })),
    watch_room_invitations: (seed.watch_room_invitations ?? []).map((i) => ({
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
      responded_at: null,
      expires_at: FUTURE_EXPIRES_ISO,
      ...i,
    })),
    anime: (
      seed.anime ?? [
        {
          external_id: 154587,
          slug: "frieren-beyond-journeys-end",
          title_romaji: "Sousou no Frieren",
          title_english: "Frieren: Beyond Journey's End",
          cover_image_url: "https://cdn.example.com/frieren.jpg",
          episodes: 28,
          chapters: null,
          status: "FINISHED",
          media_type: "anime",
        },
        {
          external_id: 30013,
          slug: "one-piece-manga",
          title_romaji: "One Piece",
          title_english: "One Piece",
          cover_image_url: "https://cdn.example.com/onepiece.jpg",
          episodes: null,
          chapters: 1100,
          status: "RELEASING",
          media_type: "manga",
        },
      ]
    ).map((a) => ({ ...a })),
  };

  function parseOrCondition(row, orExpr) {
    if (orExpr.startsWith("and(")) {
      const groups = orExpr.match(/and\(([^)]+)\)/g) ?? [];
      return groups.some((group) => {
        const inner = group.slice(4, -1);
        const clauses = inner.split(",");
        return clauses.every((clause) => {
          const [col, op, val] = clause.split(".");
          if (op === "eq") return String(row[col]) === val;
          return false;
        });
      });
    }

    const clauses = orExpr.split(",");
    return clauses.some((clause) => {
      const [col, op, val] = clause.split(".");
      if (op === "eq") return String(row[col]) === val;
      return false;
    });
  }

  function makeQueryBuilder(tableName) {
    let op = "select";
    let payload = null;
    let upsertOpts = null;
    const predicates = [];
    let orderCol = null;
    let orderAsc = true;
    let limitCount = null;
    let wantMaybeSingle = false;

    const execute = async () => {
      const table = state[tableName];
      if (!table) return { data: null, error: { message: "Unknown table" } };

      if (op === "insert") {
        const items = Array.isArray(payload) ? payload : [payload];
        const inserted = [];
        for (const item of items) {
          if (tableName === "watch_room_invitations") {
            const dupActive = table.find(
              (existing) =>
                existing.room_id === item.room_id &&
                existing.invitee_id === item.invitee_id &&
                (existing.status === "pending" ||
                  existing.status === "accepted")
            );
            if (dupActive) {
              return {
                data: null,
                error: {
                  code: "23505",
                  message: "Duplicate active watch room invitation",
                },
              };
            }
          }
          if (tableName === "friendships") {
            const pair = buildCanonicalFriendshipPair(
              item.requester_id,
              item.addressee_id
            );
            const dup = table.find((e) => {
              const ep = buildCanonicalFriendshipPair(
                e.requester_id,
                e.addressee_id
              );
              return ep.pairKey === pair.pairKey;
            });
            if (dup) {
              return {
                data: null,
                error: { code: "23505", message: "Unique pair violation" },
              };
            }
          }
          const created = {
            id: item.id || `${tableName}_${++idCounter}`,
            created_at: NOW_ISO,
            updated_at: NOW_ISO,
            responded_at: null,
            ...item,
          };
          table.push(created);
          inserted.push(created);
        }
        return {
          data: wantMaybeSingle ? inserted[0] ?? null : inserted,
          error: null,
        };
      }

      if (op === "upsert") {
        const items = Array.isArray(payload) ? payload : [payload];
        const results = [];
        for (const item of items) {
          if (
            tableName === "user_notifications" &&
            upsertOpts?.onConflict === "user_id,dedupe_key"
          ) {
            const existing = table.find(
              (r) =>
                r.user_id === item.user_id && r.dedupe_key === item.dedupe_key
            );
            if (existing) {
              Object.assign(existing, item);
              results.push(existing);
            } else {
              const created = {
                id: item.id || `notif_${++idCounter}`,
                created_at: NOW_ISO,
                ...item,
              };
              table.push(created);
              results.push(created);
            }
          } else {
            const created = {
              id: item.id || `${tableName}_${++idCounter}`,
              ...item,
            };
            table.push(created);
            results.push(created);
          }
        }
        return {
          data: wantMaybeSingle ? results[0] ?? null : results,
          error: null,
        };
      }

      const matched = table.filter((row) =>
        predicates.every((fn) => fn(row))
      );

      if (op === "update") {
        for (const row of matched) {
          Object.assign(row, payload);
        }
        return {
          data: wantMaybeSingle ? matched[0] ?? null : matched,
          error: null,
        };
      }

      if (op === "delete") {
        const toRemove = new Set(matched);
        state[tableName] = table.filter((row) => !toRemove.has(row));
        return { data: matched, error: null };
      }

      let rows = [...matched];
      if (orderCol) {
        rows.sort((a, b) => {
          const va = a[orderCol] ?? "";
          const vb = b[orderCol] ?? "";
          if (va === vb) return 0;
          return orderAsc ? (va > vb ? 1 : -1) : va < vb ? 1 : -1;
        });
      }
      if (typeof limitCount === "number") {
        rows = rows.slice(0, limitCount);
      }

      if (wantMaybeSingle) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    };

    const builder = {
      select() {
        return builder;
      },
      insert(val) {
        op = "insert";
        payload = val;
        return builder;
      },
      upsert(val, opts) {
        op = "upsert";
        payload = val;
        upsertOpts = opts;
        return builder;
      },
      update(val) {
        op = "update";
        payload = val;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      eq(col, val) {
        predicates.push((row) => row[col] === val);
        return builder;
      },
      neq(col, val) {
        predicates.push((row) => row[col] !== val);
        return builder;
      },
      is(col, val) {
        predicates.push((row) => (row[col] ?? null) === val);
        return builder;
      },
      in(col, vals) {
        const set = new Set(vals);
        predicates.push((row) => set.has(row[col]));
        return builder;
      },
      or(expr) {
        predicates.push((row) => parseOrCondition(row, expr));
        return builder;
      },
      order(col, opts) {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return builder;
      },
      limit(n) {
        limitCount = n;
        return builder;
      },
      maybeSingle() {
        wantMaybeSingle = true;
        return execute();
      },
      then(onFulfilled, onRejected) {
        return execute().then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  return {
    state,
    from(tableName) {
      return makeQueryBuilder(tableName);
    },
    async rpc(fnName, args) {
      if (fnName === "is_blocked_between") {
        const a = args?.user_a;
        const b = args?.user_b;
        const blocked = state.user_blocks.some(
          (row) =>
            (row.blocker_id === a && row.blocked_id === b) ||
            (row.blocker_id === b && row.blocked_id === a)
        );
        return { data: blocked, error: null };
      }
      return { data: null, error: { message: "Use table query fallback" } };
    },
  };
}

// ============================================================================
// 1. Activity feed privacy & accepted-friend authorization
// ============================================================================
test("1. Activity feed privacy & accepted-friend authorization: excludes guests, strangers, pending requests, and non-shareable library statuses", async () => {
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_viewer", username: "viewer", display_name: "Viewer" },
      { id: "user_accepted", username: "friend_ok", display_name: "Accepted Friend" },
      { id: "user_pending", username: "pending_bob", display_name: "Pending Bob" },
      { id: "user_stranger", username: "stranger_eve", display_name: "Stranger Eve" },
    ],
    friendships: [
      {
        id: "f_acc",
        requester_id: "user_viewer",
        addressee_id: "user_accepted",
        status: "accepted",
      },
      {
        id: "f_pend",
        requester_id: "user_viewer",
        addressee_id: "user_pending",
        status: "pending",
      },
    ],
    user_anime_library: [
      // Valid watching & completed entries from accepted friend
      {
        id: "lib_1",
        user_id: "user_accepted",
        anime_id: "154587",
        status: "watching",
        progress: 5,
        created_at: "2026-11-18T08:00:00.000Z",
        updated_at: "2026-11-18T09:30:00.000Z",
      },
      {
        id: "lib_2",
        user_id: "user_accepted",
        anime_id: "manga:30013",
        status: "completed",
        progress: 1100,
        created_at: "2026-11-18T07:00:00.000Z",
        updated_at: "2026-11-18T09:00:00.000Z",
      },
      // Non-shareable private statuses (planned, dropped, on_hold, fav:*) must NEVER leak
      {
        id: "lib_priv_1",
        user_id: "user_accepted",
        anime_id: "154587",
        status: "planned",
        progress: 0,
        created_at: "2026-11-18T09:50:00.000Z",
        updated_at: "2026-11-18T09:50:00.000Z",
      },
      {
        id: "lib_priv_2",
        user_id: "user_accepted",
        anime_id: "fav:154587",
        status: "watching",
        progress: 1,
        created_at: "2026-11-18T09:55:00.000Z",
        updated_at: "2026-11-18T09:55:00.000Z",
      },
      // Pending friend & stranger activity must NEVER appear
      {
        id: "lib_pending",
        user_id: "user_pending",
        anime_id: "154587",
        status: "completed",
        progress: 28,
        created_at: "2026-11-18T09:40:00.000Z",
        updated_at: "2026-11-18T09:40:00.000Z",
      },
      {
        id: "lib_stranger",
        user_id: "user_stranger",
        anime_id: "154587",
        status: "completed",
        progress: 28,
        created_at: "2026-11-18T09:45:00.000Z",
        updated_at: "2026-11-18T09:45:00.000Z",
      },
    ],
  });

  // Guest is rejected
  const guestRes = await getFriendActivityFeedWithClient(supabase, {
    viewerId: null,
    nowMs: NOW_MS,
  });
  assert.equal(guestRes.success, false);
  assert.equal(guestRes.items.length, 0);

  // Authenticated viewer sees ONLY accepted friend's watching & completed milestones
  const feedRes = await getFriendActivityFeedWithClient(supabase, {
    viewerId: "user_viewer",
    nowMs: NOW_MS,
  });
  assert.equal(feedRes.success, true);
  assert.equal(feedRes.acceptedFriendsCount, 1);
  assert.equal(feedRes.items.length, 2);
  assert.ok(feedRes.items.every((item) => item.actor.id === "user_accepted"));
  assert.deepEqual(
    feedRes.items.map((i) => i.activityType),
    ["updated_watching_progress", "completed_manga"]
  );
});

// ============================================================================
// 2. Blocked-user exclusion & Activity sharing preferences
// ============================================================================
test("2. Blocked-user exclusion & activity sharing preferences: respects share_activity_with_friends, share_library_activity_with_friends, and bidirectional blocks", async () => {
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_viewer", username: "viewer", display_name: "Viewer" },
      {
        id: "user_friend_all_off",
        username: "quiet_friend",
        display_name: "Quiet Friend",
        share_activity_with_friends: false,
        share_library_activity_with_friends: true,
      },
      {
        id: "user_friend_lib_off",
        username: "review_only",
        display_name: "Review Only Friend",
        share_activity_with_friends: true,
        share_library_activity_with_friends: false,
      },
      {
        id: "user_friend_blocked",
        username: "blocked_friend",
        display_name: "Blocked Friend",
        share_activity_with_friends: true,
        share_library_activity_with_friends: true,
      },
    ],
    friendships: [
      { id: "f1", requester_id: "user_viewer", addressee_id: "user_friend_all_off", status: "accepted" },
      { id: "f2", requester_id: "user_viewer", addressee_id: "user_friend_lib_off", status: "accepted" },
      { id: "f3", requester_id: "user_viewer", addressee_id: "user_friend_blocked", status: "accepted" },
    ],
    user_blocks: [
      { id: "b1", blocker_id: "user_friend_blocked", blocked_id: "user_viewer" },
    ],
    user_anime_library: [
      {
        id: "l1",
        user_id: "user_friend_all_off",
        anime_id: "154587",
        status: "completed",
        progress: 28,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
      {
        id: "l2",
        user_id: "user_friend_lib_off",
        anime_id: "154587",
        status: "completed",
        progress: 28,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
      {
        id: "l3",
        user_id: "user_friend_blocked",
        anime_id: "154587",
        status: "completed",
        progress: 28,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
    anime_reviews: [
      {
        id: "rev_quiet",
        user_id: "user_friend_all_off",
        anime_id: "154587",
        title: "Hidden by preference",
        body: "Should not appear",
        rating: 9,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
      {
        id: "rev_visible",
        user_id: "user_friend_lib_off",
        anime_id: "154587",
        title: "Masterpiece fantasy",
        body: "Incredible pacing and score.",
        rating: 10,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
      {
        id: "rev_blocked",
        user_id: "user_friend_blocked",
        anime_id: "154587",
        title: "Blocked review",
        body: "Should never appear",
        rating: 5,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
  });

  const feed = await getFriendActivityFeedWithClient(supabase, {
    viewerId: "user_viewer",
    nowMs: NOW_MS,
  });

  assert.equal(feed.success, true);
  // Only the review from user_friend_lib_off is included (their library item is hidden, and blocked/all_off friends are excluded)
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].actor.id, "user_friend_lib_off");
  assert.equal(feed.items[0].activityType, "published_review");
  assert.equal(feed.items[0].score, 10);

  // Verify get/update privacy settings persistence
  const updateRes = await updateActivityPrivacySettingsWithClient(supabase, {
    viewerId: "user_viewer",
    shareActivityWithFriends: false,
    shareLibraryActivityWithFriends: false,
    notifyWatchTogetherInvites: false,
  });
  assert.equal(updateRes.success, true);
  assert.deepEqual(updateRes.settings, {
    shareActivityWithFriends: false,
    shareLibraryActivityWithFriends: false,
    notifyWatchTogetherInvites: false,
  });

  const loadedSettings = await getActivityPrivacySettingsWithClient(
    supabase,
    "user_viewer"
  );
  assert.deepEqual(loadedSettings, {
    shareActivityWithFriends: false,
    shareLibraryActivityWithFriends: false,
    notifyWatchTogetherInvites: false,
  });
});

// ============================================================================
// 3. Pagination, deduplication, and spoiler preservation in Friend Activity Feed
// ============================================================================
test("3. Pagination, duplicate prevention, and spoiler preservation: deduplicates repeated library entries and preserves spoiler flags", async () => {
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_viewer", username: "viewer", display_name: "Viewer" },
      { id: "user_friend", username: "friend1", display_name: "Friend One" },
    ],
    friendships: [
      { id: "f1", requester_id: "user_viewer", addressee_id: "user_friend", status: "accepted" },
    ],
    user_anime_library: [
      // Duplicate watching rows for the same anime should deduplicate by canonical activity id
      {
        id: "dup_1",
        user_id: "user_friend",
        anime_id: "154587",
        status: "watching",
        progress: 3,
        created_at: "2026-11-18T08:00:00.000Z",
        updated_at: "2026-11-18T08:00:00.000Z",
      },
      {
        id: "dup_2",
        user_id: "user_friend",
        anime_id: "154587",
        status: "watching",
        progress: 4,
        created_at: "2026-11-18T08:00:00.000Z",
        updated_at: "2026-11-18T09:00:00.000Z",
      },
    ],
    discussions: [
      {
        id: "disc_spoiler",
        user_id: "user_friend",
        anime_id: "154587",
        media_type: "anime",
        category: "discussion",
        title: "Episode 28 Finale Discussion",
        body: "Major spoiler about the mage exam!",
        is_spoiler: true,
        created_at: "2026-11-18T09:30:00.000Z",
      },
      {
        id: "disc_question",
        user_id: "user_friend",
        anime_id: "community",
        media_type: "anime",
        category: "question",
        title: "Best fantasy anime this season?",
        body: "Looking for recommendations.",
        is_spoiler: false,
        created_at: "2026-11-18T09:45:00.000Z",
      },
    ],
  });

  const page1 = await getFriendActivityFeedWithClient(supabase, {
    viewerId: "user_viewer",
    page: 1,
    limit: 2,
    nowMs: NOW_MS,
  });
  assert.equal(page1.success, true);
  assert.equal(page1.totalCount, 3);
  assert.equal(page1.items.length, 2);
  assert.equal(page1.hasMore, true);

  // Verify spoiler flag is preserved on the spoiler discussion
  const spoilerItem = page1.items.find((i) => i.id.includes("disc_spoiler"));
  assert.ok(spoilerItem);
  assert.equal(spoilerItem.isSpoiler, true);

  const page2 = await getFriendActivityFeedWithClient(supabase, {
    viewerId: "user_viewer",
    page: 2,
    limit: 2,
    nowMs: NOW_MS,
  });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.hasMore, false);
});

// ============================================================================
// 4. Watch Together invitation creation, deduplication, and host-only permissions
// ============================================================================
test("4. Watch Together invitation creation & host-only permissions: allows host to invite accepted friend, prevents duplicates, and rejects non-hosts or non-friends", async () => {
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_host", username: "host_alice", display_name: "Alice Host" },
      { id: "user_friend", username: "bob_friend", display_name: "Bob Friend" },
      { id: "user_stranger", username: "charlie_stranger", display_name: "Charlie" },
    ],
    friendships: [
      { id: "f_hb", requester_id: "user_host", addressee_id: "user_friend", status: "accepted" },
    ],
    anime_comments: [
      {
        id: "room_1",
        user_id: "user_host",
        anime_id: "watch_room",
        parent_comment_id: null,
        body: makeWatchRoomPayload(),
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
  });

  // 1. Non-host cannot send invitations for room_1
  const nonHostAttempt = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_friend",
    roomId: "room_1",
    inviteeUserId: "user_host",
    nowMs: NOW_MS,
  });
  assert.equal(nonHostAttempt.success, false);
  assert.match(nonHostAttempt.error ?? "", /only the room host/i);

  // 2. Host cannot invite a non-friend
  const strangerAttempt = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_1",
    inviteeUserId: "user_stranger",
    nowMs: NOW_MS,
  });
  assert.equal(strangerAttempt.success, false);
  assert.match(strangerAttempt.error ?? "", /accepted friends/i);

  // 3. Host invites accepted friend -> succeeds and creates notification
  const validInvite = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_1",
    inviteeUserId: "user_friend",
    nowMs: NOW_MS,
  });
  assert.equal(validInvite.success, true);
  assert.equal(validInvite.status, "pending");
  assert.equal(supabase.state.watch_room_invitations.length, 1);
  assert.equal(supabase.state.user_notifications.length, 1);
  assert.equal(
    supabase.state.user_notifications[0].notification_type,
    "watch_room_invite_received"
  );

  // 4. Duplicate active invitation to the same friend for the same room is rejected
  const dupInvite = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_1",
    inviteeUserId: "user_friend",
    nowMs: NOW_MS,
  });
  assert.equal(dupInvite.success, false);
  assert.match(dupInvite.error ?? "", /already been sent/i);
  assert.equal(supabase.state.watch_room_invitations.length, 1);
});

// ============================================================================
// 5. Invitation acceptance, decline, cancellation, and unauthorized access
// ============================================================================
test("5. Invitation acceptance, decline, cancellation & authorization: enforces recipient-only accept/decline and host-only cancel", async () => {
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_host", username: "host_alice", display_name: "Alice Host" },
      { id: "user_friend", username: "bob_friend", display_name: "Bob Friend" },
      { id: "user_third", username: "eve_third", display_name: "Eve Third" },
    ],
    friendships: [
      { id: "f_hb", requester_id: "user_host", addressee_id: "user_friend", status: "accepted" },
    ],
    anime_comments: [
      {
        id: "room_1",
        user_id: "user_host",
        anime_id: "watch_room",
        parent_comment_id: null,
        body: makeWatchRoomPayload({
          privacy: "private",
          roomTitle: "Secret Guild Screening",
        }),
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
  });

  const sent = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_1",
    inviteeUserId: "user_friend",
    nowMs: NOW_MS,
  });
  assert.equal(sent.success, true);

  // Before acceptance, private room custom title is masked for invitee in DTO and notification body
  const beforeAcceptList = await getWatchRoomInvitationsForUserWithClient(
    supabase,
    {
      viewerId: "user_friend",
      nowMs: NOW_MS,
    }
  );
  assert.equal(beforeAcceptList.incomingInvitations.length, 1);
  assert.equal(
    beforeAcceptList.incomingInvitations[0].roomTitle,
    "Private Watch Together Room"
  );
  assert.doesNotMatch(
    supabase.state.user_notifications[0].body ?? "",
    /Secret Guild Screening/
  );

  // Third party cannot accept or decline
  const thirdAccept = await acceptWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_third",
    invitationId: sent.invitationId,
    nowMs: NOW_MS,
  });
  assert.equal(thirdAccept.success, false);
  assert.match(thirdAccept.error ?? "", /not authorized/i);

  // Invitee cannot cancel (only host can cancel)
  const inviteeCancel = await cancelWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_friend",
    invitationId: sent.invitationId,
    nowMs: NOW_MS,
  });
  assert.equal(inviteeCancel.success, false);
  assert.match(inviteeCancel.error ?? "", /only the room host/i);

  // Invitee accepts invitation -> joins room, marks notification read, and unlocks private room title
  const accepted = await acceptWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_friend",
    invitationId: sent.invitationId,
    nowMs: NOW_MS,
  });
  assert.equal(accepted.success, true);
  assert.equal(accepted.roomId, "room_1");
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.participantCount, 2);
  assert.equal(supabase.state.user_notifications[0].is_read, true);

  const afterAcceptList = await getWatchRoomInvitationsForUserWithClient(
    supabase,
    {
      viewerId: "user_friend",
      nowMs: NOW_MS,
    }
  );
  assert.equal(
    afterAcceptList.incomingInvitations[0].roomTitle,
    "Secret Guild Screening"
  );

  // Accepted invitation cannot be reused or declined afterwards
  const reuseAttempt = await acceptWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_friend",
    invitationId: sent.invitationId,
    nowMs: NOW_MS,
  });
  assert.equal(reuseAttempt.success, false);
  assert.equal(reuseAttempt.status, "accepted");
});

// ============================================================================
// 6. Expired, cancelled, ended, stale, full room & post-invite blocking handling
// ============================================================================
test("6. Expired, cancelled, ended, stale, full room & blocking after invitation creation", async () => {
  const staleIso = new Date(NOW_MS - 3 * 60 * 60 * 1000).toISOString();
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_host", username: "host_alice", display_name: "Alice Host" },
      { id: "user_friend", username: "bob_friend", display_name: "Bob Friend" },
    ],
    friendships: [
      { id: "f_hb", requester_id: "user_host", addressee_id: "user_friend", status: "accepted" },
    ],
    anime_comments: [
      {
        id: "room_ended",
        user_id: "user_host",
        anime_id: "watch_room",
        body: makeWatchRoomPayload({ status: "ended" }),
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
      {
        id: "room_stale",
        user_id: "user_host",
        anime_id: "watch_room",
        body: makeWatchRoomPayload({
          lastHeartbeatAt: staleIso,
          timerUpdatedAt: staleIso,
          activeParticipants: [],
        }),
        created_at: staleIso,
        updated_at: staleIso,
      },
      {
        id: "room_live",
        user_id: "user_host",
        anime_id: "watch_room",
        body: makeWatchRoomPayload(),
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
    watch_room_invitations: [
      {
        id: "inv_expired",
        room_id: "room_live",
        host_id: "user_host",
        invitee_id: "user_friend",
        status: "pending",
        room_title_snapshot: "Frieren Cozy Watch Party",
        anime_external_id: "154587",
        anime_slug: "frieren-beyond-journeys-end",
        anime_title: "Frieren: Beyond Journey's End",
        anime_cover: null,
        episode_number: 4,
        room_privacy: "public",
        expires_at: PAST_EXPIRES_ISO,
      },
    ],
  });

  // 1. Cannot send invite to ended room
  const endedInvite = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_ended",
    inviteeUserId: "user_friend",
    nowMs: NOW_MS,
  });
  assert.equal(endedInvite.success, false);
  assert.match(endedInvite.error ?? "", /ended/i);

  // 2. Cannot send invite to stale room
  const staleInvite = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_stale",
    inviteeUserId: "user_friend",
    nowMs: NOW_MS,
  });
  assert.equal(staleInvite.success, false);
  assert.match(staleInvite.error ?? "", /expired or inactive/i);

  // 3. Accepting an expired invitation marks it expired and rejects join
  const expiredAccept = await acceptWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_friend",
    invitationId: "inv_expired",
    nowMs: NOW_MS,
  });
  assert.equal(expiredAccept.success, false);
  assert.equal(expiredAccept.status, "expired");

  // 4. Create a fresh invitation, then block between users -> invitation cannot be accepted and is cleaned up
  const freshInvite = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_live",
    inviteeUserId: "user_friend",
    nowMs: NOW_MS,
  });
  assert.equal(freshInvite.success, true);

  supabase.state.user_blocks.push({
    id: "blk_1",
    blocker_id: "user_host",
    blocked_id: "user_friend",
  });

  const acceptWhileBlocked = await acceptWatchRoomInvitationWithClient(
    supabase,
    {
      viewerId: "user_friend",
      invitationId: freshInvite.invitationId,
      nowMs: NOW_MS,
    }
  );
  assert.equal(acceptWhileBlocked.success, false);
  assert.match(acceptWhileBlocked.error ?? "", /unavailable/i);

  await cleanupFriendshipBetweenUsersWithClient(
    supabase,
    "user_host",
    "user_friend"
  );
  assert.equal(
    supabase.state.watch_room_invitations.filter(
      (i) => i.id === freshInvite.invitationId
    ).length,
    0
  );
});

// ============================================================================
// 7. Concurrent room-capacity protection on invitation acceptance
// ============================================================================
test("7. Concurrent room-capacity protection: two invited friends accepting simultaneously for 1 remaining slot allows exactly 1 and rejects the 2nd", async () => {
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_host", username: "host_alice", display_name: "Alice Host" },
      { id: "user_f1", username: "friend_one", display_name: "Friend One" },
      { id: "user_f2", username: "friend_two", display_name: "Friend Two" },
    ],
    friendships: [
      { id: "f1", requester_id: "user_host", addressee_id: "user_f1", status: "accepted" },
      { id: "f2", requester_id: "user_host", addressee_id: "user_f2", status: "accepted" },
    ],
    anime_comments: [
      {
        id: "room_cap2",
        user_id: "user_host",
        anime_id: "watch_room",
        parent_comment_id: null,
        body: makeWatchRoomPayload({ maxParticipants: 2 }), // Host takes 1/2, only 1 slot left!
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
  });

  const inv1 = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_cap2",
    inviteeUserId: "user_f1",
    nowMs: NOW_MS,
  });
  const inv2 = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_cap2",
    inviteeUserId: "user_f2",
    nowMs: NOW_MS,
  });
  assert.equal(inv1.success, true);
  assert.equal(inv2.success, true);

  // Both friends click Accept concurrently
  const [res1, res2] = await Promise.all([
    acceptWatchRoomInvitationWithClient(supabase, {
      viewerId: "user_f1",
      invitationId: inv1.invitationId,
      nowMs: NOW_MS,
    }),
    acceptWatchRoomInvitationWithClient(supabase, {
      viewerId: "user_f2",
      invitationId: inv2.invitationId,
      nowMs: NOW_MS,
    }),
  ]);

  const successes = [res1, res2].filter((r) => r.success);
  const failures = [res1, res2].filter((r) => !r.success);

  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].lifecycleState, "full");
  assert.match(failures[0].error ?? "", /full/i);
});

// ============================================================================
// 8. Declining & cancelling invitations + full-room invitation rejection
// ============================================================================
test("8. Declining & cancelling invitations and full-room invitation rejection: recipient can decline, host can cancel, and full rooms reject new invites", async () => {
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_host", username: "host_alice", display_name: "Alice Host" },
      { id: "user_f1", username: "friend_one", display_name: "Friend One" },
      { id: "user_f2", username: "friend_two", display_name: "Friend Two" },
    ],
    friendships: [
      { id: "f1", requester_id: "user_host", addressee_id: "user_f1", status: "accepted" },
      { id: "f2", requester_id: "user_host", addressee_id: "user_f2", status: "accepted" },
    ],
    anime_comments: [
      {
        id: "room_norm",
        user_id: "user_host",
        anime_id: "watch_room",
        parent_comment_id: null,
        body: makeWatchRoomPayload({ maxParticipants: 4 }),
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
      {
        id: "room_already_full",
        user_id: "user_host",
        anime_id: "watch_room",
        parent_comment_id: null,
        body: makeWatchRoomPayload({
          maxParticipants: 2,
          activeParticipants: [
            {
              key: "user:user_host",
              userId: "user_host",
              username: "host_alice",
              role: "host",
              lastSeenAt: NOW_ISO,
            },
            {
              key: "user:user_f1",
              userId: "user_f1",
              username: "friend_one",
              role: "viewer",
              lastSeenAt: NOW_ISO,
            },
          ],
        }),
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
  });

  // 1. Invitee declines pending invitation -> status transitions to declined and notification marked read
  const sent1 = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_norm",
    inviteeUserId: "user_f1",
    nowMs: NOW_MS,
  });
  assert.equal(sent1.success, true);

  const declined = await declineWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_f1",
    invitationId: sent1.invitationId,
    nowMs: NOW_MS,
  });
  assert.equal(declined.success, true);
  assert.equal(declined.status, "declined");
  assert.equal(supabase.state.user_notifications[0].is_read, true);

  // Declined invitation cannot be accepted afterwards
  const acceptDeclined = await acceptWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_f1",
    invitationId: sent1.invitationId,
    nowMs: NOW_MS,
  });
  assert.equal(acceptDeclined.success, false);
  assert.equal(acceptDeclined.status, "declined");

  // 2. Host cancels pending invitation -> status transitions to cancelled and notification is deleted
  const sent2 = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_norm",
    inviteeUserId: "user_f2",
    nowMs: NOW_MS,
  });
  assert.equal(sent2.success, true);

  const cancelled = await cancelWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    invitationId: sent2.invitationId,
    nowMs: NOW_MS,
  });
  assert.equal(cancelled.success, true);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    supabase.state.user_notifications.filter((n) => n.user_id === "user_f2")
      .length,
    0
  );

  // Cancelled invitation cannot be accepted afterwards
  const acceptCancelled = await acceptWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_f2",
    invitationId: sent2.invitationId,
    nowMs: NOW_MS,
  });
  assert.equal(acceptCancelled.success, false);
  assert.equal(acceptCancelled.status, "cancelled");

  // 3. Cannot send invitation when room is already full or friend is already in room
  const alreadyInRoomRes = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_already_full",
    inviteeUserId: "user_f1",
    nowMs: NOW_MS,
  });
  assert.equal(alreadyInRoomRes.success, false);
  assert.match(alreadyInRoomRes.error ?? "", /already in your/i);

  const fullRoomInviteRes = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_already_full",
    inviteeUserId: "user_f2",
    nowMs: NOW_MS,
  });
  assert.equal(fullRoomInviteRes.success, false);
  assert.match(fullRoomInviteRes.error ?? "", /full/i);
});

// ============================================================================
// 9. Private Watch Together room activity feed protection
// ============================================================================
test("9. Private Watch Together room activity feed protection: hides private rooms from uninvited friends and masks title for invited friends", async () => {
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_host", username: "host_alice", display_name: "Alice Host" },
      { id: "user_uninvited", username: "uninvited_bob", display_name: "Uninvited Bob" },
      { id: "user_invited", username: "invited_cara", display_name: "Invited Cara" },
    ],
    friendships: [
      { id: "f1", requester_id: "user_host", addressee_id: "user_uninvited", status: "accepted" },
      { id: "f2", requester_id: "user_host", addressee_id: "user_invited", status: "accepted" },
    ],
    anime_comments: [
      {
        id: "room_private_1",
        user_id: "user_host",
        anime_id: "watch_room",
        parent_comment_id: null,
        body: makeWatchRoomPayload({
          privacy: "private",
          roomTitle: "Top Secret Private Room",
          description: "Private notes",
        }),
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
  });

  await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_private_1",
    inviteeUserId: "user_invited",
    nowMs: NOW_MS,
  });

  // Uninvited friend NEVER sees the private room in their Friend Activity Feed
  const uninvitedFeed = await getFriendActivityFeedWithClient(supabase, {
    viewerId: "user_uninvited",
    nowMs: NOW_MS,
  });
  assert.equal(uninvitedFeed.items.length, 0);

  // Invited friend sees the room in their Friend Activity Feed, but custom title & description are masked
  const invitedFeed = await getFriendActivityFeedWithClient(supabase, {
    viewerId: "user_invited",
    nowMs: NOW_MS,
  });
  assert.equal(invitedFeed.items.length, 1);
  assert.equal(invitedFeed.items[0].activityType, "watch_room_active");
  assert.equal(invitedFeed.items[0].title, "Private Watch Together Room");
  assert.equal(invitedFeed.items[0].excerpt, null);
});

// ============================================================================
// 10. Notification security, opt-out preference, and deduplication
// ============================================================================
test("10. Notification security & deduplication: respects notify_watch_together_invites = false and deduplicates re-invites after decline", async () => {
  const supabase = createMockStage4Supabase({
    profiles: [
      { id: "user_host", username: "host_alice", display_name: "Alice Host" },
      {
        id: "user_optout",
        username: "quiet_dave",
        display_name: "Quiet Dave",
        notify_watch_together_invites: false,
      },
      {
        id: "user_optin",
        username: "eager_erin",
        display_name: "Eager Erin",
        notify_watch_together_invites: true,
      },
    ],
    friendships: [
      { id: "f1", requester_id: "user_host", addressee_id: "user_optout", status: "accepted" },
      { id: "f2", requester_id: "user_host", addressee_id: "user_optin", status: "accepted" },
    ],
    anime_comments: [
      {
        id: "room_notif",
        user_id: "user_host",
        anime_id: "watch_room",
        parent_comment_id: null,
        body: makeWatchRoomPayload(),
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
  });

  // Friend with notify_watch_together_invites = false receives the invitation row, but NO notification row is created
  const optOutRes = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_notif",
    inviteeUserId: "user_optout",
    nowMs: NOW_MS,
  });
  assert.equal(optOutRes.success, true);
  assert.equal(
    supabase.state.user_notifications.filter((n) => n.user_id === "user_optout")
      .length,
    0
  );

  // Friend with notify_watch_together_invites = true receives 1 notification; declining and re-inviting reuses the same dedupe_key
  const firstOptIn = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_notif",
    inviteeUserId: "user_optin",
    nowMs: NOW_MS,
  });
  assert.equal(firstOptIn.success, true);
  await declineWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_optin",
    invitationId: firstOptIn.invitationId,
    nowMs: NOW_MS,
  });

  const secondOptIn = await sendWatchRoomInvitationWithClient(supabase, {
    viewerId: "user_host",
    roomId: "room_notif",
    inviteeUserId: "user_optin",
    nowMs: NOW_MS + 5000,
  });
  assert.equal(secondOptIn.success, true);
  const erinNotifs = supabase.state.user_notifications.filter(
    (n) => n.user_id === "user_optin"
  );
  assert.equal(erinNotifs.length, 1);
  assert.equal(
    erinNotifs[0].dedupe_key,
    "watch_room_invite_received:room_notif:user_optin"
  );
});

// ============================================================================
// 11. Live Remote Supabase Stage 3 & Stage 4 RLS & RPC Privilege Verification
// ============================================================================
test("11. Live Supabase Database Verification: Stage 3 & Stage 4 tables, columns, RLS policies, and SECURITY DEFINER RPC revocations", async () => {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [
        l.slice(0, l.indexOf("=")).trim(),
        l
          .slice(l.indexOf("=") + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ""),
      ])
  );

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const anon = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const fakeU1 = "00000000-0000-0000-0000-000000000001";
  const fakeU2 = "00000000-0000-0000-0000-000000000002";

  // 11a. Stage 4 profile privacy columns exist on remote DB
  const { error: profColErr } = await anon
    .from("profiles")
    .select(
      "id, share_activity_with_friends, share_library_activity_with_friends, notify_watch_together_invites"
    )
    .limit(1);
  assert.equal(
    profColErr,
    null,
    "Expected Stage 4 privacy columns to exist on remote public.profiles"
  );

  // 11b. Anonymous SELECT on friendships, user_notifications, watch_room_invitations returns 0 rows
  const [fSel, nSel, wSel] = await Promise.all([
    anon.from("friendships").select("*"),
    anon.from("user_notifications").select("*"),
    anon.from("watch_room_invitations").select("*"),
  ]);
  assert.equal(fSel.error, null);
  assert.deepEqual(fSel.data, []);
  assert.equal(nSel.error, null);
  assert.deepEqual(nSel.data, []);
  assert.equal(wSel.error, null);
  assert.deepEqual(wSel.data, []);

  // 11c. Anonymous INSERT on friendships, user_notifications, watch_room_invitations is rejected by RLS
  const [fIns, nIns, wIns] = await Promise.all([
    anon.from("friendships").insert({
      requester_id: fakeU1,
      addressee_id: fakeU2,
      status: "pending",
    }),
    anon.from("user_notifications").insert({
      user_id: fakeU1,
      actor_id: fakeU2,
      notification_type: "friend_request_received",
      dedupe_key: "spoof:1",
      title: "Spoofed notification",
    }),
    anon.from("watch_room_invitations").insert({
      room_id: fakeU1,
      host_id: fakeU1,
      invitee_id: fakeU2,
      status: "pending",
      room_title_snapshot: "Spoof Room",
      anime_external_id: "154587",
      anime_title: "Frieren",
      episode_number: 1,
      room_privacy: "public",
    }),
  ]);
  assert.ok(fIns.error, "Anonymous insert into friendships must be rejected");
  assert.ok(
    nIns.error,
    "Anonymous insert into user_notifications must be rejected"
  );
  assert.ok(
    wIns.error,
    "Anonymous insert into watch_room_invitations must be rejected"
  );

  // 11d. Anonymous execution of all Stage 3, 3.1, and 4 SECURITY DEFINER RPCs is denied (42501)
  const rpcResults = await Promise.all([
    anon.rpc("can_access_friend_pair_realtime_topic", {
      topic_text: `nayozu:friend-pair:${fakeU1}:${fakeU2}`,
    }),
    anon.rpc("create_verified_friend_notification", {
      target_user_id: fakeU2,
      notif_type: "friend_request_received",
    }),
    anon.rpc("are_users_friends", { user_a: fakeU1, user_b: fakeU2 }),
    anon.rpc("get_bidirectional_blocked_user_ids"),
    anon.rpc("get_permitted_friend_library_activities", { p_limit: 5 }),
    anon.rpc("is_valid_host_watch_room_for_invite", {
      p_room_id: fakeU1,
      p_host_id: fakeU2,
    }),
  ]);

  for (const res of rpcResults) {
    assert.ok(res.error, "Anonymous execution of privileged RPC must fail");
    assert.equal(res.error.code, "42501");
  }
});


