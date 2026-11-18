import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  acceptFriendRequestWithClient,
  buildCanonicalFriendshipPair,
  canAccessFriendPairRealtimeTopic,
  canBroadcastFriendPairPresence,
  canBroadcastPublicPresence,
  cancelFriendRequestWithClient,
  cleanupFriendshipBetweenUsersWithClient,
  declineFriendRequestWithClient,
  filterFriendPairPresenceState,
  filterPublicPresenceState,
  getFriendsOverviewWithClient,
  isUserOnlineForViewer,
  removeFriendWithClient,
  resolveFriendshipStatusForViewer,
  searchUsersForFriendsWithClient,
  sendFriendRequestWithClient,
  upsertFriendNotificationWithClient,
  validateFriendshipRowUpdateImmutability,
} from "../lib/friends/friendsService.ts";

/**
 * In-memory relational mock of Supabase tables (`profiles`, `friendships`, `user_blocks`,
 * `user_restrictions`, `user_notifications`) with canonical pair uniqueness and filter chains.
 */
function createMockSocialSupabase(seed = {}) {
  let idCounter = 100;
  const state = {
    profiles: (seed.profiles ?? []).map((p) => ({
      profile_visibility: "public",
      bio: null,
      avatar_url: null,
      created_at: "2026-11-12T10:00:00.000Z",
      ...p,
    })),
    friendships: (seed.friendships ?? []).map((f) => ({ ...f })),
    user_blocks: (seed.user_blocks ?? []).map((b) => ({ ...b })),
    user_restrictions: (seed.user_restrictions ?? []).map((r) => ({ ...r })),
    user_notifications: (seed.user_notifications ?? []).map((n) => ({ ...n })),
  };

  function parseOrCondition(row, orExpr, tableName) {
    if (tableName === "profiles" && orExpr.includes(".ilike.")) {
      // e.g. username.ilike.%alice%,display_name.ilike.%alice%
      const parts = orExpr.split(",");
      return parts.some((part) => {
        const [col, , rawVal] = part.split(".");
        const needle = String(rawVal ?? "")
          .replace(/^%|%$/g, "")
          .replace(/\\(.)/g, "$1")
          .toLowerCase();
        return String(row[col] ?? "")
          .toLowerCase()
          .includes(needle);
      });
    }

    if (orExpr.startsWith("and(")) {
      // e.g. and(requester_id.eq.u1,addressee_id.eq.u2),and(requester_id.eq.u2,addressee_id.eq.u1)
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

    // e.g. requester_id.eq.u1,addressee_id.eq.u1
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
          if (tableName === "friendships") {
            if (item.requester_id === item.addressee_id) {
              return {
                data: null,
                error: { code: "23514", message: "Self friendship not allowed" },
              };
            }
            const pair = buildCanonicalFriendshipPair(
              item.requester_id,
              item.addressee_id
            );
            const duplicate = table.find((existing) => {
              const ep = buildCanonicalFriendshipPair(
                existing.requester_id,
                existing.addressee_id
              );
              return ep.pairKey === pair.pairKey;
            });
            if (duplicate) {
              return {
                data: null,
                error: { code: "23505", message: "Unique pair violation" },
              };
            }
          }
          const created = {
            id: item.id || `${tableName}_${++idCounter}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            responded_at: null,
            ...item,
          };
          table.push(created);
          inserted.push(created);
        }
        const out = wantMaybeSingle ? inserted[0] ?? null : inserted;
        return { data: out, error: null };
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
                created_at: new Date().toISOString(),
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
      in(col, vals) {
        const set = new Set(vals);
        predicates.push((row) => set.has(row[col]));
        return builder;
      },
      or(expr) {
        predicates.push((row) => parseOrCondition(row, expr, tableName));
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
      if (fnName === "get_bidirectional_blocked_user_ids") {
        return { data: null, error: { message: "Use table fallback in mock" } };
      }
      return { data: null, error: null };
    },
  };
}

// ============================================================================
// 1. Self friend request prevention
// ============================================================================
test("1. Self friend request prevention: rejects sending a friend request to oneself", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [{ id: "user_a", username: "alice", display_name: "Alice" }],
  });

  const res = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_a",
  });

  assert.equal(res.success, false);
  assert.equal(res.status, "self");
  assert.match(res.error ?? "", /yourself/i);
  assert.equal(supabase.state.friendships.length, 0);
});

// ============================================================================
// 2. Duplicate friend request prevention
// ============================================================================
test("2. Duplicate friend request prevention: prevents duplicate pending outgoing requests", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
  });

  const first = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });
  assert.equal(first.success, true);
  assert.equal(first.status, "pending_outgoing");
  assert.equal(supabase.state.friendships.length, 1);

  const duplicate = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.status, "pending_outgoing");
  assert.match(duplicate.error ?? "", /already pending/i);
  assert.equal(supabase.state.friendships.length, 1);
});

// ============================================================================
// 3. Reverse pending request handling
// ============================================================================
test("3. Reverse pending request handling: when B already requested A, A requesting B auto-accepts the mutual friendship", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
  });

  await sendFriendRequestWithClient(supabase, {
    viewerId: "user_b",
    targetUserId: "user_a",
  });
  assert.equal(supabase.state.friendships.length, 1);
  assert.equal(supabase.state.friendships[0].status, "pending");

  const reverseRes = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });
  assert.equal(reverseRes.success, true);
  assert.equal(reverseRes.status, "friends");
  assert.equal(reverseRes.autoAccepted, true);
  assert.equal(supabase.state.friendships.length, 1);
  assert.equal(supabase.state.friendships[0].status, "accepted");
  assert.ok(supabase.state.friendships[0].responded_at);
});

// ============================================================================
// 4. Accepting a valid incoming request
// ============================================================================
test("4. Accepting a valid incoming request: addressee accepts pending request and both become friends", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
  });

  const sent = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });
  assert.equal(sent.success, true);

  const accepted = await acceptFriendRequestWithClient(supabase, {
    viewerId: "user_b",
    friendshipId: sent.friendshipId,
  });
  assert.equal(accepted.success, true);
  assert.equal(accepted.status, "friends");
  assert.equal(supabase.state.friendships[0].status, "accepted");
  assert.ok(supabase.state.friendships[0].responded_at);
  assert.equal(
    resolveFriendshipStatusForViewer({
      viewerId: "user_a",
      targetUserId: "user_b",
      row: supabase.state.friendships[0],
    }),
    "friends"
  );
});

// ============================================================================
// 5. Rejecting unauthorized request acceptance
// ============================================================================
test("5. Rejecting unauthorized request acceptance: requester or third party cannot accept a pending request", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
      { id: "user_c", username: "charlie", display_name: "Charlie" },
    ],
  });

  const sent = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });

  // Sender tries to accept their own outgoing request
  const selfAccept = await acceptFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    friendshipId: sent.friendshipId,
  });
  assert.equal(selfAccept.success, false);
  assert.equal(selfAccept.status, "pending_outgoing");
  assert.match(selfAccept.error ?? "", /recipient/i);

  // Third party tries to accept A -> B request
  const thirdPartyAccept = await acceptFriendRequestWithClient(supabase, {
    viewerId: "user_c",
    friendshipId: sent.friendshipId,
  });
  assert.equal(thirdPartyAccept.success, false);
  assert.match(thirdPartyAccept.error ?? "", /not authorized/i);

  assert.equal(supabase.state.friendships[0].status, "pending");
});

// ============================================================================
// 6. Declining an incoming request
// ============================================================================
test("6. Declining an incoming request: addressee declines and removes pending row", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
  });

  const sent = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });

  // Requester cannot call decline (must use cancel)
  const wrongCaller = await declineFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    friendshipId: sent.friendshipId,
  });
  assert.equal(wrongCaller.success, false);
  assert.equal(supabase.state.friendships.length, 1);

  // Addressee declines
  const declined = await declineFriendRequestWithClient(supabase, {
    viewerId: "user_b",
    friendshipId: sent.friendshipId,
  });
  assert.equal(declined.success, true);
  assert.equal(declined.status, "none");
  assert.equal(supabase.state.friendships.length, 0);
});

// ============================================================================
// 7. Cancelling an outgoing request
// ============================================================================
test("7. Cancelling an outgoing request: requester cancels pending request and cleans up notification", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
  });

  const sent = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });
  assert.equal(supabase.state.user_notifications.length, 1);

  // Addressee cannot call cancel
  const wrongCaller = await cancelFriendRequestWithClient(supabase, {
    viewerId: "user_b",
    friendshipId: sent.friendshipId,
  });
  assert.equal(wrongCaller.success, false);

  // Requester cancels
  const cancelled = await cancelFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    friendshipId: sent.friendshipId,
  });
  assert.equal(cancelled.success, true);
  assert.equal(cancelled.status, "none");
  assert.equal(supabase.state.friendships.length, 0);
  assert.equal(supabase.state.user_notifications.length, 0);
});

// ============================================================================
// 8. Removing an existing friend
// ============================================================================
test("8. Removing an existing friend: either participant can remove an accepted friendship and both views update", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
    friendships: [
      {
        id: "f_1",
        requester_id: "user_a",
        addressee_id: "user_b",
        status: "accepted",
        created_at: "2026-11-12T10:00:00.000Z",
        updated_at: "2026-11-12T10:05:00.000Z",
        responded_at: "2026-11-12T10:05:00.000Z",
      },
    ],
  });

  const removeRes = await removeFriendWithClient(supabase, {
    viewerId: "user_b",
    friendUserId: "user_a",
  });
  assert.equal(removeRes.success, true);
  assert.equal(removeRes.status, "none");

  const overviewA = await getFriendsOverviewWithClient(supabase, "user_a");
  const overviewB = await getFriendsOverviewWithClient(supabase, "user_b");
  assert.equal(overviewA.data.friends.length, 0);
  assert.equal(overviewB.data.friends.length, 0);
});

// ============================================================================
// 9. Blocking removes/prevents friendships and requests
// ============================================================================
test("9. Blocking removes existing friendships/requests and prevents new friend actions in both directions", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
    friendships: [
      {
        id: "f_1",
        requester_id: "user_a",
        addressee_id: "user_b",
        status: "accepted",
        created_at: "2026-11-12T10:00:00.000Z",
        updated_at: "2026-11-12T10:05:00.000Z",
        responded_at: "2026-11-12T10:05:00.000Z",
      },
    ],
  });

  // User A blocks User B
  supabase.state.user_blocks.push({
    id: "blk_1",
    blocker_id: "user_a",
    blocked_id: "user_b",
  });
  await cleanupFriendshipBetweenUsersWithClient(supabase, "user_a", "user_b");

  assert.equal(supabase.state.friendships.length, 0);

  // Neither A->B nor B->A can send a friend request while blocked
  const aToB = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });
  assert.equal(aToB.success, false);
  assert.equal(aToB.status, "blocked");

  const bToA = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_b",
    targetUserId: "user_a",
  });
  assert.equal(bToA.success, false);
  assert.equal(bToA.status, "blocked");
});

// ============================================================================
// 10. Private profile search restrictions
// ============================================================================
test("10. Private profile search restrictions: excludes stranger private profiles and never exposes private bio/emails", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      {
        id: "user_viewer",
        username: "viewer",
        display_name: "Viewer",
        profile_visibility: "public",
      },
      {
        id: "user_pub",
        username: "tanjiro_public",
        display_name: "Tanjiro Public",
        bio: "Public demon slayer bio",
        profile_visibility: "public",
      },
      {
        id: "user_priv_stranger",
        username: "tanjiro_private",
        display_name: "Tanjiro Secret",
        bio: "Secret private bio",
        profile_visibility: "private",
      },
      {
        id: "user_priv_connected",
        username: "tanjiro_friend_priv",
        display_name: "Tanjiro Friend Secret",
        bio: "Private bio not leaked in search",
        profile_visibility: "private",
      },
    ],
    friendships: [
      {
        id: "f_conn",
        requester_id: "user_priv_connected",
        addressee_id: "user_viewer",
        status: "pending",
        created_at: "2026-11-12T10:00:00.000Z",
        updated_at: "2026-11-12T10:00:00.000Z",
        responded_at: null,
      },
    ],
  });

  const searchRes = await searchUsersForFriendsWithClient(supabase, {
    viewerId: "user_viewer",
    query: "tanjiro",
  });

  assert.equal(searchRes.success, true);
  const foundIds = searchRes.results.map((r) => r.id);

  // Public user is found
  assert.ok(foundIds.includes("user_pub"));
  // Stranger private user is excluded from discovery search
  assert.ok(!foundIds.includes("user_priv_stranger"));
  // Already-connected private user is visible by username, but private bio is redacted
  const connectedEntry = searchRes.results.find(
    (r) => r.id === "user_priv_connected"
  );
  assert.ok(connectedEntry);
  assert.equal(connectedEntry.bio, null);
  assert.equal("email" in connectedEntry, false);
});

// ============================================================================
// 11. Restricted user friend request prevention
// ============================================================================
test("11. Restricted user friend request prevention: suspended accounts cannot send or accept friend requests", async () => {
  const futureIso = new Date(Date.now() + 86400_000).toISOString();
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_suspended", username: "badactor", display_name: "Bad Actor" },
      { id: "user_normal", username: "gooduser", display_name: "Good User" },
    ],
    user_restrictions: [
      {
        id: "rest_1",
        user_id: "user_suspended",
        status: "active",
        restriction_type: "suspension",
        restricted_until: futureIso,
        reason: "Harassment",
      },
    ],
  });

  const sendAttempt = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_suspended",
    targetUserId: "user_normal",
  });
  assert.equal(sendAttempt.success, false);
  assert.match(sendAttempt.error ?? "", /suspended/i);

  // Normal user also cannot send request to actively suspended user
  const toSuspendedAttempt = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_normal",
    targetUserId: "user_suspended",
  });
  assert.equal(toSuspendedAttempt.success, false);
  assert.match(toSuspendedAttempt.error ?? "", /cannot receive/i);
});

// ============================================================================
// 12. Friends Online drawer list filtering
// ============================================================================
test("12. Friends Online drawer list filtering: includes only accepted friends, separating pending requests", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_me", username: "me", display_name: "Me" },
      { id: "user_friend", username: "friend1", display_name: "Friend One" },
      { id: "user_incoming", username: "inc1", display_name: "Incoming One" },
      { id: "user_outgoing", username: "out1", display_name: "Outgoing One" },
    ],
    friendships: [
      {
        id: "f_accepted",
        requester_id: "user_me",
        addressee_id: "user_friend",
        status: "accepted",
        created_at: "2026-11-12T10:00:00.000Z",
        updated_at: "2026-11-12T10:05:00.000Z",
        responded_at: "2026-11-12T10:05:00.000Z",
      },
      {
        id: "f_in",
        requester_id: "user_incoming",
        addressee_id: "user_me",
        status: "pending",
        created_at: "2026-11-12T10:10:00.000Z",
        updated_at: "2026-11-12T10:10:00.000Z",
        responded_at: null,
      },
      {
        id: "f_out",
        requester_id: "user_me",
        addressee_id: "user_outgoing",
        status: "pending",
        created_at: "2026-11-12T10:15:00.000Z",
        updated_at: "2026-11-12T10:15:00.000Z",
        responded_at: null,
      },
    ],
  });

  const overview = await getFriendsOverviewWithClient(supabase, "user_me");
  assert.equal(overview.success, true);
  assert.deepEqual(
    overview.data.friends.map((f) => f.id),
    ["user_friend"]
  );
  assert.deepEqual(
    overview.data.incomingRequests.map((f) => f.id),
    ["user_incoming"]
  );
  assert.deepEqual(
    overview.data.outgoingRequests.map((f) => f.id),
    ["user_outgoing"]
  );
});

// ============================================================================
// 13. Blocked user exclusion from Friends Online and search
// ============================================================================
test("13. Blocked user exclusion: bidirectional blocks exclude users from Friends overview, search, and presence", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_me", username: "me", display_name: "Me" },
      { id: "user_blocked_by_me", username: " target_a", display_name: "Target A" },
      { id: "user_blocked_me", username: "target_b", display_name: "Target B" },
      { id: "user_clean", username: "target_clean", display_name: "Target Clean" },
    ],
    user_blocks: [
      { id: "b1", blocker_id: "user_me", blocked_id: "user_blocked_by_me" },
      { id: "b2", blocker_id: "user_blocked_me", blocked_id: "user_me" },
    ],
    friendships: [
      {
        id: "f_stale",
        requester_id: "user_me",
        addressee_id: "user_blocked_me",
        status: "accepted",
        created_at: "2026-11-12T10:00:00.000Z",
        updated_at: "2026-11-12T10:00:00.000Z",
        responded_at: "2026-11-12T10:00:00.000Z",
      },
    ],
  });

  const searchRes = await searchUsersForFriendsWithClient(supabase, {
    viewerId: "user_me",
    query: "target",
  });
  assert.deepEqual(
    searchRes.results.map((r) => r.id),
    ["user_clean"]
  );

  const overview = await getFriendsOverviewWithClient(supabase, "user_me");
  assert.equal(overview.data.friends.length, 0);
});

// ============================================================================
// 14. Presence privacy for private profiles
// ============================================================================
test("14. Presence privacy for private profiles: private users never broadcast on public channel, visible only to accepted friends", () => {
  const user = { id: "user_priv" };
  assert.equal(
    canBroadcastPublicPresence(user, {
      id: "user_priv",
      profileVisibility: "private",
    }),
    false
  );
  assert.equal(
    canBroadcastPublicPresence(user, {
      id: "user_priv",
      profileVisibility: "public",
    }),
    true
  );

  const publicOnlineMap = filterPublicPresenceState({
    key1: [
      {
        userId: "user_priv",
        username: "secret",
        displayName: "Secret",
        isPublicProfile: false,
      },
    ],
  });
  assert.equal(publicOnlineMap.has("user_priv"), false);

  const friendOnlineIds = filterFriendPairPresenceState(
    {
      pair1: [{ userId: "user_priv", onlineAt: "2026-11-12T12:00:00.000Z" }],
    },
    {
      viewerId: "user_friend",
      acceptedFriendIds: new Set(["user_priv"]),
      blockedSet: new Set(),
    }
  );

  // Stranger cannot see private user's online status
  assert.equal(
    isUserOnlineForViewer({
      viewerId: "user_stranger",
      targetUserId: "user_priv",
      targetProfileVisibility: "private",
      isAcceptedFriend: false,
      isBlocked: false,
      publicOnlineMap,
      friendOnlineIds: new Set(),
    }),
    false
  );

  // Accepted friend CAN see private friend's online status via friend-pair channel
  assert.equal(
    isUserOnlineForViewer({
      viewerId: "user_friend",
      targetUserId: "user_priv",
      targetProfileVisibility: "private",
      isAcceptedFriend: true,
      isBlocked: false,
      publicOnlineMap,
      friendOnlineIds,
    }),
    true
  );
});

// ============================================================================
// 15. Guest presence restriction
// ============================================================================
test("15. Guest presence restriction: guests cannot broadcast presence or receive private friend presence", () => {
  assert.equal(
    canBroadcastPublicPresence(null, {
      id: "user_1",
      profileVisibility: "public",
    }),
    false
  );
  assert.equal(
    canBroadcastFriendPairPresence(null, "user_2", {
      acceptedFriendIds: new Set(["user_2"]),
    }),
    false
  );

  const guestFriendOnlineSet = filterFriendPairPresenceState(
    {
      pair1: [{ userId: "user_2", onlineAt: "2026-11-12T12:00:00.000Z" }],
    },
    {
      viewerId: null,
      acceptedFriendIds: new Set(["user_2"]),
    }
  );
  assert.equal(guestFriendOnlineSet.size, 0);

  assert.equal(
    isUserOnlineForViewer({
      viewerId: null,
      targetUserId: "user_2",
      targetProfileVisibility: "private",
      isAcceptedFriend: true,
      isBlocked: false,
      publicOnlineMap: new Map(),
      friendOnlineIds: new Set(["user_2"]),
    }),
    false
  );
});

// ============================================================================
// 16. Multi-tab presence deduplication
// ============================================================================
test("16. Multi-tab presence deduplication: deduplicates multiple tabs for the same user into a single entry", () => {
  const publicMap = filterPublicPresenceState({
    "user_1:tab-a": [
      {
        userId: "user_1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        isPublicProfile: true,
        onlineAt: "2026-11-12T12:00:00.000Z",
      },
    ],
    "user_1:tab-b": [
      {
        userId: "user_1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        isPublicProfile: true,
        onlineAt: "2026-11-12T12:05:00.000Z",
      },
    ],
  });

  assert.equal(publicMap.size, 1);
  assert.equal(
    publicMap.get("user_1")?.onlineAt,
    "2026-11-12T12:05:00.000Z"
  );

  const friendSet = filterFriendPairPresenceState(
    {
      "user_1:tab-a": [{ userId: "user_1" }],
      "user_1:tab-b": [{ userId: "user_1" }],
    },
    {
      viewerId: "user_2",
      acceptedFriendIds: new Set(["user_1"]),
    }
  );
  assert.equal(friendSet.size, 1);
  assert.equal(friendSet.has("user_1"), true);
});

// ============================================================================
// 17. Notification creation for friend requests
// ============================================================================
test("17. Notification creation for friend requests: creates incoming request and accepted notifications with sender and link", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
  });

  const sent = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });
  assert.equal(sent.success, true);

  const bobOverview = await getFriendsOverviewWithClient(supabase, "user_b");
  assert.equal(bobOverview.data.notifications.length, 1);
  assert.equal(
    bobOverview.data.notifications[0].notificationType,
    "friend_request_received"
  );
  assert.equal(bobOverview.data.notifications[0].actorId, "user_a");
  assert.equal(
    bobOverview.data.notifications[0].linkUrl,
    "/profile?tab=friends&subtab=incoming"
  );
  assert.equal(bobOverview.data.unreadNotificationCount, 1);

  const accepted = await acceptFriendRequestWithClient(supabase, {
    viewerId: "user_b",
    friendshipId: sent.friendshipId,
  });
  assert.equal(accepted.success, true);

  const aliceOverview = await getFriendsOverviewWithClient(supabase, "user_a");
  assert.equal(aliceOverview.data.notifications.length, 1);
  assert.equal(
    aliceOverview.data.notifications[0].notificationType,
    "friend_request_accepted"
  );
  assert.equal(aliceOverview.data.notifications[0].actorId, "user_b");
  assert.equal(
    aliceOverview.data.notifications[0].linkUrl,
    "/profile?tab=friends&subtab=friends"
  );
});

// ============================================================================
// 18. Duplicate notification prevention
// ============================================================================
test("18. Duplicate notification prevention: repeated notification upserts for the same event do not create duplicates", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
    friendships: [
      {
        id: "f_pending_ab",
        requester_id: "user_a",
        addressee_id: "user_b",
        status: "pending",
        created_at: "2026-11-12T10:00:00.000Z",
        updated_at: "2026-11-12T10:00:00.000Z",
        responded_at: null,
      },
    ],
  });

  await upsertFriendNotificationWithClient(supabase, {
    recipientUserId: "user_b",
    actorUserId: "user_a",
    actorDisplayName: "Alice",
    notificationType: "friend_request_received",
  });
  await upsertFriendNotificationWithClient(supabase, {
    recipientUserId: "user_b",
    actorUserId: "user_a",
    actorDisplayName: "Alice",
    notificationType: "friend_request_received",
  });

  assert.equal(supabase.state.user_notifications.length, 1);
  assert.equal(
    supabase.state.user_notifications[0].dedupe_key,
    "friend_request_received:user_a:user_b"
  );
});

// ============================================================================
// 19. Stage 3.1 — Private Realtime Channel Security (3-Account + Guest Matrix)
// ============================================================================
test("19. Private Realtime channel security: enforces accepted pair membership, blocks non-friends & guests, and configures private channel", () => {
  const userA = "6bc3e4ea-3733-4ae3-a644-8dded83eb99e";
  const userB = "d5b84e8e-5bed-4887-b36a-aaa6f978258c";
  const userC = "e7368050-5c79-49e4-92a2-5ab60b18bf7a";
  const topic = `nayozu:friend-pair:${userA}:${userB}`;
  const acceptedRow = {
    requester_id: userA,
    addressee_id: userB,
    status: "accepted",
  };

  // 1. User A and User B (accepted friends) can access the pair channel
  assert.equal(
    canAccessFriendPairRealtimeTopic({
      callerId: userA,
      topic,
      friendshipRow: acceptedRow,
    }),
    true
  );
  assert.equal(
    canAccessFriendPairRealtimeTopic({
      callerId: userB,
      topic,
      friendshipRow: acceptedRow,
    }),
    true
  );

  // 2. User C (authenticated third party) is denied even if an accepted A-B friendship exists
  assert.equal(
    canAccessFriendPairRealtimeTopic({
      callerId: userC,
      topic,
      friendshipRow: acceptedRow,
    }),
    false
  );

  // 3. Guest (null caller) is denied
  assert.equal(
    canAccessFriendPairRealtimeTopic({
      callerId: null,
      topic,
      friendshipRow: acceptedRow,
    }),
    false
  );

  // 4. Pending friendship is denied
  assert.equal(
    canAccessFriendPairRealtimeTopic({
      callerId: userA,
      topic,
      friendshipRow: { ...acceptedRow, status: "pending" },
    }),
    false
  );

  // 5. Removed / non-existent friendship is denied
  assert.equal(
    canAccessFriendPairRealtimeTopic({
      callerId: userA,
      topic,
      friendshipRow: null,
    }),
    false
  );

  // 6. Blocked relationship immediately denies access
  assert.equal(
    canAccessFriendPairRealtimeTopic({
      callerId: userA,
      topic,
      isBlockedBetweenPair: true,
      friendshipRow: acceptedRow,
    }),
    false
  );

  // 7. Non-canonical topic order (high:low instead of low:high) is rejected
  assert.equal(
    canAccessFriendPairRealtimeTopic({
      callerId: userA,
      topic: `nayozu:friend-pair:${userB}:${userA}`,
      friendshipRow: acceptedRow,
    }),
    false
  );

  // 8. Verify ShellProvider configures private: true and SQL migration defines realtime.messages RLS
  const shellSource = fs.readFileSync(
    path.resolve(process.cwd(), "components/shell-context.tsx"),
    "utf8"
  );
  assert.match(shellSource, /private:\s*true/);

  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20261112010000_stage3_friendships_and_notifications.sql"
    ),
    "utf8"
  );
  assert.match(migrationSql, /can_access_friend_pair_realtime_topic/);
  assert.match(migrationSql, /realtime_messages_select_friend_pair/);
  assert.match(migrationSql, /realtime_messages_insert_friend_pair/);
});

// ============================================================================
// 20. Stage 3.1 — Notification Insertion & Mutation Security
// ============================================================================
test("20. Notification insertion security: rejects fabricated notifications without a matching friendship and removes direct client insert policy", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
  });

  // 1. Fabricated friend_request_received when no pending friendship exists -> rejected
  await upsertFriendNotificationWithClient(supabase, {
    recipientUserId: "user_b",
    actorUserId: "user_a",
    actorDisplayName: "Fake Phishing Title",
    notificationType: "friend_request_received",
  });
  assert.equal(supabase.state.user_notifications.length, 0);

  // 2. Fabricated friend_request_accepted when no accepted friendship exists -> rejected
  await upsertFriendNotificationWithClient(supabase, {
    recipientUserId: "user_a",
    actorUserId: "user_b",
    actorDisplayName: "Fake Phishing Acceptance",
    notificationType: "friend_request_accepted",
  });
  assert.equal(supabase.state.user_notifications.length, 0);

  // 3. Verify SQL migration drops user_notifications_insert_actor and uses triggers + verified RPC
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20261112010000_stage3_friendships_and_notifications.sql"
    ),
    "utf8"
  );
  assert.match(
    migrationSql,
    /drop policy if exists "user_notifications_insert_actor" on public\.user_notifications/i
  );
  assert.doesNotMatch(
    migrationSql,
    /create policy "user_notifications_insert_actor"/i
  );
  assert.match(migrationSql, /sync_friend_notifications_on_friendship_change/);
  assert.match(migrationSql, /create_verified_friend_notification/);
  assert.match(migrationSql, /enforce_user_notification_update_immutability/);
});

// ============================================================================
// 21. Stage 3.1 — Friendship Row Immutability
// ============================================================================
test("21. Friendship row immutability: addressee can only transition pending -> accepted and cannot mutate participant IDs or created_at", () => {
  const oldPendingRow = {
    id: "f_1",
    requester_id: "6bc3e4ea-3733-4ae3-a644-8dded83eb99e",
    addressee_id: "d5b84e8e-5bed-4887-b36a-aaa6f978258c",
    pair_user_low: "6bc3e4ea-3733-4ae3-a644-8dded83eb99e",
    pair_user_high: "d5b84e8e-5bed-4887-b36a-aaa6f978258c",
    status: "pending",
    created_at: "2026-11-12T10:00:00.000Z",
    updated_at: "2026-11-12T10:00:00.000Z",
    responded_at: null,
  };

  // 1. Valid transition: intended addressee accepts pending request
  const validAccept = validateFriendshipRowUpdateImmutability({
    callerId: oldPendingRow.addressee_id,
    oldRow: oldPendingRow,
    newRow: {
      ...oldPendingRow,
      status: "accepted",
    },
  });
  assert.equal(validAccept.valid, true);

  // 2. Addressee attempting to mutate requester_id -> rejected
  const mutatedRequester = validateFriendshipRowUpdateImmutability({
    callerId: oldPendingRow.addressee_id,
    oldRow: oldPendingRow,
    newRow: {
      ...oldPendingRow,
      requester_id: "e7368050-5c79-49e4-92a2-5ab60b18bf7a",
      status: "accepted",
    },
  });
  assert.equal(mutatedRequester.valid, false);
  assert.match(mutatedRequester.error ?? "", /requester_id is immutable/i);

  // 3. Addressee attempting to mutate addressee_id -> rejected
  const mutatedAddressee = validateFriendshipRowUpdateImmutability({
    callerId: oldPendingRow.addressee_id,
    oldRow: oldPendingRow,
    newRow: {
      ...oldPendingRow,
      addressee_id: "e7368050-5c79-49e4-92a2-5ab60b18bf7a",
      status: "accepted",
    },
  });
  assert.equal(mutatedAddressee.valid, false);
  assert.match(mutatedAddressee.error ?? "", /addressee_id is immutable/i);

  // 4. Addressee attempting to mutate created_at or id -> rejected
  const mutatedCreatedAt = validateFriendshipRowUpdateImmutability({
    callerId: oldPendingRow.addressee_id,
    oldRow: oldPendingRow,
    newRow: {
      ...oldPendingRow,
      created_at: "2020-01-01T00:00:00.000Z",
      status: "accepted",
    },
  });
  assert.equal(mutatedCreatedAt.valid, false);
  assert.match(mutatedCreatedAt.error ?? "", /created_at is immutable/i);

  // 5. Requester attempting to self-accept -> rejected
  const requesterSelfAccept = validateFriendshipRowUpdateImmutability({
    callerId: oldPendingRow.requester_id,
    oldRow: oldPendingRow,
    newRow: {
      ...oldPendingRow,
      status: "accepted",
    },
  });
  assert.equal(requesterSelfAccept.valid, false);

  // 6. Status reversal (accepted -> pending) -> rejected
  const statusReversal = validateFriendshipRowUpdateImmutability({
    callerId: oldPendingRow.addressee_id,
    oldRow: { ...oldPendingRow, status: "accepted" },
    newRow: { ...oldPendingRow, status: "pending" },
  });
  assert.equal(statusReversal.valid, false);
});

// ============================================================================
// 22. Stage 3.1 — Blocking & Unblocking Cleanup Idempotency
// ============================================================================
test("22. Blocking and unblocking cleanup: deletes friendships and notifications idempotently and unblocking never restores deleted friendships", async () => {
  const supabase = createMockSocialSupabase({
    profiles: [
      { id: "user_a", username: "alice", display_name: "Alice" },
      { id: "user_b", username: "bob", display_name: "Bob" },
    ],
  });

  const sent = await sendFriendRequestWithClient(supabase, {
    viewerId: "user_a",
    targetUserId: "user_b",
  });
  assert.equal(sent.success, true);

  const accepted = await acceptFriendRequestWithClient(supabase, {
    viewerId: "user_b",
    friendshipId: sent.friendshipId,
  });
  assert.equal(accepted.success, true);
  assert.equal(supabase.state.friendships.length, 1);
  assert.ok(supabase.state.user_notifications.length >= 1);
  assert.equal(
    resolveFriendshipStatusForViewer({
      viewerId: "user_a",
      targetUserId: "user_b",
      row: supabase.state.friendships[0] ?? null,
      isBlocked: false,
    }),
    "friends"
  );

  // Simulate block + repeated idempotent cleanup (trigger + application layer)
  supabase.state.user_blocks.push({
    id: "block_ab",
    blocker_id: "user_a",
    blocked_id: "user_b",
  });
  await cleanupFriendshipBetweenUsersWithClient(supabase, "user_a", "user_b");
  await cleanupFriendshipBetweenUsersWithClient(supabase, "user_a", "user_b");

  assert.equal(supabase.state.friendships.length, 0);
  assert.equal(supabase.state.user_notifications.length, 0);

  // Unblock user_b and verify friendship remains deleted ("none") and is not restored
  supabase.state.user_blocks = [];
  const statusAfterUnblock = resolveFriendshipStatusForViewer({
    viewerId: "user_a",
    targetUserId: "user_b",
    row: supabase.state.friendships[0] ?? null,
    isBlocked: false,
  });
  assert.equal(statusAfterUnblock, "none");

  const overviewAfterUnblock = await getFriendsOverviewWithClient(
    supabase,
    "user_a"
  );
  assert.equal(overviewAfterUnblock.data.friends.length, 0);
});
