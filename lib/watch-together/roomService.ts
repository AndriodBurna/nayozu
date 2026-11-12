import type { createClient } from "@/lib/supabase/server";

export type WatchRoomStatus = "live" | "intermission" | "ended";
export type WatchRoomPrivacy = "public" | "private";
export type WatchRoomLifecycleState = "active" | "full" | "ended" | "stale";

/**
 * Active participant presence window (3 minutes).
 * Connected clients send heartbeats every 45 seconds while inside a room.
 */
export const PARTICIPANT_ACTIVE_TTL_MS = 3 * 60 * 1000;

/**
 * Stale / abandoned room expiry policy:
 * - A room is classified as "stale" after 2 hours of complete inactivity across
 *   room creation, host playback/settings updates, host heartbeats, and active
 *   participant presence updates.
 * - Why 2 hours is safe: A standard anime episode is ~24 minutes and a full-length
 *   film is ~90–115 minutes. A temporary host network drop, page reload, or pause
 *   during an episode/intermission will never prematurely expire an active room,
 *   while genuinely abandoned rooms where everyone closed their browser are
 *   automatically excluded.
 */
export const STALE_ROOM_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Maximum time a room can remain open without any host signal/update (6 hours).
 */
export const MAX_ROOM_IDLE_WITHOUT_HOST_MS = 6 * 60 * 60 * 1000;

export interface WatchRoomParticipantSnapshot {
  key: string;
  userId: string | null;
  username: string;
  displayName?: string;
  avatarUrl: string | null;
  isPublicProfile?: boolean;
  role: "host" | "viewer" | "guest";
  lastSeenAt: string;
}

export interface WatchRoomPayload {
  version: 1;
  roomTitle: string;
  description: string | null;
  animeExternalId: string;
  animeSlug: string;
  animeTitle: string;
  animeCover: string | null;
  episodeNumber: number;
  totalEpisodes: number | null;
  language: "sub" | "dub";
  status: WatchRoomStatus;
  privacy: WatchRoomPrivacy;
  accessCodeHash?: string | null;
  maxParticipants: number;
  timerSeconds: number;
  isPlaying: boolean;
  timerUpdatedAt: string;
  lastHeartbeatAt?: string;
  hostPresent?: boolean;
  activeParticipants?: WatchRoomParticipantSnapshot[];
}

export interface WatchRoomPresenceRecord {
  type: "watch_room_presence";
  version: 1;
  status: "active" | "left";
  sessionKey: string;
  lastSeenAt: string;
}

export interface WatchRoomHostProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isPublicProfile: boolean;
}

export interface WatchRoomChatItem {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isPublicProfile: boolean;
  };
}

export interface WatchRoomResolvedDTO {
  id: string;
  isShowcase?: false;
  roomTitle: string;
  description: string | null;
  animeExternalId: string;
  animeSlug: string;
  animeTitle: string;
  animeCover: string | null;
  episodeNumber: number;
  totalEpisodes: number | null;
  language: "sub" | "dub";
  status: "live" | "intermission";
  lifecycleState: "active" | "full";
  isFull: boolean;
  isJoinable: boolean;
  privacy: WatchRoomPrivacy;
  maxParticipants: number;
  participantCount: number;
  participants: WatchRoomParticipantSnapshot[];
  timerSeconds: number;
  isPlaying: boolean;
  timerUpdatedAt: string;
  lastActivityAt: string;
  createdAt: string;
  hostId: string;
  host: WatchRoomHostProfile;
  chatMessages: WatchRoomChatItem[];
}

export interface RawWatchRoomAnimeRow {
  external_id: number;
  slug: string;
  title_romaji: string;
  title_english: string | null;
  cover_image_url: string | null;
  banner_image_url?: string | null;
  episodes: number | null;
  status?: string | null;
  media_type?: string | null;
}

const GENERIC_PLACEHOLDER_TITLES = new Set([
  "anime",
  "untitled",
  "placeholder",
  "unknown anime",
  "test anime",
]);

export function parseWatchRoomPayloadSync(rawBody: string): WatchRoomPayload | null {
  if (!rawBody || typeof rawBody !== "string") return null;
  try {
    const parsed = JSON.parse(rawBody) as Partial<WatchRoomPayload> & {
      type?: string;
    };
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.type === "watch_room_presence") return null;
    if (parsed.version !== 1) return null;

    const cleanRoomTitle = String(parsed.roomTitle ?? "").trim();
    const cleanAnimeExternalId = String(parsed.animeExternalId ?? "").trim();
    if (!cleanRoomTitle || !cleanAnimeExternalId) {
      return null;
    }

    const rawAnimeTitle = String(parsed.animeTitle ?? "").trim();
    const activeParticipants = Array.isArray(parsed.activeParticipants)
      ? parsed.activeParticipants
          .filter(
            (p): p is WatchRoomParticipantSnapshot =>
              Boolean(p && typeof p === "object" && p.key && p.username && p.lastSeenAt)
          )
          .map((p) => ({
            key: String(p.key),
            userId: p.userId ? String(p.userId) : null,
            username: String(p.username),
            displayName: p.displayName ? String(p.displayName) : String(p.username),
            avatarUrl: p.avatarUrl ? String(p.avatarUrl) : null,
            isPublicProfile: p.isPublicProfile === true,
            role:
              p.role === "host"
                ? ("host" as const)
                : p.role === "viewer"
                  ? ("viewer" as const)
                  : ("guest" as const),
            lastSeenAt: String(p.lastSeenAt),
          }))
      : undefined;

    return {
      version: 1,
      roomTitle: cleanRoomTitle,
      description: parsed.description ? String(parsed.description).trim() : null,
      animeExternalId: cleanAnimeExternalId,
      animeSlug: String(parsed.animeSlug ?? "").trim(),
      animeTitle: rawAnimeTitle,
      animeCover: parsed.animeCover ? String(parsed.animeCover).trim() : null,
      episodeNumber: Math.max(Math.floor(Number(parsed.episodeNumber) || 1), 1),
      totalEpisodes:
        parsed.totalEpisodes && Number(parsed.totalEpisodes) > 0
          ? Math.floor(Number(parsed.totalEpisodes))
          : null,
      language: parsed.language === "dub" ? "dub" : "sub",
      status:
        parsed.status === "intermission" || parsed.status === "ended"
          ? parsed.status
          : "live",
      privacy: parsed.privacy === "private" ? "private" : "public",
      accessCodeHash: parsed.accessCodeHash ?? null,
      maxParticipants: Math.min(
        Math.max(Math.floor(Number(parsed.maxParticipants) || 8), 2),
        25
      ),
      timerSeconds: Math.max(Math.floor(Number(parsed.timerSeconds) || 0), 0),
      isPlaying: Boolean(parsed.isPlaying),
      timerUpdatedAt: parsed.timerUpdatedAt || new Date(0).toISOString(),
      lastHeartbeatAt: parsed.lastHeartbeatAt || undefined,
      hostPresent:
        typeof parsed.hostPresent === "boolean" ? parsed.hostPresent : true,
      activeParticipants,
    };
  } catch {
    return null;
  }
}

export function parseWatchRoomPresenceRecord(
  rawBody: string
): WatchRoomPresenceRecord | null {
  if (!rawBody || typeof rawBody !== "string" || !rawBody.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawBody) as Partial<WatchRoomPresenceRecord>;
    if (
      !parsed ||
      parsed.type !== "watch_room_presence" ||
      parsed.version !== 1 ||
      (parsed.status !== "active" && parsed.status !== "left") ||
      !parsed.lastSeenAt
    ) {
      return null;
    }
    return {
      type: "watch_room_presence",
      version: 1,
      status: parsed.status,
      sessionKey: String(parsed.sessionKey || ""),
      lastSeenAt: String(parsed.lastSeenAt),
    };
  } catch {
    return null;
  }
}

export function serializeWatchRoomPresenceRecord(
  record: Omit<WatchRoomPresenceRecord, "type" | "version">
): string {
  return JSON.stringify({
    type: "watch_room_presence",
    version: 1,
    status: record.status,
    sessionKey: record.sessionKey,
    lastSeenAt: record.lastSeenAt,
  });
}

/**
 * Resolves accurate anime title, slug, cover artwork, and episode count
 * using the canonical `anime` database row first and falling back to the
 * room payload only when real metadata is present.
 * Returns null if no real title can be resolved (preventing generic placeholders).
 */
export function resolveWatchRoomMediaMetadata(
  payload: WatchRoomPayload,
  animeRow?: RawWatchRoomAnimeRow | null
): {
  animeExternalId: string;
  animeSlug: string;
  animeTitle: string;
  animeCover: string | null;
  totalEpisodes: number | null;
  episodeNumber: number;
} | null {
  const dbTitle = (
    animeRow?.title_english ||
    animeRow?.title_romaji ||
    ""
  ).trim();
  const payloadTitle = (payload.animeTitle || "").trim();
  const isPayloadGeneric = GENERIC_PLACEHOLDER_TITLES.has(
    payloadTitle.toLowerCase()
  );

  const resolvedTitle = dbTitle || (!isPayloadGeneric ? payloadTitle : "");
  if (!resolvedTitle) {
    return null;
  }

  const resolvedSlug = (animeRow?.slug || payload.animeSlug || "").trim();
  // Use only the anime's own cover image from DB or payload — never unrelated fallback artwork
  const resolvedCover =
    animeRow !== undefined && animeRow !== null
      ? animeRow.cover_image_url ?? payload.animeCover ?? null
      : payload.animeCover ?? null;

  const resolvedTotalEpisodes =
    animeRow?.episodes && Number(animeRow.episodes) > 0
      ? Number(animeRow.episodes)
      : payload.totalEpisodes && Number(payload.totalEpisodes) > 0
        ? Number(payload.totalEpisodes)
        : null;

  const safeEpisodeNumber = resolvedTotalEpisodes
    ? Math.min(Math.max(payload.episodeNumber, 1), resolvedTotalEpisodes)
    : Math.max(payload.episodeNumber, 1);

  return {
    animeExternalId: animeRow
      ? String(animeRow.external_id)
      : payload.animeExternalId,
    animeSlug: resolvedSlug,
    animeTitle: resolvedTitle,
    animeCover: resolvedCover,
    totalEpisodes: resolvedTotalEpisodes,
    episodeNumber: safeEpisodeNumber,
  };
}

function toTimestampMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Computes deduplicated active participants for a room.
 * - Counts the host when present and room is active.
 * - Counts active participants only once (deduplicated by `user:<id>` or `guest:<sessionKey>`).
 * - Removes participants who have left (`status === "left"`) or whose presence heartbeat expired.
 * - Excludes bidirectionally blocked users.
 * - Never derives participant counts from chat messages.
 * - Clamps displayed participantCount to `maxParticipants`.
 */
export function computeActiveRoomParticipants(params: {
  hostId: string;
  hostProfile: WatchRoomHostProfile;
  payload: WatchRoomPayload;
  roomCreatedAt: string;
  roomUpdatedAt?: string | null;
  presenceChildRows: Array<{
    userId: string;
    isHidden: boolean;
    createdAt: string;
    updatedAt?: string | null;
    record: WatchRoomPresenceRecord;
    profile?: WatchRoomHostProfile;
  }>;
  blockedSet?: ReadonlySet<string>;
  nowMs?: number;
}): {
  participants: WatchRoomParticipantSnapshot[];
  participantCount: number;
  activeUserIds: Set<string>;
  latestPresenceAtMs: number;
} {
  const {
    hostId,
    hostProfile,
    payload,
    roomCreatedAt,
    roomUpdatedAt,
    presenceChildRows,
    blockedSet,
    nowMs = Date.now(),
  } = params;

  const participantMap = new Map<string, WatchRoomParticipantSnapshot>();
  const firstJoinedAtMap = new Map<string, number>();
  const explicitlyLeftKeys = new Set<string>();
  let latestPresenceAtMs = 0;

  // 1. Inspect stored child presence records (newest record per user wins; track earliest join time)
  const latestRowByUser = new Map<
    string,
    {
      userId: string;
      isHidden: boolean;
      timestampMs: number;
      firstJoinedMs: number;
      lastSeenIso: string;
      record: WatchRoomPresenceRecord;
      profile?: WatchRoomHostProfile;
    }
  >();

  for (const row of presenceChildRows) {
    if (!row.userId || blockedSet?.has(row.userId)) continue;
    const createdMs = toTimestampMs(row.createdAt);
    const rowTimeMs = Math.max(
      toTimestampMs(row.record.lastSeenAt),
      toTimestampMs(row.updatedAt),
      createdMs
    );
    const prev = latestRowByUser.get(row.userId);
    const earliestMs =
      prev && prev.firstJoinedMs > 0 && createdMs > 0
        ? Math.min(prev.firstJoinedMs, createdMs)
        : createdMs || rowTimeMs;
    if (!prev || rowTimeMs >= prev.timestampMs) {
      latestRowByUser.set(row.userId, {
        userId: row.userId,
        isHidden: row.isHidden,
        timestampMs: rowTimeMs,
        firstJoinedMs: earliestMs,
        lastSeenIso: row.record.lastSeenAt || row.updatedAt || row.createdAt,
        record: row.record,
        profile: row.profile,
      });
    } else if (prev) {
      prev.firstJoinedMs = earliestMs;
    }
  }

  for (const [uid, entry] of latestRowByUser.entries()) {
    const userKey = `user:${uid}`;
    if (entry.isHidden || entry.record.status === "left") {
      explicitlyLeftKeys.add(userKey);
      continue;
    }
    if (nowMs - entry.timestampMs <= PARTICIPANT_ACTIVE_TTL_MS) {
      if (entry.timestampMs > latestPresenceAtMs) {
        latestPresenceAtMs = entry.timestampMs;
      }
      const prof = entry.profile;
      firstJoinedAtMap.set(userKey, entry.firstJoinedMs);
      participantMap.set(userKey, {
        key: userKey,
        userId: uid,
        username: prof?.username || `user_${uid.slice(0, 6)}`,
        displayName:
          prof?.displayName || prof?.username || `user_${uid.slice(0, 6)}`,
        avatarUrl: prof?.avatarUrl ?? null,
        isPublicProfile: prof?.isPublicProfile ?? false,
        role: uid === hostId ? "host" : "viewer",
        lastSeenAt: entry.lastSeenIso,
      });
    }
  }

  // 2. Merge host-synced Realtime snapshot from payload.activeParticipants (within TTL)
  if (Array.isArray(payload.activeParticipants)) {
    for (const snap of payload.activeParticipants) {
      const snapUserId = snap.userId ? String(snap.userId) : null;
      if (snapUserId && blockedSet?.has(snapUserId)) continue;

      const canonicalKey = snapUserId
        ? `user:${snapUserId}`
        : snap.key.startsWith("guest:")
          ? snap.key
          : `guest:${snap.key}`;

      if (explicitlyLeftKeys.has(canonicalKey)) continue;

      const seenMs = toTimestampMs(snap.lastSeenAt);
      if (seenMs <= 0 || nowMs - seenMs > PARTICIPANT_ACTIVE_TTL_MS) continue;

      if (seenMs > latestPresenceAtMs) {
        latestPresenceAtMs = seenMs;
      }

      if (!participantMap.has(canonicalKey)) {
        firstJoinedAtMap.set(canonicalKey, seenMs);
        participantMap.set(canonicalKey, {
          key: canonicalKey,
          userId: snapUserId,
          username: snap.username,
          displayName: snap.displayName || snap.username,
          avatarUrl: snap.avatarUrl ?? null,
          isPublicProfile: snap.isPublicProfile === true,
          role:
            snapUserId === hostId
              ? "host"
              : snap.role === "host"
                ? "viewer"
                : snap.role,
          lastSeenAt: snap.lastSeenAt,
        });
      }
    }
  }

  // 3. Include the host when the room is active and the host has not explicitly left
  const hostKey = `user:${hostId}`;
  const hostLastSignalMs = Math.max(
    toTimestampMs(payload.lastHeartbeatAt),
    toTimestampMs(payload.timerUpdatedAt),
    toTimestampMs(roomUpdatedAt),
    toTimestampMs(roomCreatedAt)
  );
  const hostRecentlyActive =
    nowMs - hostLastSignalMs <= STALE_ROOM_TTL_MS &&
    payload.status !== "ended" &&
    payload.hostPresent !== false &&
    !explicitlyLeftKeys.has(hostKey) &&
    !blockedSet?.has(hostId);

  if (hostRecentlyActive && !participantMap.has(hostKey)) {
    firstJoinedAtMap.set(hostKey, toTimestampMs(roomCreatedAt) || hostLastSignalMs);
    participantMap.set(hostKey, {
      key: hostKey,
      userId: hostId,
      username: hostProfile.username,
      displayName: hostProfile.displayName,
      avatarUrl: hostProfile.avatarUrl,
      isPublicProfile: hostProfile.isPublicProfile,
      role: "host",
      lastSeenAt:
        payload.lastHeartbeatAt ||
        payload.timerUpdatedAt ||
        roomUpdatedAt ||
        roomCreatedAt,
    });
  }

  // Order host first, then viewers by earliest join time (first-come-first-served) with deterministic key tie-breaker
  const ordered = Array.from(participantMap.values()).sort((a, b) => {
    if (a.role === "host" && b.role !== "host") return -1;
    if (b.role === "host" && a.role !== "host") return 1;
    const aJoin = firstJoinedAtMap.get(a.key) ?? toTimestampMs(a.lastSeenAt);
    const bJoin = firstJoinedAtMap.get(b.key) ?? toTimestampMs(b.lastSeenAt);
    if (aJoin !== bJoin) return aJoin - bJoin;
    return a.key.localeCompare(b.key);
  });

  const clampedParticipants = ordered.slice(0, payload.maxParticipants);
  const activeUserIds = new Set<string>();
  for (const p of clampedParticipants) {
    if (p.userId) activeUserIds.add(p.userId);
  }

  return {
    participants: clampedParticipants,
    participantCount: Math.min(
      clampedParticipants.length,
      payload.maxParticipants
    ),
    activeUserIds,
    latestPresenceAtMs,
  };
}

/**
 * Deduplicates live Supabase Realtime presence entries inside a Watch Together room.
 * Prevents duplicate entries caused by multiple tabs, reconnects, or repeated sync events.
 */
export function deduplicateRealtimeParticipants(
  presenceState: Record<string, Array<Record<string, unknown>>>,
  options?: {
    hostId?: string;
    maxParticipants?: number;
    blockedSet?: ReadonlySet<string>;
  }
): WatchRoomParticipantSnapshot[] {
  const deduped = new Map<string, WatchRoomParticipantSnapshot>();
  const hostId = options?.hostId;
  const blockedSet = options?.blockedSet;
  const maxParticipants = options?.maxParticipants ?? 25;

  for (const [presenceKey, entries] of Object.entries(presenceState)) {
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") continue;
      const rawUserId =
        typeof raw.userId === "string" && raw.userId.trim()
          ? raw.userId.trim()
          : presenceKey;
      const isGuest =
        raw.role === "guest" || rawUserId.startsWith("guest_");
      const userId = isGuest ? null : rawUserId;

      if (userId && blockedSet?.has(userId)) continue;

      const canonicalKey = userId
        ? `user:${userId}`
        : `guest:${rawUserId}`;

      const username = String(raw.username || "Viewer").trim() || "Viewer";
      const displayName =
        String(raw.displayName || username).trim() || username;
      const avatarUrl =
        typeof raw.avatarUrl === "string" && raw.avatarUrl.trim()
          ? raw.avatarUrl.trim()
          : null;
      const joinedAt =
        typeof raw.joinedAt === "string" && raw.joinedAt
          ? raw.joinedAt
          : new Date().toISOString();
      const role: "host" | "viewer" | "guest" =
        userId && hostId && userId === hostId
          ? "host"
          : isGuest
            ? "guest"
            : "viewer";

      const existing = deduped.get(canonicalKey);
      if (
        !existing ||
        toTimestampMs(joinedAt) >= toTimestampMs(existing.lastSeenAt)
      ) {
        deduped.set(canonicalKey, {
          key: canonicalKey,
          userId,
          username,
          displayName,
          avatarUrl,
          isPublicProfile: raw.isPublicProfile === true,
          role,
          lastSeenAt: joinedAt,
        });
      }
    }
  }

  const sorted = Array.from(deduped.values()).sort((a, b) => {
    if (a.role === "host" && b.role !== "host") return -1;
    if (b.role === "host" && a.role !== "host") return 1;
    return toTimestampMs(a.lastSeenAt) - toTimestampMs(b.lastSeenAt);
  });

  return sorted.slice(0, maxParticipants);
}

/**
 * Classifies a Watch Together room into "active", "full", "ended", or "stale".
 */
export function classifyWatchRoomLifecycle(params: {
  payload: WatchRoomPayload;
  isHidden: boolean;
  roomCreatedAt: string;
  roomUpdatedAt?: string | null;
  latestPresenceAtMs?: number;
  latestChatAtMs?: number;
  participantCount: number;
  nowMs?: number;
}): {
  lifecycleState: WatchRoomLifecycleState;
  isFull: boolean;
  isJoinable: boolean;
  lastActivityAt: string;
} {
  const {
    payload,
    isHidden,
    roomCreatedAt,
    roomUpdatedAt,
    latestPresenceAtMs = 0,
    latestChatAtMs = 0,
    participantCount,
    nowMs = Date.now(),
  } = params;

  const createdMs = toTimestampMs(roomCreatedAt);
  const updatedMs = toTimestampMs(roomUpdatedAt);
  const timerUpdatedMs = toTimestampMs(payload.timerUpdatedAt);
  const heartbeatMs = toTimestampMs(payload.lastHeartbeatAt);

  const hostLastSignalMs = Math.max(
    createdMs,
    updatedMs,
    timerUpdatedMs,
    heartbeatMs
  );
  const latestActivityMs = Math.max(
    hostLastSignalMs,
    latestPresenceAtMs,
    latestChatAtMs
  );
  const lastActivityAt =
    latestActivityMs > 0
      ? new Date(latestActivityMs).toISOString()
      : roomCreatedAt;

  if (isHidden || payload.status === "ended") {
    return {
      lifecycleState: "ended",
      isFull: false,
      isJoinable: false,
      lastActivityAt,
    };
  }

  // Room is stale if there has been no activity for > STALE_ROOM_TTL_MS (2h)
  // OR no host signal for > MAX_ROOM_IDLE_WITHOUT_HOST_MS (6h)
  const idleMs = latestActivityMs > 0 ? nowMs - latestActivityMs : Infinity;
  const hostIdleMs = hostLastSignalMs > 0 ? nowMs - hostLastSignalMs : Infinity;

  if (
    idleMs > STALE_ROOM_TTL_MS ||
    hostIdleMs > MAX_ROOM_IDLE_WITHOUT_HOST_MS
  ) {
    return {
      lifecycleState: "stale",
      isFull: false,
      isJoinable: false,
      lastActivityAt,
    };
  }

  const isFull = participantCount >= payload.maxParticipants;
  if (isFull) {
    return {
      lifecycleState: "full",
      isFull: true,
      isJoinable: false,
      lastActivityAt,
    };
  }

  return {
    lifecycleState: "active",
    isFull: false,
    isJoinable: true,
    lastActivityAt,
  };
}

/**
 * Retrieves bidirectional blocked user IDs for the caller using the Stage 1
 * `get_bidirectional_blocked_user_ids` RPC, `user_blocks` table, and
 * `is_blocked_between` RPC fallback.
 */
export async function resolveBidirectionalBlockedSet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  currentUserId: string | null,
  candidateUserIds?: Iterable<string>
): Promise<Set<string>> {
  const blockedSet = new Set<string>();
  if (!currentUserId) return blockedSet;

  const [rpcRes, tableRes] = await Promise.all([
    supabase.rpc("get_bidirectional_blocked_user_ids"),
    supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${currentUserId},blocked_id.eq.${currentUserId}`),
  ]);

  let rpcSucceeded = false;
  if (!rpcRes.error && Array.isArray(rpcRes.data)) {
    rpcSucceeded = true;
    for (const entry of rpcRes.data) {
      if (typeof entry === "string" && entry) {
        blockedSet.add(entry);
      } else if (
        entry &&
        typeof entry === "object" &&
        "excluded_user_id" in entry &&
        typeof (entry as { excluded_user_id?: unknown }).excluded_user_id ===
          "string"
      ) {
        blockedSet.add(
          (entry as { excluded_user_id: string }).excluded_user_id
        );
      }
    }
  }

  for (const row of tableRes.data ?? []) {
    if (row.blocker_id === currentUserId) blockedSet.add(row.blocked_id);
    if (row.blocked_id === currentUserId) blockedSet.add(row.blocker_id);
  }

  if (!rpcSucceeded && candidateUserIds) {
    const candidates = Array.from(new Set(candidateUserIds)).filter(
      (id) => id && id !== currentUserId && !blockedSet.has(id)
    );
    if (candidates.length > 0) {
      await Promise.all(
        candidates.map(async (candidateId) => {
          const check = await supabase.rpc("is_blocked_between", {
            user_a: currentUserId,
            user_b: candidateId,
          });
          if (!check.error && check.data === true) {
            blockedSet.add(candidateId);
          }
        })
      );
    }
  }

  return blockedSet;
}

const roomJoinLocks = new Map<string, Promise<unknown>>();

/**
 * Per-room async mutex used on the server to serialize concurrent join checks
 * and presence writes for the same room, preventing final-slot race conditions.
 */
export async function withWatchRoomJoinLock<T>(
  roomId: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = roomJoinLocks.get(roomId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => gate);
  roomJoinLocks.set(roomId, chained);

  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (roomJoinLocks.get(roomId) === chained) {
      roomJoinLocks.delete(roomId);
    }
  }
}

/**
 * Safely updates or prunes `WatchRoomPayload.activeParticipants` on the server:
 * - When `liveRealtimeParticipants` is provided (from a subscribed Realtime channel),
 *   replaces the snapshot with the live list and stamps `nowIso`, immediately purging
 *   any guest who disconnected while the host was away or connected.
 * - When `liveRealtimeParticipants` is omitted (e.g. heartbeat before Realtime sync or
 *   playback update), prunes entries older than `PARTICIPANT_ACTIVE_TTL_MS` without
 *   advancing guest `lastSeenAt` timestamps so stale guests never remain indefinitely.
 * - When `hostLeaving` is true, removes the host and all guest entries (since no host
 *   is present to monitor Realtime guest disconnects).
 */
export function pruneWatchRoomActiveParticipantsSnapshot(params: {
  existing: WatchRoomParticipantSnapshot[] | undefined;
  liveRealtimeParticipants?: WatchRoomParticipantSnapshot[];
  hostId: string;
  maxParticipants: number;
  blockedSet?: ReadonlySet<string>;
  nowIso: string;
  nowMs?: number;
  hostLeaving?: boolean;
}): WatchRoomParticipantSnapshot[] {
  const {
    existing,
    liveRealtimeParticipants,
    hostId,
    maxParticipants,
    blockedSet,
    nowIso,
    nowMs = toTimestampMs(nowIso) || Date.now(),
    hostLeaving = false,
  } = params;

  if (hostLeaving) {
    if (!Array.isArray(existing)) return [];
    return existing.filter((p) => {
      if (!p || typeof p !== "object") return false;
      const uid = p.userId ? String(p.userId) : null;
      if (!uid || uid === hostId) return false;
      if (blockedSet?.has(uid)) return false;
      if (p.role === "guest" || p.key.startsWith("guest:")) return false;
      const seenMs = toTimestampMs(p.lastSeenAt);
      return seenMs > 0 && nowMs - seenMs <= PARTICIPANT_ACTIVE_TTL_MS;
    });
  }

  if (Array.isArray(liveRealtimeParticipants)) {
    const seenKeys = new Set<string>();
    const sanitized: WatchRoomParticipantSnapshot[] = [];

    for (const item of liveRealtimeParticipants) {
      if (!item || typeof item !== "object" || !item.username) continue;
      const uid = item.userId ? String(item.userId) : null;
      if (uid && blockedSet?.has(uid)) continue;
      const key = uid
        ? `user:${uid}`
        : String(item.key || "").startsWith("guest:")
          ? String(item.key)
          : `guest:${String(item.key || item.username)}`;
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);

      sanitized.push({
        key,
        userId: uid,
        username: String(item.username).slice(0, 40),
        displayName: String(item.displayName || item.username).slice(0, 60),
        avatarUrl: item.avatarUrl ? String(item.avatarUrl) : null,
        isPublicProfile: item.isPublicProfile === true,
        role:
          uid === hostId
            ? "host"
            : item.role === "guest" || !uid
              ? "guest"
              : "viewer",
        lastSeenAt: nowIso,
      });

      if (sanitized.length >= maxParticipants) break;
    }

    return sanitized;
  }

  // No live Realtime snapshot provided: prune expired entries WITHOUT refreshing guest timestamps
  if (!Array.isArray(existing)) return [];
  const pruned: WatchRoomParticipantSnapshot[] = [];
  const seenKeys = new Set<string>();

  for (const item of existing) {
    if (!item || typeof item !== "object" || !item.key || !item.username) {
      continue;
    }
    const uid = item.userId ? String(item.userId) : null;
    if (uid && blockedSet?.has(uid)) continue;
    const seenMs = toTimestampMs(item.lastSeenAt);
    if (seenMs <= 0 || nowMs - seenMs > PARTICIPANT_ACTIVE_TTL_MS) {
      continue;
    }
    if (seenKeys.has(item.key)) continue;
    seenKeys.add(item.key);

    pruned.push({
      ...item,
      // Only refresh the host's own timestamp when the host sends a non-Realtime heartbeat
      lastSeenAt: uid === hostId ? nowIso : item.lastSeenAt,
    });

    if (pruned.length >= maxParticipants) break;
  }

  return pruned;
}

/**
 * Shared Watch Together data service used by BOTH the right-side Community & Activity
 * drawer and the Watch Together lobby page.
 */
export async function fetchSharedWatchTogetherRooms(
  supabase: Awaited<ReturnType<typeof createClient>>,
  options?: {
    currentUserId?: string | null;
    precomputedBlockedSet?: Set<string>;
    cleanupOwnStaleRooms?: boolean;
    nowMs?: number;
  }
): Promise<{
  lobbyRooms: WatchRoomResolvedDTO[];
  drawerRooms: WatchRoomResolvedDTO[];
  blockedSet: Set<string>;
  hostActivityMap: Map<string, { recentActivity: string; lastActiveAt: string }>;
}> {
  let currentUserId = options?.currentUserId;
  if (currentUserId === undefined) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    currentUserId = user?.id ?? null;
  }

  // 1. Fetch top-level watch_room records (parent_comment_id IS NULL) so chat volume never crowds out rooms
  const { data: rawTopRows, error: roomsError } = await supabase
    .from("anime_comments")
    .select(
      "id, user_id, anime_id, parent_comment_id, body, is_hidden, created_at, updated_at"
    )
    .eq("anime_id", "watch_room")
    .is("parent_comment_id", null)
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(60);

  if (roomsError) {
    throw new Error(roomsError.message);
  }

  const topRows = (rawTopRows ?? []).filter((r) => !r.parent_comment_id);
  const topRoomIds = topRows.map((r) => r.id);

  // 2. Fetch child rows (presence records + chat messages) for those top-level rooms
  const { data: rawChildRows } =
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
          .limit(300)
      : { data: [] };

  const childRows = (rawChildRows ?? []).filter((r) =>
    Boolean(r.parent_comment_id)
  );
  const rows = [...topRows, ...childRows];
  const candidateUserIds = new Set<string>();
  for (const r of rows) {
    if (r.user_id) candidateUserIds.add(r.user_id);
  }

  const blockedSet =
    options?.precomputedBlockedSet ??
    (await resolveBidirectionalBlockedSet(
      supabase,
      currentUserId ?? null,
      candidateUserIds
    ));

  // Parse room payloads and collect external anime IDs + user IDs for batch hydration
  const parsedTopRooms: Array<{
    row: (typeof rows)[number];
    payload: WatchRoomPayload;
  }> = [];
  const animeExternalIdsSet = new Set<number>();
  const profileIdsSet = new Set<string>();

  for (const row of topRows) {
    if (blockedSet.has(row.user_id)) continue;
    const payload = parseWatchRoomPayloadSync(row.body);
    if (!payload) continue;
    parsedTopRooms.push({ row, payload });
    profileIdsSet.add(row.user_id);

    const numId = Number(payload.animeExternalId);
    if (Number.isFinite(numId) && numId > 0) {
      animeExternalIdsSet.add(numId);
    }
    if (Array.isArray(payload.activeParticipants)) {
      for (const p of payload.activeParticipants) {
        if (p.userId && !blockedSet.has(p.userId)) {
          profileIdsSet.add(p.userId);
        }
      }
    }
  }

  for (const child of childRows) {
    if (!blockedSet.has(child.user_id)) {
      profileIdsSet.add(child.user_id);
    }
  }

  const profileIds = Array.from(profileIdsSet);
  const animeExternalIds = Array.from(animeExternalIdsSet);

  const [profilesRes, animeRes] = await Promise.all([
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url, profile_visibility")
          .in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
    animeExternalIds.length > 0
      ? supabase
          .from("anime")
          .select(
            "external_id, slug, title_romaji, title_english, cover_image_url, banner_image_url, episodes, status, media_type"
          )
          .in("external_id", animeExternalIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const profileMap = new Map<string, WatchRoomHostProfile>();
  for (const p of profilesRes.data ?? []) {
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

  const resolveProfile = (userId: string): WatchRoomHostProfile => {
    const existing = profileMap.get(userId);
    if (existing) return existing;
    const fallback = `user_${userId.slice(0, 6)}`;
    return {
      id: userId,
      username: fallback,
      displayName: fallback,
      avatarUrl: null,
      isPublicProfile: false,
    };
  };

  const animeMap = new Map<string, RawWatchRoomAnimeRow>();
  for (const a of (animeRes.data ?? []) as RawWatchRoomAnimeRow[]) {
    animeMap.set(String(a.external_id), a);
  }

  // Partition child rows into structured presence records vs room chat messages
  const presenceRowsByRoom = new Map<
    string,
    Array<{
      userId: string;
      isHidden: boolean;
      createdAt: string;
      updatedAt?: string | null;
      record: WatchRoomPresenceRecord;
      profile?: WatchRoomHostProfile;
    }>
  >();
  const chatMessagesByRoom = new Map<string, WatchRoomChatItem[]>();

  for (const child of childRows) {
    const roomId = child.parent_comment_id;
    if (!roomId || blockedSet.has(child.user_id)) continue;

    const presenceRecord = parseWatchRoomPresenceRecord(child.body);
    if (presenceRecord) {
      const list = presenceRowsByRoom.get(roomId) ?? [];
      list.push({
        userId: child.user_id,
        isHidden: Boolean(child.is_hidden),
        createdAt: child.created_at,
        updatedAt: (child as { updated_at?: string | null }).updated_at ?? null,
        record: presenceRecord,
        profile: resolveProfile(child.user_id),
      });
      presenceRowsByRoom.set(roomId, list);
    } else if (!child.is_hidden && child.body.trim()) {
      const author = resolveProfile(child.user_id);
      const list = chatMessagesByRoom.get(roomId) ?? [];
      list.push({
        id: child.id,
        body: child.body,
        createdAt: child.created_at,
        author,
      });
      chatMessagesByRoom.set(roomId, list);
    }
  }

  const nowMs = options?.nowMs ?? Date.now();
  const staleOwnRoomIds: string[] = [];
  const lobbyRooms: WatchRoomResolvedDTO[] = [];
  const drawerRooms: WatchRoomResolvedDTO[] = [];
  const hostActivityMap = new Map<
    string,
    { recentActivity: string; lastActiveAt: string }
  >();

  for (const { row, payload } of parsedTopRooms) {
    const animeRow = animeMap.get(payload.animeExternalId) ?? null;
    if (animeRow?.status === "NOT_YET_RELEASED") continue;

    const resolvedMedia = resolveWatchRoomMediaMetadata(payload, animeRow);
    if (!resolvedMedia) continue;

    const hostProfile = resolveProfile(row.user_id);
    const roomPresenceRows = presenceRowsByRoom.get(row.id) ?? [];
    const roomChats = (chatMessagesByRoom.get(row.id) ?? []).sort(
      (a, b) => toTimestampMs(a.createdAt) - toTimestampMs(b.createdAt)
    );
    const latestChatAtMs =
      roomChats.length > 0
        ? toTimestampMs(roomChats[roomChats.length - 1]!.createdAt)
        : 0;

    const updatedAt =
      (row as { updated_at?: string | null }).updated_at ?? null;

    const { participants, participantCount, latestPresenceAtMs } =
      computeActiveRoomParticipants({
        hostId: row.user_id,
        hostProfile,
        payload,
        roomCreatedAt: row.created_at,
        roomUpdatedAt: updatedAt,
        presenceChildRows: roomPresenceRows,
        blockedSet,
        nowMs,
      });

    const lifecycle = classifyWatchRoomLifecycle({
      payload,
      isHidden: Boolean(row.is_hidden),
      roomCreatedAt: row.created_at,
      roomUpdatedAt: updatedAt,
      latestPresenceAtMs,
      latestChatAtMs,
      participantCount,
      nowMs,
    });

    if (lifecycle.lifecycleState === "ended") {
      continue;
    }

    if (lifecycle.lifecycleState === "stale") {
      if (currentUserId && row.user_id === currentUserId) {
        staleOwnRoomIds.push(row.id);
      }
      continue;
    }

    const activeStatus: "live" | "intermission" =
      payload.status === "intermission" ? "intermission" : "live";

    const roomDto: WatchRoomResolvedDTO = {
      id: row.id,
      isShowcase: false,
      roomTitle: payload.roomTitle,
      description: payload.description,
      animeExternalId: resolvedMedia.animeExternalId,
      animeSlug: resolvedMedia.animeSlug,
      animeTitle: resolvedMedia.animeTitle,
      animeCover: resolvedMedia.animeCover,
      episodeNumber: resolvedMedia.episodeNumber,
      totalEpisodes: resolvedMedia.totalEpisodes,
      language: payload.language,
      status: activeStatus,
      lifecycleState: lifecycle.lifecycleState,
      isFull: lifecycle.isFull,
      isJoinable: lifecycle.isJoinable,
      privacy: payload.privacy,
      maxParticipants: payload.maxParticipants,
      participantCount,
      participants,
      timerSeconds: payload.timerSeconds,
      isPlaying: payload.isPlaying,
      timerUpdatedAt: payload.timerUpdatedAt,
      lastActivityAt: lifecycle.lastActivityAt,
      createdAt: row.created_at,
      hostId: row.user_id,
      host: hostProfile,
      chatMessages: roomChats,
    };

    lobbyRooms.push(roomDto);

    // The compact right-side drawer lists public, joinable (non-full) active rooms
    if (
      roomDto.privacy === "public" &&
      roomDto.lifecycleState === "active" &&
      roomDto.isJoinable
    ) {
      drawerRooms.push(roomDto);
    }

    if (roomDto.privacy === "public" && !hostActivityMap.has(row.user_id)) {
      hostActivityMap.set(row.user_id, {
        recentActivity: `Hosting ${roomDto.animeTitle} · Ep ${roomDto.episodeNumber}`,
        lastActiveAt: lifecycle.lastActivityAt,
      });
    }
  }

  // Idempotent cleanup of stale rooms owned by the current authenticated user
  if (
    options?.cleanupOwnStaleRooms !== false &&
    currentUserId &&
    staleOwnRoomIds.length > 0
  ) {
    try {
      await supabase
        .from("anime_comments")
        .update({
          is_hidden: true,
          updated_at: new Date(nowMs).toISOString(),
        })
        .in("id", staleOwnRoomIds)
        .eq("user_id", currentUserId)
        .eq("anime_id", "watch_room");
    } catch {
      /* idempotent best-effort cleanup */
    }
  }

  // Sort rooms: active joinable live rooms first, then intermission, then full rooms, then by recency
  const sortRooms = (a: WatchRoomResolvedDTO, b: WatchRoomResolvedDTO) => {
    if (a.isJoinable !== b.isJoinable) return a.isJoinable ? -1 : 1;
    if (a.status !== b.status) return a.status === "live" ? -1 : 1;
    return toTimestampMs(b.lastActivityAt) - toTimestampMs(a.lastActivityAt);
  };

  lobbyRooms.sort(sortRooms);
  drawerRooms.sort(sortRooms);

  return {
    lobbyRooms,
    drawerRooms,
    blockedSet,
    hostActivityMap,
  };
}
