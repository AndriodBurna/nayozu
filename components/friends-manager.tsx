"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Sparkles,
  Tv,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useShell } from "@/components/shell-context";
import FriendActivityFeed from "@/components/friend-activity-feed";
import {
  acceptFriendRequestAction,
  acceptWatchRoomInvitationAction,
  cancelFriendRequestAction,
  declineFriendRequestAction,
  declineWatchRoomInvitationAction,
  getFriendsOverviewAction,
  getWatchRoomInvitationsAction,
  removeFriendAction,
  searchUsersForFriendsAction,
  sendFriendRequestAction,
} from "@/lib/actions/friendActions";
import type {
  FriendProfileSummaryDTO,
  FriendshipRelationshipStatus,
  FriendsOverviewDTO,
} from "@/lib/friends/friendsService";
import type { WatchRoomInvitationDTO } from "@/lib/friends/friendActivityAndInvitesService";

export type FriendsSubTab = "friends" | "activity" | "incoming" | "sent" | "search";

function dispatchFriendsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nayozu:friends-updated"));
  }
}

export function FriendActionButton({
  targetUserId,
  targetUsername,
  initialStatus,
  initialFriendshipId = null,
  isBlocked = false,
  onStatusChange,
}: {
  targetUserId: string;
  targetUsername: string;
  initialStatus: FriendshipRelationshipStatus;
  initialFriendshipId?: string | null;
  isBlocked?: boolean;
  onStatusChange?: (status: FriendshipRelationshipStatus) => void;
}) {
  const [status, setStatus] = useState<FriendshipRelationshipStatus>(
    isBlocked ? "blocked" : initialStatus
  );
  const [friendshipId, setFriendshipId] = useState<string | null>(
    initialFriendshipId
  );
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setStatus(isBlocked ? "blocked" : initialStatus);
    setFriendshipId(initialFriendshipId);
    setConfirmRemove(false);
  }, [initialStatus, initialFriendshipId, isBlocked]);

  if (status === "self" || status === "blocked" || isBlocked) {
    return null;
  }

  const handleSendRequest = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await sendFriendRequestAction({ targetUserId });
      if (!res.success) {
        if (res.status) setStatus(res.status);
        setFeedback({
          type: "error",
          text: res.error || "Could not send friend request.",
        });
        return;
      }
      setStatus(res.status);
      if (res.friendshipId) setFriendshipId(res.friendshipId);
      setFeedback({
        type: "success",
        text: res.message || `Friend request sent to @${targetUsername}.`,
      });
      onStatusChange?.(res.status);
      dispatchFriendsUpdated();
    });
  };

  const handleAccept = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await acceptFriendRequestAction({
        friendshipId: friendshipId ?? undefined,
        requesterUserId: targetUserId,
      });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Could not accept request.",
        });
        return;
      }
      setStatus("friends");
      if (res.friendshipId) setFriendshipId(res.friendshipId);
      setFeedback({
        type: "success",
        text: res.message || `You and @${targetUsername} are now friends!`,
      });
      onStatusChange?.("friends");
      dispatchFriendsUpdated();
    });
  };

  const handleDecline = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await declineFriendRequestAction({
        friendshipId: friendshipId ?? undefined,
        requesterUserId: targetUserId,
      });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Could not decline request.",
        });
        return;
      }
      setStatus("none");
      setFriendshipId(null);
      setFeedback({
        type: "success",
        text: "Friend request declined.",
      });
      onStatusChange?.("none");
      dispatchFriendsUpdated();
    });
  };

  const handleCancel = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await cancelFriendRequestAction({
        friendshipId: friendshipId ?? undefined,
        targetUserId,
      });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Could not cancel request.",
        });
        return;
      }
      setStatus("none");
      setFriendshipId(null);
      setFeedback({
        type: "success",
        text: "Friend request cancelled.",
      });
      onStatusChange?.("none");
      dispatchFriendsUpdated();
    });
  };

  const handleRemoveFriend = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await removeFriendAction({
        friendshipId: friendshipId ?? undefined,
        friendUserId: targetUserId,
      });
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "Could not remove friend.",
        });
        return;
      }
      setConfirmRemove(false);
      setStatus("none");
      setFriendshipId(null);
      setFeedback({
        type: "success",
        text: `Removed @${targetUsername} from your friends.`,
      });
      onStatusChange?.("none");
      dispatchFriendsUpdated();
    });
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      {status === "none" && (
        <button
          type="button"
          disabled={isPending}
          onClick={handleSendRequest}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:brightness-110 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
          <span>Add Friend</span>
        </button>
      )}

      {status === "pending_outgoing" && (
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200">
            <Clock className="h-3.5 w-3.5" />
            <span>Request Sent</span>
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={handleCancel}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            <span>Cancel</span>
          </button>
        </div>
      )}

      {status === "pending_incoming" && (
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            disabled={isPending}
            onClick={handleAccept}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Accept Request</span>
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDecline}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            <span>Decline</span>
          </button>
        </div>
      )}

      {status === "friends" &&
        (confirmRemove ? (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs">
            <span className="font-semibold text-rose-200">
              Remove @{targetUsername}?
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={handleRemoveFriend}
              className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirmRemove(false)}
              className="rounded border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-zinc-300 hover:text-white"
            >
              Keep
            </button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-300">
              <UserCheck className="h-3.5 w-3.5" />
              <span>Friends</span>
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirmRemove(true)}
              title={`Remove @${targetUsername} from friends`}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:border-rose-500/40 hover:text-rose-300"
            >
              <UserMinus className="h-3.5 w-3.5" />
              <span>Remove</span>
            </button>
          </div>
        ))}

      {feedback && (
        <span
          className={`text-[11px] font-medium ${
            feedback.type === "error" ? "text-rose-300" : "text-emerald-300"
          }`}
        >
          {feedback.text}
        </span>
      )}
    </div>
  );
}

export default function FriendsManager({
  initialOverview,
  initialSubTab = "friends",
}: {
  initialOverview?: FriendsOverviewDTO;
  initialSubTab?: FriendsSubTab;
}) {
  const router = useRouter();
  const { isUserOnline } = useShell();

  const [subTab, setSubTab] = useState<FriendsSubTab>(initialSubTab);
  const [overview, setOverview] = useState<FriendsOverviewDTO>(
    initialOverview ?? {
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      notifications: [],
      unreadNotificationCount: 0,
    }
  );
  const [watchInvites, setWatchInvites] = useState<WatchRoomInvitationDTO[]>(
    []
  );
  const [actingInviteId, setActingInviteId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!initialOverview);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<FriendProfileSummaryDTO[]>(
    []
  );
  const [searching, setSearching] = useState<boolean>(false);
  const [hasSearched, setHasSearched] = useState<boolean>(false);

  // Confirm remove friend state (stores user ID awaiting confirmation)
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(
    null
  );
  const [actingUserId, setActingUserId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [res, invitesRes] = await Promise.all([
        getFriendsOverviewAction(),
        getWatchRoomInvitationsAction(),
      ]);
      if (!res.success) {
        setError(res.error || "Unable to load friends right now.");
        return;
      }
      setOverview(res.data);
      if (invitesRes.success) {
        setWatchInvites(
          invitesRes.incomingInvitations.filter(
            (inv) => inv.status === "pending" || inv.status === "accepted"
          )
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load friends right now."
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialOverview) {
      void loadOverview(false);
    } else {
      void getWatchRoomInvitationsAction().then((res) => {
        if (res.success) {
          setWatchInvites(
            res.incomingInvitations.filter(
              (inv) => inv.status === "pending" || inv.status === "accepted"
            )
          );
        }
      });
    }
  }, [initialOverview, loadOverview]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleUpdated = () => {
      void loadOverview(true);
    };
    window.addEventListener("nayozu:friends-updated", handleUpdated);
    return () => {
      window.removeEventListener("nayozu:friends-updated", handleUpdated);
    };
  }, [loadOverview]);

  const runSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const res = await searchUsersForFriendsAction({
        query: trimmed,
        limit: 20,
      });
      if (!res.success) {
        setError(res.error || "Unable to search users right now.");
        return;
      }
      setSearchResults(res.results);
      setHasSearched(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to search users right now."
      );
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(searchQuery);
  };

  const handleSendRequest = (targetUser: FriendProfileSummaryDTO) => {
    setError(null);
    setSuccessMsg(null);
    setActingUserId(targetUser.id);
    startTransition(async () => {
      try {
        const res = await sendFriendRequestAction({
          targetUserId: targetUser.id,
        });
        if (!res.success) {
          setError(res.error || "Failed to send friend request.");
          return;
        }
        setSuccessMsg(
          res.message || `Sent friend request to @${targetUser.username}.`
        );
        setSearchResults((prev) =>
          prev.map((item) =>
            item.id === targetUser.id
              ? {
                  ...item,
                  relationshipStatus: res.status,
                  friendshipId: res.friendshipId ?? item.friendshipId,
                }
              : item
          )
        );
        await loadOverview(true);
        dispatchFriendsUpdated();
      } finally {
        setActingUserId(null);
      }
    });
  };

  const handleAcceptRequest = (requester: FriendProfileSummaryDTO) => {
    setError(null);
    setSuccessMsg(null);
    setActingUserId(requester.id);
    startTransition(async () => {
      try {
        const res = await acceptFriendRequestAction({
          friendshipId: requester.friendshipId ?? undefined,
          requesterUserId: requester.id,
        });
        if (!res.success) {
          setError(res.error || "Failed to accept friend request.");
          return;
        }
        setSuccessMsg(
          res.message || `You and @${requester.username} are now friends!`
        );
        setSearchResults((prev) =>
          prev.map((item) =>
            item.id === requester.id
              ? {
                  ...item,
                  relationshipStatus: "friends",
                  friendshipId: res.friendshipId ?? item.friendshipId,
                }
              : item
          )
        );
        await loadOverview(true);
        dispatchFriendsUpdated();
      } finally {
        setActingUserId(null);
      }
    });
  };

  const handleDeclineRequest = (requester: FriendProfileSummaryDTO) => {
    setError(null);
    setSuccessMsg(null);
    setActingUserId(requester.id);
    startTransition(async () => {
      try {
        const res = await declineFriendRequestAction({
          friendshipId: requester.friendshipId ?? undefined,
          requesterUserId: requester.id,
        });
        if (!res.success) {
          setError(res.error || "Failed to decline friend request.");
          return;
        }
        setSuccessMsg(
          res.message || `Declined request from @${requester.username}.`
        );
        setSearchResults((prev) =>
          prev.map((item) =>
            item.id === requester.id
              ? { ...item, relationshipStatus: "none", friendshipId: null }
              : item
          )
        );
        await loadOverview(true);
        dispatchFriendsUpdated();
      } finally {
        setActingUserId(null);
      }
    });
  };

  const handleCancelRequest = (targetUser: FriendProfileSummaryDTO) => {
    setError(null);
    setSuccessMsg(null);
    setActingUserId(targetUser.id);
    startTransition(async () => {
      try {
        const res = await cancelFriendRequestAction({
          friendshipId: targetUser.friendshipId ?? undefined,
          targetUserId: targetUser.id,
        });
        if (!res.success) {
          setError(res.error || "Failed to cancel friend request.");
          return;
        }
        setSuccessMsg(
          res.message || `Cancelled friend request to @${targetUser.username}.`
        );
        setSearchResults((prev) =>
          prev.map((item) =>
            item.id === targetUser.id
              ? { ...item, relationshipStatus: "none", friendshipId: null }
              : item
          )
        );
        await loadOverview(true);
        dispatchFriendsUpdated();
      } finally {
        setActingUserId(null);
      }
    });
  };

  const handleRemoveFriend = (friendUser: FriendProfileSummaryDTO) => {
    setError(null);
    setSuccessMsg(null);
    setActingUserId(friendUser.id);
    startTransition(async () => {
      try {
        const res = await removeFriendAction({
          friendshipId: friendUser.friendshipId ?? undefined,
          friendUserId: friendUser.id,
        });
        if (!res.success) {
          setError(res.error || "Failed to remove friend.");
          return;
        }
        setConfirmRemoveUserId(null);
        setSuccessMsg(
          res.message || `Removed @${friendUser.username} from your friends.`
        );
        setSearchResults((prev) =>
          prev.map((item) =>
            item.id === friendUser.id
              ? { ...item, relationshipStatus: "none", friendshipId: null }
              : item
          )
        );
        await loadOverview(true);
        dispatchFriendsUpdated();
      } finally {
        setActingUserId(null);
      }
    });
  };

  const handleAcceptWatchInvite = (inv: WatchRoomInvitationDTO) => {
    setError(null);
    setSuccessMsg(null);
    setActingInviteId(inv.id);
    startTransition(async () => {
      try {
        const res = await acceptWatchRoomInvitationAction({
          invitationId: inv.id,
        });
        if (!res.success) {
          setError(res.error || "Could not accept Watch Together invitation.");
          await loadOverview(true);
          return;
        }
        setSuccessMsg(
          res.message ||
            `Accepted Watch Together invitation from @${inv.host.username}.`
        );
        dispatchFriendsUpdated();
        const targetRoomId = res.roomId || inv.roomId;
        if (targetRoomId) {
          router.push(
            `/watch-together?room=${encodeURIComponent(targetRoomId)}`
          );
        } else {
          await loadOverview(true);
        }
      } finally {
        setActingInviteId(null);
      }
    });
  };

  const handleDeclineWatchInvite = (inv: WatchRoomInvitationDTO) => {
    setError(null);
    setSuccessMsg(null);
    setActingInviteId(inv.id);
    startTransition(async () => {
      try {
        const res = await declineWatchRoomInvitationAction({
          invitationId: inv.id,
        });
        if (!res.success) {
          setError(res.error || "Could not decline Watch Together invitation.");
          return;
        }
        setSuccessMsg("Watch Together invitation declined.");
        setWatchInvites((prev) => prev.filter((item) => item.id !== inv.id));
        dispatchFriendsUpdated();
      } finally {
        setActingInviteId(null);
      }
    });
  };

  const renderStatusBadge = (
    item: FriendProfileSummaryDTO,
    online: boolean
  ) => {
    switch (item.relationshipStatus) {
      case "friends":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            <UserCheck className="h-3 w-3" />
            {online ? "Friend · Online" : "Friend"}
          </span>
        );
      case "pending_incoming":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
            <Clock className="h-3 w-3" />
            Incoming Request
          </span>
        );
      case "pending_outgoing":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
            <Clock className="h-3 w-3" />
            Request Sent
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
            Not Connected
          </span>
        );
    }
  };

  const renderUserCard = (item: FriendProfileSummaryDTO) => {
    const isFriend = item.relationshipStatus === "friends";
    const isPublic = item.profileVisibility === "public";
    const canSeeOnline = isPublic || isFriend;
    const online =
      canSeeOnline &&
      isUserOnline(item.id, {
        isPublicProfile: isPublic,
        isAcceptedFriend: isFriend,
        isBlocked: false,
      });
    const busy = isPending && actingUserId === item.id;

    return (
      <div
        key={item.id}
        className="flex flex-col justify-between gap-3 rounded-2xl border border-[#1c233a] bg-[#121624] p-4 sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <Link
            href={`/u/${encodeURIComponent(item.username)}`}
            className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-primary/40 bg-[#1a2035] flex items-center justify-center text-sm font-bold text-primary"
          >
            {item.avatarUrl ? (
              <Image
                src={item.avatarUrl}
                alt={item.username}
                fill
                sizes="48px"
                className="object-cover"
              />
            ) : (
              <span>{item.username.slice(0, 2).toUpperCase()}</span>
            )}
            {canSeeOnline && (
              <span
                title={online ? "Online now" : "Offline"}
                className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-[#121624] ${
                  online ? "bg-emerald-500" : "bg-zinc-600"
                }`}
              />
            )}
          </Link>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/u/${encodeURIComponent(item.username)}`}
                className="truncate text-sm font-bold text-white hover:text-primary transition-colors"
              >
                {item.displayName || item.username}
              </Link>
              <span className="text-xs text-zinc-400">@{item.username}</span>
              {item.profileVisibility === "private" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  <Lock className="h-2.5 w-2.5" />
                  Private
                </span>
              )}
              {renderStatusBadge(item, online)}
            </div>

            {item.bio && (
              <p className="line-clamp-1 text-xs text-zinc-400">{item.bio}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {item.relationshipStatus === "none" && (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => handleSendRequest(item)}
              className="h-8 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground"
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              )}
              Add Friend
            </Button>
          )}

          {item.relationshipStatus === "pending_incoming" && (
            <>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => handleAcceptRequest(item)}
                className="h-8 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-500"
              >
                {busy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                )}
                Accept
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => handleDeclineRequest(item)}
                className="h-8 rounded-xl border-[#232a42] bg-[#151a2a] px-3 text-xs font-semibold text-zinc-300 hover:border-rose-500/40 hover:text-rose-300"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Decline
              </Button>
            </>
          )}

          {item.relationshipStatus === "pending_outgoing" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => handleCancelRequest(item)}
              className="h-8 rounded-xl border-[#232a42] bg-[#151a2a] px-3 text-xs font-semibold text-zinc-300 hover:border-rose-500/40 hover:text-rose-300"
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="mr-1.5 h-3.5 w-3.5" />
              )}
              Cancel Request
            </Button>
          )}

          {item.relationshipStatus === "friends" &&
            (confirmRemoveUserId === item.id ? (
              <div className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-2.5 py-1">
                <span className="text-[11px] font-semibold text-rose-200">
                  Remove friend?
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleRemoveFriend(item)}
                  className="rounded-lg bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  {busy ? "..." : "Yes, Remove"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmRemoveUserId(null)}
                  className="rounded-lg border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-zinc-300 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmRemoveUserId(item.id)}
                className="h-8 rounded-xl border-[#232a42] bg-[#151a2a] px-3 text-xs font-semibold text-zinc-300 hover:border-rose-500/40 hover:text-rose-300"
              >
                <UserMinus className="mr-1.5 h-3.5 w-3.5" />
                Remove Friend
              </Button>
            ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              {
                id: "friends",
                label: `My Friends (${overview.friends.length})`,
                icon: Users,
              },
              {
                id: "activity",
                label: "Friend Activity",
                icon: Sparkles,
              },
              {
                id: "incoming",
                label: `Incoming Requests (${overview.incomingRequests.length})`,
                icon: UserPlus,
                highlight: overview.incomingRequests.length > 0,
              },
              {
                id: "sent",
                label: `Sent Requests (${overview.outgoingRequests.length})`,
                icon: Clock,
              },
              {
                id: "search",
                label: "Search People",
                icon: Search,
              },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSubTab(t.id);
                  setError(null);
                  setSuccessMsg(null);
                }}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "border border-[#1b2238] bg-[#121624] text-zinc-300 hover:border-primary/40 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void loadOverview(false)}
          className="h-8 rounded-xl border-[#232a42] bg-[#151a2a] text-xs font-semibold text-zinc-300 hover:text-white"
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Feedback banners */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Incoming Watch Together Invitations Banner */}
      {watchInvites.length > 0 && (
        <section
          aria-label="Watch Together Invitations"
          className="rounded-2xl border border-primary/35 bg-[#13182a] p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Tv className="h-4 w-4 text-primary" />
              <span>
                Watch Together Invitations ({watchInvites.length})
              </span>
            </div>
            <Link
              href="/watch-together"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Open Watch Together Lobby →
            </Link>
          </div>
          <div className="space-y-2.5">
            {watchInvites.map((inv) => {
              const busy = isPending && actingInviteId === inv.id;
              return (
                <div
                  key={inv.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-[#232b45] bg-[#0e1220] p-3 sm:flex-row sm:items-center"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-lg bg-[#1a2035] border border-white/10 flex items-center justify-center">
                      {inv.animeCover ? (
                        <Image
                          src={inv.animeCover}
                          alt={inv.animeTitle}
                          fill
                          sizes="36px"
                          className="object-cover"
                        />
                      ) : (
                        <Tv className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate text-xs font-bold text-white">
                        {inv.roomTitle}{" "}
                        <span className="font-normal text-zinc-400">
                          · {inv.animeTitle} (Ep {inv.episodeNumber})
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-zinc-400">
                        Invited by{" "}
                        <Link
                          href={`/u/${encodeURIComponent(inv.host.username)}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          @{inv.host.username}
                        </Link>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {inv.status === "accepted" ? (
                      <Button
                        asChild
                        size="sm"
                        className="h-8 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground"
                      >
                        <Link
                          href={`/watch-together?room=${encodeURIComponent(inv.roomId)}`}
                        >
                          <Tv className="mr-1.5 h-3.5 w-3.5" />
                          Open Room
                        </Link>
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleAcceptWatchInvite(inv)}
                          className="h-8 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-500"
                        >
                          {busy ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Accept &amp; Join
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleDeclineWatchInvite(inv)}
                          className="h-8 rounded-xl border-[#232a42] bg-[#151a2a] px-3 text-xs font-semibold text-zinc-300 hover:border-rose-500/40 hover:text-rose-300"
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
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

      {/* Active Sub-Tab View */}
      {subTab === "activity" ? (
        <FriendActivityFeed />
      ) : subTab === "search" ? (
        <div className="space-y-4">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-2.5 sm:flex-row"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search members by @username or display name..."
                aria-label="Search members by username or display name"
                className="h-10 rounded-xl border-[#232a42] bg-[#121624] pl-10 text-sm text-white placeholder:text-zinc-500"
              />
            </div>
            <Button
              type="submit"
              disabled={searching}
              className="h-10 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground"
            >
              {searching ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Searching...
                </>
              ) : (
                "Search People"
              )}
            </Button>
          </form>

          {searching ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="h-20 rounded-2xl border border-[#1c233a] bg-[#121624]/60 animate-pulse"
                />
              ))}
            </div>
          ) : !hasSearched ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-10 px-4 text-center space-y-2">
              <Search className="mx-auto h-8 w-8 text-zinc-500" />
              <h3 className="text-sm font-bold text-white">
                Find Friends on Nayozu
              </h3>
              <p className="max-w-md mx-auto text-xs text-zinc-400">
                Enter a username or display name above to discover community members and send a friend request. Private profiles are protected from stranger discovery.
              </p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-10 px-4 text-center space-y-2">
              <Users className="mx-auto h-8 w-8 text-zinc-500" />
              <h3 className="text-sm font-bold text-white">
                No Eligible Members Found
              </h3>
              <p className="max-w-md mx-auto text-xs text-zinc-400">
                No public profiles matched &ldquo;{searchQuery.trim()}&rdquo;. Check the spelling or try searching by exact @username.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {searchResults.map((item) => renderUserCard(item))}
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="h-20 rounded-2xl border border-[#1c233a] bg-[#121624]/60 animate-pulse"
            />
          ))}
        </div>
      ) : subTab === "friends" ? (
        overview.friends.length === 0 ? (
          <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-12 px-4 text-center space-y-3">
            <Users className="mx-auto h-8 w-8 text-zinc-500" />
            <h3 className="text-sm font-bold text-white">
              You Haven&apos;t Added Any Friends Yet
            </h3>
            <p className="max-w-md mx-auto text-xs text-zinc-400">
              Connect with other anime and manga fans to see when they are online or hosting Watch Together rooms.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => setSubTab("search")}
              className="bg-primary text-xs font-bold text-primary-foreground"
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              Search People
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {overview.friends.map((friend) => renderUserCard(friend))}
          </div>
        )
      ) : subTab === "incoming" ? (
        overview.incomingRequests.length === 0 ? (
          <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-12 px-4 text-center space-y-2">
            <UserPlus className="mx-auto h-8 w-8 text-zinc-500" />
            <h3 className="text-sm font-bold text-white">
              No Incoming Friend Requests
            </h3>
            <p className="max-w-md mx-auto text-xs text-zinc-400">
              When another member sends you a friend request, it will appear here for you to accept or decline.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {overview.incomingRequests.map((req) => renderUserCard(req))}
          </div>
        )
      ) : overview.outgoingRequests.length === 0 ? (
        <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-12 px-4 text-center space-y-2">
          <Clock className="mx-auto h-8 w-8 text-zinc-500" />
          <h3 className="text-sm font-bold text-white">
            No Pending Sent Requests
          </h3>
          <p className="max-w-md mx-auto text-xs text-zinc-400">
            Friend requests you send that are awaiting a response will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {overview.outgoingRequests.map((req) => renderUserCard(req))}
        </div>
      )}
    </div>
  );
}
