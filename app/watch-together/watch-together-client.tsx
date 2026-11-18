"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Crown,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Tv,
  UserCheck,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import MediaPlayer from "@/components/media-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useShell } from "@/components/shell-context";
import { createClient } from "@/lib/supabase/client";
import {
  acceptWatchRoomInvitationAction,
  cancelWatchRoomInvitationAction,
  declineWatchRoomInvitationAction,
  getFriendsOverviewAction,
  getWatchRoomInvitationsAction,
  sendWatchRoomInvitationAction,
} from "@/lib/actions/friendActions";
import type { FriendProfileSummaryDTO } from "@/lib/friends/friendsService";
import type { WatchRoomInvitationDTO } from "@/lib/friends/friendActivityAndInvitesService";
import {
  buildYouTubeEmbedUrl,
  type VideoEpisode,
} from "@/lib/providers/mediaProviderAdapter";
import {
  deduplicateRealtimeParticipants,
  type WatchRoomParticipantSnapshot,
  type WatchRoomResolvedDTO,
} from "@/lib/watch-together/roomService";
import {
  createWatchRoomAction,
  getWatchTogetherLobbyDataAction,
  heartbeatWatchRoomAction,
  leaveWatchRoomAction,
  sendWatchRoomChatAction,
  updateWatchRoomStateAction,
  verifyWatchRoomAccessAction,
  type WatchRoomPrivacy,
  type WatchRoomStatus,
} from "./actions";

export interface WatchRoomAnimeOption {
  externalId: string;
  slug: string;
  title: string;
  coverImage: string | null;
  bannerImage: string | null;
  episodes: number | null;
  trailerId: string | null;
  trailerSite: string | null;
  officialVideoId: string | null;
  officialVideoKind: "video" | "playlist" | null;
  officialVideoCredit: string | null;
}

export interface WatchRoomChatMessage {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id?: string;
    username: string;
    displayName?: string;
    avatarUrl: string | null;
    isPublicProfile?: boolean;
  };
}

export type WatchRoomItem = WatchRoomResolvedDTO;

export interface WatchTogetherCurrentUser {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl: string | null;
  isPublicProfile?: boolean;
}

interface WatchTogetherClientProps {
  initialRooms: WatchRoomItem[];
  animeOptions: WatchRoomAnimeOption[];
  currentUser: WatchTogetherCurrentUser | null;
  blockedUserIds?: string[];
  loadError?: string | null;
}

const HEARTBEAT_INTERVAL_MS = 45_000;

function formatClock(totalSeconds: number): string {
  const safe = Math.max(Math.floor(totalSeconds), 0);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function notifyWatchRoomsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nayozu:watch-rooms-updated"));
  }
}

export default function WatchTogetherClient({
  initialRooms,
  animeOptions,
  currentUser,
  blockedUserIds = [],
  loadError: initialLoadError = null,
}: WatchTogetherClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isUserOnline } = useShell();
  const roomParam = searchParams.get("room") ?? "";
  const inviteParam = searchParams.get("invite") ?? "";

  const [rooms, setRooms] = useState<WatchRoomItem[]>(initialRooms);
  const [lobbyLoading, setLobbyLoading] = useState<boolean>(false);
  const [lobbyError, setLobbyError] = useState<string | null>(initialLoadError);
  const [joinBannerError, setJoinBannerError] = useState<string | null>(null);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  // Stage 4: Watch Together Friend Invitations state
  const [incomingInvites, setIncomingInvites] = useState<
    WatchRoomInvitationDTO[]
  >([]);
  const [roomOutgoingInvites, setRoomOutgoingInvites] = useState<
    WatchRoomInvitationDTO[]
  >([]);
  const [hostFriends, setHostFriends] = useState<FriendProfileSummaryDTO[]>([]);
  const [inviteModalOpen, setInviteModalOpen] = useState<boolean>(false);
  const [loadingHostInvitePanel, setLoadingHostInvitePanel] =
    useState<boolean>(false);
  const [inviteFeedback, setInviteFeedback] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);
  const [actingInviteKey, setActingInviteKey] = useState<string | null>(null);
  const [isInvitePending, startInviteTransition] = useTransition();

  useEffect(() => {
    setRooms(initialRooms);
  }, [initialRooms]);

  useEffect(() => {
    setLobbyError(initialLoadError);
  }, [initialLoadError]);

  const blockedSet = useMemo(() => new Set(blockedUserIds), [blockedUserIds]);

  const refreshLobbyRooms = useCallback(async () => {
    setLobbyLoading(true);
    setLobbyError(null);
    try {
      const [res, invitesRes] = await Promise.all([
        getWatchTogetherLobbyDataAction(),
        currentUser ? getWatchRoomInvitationsAction() : Promise.resolve(null),
      ]);
      if (!res.success) {
        setLobbyError(res.error || "Unable to refresh Watch Together rooms.");
        return;
      }
      setRooms(res.rooms);
      if (invitesRes && invitesRes.success) {
        setIncomingInvites(
          invitesRes.incomingInvitations.filter(
            (inv) => inv.status === "pending" || inv.status === "accepted"
          )
        );
      }
    } catch (err) {
      setLobbyError(
        err instanceof Error
          ? err.message
          : "Unable to refresh Watch Together rooms."
      );
    } finally {
      setLobbyLoading(false);
    }
  }, [currentUser]);

  const refreshHostInviteData = useCallback(
    async (targetRoomId: string) => {
      if (!currentUser || !targetRoomId) return;
      setLoadingHostInvitePanel(true);
      try {
        const [friendsRes, invitesRes] = await Promise.all([
          getFriendsOverviewAction(),
          getWatchRoomInvitationsAction({ roomId: targetRoomId }),
        ]);
        if (friendsRes.success) {
          setHostFriends(friendsRes.data.friends);
        }
        if (invitesRes.success) {
          setRoomOutgoingInvites(invitesRes.roomOutgoingInvitations);
        }
      } catch {
        /* ignore */
      } finally {
        setLoadingHostInvitePanel(false);
      }
    },
    [currentUser]
  );

  useEffect(() => {
    if (!currentUser) {
      setIncomingInvites([]);
      return;
    }
    void getWatchRoomInvitationsAction().then((res) => {
      if (res.success) {
        setIncomingInvites(
          res.incomingInvitations.filter(
            (inv) => inv.status === "pending" || inv.status === "accepted"
          )
        );
      }
    });
  }, [currentUser]);

  useEffect(() => {
    const onRoomsUpdated = () => {
      void refreshLobbyRooms();
    };
    window.addEventListener("nayozu:watch-rooms-updated", onRoomsUpdated);
    return () => {
      window.removeEventListener("nayozu:watch-rooms-updated", onRoomsUpdated);
    };
  }, [refreshLobbyRooms]);

  // Landing filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "live" | "intermission" | "public" | "private"
  >("all");
  const [quickJoinId, setQuickJoinId] = useState("");

  // Create room modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoomTitle, setNewRoomTitle] = useState("");
  const [newRoomDesc, setNewRoomDesc] = useState("");
  const [selectedAnimeId, setSelectedAnimeId] = useState(
    animeOptions[0]?.externalId ?? ""
  );
  const [newEpisodeNum, setNewEpisodeNum] = useState(1);
  const [newLanguage, setNewLanguage] = useState<"sub" | "dub">("sub");
  const [newPrivacy, setNewPrivacy] = useState<WatchRoomPrivacy>("public");
  const [newAccessCode, setNewAccessCode] = useState("");
  const [newMaxParticipants, setNewMaxParticipants] = useState(8);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, startCreateTransition] = useTransition();

  // Room access verification & private code gate
  const [verifiedRoomId, setVerifiedRoomId] = useState<string | null>(null);
  const [verifiedAccessCode, setVerifiedAccessCode] = useState<string>("");
  const [pendingPrivateRoom, setPendingPrivateRoom] =
    useState<WatchRoomItem | null>(null);
  const [enteredCode, setEnteredCode] = useState("");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [verifyingAccess, setVerifyingAccess] = useState(false);

  // Active room live state
  const activeRoom = useMemo(
    () =>
      rooms.find((r) => r.id === roomParam && !blockedSet.has(r.hostId)) ??
      null,
    [rooms, roomParam, blockedSet]
  );

  const [roomEpisode, setRoomEpisode] = useState<number>(1);
  const [roomLanguage, setRoomLanguage] = useState<"sub" | "dub">("sub");
  const [roomStatus, setRoomStatus] = useState<WatchRoomStatus>("live");
  const [timerSeconds, setTimerSeconds] = useState<number>(0);
  const [timerPlaying, setTimerPlaying] = useState<boolean>(false);
  const [hostActionError, setHostActionError] = useState<string | null>(null);
  const [isUpdatingRoom, startUpdateTransition] = useTransition();

  // Realtime channel state
  const [realtimeStatus, setRealtimeStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const [participants, setParticipants] = useState<
    WatchRoomParticipantSnapshot[]
  >([]);
  const [sideTab, setSideTab] = useState<"chat" | "participants">("chat");
  const [chatMessages, setChatMessages] = useState<WatchRoomChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isSendingChat, startChatTransition] = useTransition();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const participantsRef = useRef<WatchRoomParticipantSnapshot[]>([]);
  const realtimeSyncedRef = useRef<boolean>(false);
  const guestSessionIdRef = useRef<string>(
    `guest_${Math.random().toString(36).slice(2, 8)}`
  );

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  // Sync local state when activeRoom changes
  useEffect(() => {
    if (!activeRoom) {
      setVerifiedRoomId(null);
      setRealtimeStatus("disconnected");
      setParticipants([]);
      return;
    }

    setRoomEpisode(activeRoom.episodeNumber);
    setRoomLanguage(activeRoom.language);
    setRoomStatus(activeRoom.status);
    setTimerSeconds(activeRoom.timerSeconds);
    setTimerPlaying(activeRoom.isPlaying);
    setChatMessages(activeRoom.chatMessages);
    setParticipants(activeRoom.participants ?? []);
    setHostActionError(null);
    setChatError(null);

    // Verify room access on server if not yet verified for this room
    if (verifiedRoomId === activeRoom.id) return;

    const isHost = Boolean(currentUser && currentUser.id === activeRoom.hostId);
    if (isHost) {
      void refreshHostInviteData(activeRoom.id);
    }

    if (activeRoom.privacy === "private" && !isHost && !currentUser) {
      setPendingPrivateRoom(activeRoom);
      return;
    }

    let cancelled = false;
    setVerifyingAccess(true);
    setAccessError(null);
    verifyWatchRoomAccessAction({ roomId: activeRoom.id })
      .then((res) => {
        if (cancelled) return;
        if (res.authorized) {
          setVerifiedRoomId(activeRoom.id);
          setPendingPrivateRoom(null);
          notifyWatchRoomsUpdated();
        } else if (activeRoom.privacy === "private" && !isHost) {
          setPendingPrivateRoom(activeRoom);
        } else {
          setAccessError(res.error || "Unable to join this room.");
          void refreshLobbyRooms();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccessError("Failed to verify room access with server.");
        }
      })
      .finally(() => {
        if (!cancelled) setVerifyingAccess(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeRoom,
    currentUser,
    verifiedRoomId,
    refreshLobbyRooms,
    refreshHostInviteData,
  ]);

  const activeRoomId = activeRoom?.id ?? null;
  const activeRoomHostId = activeRoom?.hostId ?? "";
  const activeRoomMaxParticipants = activeRoom?.maxParticipants ?? 8;

  // Connect to Supabase Realtime Presence + Broadcast when inside a verified room
  useEffect(() => {
    if (!activeRoomId || verifiedRoomId !== activeRoomId) {
      return;
    }

    let isMounted = true;
    const roomId = activeRoomId;
    const hostId = activeRoomHostId;
    const maxCap = activeRoomMaxParticipants;
    const isHost = Boolean(currentUser && currentUser.id === hostId);

    const supabase = createClient();
    const myKey = currentUser?.id ?? guestSessionIdRef.current;
    const myUsername =
      currentUser?.username ?? `Guest_${guestSessionIdRef.current.slice(-4)}`;
    const myDisplayName = currentUser?.displayName || myUsername;
    const myRole: "host" | "viewer" | "guest" = isHost
      ? "host"
      : currentUser
        ? "viewer"
        : "guest";

    setRealtimeStatus("connecting");

    const channel = supabase.channel(`watch-room:${roomId}`, {
      config: {
        presence: { key: myKey },
        broadcast: { self: false },
      },
    });

    channelRef.current = channel;

    const syncPresence = () => {
      if (!isMounted) return;
      const state = channel.presenceState() as Record<
        string,
        Array<Record<string, unknown>>
      >;
      const deduped = deduplicateRealtimeParticipants(state, {
        hostId,
        maxParticipants: maxCap,
        blockedSet,
      });
      setParticipants(deduped);

      // Update local rooms array so participantCount stays accurate in memory
      if (deduped.length > 0) {
        realtimeSyncedRef.current = true;
        setRooms((prev) =>
          prev.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  participants: deduped,
                  participantCount: Math.min(deduped.length, r.maxParticipants),
                  isFull: deduped.length >= r.maxParticipants,
                  isJoinable: deduped.length < r.maxParticipants,
                  lifecycleState:
                    deduped.length >= r.maxParticipants ? "full" : "active",
                }
              : r
          )
        );
      }

      if (isHost && (deduped.length > 0 || realtimeSyncedRef.current)) {
        void heartbeatWatchRoomAction({
          roomId,
          activeParticipants: deduped,
        }).then(() => {
          notifyWatchRoomsUpdated();
        });
      }
    };

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .on(
        "Broadcast" as "broadcast",
        { event: "playback_sync" },
        ({ payload }) => {
          if (!isMounted || !payload || typeof payload !== "object") return;
          const data = payload as {
            episodeNumber?: number;
            language?: "sub" | "dub";
            status?: WatchRoomStatus;
            timerSeconds?: number;
            isPlaying?: boolean;
          };
          if (typeof data.episodeNumber === "number") {
            setRoomEpisode(data.episodeNumber);
          }
          if (data.language === "sub" || data.language === "dub") {
            setRoomLanguage(data.language);
          }
          if (data.status) {
            setRoomStatus(data.status);
            if (data.status === "ended") {
              setTimerPlaying(false);
              setRooms((prev) => prev.filter((r) => r.id !== roomId));
              notifyWatchRoomsUpdated();
            }
          }
          if (typeof data.timerSeconds === "number") {
            setTimerSeconds(data.timerSeconds);
          }
          if (typeof data.isPlaying === "boolean") {
            setTimerPlaying(data.isPlaying);
          }
        }
      )
      .on("Broadcast" as "broadcast", { event: "room_chat" }, ({ payload }) => {
        if (!isMounted || !payload || typeof payload !== "object") return;
        const msg = payload as WatchRoomChatMessage;
        if (!msg.id || !msg.body) return;
        if (msg.author?.id && blockedSet.has(msg.author.id)) return;
        setChatMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
        );
      })
      .subscribe(async (status) => {
        if (!isMounted) return;
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("connected");
          try {
            await channel.track({
              userId: myKey,
              username: myUsername,
              displayName: myDisplayName,
              avatarUrl: currentUser?.avatarUrl ?? null,
              isPublicProfile: currentUser?.isPublicProfile === true,
              role: myRole,
              joinedAt: new Date().toISOString(),
            });
          } catch {
            /* ignore track error */
          }
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          realtimeSyncedRef.current = false;
          setRealtimeStatus("disconnected");
        }
      });

    // Periodic server heartbeat while connected to the room
    const heartbeatTimer = window.setInterval(() => {
      if (!currentUser) return;
      void heartbeatWatchRoomAction({
        roomId,
        activeParticipants:
          isHost && realtimeSyncedRef.current
            ? participantsRef.current
            : undefined,
      });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isMounted = false;
      realtimeSyncedRef.current = false;
      window.clearInterval(heartbeatTimer);
      channelRef.current = null;
      void channel.untrack().catch(() => {});
      void supabase.removeChannel(channel);
      if (currentUser) {
        void leaveWatchRoomAction({ roomId }).then(() => {
          notifyWatchRoomsUpdated();
        });
      }
    };
  }, [
    activeRoomId,
    activeRoomHostId,
    activeRoomMaxParticipants,
    verifiedRoomId,
    currentUser,
    blockedSet,
  ]);

  // Shared watch timer tick when timerPlaying is true
  useEffect(() => {
    if (!timerPlaying || roomStatus !== "live") return;
    const interval = setInterval(() => {
      setTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [timerPlaying, roomStatus]);

  // Filtered rooms for the landing page (excludes ended, stale, and blocked hosts)
  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (blockedSet.has(r.hostId)) return false;
      if (statusFilter === "live" && r.status !== "live") return false;
      if (statusFilter === "intermission" && r.status !== "intermission")
        return false;
      if (statusFilter === "public" && r.privacy !== "public") return false;
      if (statusFilter === "private" && r.privacy !== "private") return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchTitle = r.roomTitle.toLowerCase().includes(q);
        const matchAnime = r.animeTitle.toLowerCase().includes(q);
        const matchHost = r.host.username.toLowerCase().includes(q);
        if (!matchTitle && !matchAnime && !matchHost) return false;
      }
      return true;
    });
  }, [rooms, statusFilter, searchQuery, blockedSet]);

  const selectedAnimeForCreate = useMemo(
    () => animeOptions.find((a) => a.externalId === selectedAnimeId) ?? null,
    [animeOptions, selectedAnimeId]
  );

  // Handlers
  const handleSelectRoom = async (room: WatchRoomItem) => {
    setAccessError(null);
    setJoinBannerError(null);

    const isHost = Boolean(currentUser && currentUser.id === room.hostId);
    if (room.privacy === "private" && !isHost && !currentUser) {
      setPendingPrivateRoom(room);
      setEnteredCode("");
      return;
    }

    setJoiningRoomId(room.id);
    try {
      const res = await verifyWatchRoomAccessAction({ roomId: room.id });
      if (!res.authorized) {
        if (room.privacy === "private" && !isHost) {
          setPendingPrivateRoom(room);
          setEnteredCode("");
          router.push(`/watch-together?room=${encodeURIComponent(room.id)}`, {
            scroll: false,
          });
          return;
        }
        setJoinBannerError(
          res.error || "This Watch Together room is no longer available."
        );
        void refreshLobbyRooms();
        notifyWatchRoomsUpdated();
        return;
      }

      setVerifiedRoomId(room.id);
      notifyWatchRoomsUpdated();
      router.push(`/watch-together?room=${encodeURIComponent(room.id)}`, {
        scroll: false,
      });
    } catch {
      setJoinBannerError("Could not join room right now. Please try again.");
    } finally {
      setJoiningRoomId(null);
    }
  };

  const handleSendFriendInvite = (friend: FriendProfileSummaryDTO) => {
    if (!activeRoom) return;
    setInviteFeedback(null);
    setActingInviteKey(friend.id);
    startInviteTransition(async () => {
      try {
        const res = await sendWatchRoomInvitationAction({
          roomId: activeRoom.id,
          inviteeUserId: friend.id,
        });
        if (!res.success) {
          setInviteFeedback({
            type: "error",
            text: res.error || "Could not send Watch Together invitation.",
          });
          return;
        }
        setInviteFeedback({
          type: "success",
          text:
            res.message ||
            `Watch Together invitation sent to @${friend.username}.`,
        });
        await refreshHostInviteData(activeRoom.id);
      } finally {
        setActingInviteKey(null);
      }
    });
  };

  const handleCancelFriendInvite = (inv: WatchRoomInvitationDTO) => {
    if (!activeRoom) return;
    setInviteFeedback(null);
    setActingInviteKey(inv.id);
    startInviteTransition(async () => {
      try {
        const res = await cancelWatchRoomInvitationAction({
          invitationId: inv.id,
        });
        if (!res.success) {
          setInviteFeedback({
            type: "error",
            text: res.error || "Could not cancel invitation.",
          });
          return;
        }
        setInviteFeedback({
          type: "success",
          text: `Cancelled invitation to @${inv.invitee.username}.`,
        });
        await refreshHostInviteData(activeRoom.id);
      } finally {
        setActingInviteKey(null);
      }
    });
  };

  const handleAcceptRoomInvitation = (inv: WatchRoomInvitationDTO) => {
    setJoinBannerError(null);
    setAccessError(null);
    setActingInviteKey(inv.id);
    startInviteTransition(async () => {
      try {
        const res = await acceptWatchRoomInvitationAction({
          invitationId: inv.id,
        });
        if (!res.success) {
          setJoinBannerError(
            res.error || "Unable to accept Watch Together invitation."
          );
          setAccessError(
            res.error || "Unable to accept Watch Together invitation."
          );
          void refreshLobbyRooms();
          return;
        }
        setVerifiedRoomId(inv.roomId);
        setPendingPrivateRoom(null);
        notifyWatchRoomsUpdated();
        router.push(
          `/watch-together?room=${encodeURIComponent(inv.roomId)}`,
          { scroll: false }
        );
      } finally {
        setActingInviteKey(null);
      }
    });
  };

  const handleDeclineRoomInvitation = (inv: WatchRoomInvitationDTO) => {
    setJoinBannerError(null);
    setActingInviteKey(inv.id);
    startInviteTransition(async () => {
      try {
        const res = await declineWatchRoomInvitationAction({
          invitationId: inv.id,
        });
        if (res.success) {
          setIncomingInvites((prev) =>
            prev.filter((item) => item.id !== inv.id)
          );
          notifyWatchRoomsUpdated();
        } else {
          setJoinBannerError(res.error || "Could not decline invitation.");
        }
      } finally {
        setActingInviteKey(null);
      }
    });
  };

  const handleLeaveRoom = async () => {
    if (activeRoom) {
      const leavingId = activeRoom.id;
      setVerifiedRoomId(null);
      await leaveWatchRoomAction({ roomId: leavingId });
      notifyWatchRoomsUpdated();
    }
    router.push("/watch-together");
    void refreshLobbyRooms();
  };

  const handleSubmitPrivateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPrivateRoom) return;
    setVerifyingAccess(true);
    setAccessError(null);

    try {
      const res = await verifyWatchRoomAccessAction({
        roomId: pendingPrivateRoom.id,
        accessCode: enteredCode,
      });
      if (res.authorized) {
        setVerifiedRoomId(pendingPrivateRoom.id);
        setVerifiedAccessCode(enteredCode);
        const targetId = pendingPrivateRoom.id;
        setPendingPrivateRoom(null);
        notifyWatchRoomsUpdated();
        router.push(`/watch-together?room=${encodeURIComponent(targetId)}`, {
          scroll: false,
        });
      } else {
        setAccessError(res.error || "Invalid invite code.");
      }
    } catch {
      setAccessError("Failed to verify invite code.");
    } finally {
      setVerifyingAccess(false);
    }
  };

  const handleQuickJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickJoinId.trim();
    if (!trimmed) return;
    const found = rooms.find(
      (r) =>
        r.id.toLowerCase() === trimmed.toLowerCase() ||
        r.id.toLowerCase().startsWith(trimmed.toLowerCase())
    );
    if (found) {
      void handleSelectRoom(found);
    } else {
      router.push(`/watch-together?room=${encodeURIComponent(trimmed)}`, {
        scroll: false,
      });
    }
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!currentUser) {
      setCreateError("You must be signed in to create a Watch Together room.");
      return;
    }

    startCreateTransition(async () => {
      const result = await createWatchRoomAction({
        roomTitle: newRoomTitle,
        description: newRoomDesc,
        animeExternalId: selectedAnimeId,
        episodeNumber: newEpisodeNum,
        language: newLanguage,
        privacy: newPrivacy,
        accessCode: newPrivacy === "private" ? newAccessCode : undefined,
        maxParticipants: newMaxParticipants,
      });

      if (!result.success || !result.roomId) {
        setCreateError(result.error || "Failed to create room.");
        return;
      }

      setCreateOpen(false);
      setNewRoomTitle("");
      setNewRoomDesc("");
      setVerifiedRoomId(result.roomId);
      if (newPrivacy === "private") {
        setVerifiedAccessCode(newAccessCode);
      }
      notifyWatchRoomsUpdated();
      router.push(`/watch-together?room=${encodeURIComponent(result.roomId)}`);
      router.refresh();
    });
  };

  const broadcastAndPersistHostState = (next: {
    episodeNumber?: number;
    language?: "sub" | "dub";
    status?: WatchRoomStatus;
    timerSeconds?: number;
    isPlaying?: boolean;
  }) => {
    if (!activeRoom) return;
    setHostActionError(null);

    const nextEp = next.episodeNumber ?? roomEpisode;
    const nextLang = next.language ?? roomLanguage;
    const nextStatus = next.status ?? roomStatus;
    const nextTimer = next.timerSeconds ?? timerSeconds;
    const nextPlaying = next.isPlaying ?? timerPlaying;

    setRoomEpisode(nextEp);
    setRoomLanguage(nextLang);
    setRoomStatus(nextStatus);
    setTimerSeconds(nextTimer);
    setTimerPlaying(nextPlaying);

    if (channelRef.current && realtimeStatus === "connected") {
      channelRef.current.send({
        type: "broadcast",
        event: "playback_sync",
        payload: {
          episodeNumber: nextEp,
          language: nextLang,
          status: nextStatus,
          timerSeconds: nextTimer,
          isPlaying: nextPlaying,
        },
      });
    }

    startUpdateTransition(async () => {
      const res = await updateWatchRoomStateAction({
        roomId: activeRoom.id,
        episodeNumber: nextEp,
        language: nextLang,
        status: nextStatus,
        timerSeconds: nextTimer,
        isPlaying: nextPlaying,
      });
      if (!res.success) {
        setHostActionError(res.error || "Failed to persist room state.");
      } else {
        notifyWatchRoomsUpdated();
        if (nextStatus === "ended") {
          setRooms((prev) => prev.filter((r) => r.id !== activeRoom.id));
          router.push("/watch-together");
          router.refresh();
        }
      }
    });
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom || !chatInput.trim()) return;
    setChatError(null);

    const text = chatInput.trim();
    startChatTransition(async () => {
      const res = await sendWatchRoomChatAction({
        roomId: activeRoom.id,
        message: text,
        accessCode: verifiedAccessCode || undefined,
      });

      if (!res.success || !res.chatMessage) {
        setChatError(res.error || "Failed to send message.");
        return;
      }

      setChatInput("");
      setChatMessages((prev) =>
        prev.some((m) => m.id === res.chatMessage!.id)
          ? prev
          : [...prev, res.chatMessage!]
      );

      if (channelRef.current && realtimeStatus === "connected") {
        channelRef.current.send({
          type: "broadcast",
          event: "room_chat",
          payload: res.chatMessage,
        });
      }
    });
  };

  // Resolve official episodes/trailer for the active room's anime
  const activeAnimeMeta = useMemo(() => {
    if (!activeRoom) return null;
    return (
      animeOptions.find((a) => a.externalId === activeRoom.animeExternalId) ??
      null
    );
  }, [activeRoom, animeOptions]);

  const activeOfficialEpisodes = useMemo<VideoEpisode[]>(() => {
    if (!activeRoom) return [];
    if (activeAnimeMeta?.officialVideoId) {
      const kind =
        activeAnimeMeta.officialVideoKind === "playlist" ? "playlist" : "video";
      return [
        {
          id: `${activeRoom.animeExternalId}-official`,
          number: 1,
          title: activeRoom.animeTitle,
          embedUrl: buildYouTubeEmbedUrl(activeAnimeMeta.officialVideoId, kind),
          provider: "youtube",
          credit: activeAnimeMeta.officialVideoCredit || "Official Stream",
        },
      ];
    }
    if (
      activeAnimeMeta?.trailerId &&
      activeAnimeMeta.trailerSite?.toLowerCase() === "youtube"
    ) {
      return [
        {
          id: `${activeRoom.animeExternalId}-trailer`,
          number: 1,
          title: `${activeRoom.animeTitle} (Official Trailer)`,
          embedUrl: buildYouTubeEmbedUrl(activeAnimeMeta.trailerId, "video"),
          provider: "youtube",
          credit: "Official YouTube Trailer",
        },
      ];
    }
    return [];
  }, [activeRoom, activeAnimeMeta]);

  /* ================================================================== */
  /* ACTIVE ROOM VIEW                                                   */
  /* ================================================================== */
  if (roomParam) {
    if (!activeRoom) {
      return (
        <div className="rounded-2xl border border-[#1e253d] bg-[#121625] p-8 text-center space-y-4">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-white">
              Watch Room Not Found or Ended
            </h1>
            <p className="text-sm text-zinc-400">
              Room <code className="text-zinc-200">{roomParam}</code> does not
              exist, has expired due to inactivity, or has already ended.
            </p>
          </div>
          <Button
            asChild
            className="rounded-xl bg-primary text-primary-foreground"
          >
            <Link href="/watch-together">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Watch Together Lobby
            </Link>
          </Button>
        </div>
      );
    }

    if (roomStatus === "ended") {
      return (
        <div className="rounded-2xl border border-[#1e253d] bg-[#121625] p-8 text-center space-y-4">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-white">
              Watch Together Session Ended
            </h1>
            <p className="text-sm text-zinc-400">
              The host has ended <strong>{activeRoom.roomTitle}</strong>.
            </p>
          </div>
          <Button
            asChild
            className="rounded-xl bg-primary text-primary-foreground"
          >
            <Link href="/watch-together">
              <ArrowLeft className="mr-2 h-4 w-4" /> Return to Lobby
            </Link>
          </Button>
        </div>
      );
    }

    if (verifyingAccess) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[#1e253d] bg-[#121625] py-20 gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-zinc-300">
            Validating room permissions and capacity on server...
          </p>
        </div>
      );
    }

    if (pendingPrivateRoom && verifiedRoomId !== activeRoom.id) {
      const matchingInvite = incomingInvites.find(
        (inv) =>
          inv.roomId === activeRoom.id &&
          (inv.status === "pending" || inv.status === "accepted") &&
          (!inviteParam || inv.id === inviteParam || inv.roomId === activeRoom.id)
      );

      return (
        <div className="mx-auto max-w-md rounded-2xl border border-[#1e253d] bg-[#121625] p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">
                Private Watch Room
              </h1>
              <p className="text-xs text-zinc-400">
                Hosted by @{activeRoom.host.username}
              </p>
            </div>
          </div>

          {matchingInvite && matchingInvite.status === "pending" && (
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-3.5 space-y-2.5">
              <p className="text-xs text-zinc-200">
                <strong>@{matchingInvite.host.username}</strong> invited you to
                join this private Watch Together session.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    isInvitePending && actingInviteKey === matchingInvite.id
                  }
                  onClick={() => handleAcceptRoomInvitation(matchingInvite)}
                  className="bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"
                >
                  {isInvitePending && actingInviteKey === matchingInvite.id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Accept Invitation &amp; Join
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    isInvitePending && actingInviteKey === matchingInvite.id
                  }
                  onClick={() => handleDeclineRoomInvitation(matchingInvite)}
                  className="text-xs"
                >
                  Decline
                </Button>
              </div>
            </div>
          )}

          <p className="text-sm text-zinc-300">
            <strong>{activeRoom.roomTitle}</strong> requires an invite code to
            enter. Access and room capacity are verified on the server.
          </p>

          <form onSubmit={handleSubmitPrivateCode} className="space-y-3">
            <Input
              type="password"
              placeholder="Enter room invite code..."
              value={enteredCode}
              onChange={(e) => setEnteredCode(e.target.value)}
              required
            />
            {accessError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {accessError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPendingPrivateRoom(null);
                  router.push("/watch-together");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={verifyingAccess || !enteredCode.trim()}
                className="bg-primary text-primary-foreground"
              >
                {verifyingAccess ? "Verifying..." : "Unlock & Join Room"}
              </Button>
            </div>
          </form>
        </div>
      );
    }

    if (accessError && verifiedRoomId !== activeRoom.id) {
      return (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center space-y-4">
          <ShieldAlert className="mx-auto h-10 w-10 text-red-400" />
          <h1 className="text-lg font-bold text-white">Room Access Denied</h1>
          <p className="text-sm text-zinc-300">{accessError}</p>
          <Button asChild variant="outline">
            <Link href="/watch-together">Back to Lobby</Link>
          </Button>
        </div>
      );
    }

    const isHost = Boolean(currentUser && currentUser.id === activeRoom.hostId);
    const displayedParticipants =
      participants.length > 0 ? participants : activeRoom.participants ?? [];
    const liveViewerCount = Math.min(
      Math.max(
        displayedParticipants.length,
        activeRoom.participantCount || 1,
        1
      ),
      activeRoom.maxParticipants
    );
    const isMultiViewerSynced =
      realtimeStatus === "connected" && displayedParticipants.length >= 2;

    return (
      <div className="space-y-6 pb-10">
        {/* Top Room Navigation & Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#1b2238] bg-[#121624] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleLeaveRoom()}
              className="text-zinc-300"
            >
              <LogOut className="mr-1.5 h-4 w-4" /> Leave Room
            </Button>
            <div className="h-4 w-px bg-white/10 hidden sm:block" />
            <div className="flex flex-wrap items-center gap-2">
              {roomStatus === "live" ? (
                <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                  <Radio className="mr-1 h-3 w-3 animate-pulse" /> Live Room
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-amber-400/40 text-amber-300"
                >
                  Intermission
                </Badge>
              )}

              {activeRoom.privacy === "private" ? (
                <Badge variant="outline" className="text-xs text-zinc-300">
                  <Lock className="mr-1 h-3 w-3" /> Invite Only
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-zinc-300">
                  <Globe className="mr-1 h-3 w-3" /> Public
                </Badge>
              )}
            </div>
          </div>

          {/* Honest Realtime Connection Indicator */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {realtimeStatus === "connected" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-medium text-emerald-400">
                <Wifi className="h-3.5 w-3.5" />
                Realtime Connected ({liveViewerCount}/
                {activeRoom.maxParticipants} in room)
              </span>
            ) : realtimeStatus === "connecting" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-medium text-amber-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Connecting to room channel ({liveViewerCount}/
                {activeRoom.maxParticipants})...
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/80 px-3 py-1 font-medium text-zinc-400">
                <WifiOff className="h-3.5 w-3.5" />
                Local Playback ({liveViewerCount}/{activeRoom.maxParticipants}{" "}
                recorded)
              </span>
            )}

            {activeRoom.animeSlug && (
              <Link
                href={`/anime/${activeRoom.animeSlug}`}
                className="inline-flex items-center gap-1 text-zinc-400 hover:text-primary transition-colors"
              >
                Title Page <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>

        {/* Room Title & Honest Sync Disclosure Banner */}
        <div className="rounded-2xl border border-[#1e253d] bg-[#121625] p-5 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h1 className="text-xl md:text-2xl font-bold text-white">
                {activeRoom.roomTitle}
              </h1>
              <p className="text-xs md:text-sm text-zinc-400">
                Watching{" "}
                <strong className="text-zinc-200">
                  {activeRoom.animeTitle}
                </strong>{" "}
                · Episode {roomEpisode}
                {activeRoom.totalEpisodes
                  ? ` of ${activeRoom.totalEpisodes}`
                  : ""}{" "}
                ({roomLanguage.toUpperCase()}) · Hosted by{" "}
                {activeRoom.host.isPublicProfile ? (
                  <Link
                    href={`/u/${encodeURIComponent(activeRoom.host.username)}`}
                    className="text-primary font-semibold hover:underline"
                  >
                    @{activeRoom.host.username}
                  </Link>
                ) : (
                  <span className="text-primary font-semibold">
                    @{activeRoom.host.username}
                  </span>
                )}
              </p>
              {activeRoom.description && (
                <p className="text-xs text-zinc-400 pt-0.5">
                  {activeRoom.description}
                </p>
              )}
            </div>

            {/* Shared Watch Timer & Coordinator */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#232b45] bg-[#0d111d] px-4 py-2.5">
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400">
                  Shared Room Timer
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-bold text-white">
                    {formatClock(timerSeconds)}
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      timerPlaying ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {timerPlaying ? "Running" : "Paused"}
                  </span>
                </div>
              </div>

              {isHost && (
                <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isUpdatingRoom}
                    onClick={() =>
                      broadcastAndPersistHostState({ isPlaying: !timerPlaying })
                    }
                    className="h-8 px-2.5 text-xs"
                  >
                    {timerPlaying ? (
                      <>
                        <Pause className="mr-1 h-3.5 w-3.5" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="mr-1 h-3.5 w-3.5" /> Start
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isUpdatingRoom}
                    onClick={() =>
                      broadcastAndPersistHostState({
                        timerSeconds: 0,
                        isPlaying: false,
                      })
                    }
                    title="Reset shared timer to 00:00"
                    className="h-8 px-2 text-xs text-zinc-400 hover:text-white"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Honest Technical Synchronization Notice */}
          <div className="rounded-xl border border-[#222a42] bg-[#0e1220] px-3.5 py-2.5 text-xs text-zinc-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-start sm:items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5 sm:mt-0" />
              <span>
                {isMultiViewerSynced ? (
                  <>
                    <strong>Room Episode &amp; Shared Timer Synced:</strong>{" "}
                    Connected with {liveViewerCount} active participants via
                    Supabase Realtime. Video streams load independently per
                    viewer to respect media-provider restrictions — align your
                    player with the Shared Room Timer (
                    <code className="text-primary">
                      {formatClock(timerSeconds)}
                    </code>
                    ).
                  </>
                ) : realtimeStatus === "connected" ? (
                  <>
                    <strong>
                      Realtime Channel Ready ({liveViewerCount} participant in
                      room):
                    </strong>{" "}
                    Share this room link so others can join. Video players
                    resolve streams independently per viewer; episode selection,
                    chat, and the shared timer broadcast in real time when peers
                    join.
                  </>
                ) : (
                  <>
                    <strong>Independent Playback Mode:</strong> Video streams
                    are not frame-locked across browsers. Use the Shared Room
                    Timer to coordinate playback.
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Host Controls Bar (Strictly Server-Verified Host Only) */}
          {isHost && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                <Crown className="h-4 w-4 text-amber-400" />
                <span>Host Room Controls (Server-Verified)</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-400">Episode:</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={roomEpisode <= 1 || isUpdatingRoom}
                    onClick={() =>
                      broadcastAndPersistHostState({
                        episodeNumber: Math.max(roomEpisode - 1, 1),
                        timerSeconds: 0,
                      })
                    }
                    className="h-7 px-2 text-xs"
                  >
                    -1
                  </Button>
                  <span className="px-2 text-xs font-bold text-white">
                    Ep {roomEpisode}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      Boolean(
                        activeRoom.totalEpisodes &&
                          roomEpisode >= activeRoom.totalEpisodes
                      ) || isUpdatingRoom
                    }
                    onClick={() =>
                      broadcastAndPersistHostState({
                        episodeNumber: roomEpisode + 1,
                        timerSeconds: 0,
                      })
                    }
                    className="h-7 px-2 text-xs"
                  >
                    +1
                  </Button>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isUpdatingRoom}
                  onClick={() =>
                    broadcastAndPersistHostState({
                      language: roomLanguage === "sub" ? "dub" : "sub",
                    })
                  }
                  className="h-7 text-xs"
                >
                  Audio: {roomLanguage.toUpperCase()}
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isUpdatingRoom}
                  onClick={() =>
                    broadcastAndPersistHostState({
                      status: roomStatus === "live" ? "intermission" : "live",
                      isPlaying: false,
                    })
                  }
                  className="h-7 text-xs"
                >
                  {roomStatus === "live" ? "Set Intermission" : "Resume Live"}
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isUpdatingRoom}
                  onClick={() => {
                    const nextOpen = !inviteModalOpen;
                    setInviteModalOpen(nextOpen);
                    setInviteFeedback(null);
                    if (nextOpen) {
                      void refreshHostInviteData(activeRoom.id);
                    }
                  }}
                  className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/10"
                >
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  Invite Friends
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={isUpdatingRoom}
                  onClick={() =>
                    broadcastAndPersistHostState({
                      status: "ended",
                      isPlaying: false,
                    })
                  }
                  className="h-7 text-xs"
                >
                  End Room
                </Button>
              </div>
            </div>
          )}

          {isHost && inviteModalOpen && (
            <div className="rounded-xl border border-[#232b45] bg-[#0d111d] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <UserPlus className="h-4 w-4 text-primary" />
                  <span>Invite Accepted Friends to This Room</span>
                </div>
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  className="text-zinc-400 hover:text-white"
                  aria-label="Close friend invite panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {inviteFeedback && (
                <p
                  className={`text-xs font-medium ${
                    inviteFeedback.type === "error"
                      ? "text-rose-300"
                      : "text-emerald-300"
                  }`}
                >
                  {inviteFeedback.text}
                </p>
              )}

              {loadingHostInvitePanel ? (
                <div className="flex items-center gap-2 py-3 text-xs text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>Loading your friends list...</span>
                </div>
              ) : hostFriends.length === 0 ? (
                <p className="text-xs text-zinc-400">
                  You don&apos;t have any accepted friends yet. Add friends in{" "}
                  <Link
                    href="/profile?tab=friends&subtab=search"
                    className="text-primary underline"
                  >
                    your Friends tab
                  </Link>{" "}
                  to invite them directly to Watch Together rooms.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {hostFriends.map((friend) => {
                    const existingInvite = roomOutgoingInvites.find(
                      (inv) =>
                        inv.inviteeId === friend.id &&
                        (inv.status === "pending" || inv.status === "accepted")
                    );
                    const alreadyInRoom = displayedParticipants.some(
                      (p) => p.userId === friend.id
                    );
                    const online = isUserOnline(friend.id, {
                      isPublicProfile: friend.profileVisibility === "public",
                      isAcceptedFriend: true,
                      isBlocked: false,
                    });
                    const busy =
                      isInvitePending &&
                      (actingInviteKey === friend.id ||
                        actingInviteKey === existingInvite?.id);

                    return (
                      <div
                        key={friend.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[#1c233a] bg-[#121625] px-3 py-2"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              online ? "bg-emerald-400" : "bg-zinc-600"
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">
                              {friend.displayName || friend.username}
                            </p>
                            <p className="truncate text-[10px] text-zinc-400">
                              @{friend.username} · {online ? "Online" : "Offline"}
                            </p>
                          </div>
                        </div>

                        {alreadyInRoom ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
                            <UserCheck className="h-3.5 w-3.5" /> In Room
                          </span>
                        ) : existingInvite?.status === "accepted" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
                            <Check className="h-3.5 w-3.5" /> Accepted
                          </span>
                        ) : existingInvite?.status === "pending" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              handleCancelFriendInvite(existingInvite)
                            }
                            className="h-7 px-2.5 text-[11px]"
                          >
                            Cancel Invite
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              busy ||
                              liveViewerCount >= activeRoom.maxParticipants
                            }
                            onClick={() => handleSendFriendInvite(friend)}
                            className="h-7 bg-primary px-2.5 text-[11px] text-primary-foreground"
                          >
                            <UserPlus className="mr-1 h-3 w-3" />
                            Invite
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {hostActionError && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {hostActionError}
            </p>
          )}
        </div>

        {/* Main 2-Column Watch Layout: Video Player (Left) + Chat & Participants (Right) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left 8 Columns: Existing Nayozu MediaPlayer */}
          <div className="lg:col-span-8 space-y-4">
            <MediaPlayer
              key={`${activeRoom.animeExternalId}-${roomEpisode}-${roomLanguage}`}
              animeId={activeRoom.animeExternalId}
              title={activeRoom.animeTitle}
              episodes={activeOfficialEpisodes}
              initialProgress={roomEpisode}
              initialLanguage={roomLanguage}
              userId={currentUser?.id ?? null}
            />
          </div>

          {/* Right 4 Columns: Participants & Room Chat */}
          <div className="lg:col-span-4 flex flex-col rounded-2xl border border-[#1e253d] bg-[#121625] overflow-hidden h-[560px]">
            {/* Tab Switcher */}
            <div className="grid grid-cols-2 border-b border-[#1e253d] bg-[#0e1220]">
              <button
                type="button"
                onClick={() => setSideTab("chat")}
                className={`flex items-center justify-center gap-2 py-3 text-xs font-semibold transition-colors ${
                  sideTab === "chat"
                    ? "border-b-2 border-primary text-primary bg-[#121625]"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Room Chat ({chatMessages.length})
              </button>
              <button
                type="button"
                onClick={() => setSideTab("participants")}
                className={`flex items-center justify-center gap-2 py-3 text-xs font-semibold transition-colors ${
                  sideTab === "participants"
                    ? "border-b-2 border-primary text-primary bg-[#121625]"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Participants ({liveViewerCount}/{activeRoom.maxParticipants})
              </button>
            </div>

            {sideTab === "participants" ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Room Host Card */}
                <div className="rounded-xl border border-[#232b45] bg-[#0e1220] p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative flex h-8 w-8 shrink-0 overflow-hidden items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                      {activeRoom.host.avatarUrl ? (
                        <Image
                          src={activeRoom.host.avatarUrl}
                          alt={activeRoom.host.username}
                          fill
                          sizes="32px"
                          className="object-cover"
                        />
                      ) : (
                        <span>
                          {activeRoom.host.username.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      {activeRoom.host.isPublicProfile ? (
                        <Link
                          href={`/u/${encodeURIComponent(activeRoom.host.username)}`}
                          className="block truncate text-xs font-semibold text-white hover:text-primary"
                        >
                          @{activeRoom.host.username}
                        </Link>
                      ) : (
                        <p className="truncate text-xs font-semibold text-white">
                          @{activeRoom.host.username}
                        </p>
                      )}
                      <p className="text-[11px] text-zinc-400">Room Host</p>
                    </div>
                  </div>
                  <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px]">
                    <Crown className="mr-1 h-3 w-3" /> Host
                  </Badge>
                </div>

                <div className="pt-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    Active Participants ({liveViewerCount}/
                    {activeRoom.maxParticipants})
                  </p>
                  {displayedParticipants.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-4 text-center">
                      {realtimeStatus === "connected"
                        ? "Synchronizing participant presence..."
                        : "Participant list temporarily unavailable."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {displayedParticipants.map((p) => (
                        <div
                          key={p.key}
                          className="flex items-center justify-between rounded-xl border border-[#1b2238] bg-[#151a2c] px-3 py-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                            {p.isPublicProfile && p.userId ? (
                              <Link
                                href={`/u/${encodeURIComponent(p.username)}`}
                                className="truncate text-xs font-medium text-white hover:text-primary"
                              >
                                {p.displayName || p.username}
                              </Link>
                            ) : (
                              <span className="truncate text-xs font-medium text-white">
                                {p.displayName || p.username}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                            {p.role}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Messages Feed */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {chatMessages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-center px-4 space-y-2">
                      <MessageSquare className="h-7 w-7 text-zinc-600" />
                      <p className="text-xs text-zinc-400">
                        No chat messages in this room yet. Start the
                        conversation!
                      </p>
                    </div>
                  ) : (
                    chatMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className="rounded-xl border border-[#1c233a] bg-[#0e1220] p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-primary">
                            @{msg.author.username}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-200 leading-relaxed break-words">
                          {msg.body}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                {/* Chat Composer / Honest Auth Gate */}
                <div className="border-t border-[#1e253d] bg-[#0e1220] p-3">
                  {!currentUser ? (
                    <div className="rounded-lg border border-[#232b45] bg-[#121625] p-2.5 text-center space-y-2">
                      <p className="text-xs text-zinc-300">
                        Sign in to post messages in room chat.
                      </p>
                      <Button
                        asChild
                        size="sm"
                        className="h-7 text-xs bg-primary text-primary-foreground"
                      >
                        <Link
                          href={`/login?next=${encodeURIComponent(`/watch-together?room=${activeRoom.id}`)}`}
                        >
                          Sign In
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleSendChat} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Send a message to the room..."
                          maxLength={500}
                          disabled={isSendingChat}
                          className="h-9 text-xs"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isSendingChat || !chatInput.trim()}
                          className="h-9 px-3 bg-primary text-primary-foreground"
                        >
                          {isSendingChat ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {chatError && (
                        <p className="text-[11px] text-red-400">{chatError}</p>
                      )}
                    </form>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================== */
  /* WATCH TOGETHER LANDING / LOBBY VIEW                                */
  /* ================================================================== */
  return (
    <div className="space-y-8 pb-12">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1e253d] bg-gradient-to-br from-[#14192d] via-[#111525] to-[#0b0e17] p-6 md:p-8">
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 border border-primary/30 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
              <Tv className="h-3.5 w-3.5" /> Watch Together Lobby
            </span>
            <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-white">
              Watch Together with the Community
            </h1>
            <p className="text-xs md:text-sm text-zinc-300 leading-relaxed">
              Join an active watch room or host your own session. Rooms
              coordinate episode selection, live participant presence, a shared
              watch timer, and room chat via Supabase Realtime while respecting
              media-provider playback rules.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => void refreshLobbyRooms()}
              disabled={lobbyLoading}
              className="h-11 rounded-xl border-[#232b45] bg-[#121625] px-4 text-xs font-semibold text-zinc-200 hover:bg-[#192036] hover:text-white"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${lobbyLoading ? "animate-spin text-primary" : ""}`}
              />
              Refresh Rooms
            </Button>
            <Button
              type="button"
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
              className="h-11 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110"
            >
              <Plus className="mr-2 h-4 w-4" /> Create Watch Room
            </Button>
          </div>
        </div>
      </section>

      {/* Create Room Modal / Panel */}
      {createOpen && (
        <section className="rounded-2xl border border-primary/40 bg-[#121625] p-6 space-y-5 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Tv className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-white">
                Host a Watch Together Room
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
              aria-label="Close create room form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!currentUser ? (
            <div className="rounded-xl border border-[#232b45] bg-[#0e1220] p-6 text-center space-y-3">
              <Lock className="mx-auto h-8 w-8 text-primary" />
              <h3 className="text-base font-bold text-white">
                Authentication Required to Host a Room
              </h3>
              <p className="max-w-md mx-auto text-xs text-zinc-400">
                Room creation, host playback controls, and persistent chat
                require a verified Nayozu account. Sign in or create an account
                to host your own room.
              </p>
              <div className="flex items-center justify-center gap-3 pt-1">
                <Button asChild className="bg-primary text-primary-foreground">
                  <Link href="/login?next=%2Fwatch-together">Sign In</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/register?next=%2Fwatch-together">
                    Create Account
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-300">
                    Room Title *
                  </label>
                  <Input
                    value={newRoomTitle}
                    onChange={(e) => setNewRoomTitle(e.target.value)}
                    placeholder="e.g. Weekend Shonen Marathon — Ep 1 Watch"
                    maxLength={80}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-300">
                    Select Anime Title *
                  </label>
                  <select
                    aria-label="Select Anime Title"
                    value={selectedAnimeId}
                    onChange={(e) => {
                      setSelectedAnimeId(e.target.value);
                      setNewEpisodeNum(1);
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  >
                    {animeOptions.map((a) => (
                      <option key={a.externalId} value={a.externalId}>
                        {a.title} {a.episodes ? `(${a.episodes} eps)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-300">
                    Starting Episode
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={selectedAnimeForCreate?.episodes || 2000}
                    value={newEpisodeNum}
                    onChange={(e) =>
                      setNewEpisodeNum(Math.max(Number(e.target.value) || 1, 1))
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-300">
                    Audio Track
                  </label>
                  <select
                    aria-label="Audio Track"
                    value={newLanguage}
                    onChange={(e) =>
                      setNewLanguage(e.target.value === "dub" ? "dub" : "sub")
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  >
                    <option value="sub">Subtitled (SUB)</option>
                    <option value="dub">English Dub (DUB)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-300">
                    Max Viewers
                  </label>
                  <Input
                    type="number"
                    min={2}
                    max={25}
                    value={newMaxParticipants}
                    onChange={(e) =>
                      setNewMaxParticipants(
                        Math.min(Math.max(Number(e.target.value) || 8, 2), 25)
                      )
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-300">
                    Room Access
                  </label>
                  <select
                    aria-label="Room Access"
                    value={newPrivacy}
                    onChange={(e) =>
                      setNewPrivacy(
                        e.target.value === "private" ? "private" : "public"
                      )
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  >
                    <option value="public">Public Room</option>
                    <option value="private">Private (Invite Code)</option>
                  </select>
                </div>
              </div>

              {newPrivacy === "private" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-300">
                    Room Invite Code (4+ characters, verified on server) *
                  </label>
                  <Input
                    type="password"
                    value={newAccessCode}
                    onChange={(e) => setNewAccessCode(e.target.value)}
                    placeholder="Set a secret code for your guests..."
                    minLength={4}
                    required
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Room Note / Discussion Topic (optional)
                </label>
                <Textarea
                  value={newRoomDesc}
                  onChange={(e) => setNewRoomDesc(e.target.value)}
                  placeholder="Share house rules, spoiler policy, or schedule notes..."
                  rows={2}
                  maxLength={280}
                />
              </div>

              {createError && (
                <p className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {createError}
                </p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isCreating}
                  className="bg-primary text-primary-foreground"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating
                      Room...
                    </>
                  ) : (
                    "Create & Enter Room"
                  )}
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Search, Filter Tabs & Quick Join Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: "all", label: "All Rooms" },
              { id: "live", label: "Live Now" },
              { id: "intermission", label: "Intermission" },
              { id: "public", label: "Public" },
              { id: "private", label: "Invite Only" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                statusFilter === tab.id
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                  : "border border-[#1b2238] bg-[#121624] text-zinc-400 hover:border-primary/40 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search rooms, anime, host..."
              className="pl-8 text-xs"
            />
          </div>

          <form
            onSubmit={handleQuickJoin}
            className="flex items-center gap-1.5"
          >
            <Input
              value={quickJoinId}
              onChange={(e) => setQuickJoinId(e.target.value)}
              placeholder="Enter Room ID..."
              className="w-36 text-xs"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="h-9 text-xs"
            >
              <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Join ID
            </Button>
          </form>
        </div>
      </div>

      {joinBannerError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>{joinBannerError}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setJoinBannerError(null)}
            className="h-7 text-xs text-amber-200 hover:text-white"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Incoming Watch Together Friend Invitations Banner */}
      {incomingInvites.length > 0 && (
        <section
          aria-label="Incoming Watch Together Invitations"
          className="rounded-2xl border border-primary/35 bg-[#121625] p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <UserPlus className="h-4 w-4 text-primary" />
              <span>
                Friend Invitations to Watch Together ({incomingInvites.length})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {incomingInvites.map((inv) => {
              const busy = isInvitePending && actingInviteKey === inv.id;
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#232b45] bg-[#0d111d] p-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-xs font-bold text-white">
                      {inv.roomTitle} · {inv.animeTitle} (Ep {inv.episodeNumber})
                    </p>
                    <p className="truncate text-[11px] text-zinc-400">
                      Invited by @{inv.host.username}
                      {inv.roomPrivacy === "private" ? " · Private Room" : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {inv.status === "accepted" ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          router.push(
                            `/watch-together?room=${encodeURIComponent(inv.roomId)}`
                          )
                        }
                        className="h-8 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground"
                      >
                        Enter Room
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleAcceptRoomInvitation(inv)}
                          className="h-8 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-500"
                        >
                          {busy ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="mr-1 h-3.5 w-3.5" />
                          )}
                          Accept
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => handleDeclineRoomInvitation(inv)}
                          className="h-8 rounded-xl px-2.5 text-xs"
                        >
                          Decline
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {lobbyError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200 flex items-center justify-between"
        >
          <span>Could not load Watch Together rooms: {lobbyError}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refreshLobbyRooms()}
            className="h-7 text-xs text-rose-200 hover:text-white"
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      )}

      {/* Loading Skeletons when refreshing an empty list */}
      {lobbyLoading && rooms.length === 0 ? (
        <div
          className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Loading Watch Together rooms"
        >
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="h-56 rounded-2xl border border-[#1c233a] bg-[#121624] p-5 animate-pulse flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="h-4 w-1/2 rounded bg-white/10" />
                <div className="flex gap-3.5">
                  <div className="h-24 w-16 rounded-xl bg-white/10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-white/10" />
                    <div className="h-3 w-1/2 rounded bg-white/5" />
                  </div>
                </div>
              </div>
              <div className="h-8 w-full rounded-xl bg-white/5" />
            </div>
          ))}
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-16 px-4 text-center space-y-3">
          <Tv className="mx-auto h-9 w-9 text-zinc-500" />
          <p className="text-sm font-medium text-zinc-300">
            {rooms.length === 0
              ? "No active Watch Together rooms right now."
              : "No Watch Together rooms match your current filter."}
          </p>
          <p className="max-w-md mx-auto text-xs text-zinc-400">
            {rooms.length === 0
              ? "Start a new room to watch with the community, or check back soon for live parties."
              : "Try clearing your search or switching room status filters."}
          </p>
          <div className="flex items-center justify-center gap-3 pt-1">
            {(statusFilter !== "all" || searchQuery.trim() !== "") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatusFilter("all");
                  setSearchQuery("");
                }}
              >
                Reset Filters
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="bg-primary text-primary-foreground"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Host a Room
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredRooms.map((room) => {
            const isHost = Boolean(
              currentUser && currentUser.id === room.hostId
            );
            const isFull =
              room.isFull || room.participantCount >= room.maxParticipants;
            const joinDisabled = isFull && !isHost;
            const isJoining = joiningRoomId === room.id;

            return (
              <article
                key={room.id}
                className="group flex flex-col justify-between rounded-2xl border border-[#1c233a] bg-[#121624] p-5 transition-all hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10"
              >
                <div className="space-y-4">
                  {/* Top Status Row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {room.status === "live" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                          <Radio className="h-2.5 w-2.5 animate-pulse" /> Live
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                          <Clock className="h-2.5 w-2.5" /> Intermission
                        </span>
                      )}

                      {isFull && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                          Full
                        </span>
                      )}

                      <span className="rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-300">
                        Ep {room.episodeNumber}
                        {room.totalEpisodes
                          ? `/${room.totalEpisodes}`
                          : ""} · {room.language.toUpperCase()}
                      </span>
                    </div>

                    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                      {room.privacy === "private" ? (
                        <Lock className="h-3.5 w-3.5 text-amber-400" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-zinc-500" />
                      )}
                      <Users className="h-3.5 w-3.5 text-primary ml-1" />
                      <span>
                        {room.participantCount}/{room.maxParticipants}
                      </span>
                    </span>
                  </div>

                  {/* Anime Poster + Room Title */}
                  <div className="flex gap-3.5">
                    <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#181d30] flex items-center justify-center">
                      {room.animeCover ? (
                        <Image
                          src={room.animeCover}
                          alt={room.animeTitle}
                          fill
                          sizes="64px"
                          className="object-cover"
                        />
                      ) : (
                        <Tv
                          className="h-5 w-5 text-zinc-500"
                          aria-label="No poster artwork"
                        />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <h3 className="line-clamp-1 text-base font-bold text-white group-hover:text-primary transition-colors">
                        {room.roomTitle}
                      </h3>
                      <p className="line-clamp-1 text-xs font-medium text-primary">
                        {room.animeTitle}
                      </p>
                      {room.description ? (
                        <p className="line-clamp-2 text-xs text-zinc-400 leading-relaxed">
                          {room.description}
                        </p>
                      ) : (
                        <p className="text-xs text-zinc-500">
                          Synchronized episode &amp; watch timer session.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer: Host Info & Join Button */}
                <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-3.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="relative flex h-7 w-7 shrink-0 overflow-hidden items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                      {room.host.avatarUrl ? (
                        <Image
                          src={room.host.avatarUrl}
                          alt={room.host.username}
                          fill
                          sizes="28px"
                          className="object-cover"
                        />
                      ) : (
                        <span>
                          {room.host.username.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-zinc-200">
                        Hosted by{" "}
                        {room.host.isPublicProfile ? (
                          <Link
                            href={`/u/${encodeURIComponent(room.host.username)}`}
                            className="hover:text-primary"
                          >
                            @{room.host.username}
                          </Link>
                        ) : (
                          <span>@{room.host.username}</span>
                        )}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {room.participantCount === 1
                          ? "1 active participant"
                          : `${room.participantCount} active participants`}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    disabled={joinDisabled || isJoining}
                    onClick={() => void handleSelectRoom(room)}
                    className="rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
                  >
                    {isJoining ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : joinDisabled ? (
                      "Room Full"
                    ) : room.privacy === "private" ? (
                      "Enter Code"
                    ) : (
                      "Join Room"
                    )}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
