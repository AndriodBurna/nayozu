"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { AUTH_ENABLED } from "@/lib/features";
import { createClient } from "@/lib/supabase/client";
import { signOutUserAction } from "@/lib/actions/authActions";
import {
  buildCanonicalFriendshipPair,
  canBroadcastFriendPairPresence,
  canBroadcastPublicPresence,
  filterFriendPairPresenceState,
  filterPublicPresenceState,
  isUserOnlineForViewer,
  type FriendPairPresencePayload,
  type GlobalPresencePayload,
} from "@/lib/friends/friendsService";

export type ShellUserRole = "user" | "moderator" | "admin" | null;

export interface ShellPresenceUserEntry {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isPublicProfile: true;
  onlineAt: string | null;
}

interface ShellProfilePresenceMeta {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileVisibility: "public" | "private";
}

interface ShellState {
  user: User | null;
  userRole: ShellUserRole;
  authLoading: boolean;
  refreshUser: () => Promise<void>;
  refreshPresenceMetadata: () => Promise<void>;
  signOut: () => Promise<void>;
  rightOpen: boolean;
  toggleRight: () => void;
  closeRight: () => void;
  leftOpen: boolean;
  toggleLeft: () => void;
  closeLeft: () => void;
  publicOnlinePresenceMap: ReadonlyMap<string, ShellPresenceUserEntry>;
  friendOnlineIds: ReadonlySet<string>;
  isUserOnline: (
    targetUserId: string,
    options?: {
      isPublicProfile?: boolean;
      isAcceptedFriend?: boolean;
      isBlocked?: boolean;
    }
  ) => boolean;
}

const ShellContext = createContext<ShellState | null>(null);
const STORAGE_KEY = "nayozu:right-panel";
const MAX_FRIEND_PAIR_CHANNELS = 25;

export function isMobileOrTabletViewport(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(max-width: 1023px)").matches;
}

export function coordinateDrawerState(
  prev: { leftOpen: boolean; rightOpen: boolean },
  action: "toggleLeft" | "closeLeft" | "toggleRight" | "closeRight",
  isMobileOrTablet: boolean
): { leftOpen: boolean; rightOpen: boolean } {
  switch (action) {
    case "closeLeft":
      return { ...prev, leftOpen: false };
    case "closeRight":
      return { ...prev, rightOpen: false };
    case "toggleLeft": {
      const nextLeft = !prev.leftOpen;
      return {
        leftOpen: nextLeft,
        rightOpen: nextLeft && isMobileOrTablet ? false : prev.rightOpen,
      };
    }
    case "toggleRight": {
      const nextRight = !prev.rightOpen;
      return {
        leftOpen: nextRight && isMobileOrTablet ? false : prev.leftOpen,
        rightOpen: nextRight,
      };
    }
  }
}

export function ShellProvider({
  children,
  initialUser = null,
  initialUserRole = null,
}: {
  children: React.ReactNode;
  initialUser?: User | null;
  initialUserRole?: ShellUserRole;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [userRole, setUserRole] = useState<ShellUserRole>(initialUserRole);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);

  // Global Shell Presence State
  const [presenceMeta, setPresenceMeta] =
    useState<ShellProfilePresenceMeta | null>(null);
  const [acceptedFriendIds, setAcceptedFriendIds] = useState<string[]>([]);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [publicPresenceSubscribed, setPublicPresenceSubscribed] =
    useState<boolean>(false);
  const [publicOnlinePresenceMap, setPublicOnlinePresenceMap] = useState<
    Map<string, ShellPresenceUserEntry>
  >(new Map());
  const [friendOnlineIds, setFriendOnlineIds] = useState<Set<string>>(
    new Set()
  );

  const publicChannelRef = useRef<RealtimeChannel | null>(null);
  const sessionTabIdRef = useRef<string>(
    `tab-${Math.random().toString(36).slice(2, 9)}`
  );

  const currentUserId = user?.id ?? null;
  const initialUserId = initialUser?.id ?? null;
  const initialDisplayName =
    (initialUser?.user_metadata?.display_name as string | undefined) ?? null;
  const initialUsername =
    (initialUser?.user_metadata?.username as string | undefined) ?? null;
  const initialAvatarUrl =
    (initialUser?.user_metadata?.avatar_url as string | undefined) ?? null;

  const blockedSet = useMemo(() => new Set(blockedUserIds), [blockedUserIds]);
  const acceptedFriendSet = useMemo(
    () => new Set(acceptedFriendIds),
    [acceptedFriendIds]
  );

  const blockedSetRef = useRef(blockedSet);
  const acceptedFriendSetRef = useRef(acceptedFriendSet);
  const presenceMetaRef = useRef(presenceMeta);
  useEffect(() => {
    blockedSetRef.current = blockedSet;
    acceptedFriendSetRef.current = acceptedFriendSet;
    presenceMetaRef.current = presenceMeta;
  }, [blockedSet, acceptedFriendSet, presenceMeta]);

  useEffect(() => {
    setUser(initialUser);
    setUserRole(initialUserRole);
  }, [
    initialUser,
    initialUserId,
    initialDisplayName,
    initialUsername,
    initialAvatarUrl,
    initialUserRole,
  ]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        setRightOpen(saved === "1");
      }
    } catch {
      /* storage unavailable: stay closed */
    }
  }, []);

  const refreshPresenceMetadata = useCallback(async () => {
    if (!AUTH_ENABLED || !currentUserId) {
      setPresenceMeta(null);
      setAcceptedFriendIds([]);
      setBlockedUserIds([]);
      setFriendOnlineIds(new Set());
      return;
    }

    try {
      const supabase = createClient();
      const [profileRes, friendshipsRes, blocksRes, rpcBlocksRes] =
        await Promise.all([
          supabase
            .from("profiles")
            .select(
              "id, username, display_name, avatar_url, profile_visibility"
            )
            .eq("id", currentUserId)
            .maybeSingle(),
          supabase
            .from("friendships")
            .select("requester_id, addressee_id, status")
            .or(
              `requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`
            )
            .eq("status", "accepted"),
          supabase
            .from("user_blocks")
            .select("blocker_id, blocked_id")
            .or(`blocker_id.eq.${currentUserId},blocked_id.eq.${currentUserId}`),
          supabase.rpc("get_bidirectional_blocked_user_ids"),
        ]);

      const nextBlocked = new Set<string>();
      if (!rpcBlocksRes.error && Array.isArray(rpcBlocksRes.data)) {
        for (const item of rpcBlocksRes.data) {
          if (typeof item === "string" && item) {
            nextBlocked.add(item);
          } else if (
            item &&
            typeof item === "object" &&
            "excluded_user_id" in item &&
            typeof (item as { excluded_user_id?: unknown }).excluded_user_id ===
              "string"
          ) {
            nextBlocked.add(
              (item as { excluded_user_id: string }).excluded_user_id
            );
          }
        }
      }
      for (const b of blocksRes.data ?? []) {
        if (b.blocker_id === currentUserId) nextBlocked.add(b.blocked_id);
        if (b.blocked_id === currentUserId) nextBlocked.add(b.blocker_id);
      }

      const nextFriends: string[] = [];
      for (const f of friendshipsRes.data ?? []) {
        if (f.status !== "accepted") continue;
        const otherId: string =
          f.requester_id === currentUserId ? f.addressee_id : f.requester_id;
        if (
          otherId &&
          otherId !== currentUserId &&
          !nextBlocked.has(otherId) &&
          !nextFriends.includes(otherId)
        ) {
          nextFriends.push(otherId);
        }
      }

      const pRow = profileRes.data;
      const fallbackUsername =
        pRow?.username ||
        (user?.user_metadata?.username as string | undefined) ||
        user?.email?.split("@")[0] ||
        `user_${currentUserId.slice(0, 8)}`;

      setPresenceMeta({
        id: currentUserId,
        username: fallbackUsername,
        displayName:
          pRow?.display_name ||
          (user?.user_metadata?.display_name as string | undefined) ||
          fallbackUsername,
        avatarUrl:
          pRow?.avatar_url ||
          (user?.user_metadata?.avatar_url as string | undefined) ||
          null,
        profileVisibility:
          pRow?.profile_visibility === "private" ? "private" : "public",
      });
      setBlockedUserIds(Array.from(nextBlocked));
      setAcceptedFriendIds(nextFriends);
    } catch {
      /* ignore offline/sandbox errors gracefully */
    }
  }, [currentUserId, user]);

  useEffect(() => {
    void refreshPresenceMetadata();
  }, [refreshPresenceMetadata]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSocialUpdated = () => {
      void refreshPresenceMetadata();
    };
    window.addEventListener("nayozu:friends-updated", handleSocialUpdated);
    window.addEventListener(
      "nayozu:presence-metadata-updated",
      handleSocialUpdated
    );
    return () => {
      window.removeEventListener("nayozu:friends-updated", handleSocialUpdated);
      window.removeEventListener(
        "nayozu:presence-metadata-updated",
        handleSocialUpdated
      );
    };
  }, [refreshPresenceMetadata]);

  // 1) Application-Shell Public Presence Subscription (`nayozu:presence`)
  // Active across the entire application shell regardless of whether the right-side drawer is open.
  useEffect(() => {
    if (!AUTH_ENABLED) {
      publicChannelRef.current = null;
      setPublicPresenceSubscribed(false);
      setPublicOnlinePresenceMap(new Map());
      return;
    }

    let isActive = true;
    const supabase = createClient();
    const presenceKey = currentUserId
      ? `${currentUserId}:${sessionTabIdRef.current}`
      : `guest:${sessionTabIdRef.current}`;

    const channel = supabase.channel("nayozu:presence", {
      config: {
        presence: {
          key: presenceKey,
        },
      },
    });
    publicChannelRef.current = channel;

    const syncPublicPresence = () => {
      if (!isActive) return;
      const state = channel.presenceState<GlobalPresencePayload>();
      const knownPrivate = new Set<string>();
      if (
        presenceMetaRef.current &&
        presenceMetaRef.current.profileVisibility === "private"
      ) {
        knownPrivate.add(presenceMetaRef.current.id);
      }
      setPublicOnlinePresenceMap(
        filterPublicPresenceState(state, {
          blockedSet: blockedSetRef.current,
          knownPrivateUserIds: knownPrivate,
        })
      );
    };

    channel
      .on("presence", { event: "sync" }, syncPublicPresence)
      .on("presence", { event: "join" }, syncPublicPresence)
      .on("presence", { event: "leave" }, syncPublicPresence)
      .subscribe((status) => {
        if (!isActive) return;
        setPublicPresenceSubscribed(status === "SUBSCRIBED");
      });

    return () => {
      isActive = false;
      publicChannelRef.current = null;
      setPublicPresenceSubscribed(false);
      void channel.untrack().catch(() => {});
      void supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  // 2) Broadcast on `nayozu:presence` ONLY when authenticated AND profileVisibility === 'public'.
  // Guests and private profiles never broadcast on the public channel.
  useEffect(() => {
    const channel = publicChannelRef.current;
    if (!publicPresenceSubscribed || !channel) return;

    if (canBroadcastPublicPresence(user, presenceMeta)) {
      const meta = presenceMeta!;
      void channel
        .track({
          userId: user!.id,
          username: meta.username,
          displayName: meta.displayName || meta.username,
          avatarUrl: meta.avatarUrl ?? null,
          isPublicProfile: true,
          onlineAt: new Date().toISOString(),
        })
        .catch(() => {});
    } else {
      void channel.untrack().catch(() => {});
    }
  }, [publicPresenceSubscribed, user, presenceMeta]);

  // 3) Per-Friendship Presence Channels (`nayozu:friend-pair:<low>:<high>`)
  // Allows accepted friends (including friends with private profiles) to see each other's online status
  // without ever broadcasting a private profile's presence to strangers or guests.
  const sortedFriendsSignature = useMemo(
    () =>
      acceptedFriendIds
        .filter((id) => !blockedSet.has(id))
        .slice(0, MAX_FRIEND_PAIR_CHANNELS)
        .sort()
        .join(","),
    [acceptedFriendIds, blockedSet]
  );

  useEffect(() => {
    if (!AUTH_ENABLED || !currentUserId || !sortedFriendsSignature) {
      setFriendOnlineIds(new Set());
      return;
    }

    let isActive = true;
    const supabase = createClient();
    const activeFriendList = sortedFriendsSignature.split(",").filter(Boolean);
    const channels: RealtimeChannel[] = [];
    const perChannelState = new Map<
      string,
      Record<string, FriendPairPresencePayload[]>
    >();

    const recomputeFriendOnlineSet = () => {
      if (!isActive) return;
      const mergedState: Record<string, FriendPairPresencePayload[]> = {};
      let idx = 0;
      for (const chState of perChannelState.values()) {
        for (const entries of Object.values(chState)) {
          mergedState[`entry_${idx++}`] = entries;
        }
      }
      setFriendOnlineIds(
        filterFriendPairPresenceState(mergedState, {
          viewerId: currentUserId,
          acceptedFriendIds: acceptedFriendSetRef.current,
          blockedSet: blockedSetRef.current,
        })
      );
    };

    for (const friendId of activeFriendList) {
      if (
        !canBroadcastFriendPairPresence(
          { id: currentUserId },
          friendId,
          {
            acceptedFriendIds: acceptedFriendSetRef.current,
            blockedSet: blockedSetRef.current,
          }
        )
      ) {
        continue;
      }

      const { pairKey } = buildCanonicalFriendshipPair(currentUserId, friendId);
      const channelName = `nayozu:friend-pair:${pairKey}`;
      const ch = supabase.channel(channelName, {
        config: {
          private: true,
          presence: {
            key: `${currentUserId}:${sessionTabIdRef.current}`,
          },
        },
      });

      const syncPair = () => {
        if (!isActive) return;
        perChannelState.set(
          channelName,
          ch.presenceState<FriendPairPresencePayload>()
        );
        recomputeFriendOnlineSet();
      };

      ch.on("presence", { event: "sync" }, syncPair)
        .on("presence", { event: "join" }, syncPair)
        .on("presence", { event: "leave" }, syncPair)
        .subscribe((status) => {
          if (!isActive) return;
          if (status === "SUBSCRIBED") {
            void ch
              .track({
                userId: currentUserId,
                onlineAt: new Date().toISOString(),
              })
              .catch(() => {});
          }
        });

      channels.push(ch);
    }

    return () => {
      isActive = false;
      for (const ch of channels) {
        void ch.untrack().catch(() => {});
        void supabase.removeChannel(ch);
      }
    };
  }, [currentUserId, sortedFriendsSignature]);

  // Immediately purge any blocked users from presence maps if blockedSet updates
  useEffect(() => {
    setPublicOnlinePresenceMap((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const uid of next.keys()) {
        if (blockedSet.has(uid)) {
          next.delete(uid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setFriendOnlineIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const uid of next.values()) {
        if (blockedSet.has(uid) || !acceptedFriendSet.has(uid)) {
          next.delete(uid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [blockedSet, acceptedFriendSet]);

  const isUserOnline = useCallback(
    (
      targetUserId: string,
      options?: {
        isPublicProfile?: boolean;
        isAcceptedFriend?: boolean;
        isBlocked?: boolean;
      }
    ): boolean => {
      const blocked =
        Boolean(options?.isBlocked) || blockedSet.has(targetUserId);
      const isFriend =
        options?.isAcceptedFriend !== undefined
          ? options.isAcceptedFriend
          : acceptedFriendSet.has(targetUserId);
      const visibility: "public" | "private" =
        options?.isPublicProfile === false ? "private" : "public";

      return isUserOnlineForViewer({
        viewerId: currentUserId,
        targetUserId,
        targetProfileVisibility: visibility,
        isAcceptedFriend: isFriend,
        isBlocked: blocked,
        publicOnlineMap: publicOnlinePresenceMap,
        friendOnlineIds,
      });
    },
    [
      currentUserId,
      blockedSet,
      acceptedFriendSet,
      publicOnlinePresenceMap,
      friendOnlineIds,
    ]
  );

  const refreshUser = useCallback(async () => {
    if (!AUTH_ENABLED) {
      setUser(null);
      setUserRole(null);
      setAuthLoading(false);
      return;
    }
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) {
        setUser(null);
        setUserRole(null);
      } else {
        setUser(data.user);
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (roleRow?.role === "admin" || roleRow?.role === "moderator") {
          setUserRole(roleRow.role);
        } else {
          setUserRole("user");
        }
      }
    } catch {
      setUser(null);
      setUserRole(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!AUTH_ENABLED) {
      setAuthLoading(false);
      return;
    }
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setUserRole(null);
        setPresenceMeta(null);
        setAcceptedFriendIds([]);
        setBlockedUserIds([]);
        setFriendOnlineIds(new Set());
        setAuthLoading(false);
        return;
      }
      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        if (session?.user) {
          setUser(session.user);
          void refreshUser();
          void refreshPresenceMetadata();
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshUser, refreshPresenceMetadata]);

  const signOut = useCallback(async () => {
    try {
      const supabase = createClient();
      if (publicChannelRef.current) {
        await publicChannelRef.current.untrack().catch(() => {});
      }
      await Promise.allSettled([
        signOutUserAction(),
        supabase.auth.signOut(),
      ]);
    } finally {
      setUser(null);
      setUserRole(null);
      setPresenceMeta(null);
      setAcceptedFriendIds([]);
      setBlockedUserIds([]);
      setFriendOnlineIds(new Set());
    }
  }, []);

  const persistRightOpen = useCallback((open: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRight = useCallback(() => {
    const next = coordinateDrawerState(
      { leftOpen, rightOpen },
      "toggleRight",
      isMobileOrTabletViewport()
    );
    setLeftOpen(next.leftOpen);
    setRightOpen(next.rightOpen);
    persistRightOpen(next.rightOpen);
  }, [leftOpen, rightOpen, persistRightOpen]);

  const closeRight = useCallback(() => {
    const next = coordinateDrawerState(
      { leftOpen, rightOpen },
      "closeRight",
      isMobileOrTabletViewport()
    );
    setRightOpen(next.rightOpen);
    persistRightOpen(false);
  }, [leftOpen, rightOpen, persistRightOpen]);

  const toggleLeft = useCallback(() => {
    const next = coordinateDrawerState(
      { leftOpen, rightOpen },
      "toggleLeft",
      isMobileOrTabletViewport()
    );
    setLeftOpen(next.leftOpen);
    if (next.rightOpen !== rightOpen) {
      setRightOpen(next.rightOpen);
    }
  }, [leftOpen, rightOpen]);

  const closeLeft = useCallback(() => {
    setLeftOpen(false);
  }, []);

  const value = useMemo<ShellState>(
    () => ({
      user,
      userRole,
      authLoading,
      refreshUser,
      refreshPresenceMetadata,
      signOut,
      rightOpen,
      toggleRight,
      closeRight,
      leftOpen,
      toggleLeft,
      closeLeft,
      publicOnlinePresenceMap,
      friendOnlineIds,
      isUserOnline,
    }),
    [
      user,
      userRole,
      authLoading,
      refreshUser,
      refreshPresenceMetadata,
      signOut,
      rightOpen,
      toggleRight,
      closeRight,
      leftOpen,
      toggleLeft,
      closeLeft,
      publicOnlinePresenceMap,
      friendOnlineIds,
      isUserOnline,
    ]
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}
