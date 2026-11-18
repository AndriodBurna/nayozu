"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Users,
  Tv,
  MessageSquare,
  ChevronRight,
  X,
  LogIn,
  RefreshCw,
  AlertCircle,
  Loader2,
  Radio,
  Clock,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/shell-context";
import FriendActivityFeed from "@/components/friend-activity-feed";
import { sanitizeRedirectPath } from "@/lib/supabase/proxy";
import {
  getRightPanelDataAction,
  type RightPanelCommunityMemberDTO,
  type RightPanelDataResponse,
  type RightPanelTrendingDiscussionDTO,
  type RightPanelUserProfileDTO,
  type RightPanelWatchRoomDTO,
} from "@/lib/actions/communityActions";
import { verifyWatchRoomAccessAction } from "@/app/watch-together/actions";

export interface PresencePayload {
  userId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
  isPublicProfile?: boolean;
  onlineAt?: string;
}

const STALE_MS = 45_000;

const AUTH_ROUTE_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth",
];

export function shouldCloseDrawerOnOutsidePointerDown({
  rightOpen,
  isDesktopViewport,
  isInsidePanel,
  isInsideTrigger,
}: {
  rightOpen: boolean;
  isDesktopViewport: boolean;
  isInsidePanel: boolean;
  isInsideTrigger: boolean;
}): boolean {
  if (!rightOpen) return false;
  if (isDesktopViewport) return false;
  if (isInsidePanel || isInsideTrigger) return false;
  return true;
}

export function buildGuestAuthRedirectParam(
  pathname: string | null | undefined,
  search?: string | null | undefined
): string {
  if (!pathname) return "";
  const normalizedSearch = search
    ? search.startsWith("?")
      ? search
      : `?${search}`
    : "";

  for (const prefix of AUTH_ROUTE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return "";
    }
  }

  const candidate = `${pathname}${normalizedSearch}`;
  const sanitized = sanitizeRedirectPath(candidate, "/");
  if (!sanitized || sanitized === "/") {
    return "";
  }
  for (const prefix of AUTH_ROUTE_PREFIXES) {
    if (
      sanitized === prefix ||
      sanitized.startsWith(`${prefix}/`) ||
      sanitized.startsWith(`${prefix}?`)
    ) {
      return "";
    }
  }
  return `?next=${encodeURIComponent(sanitized)}`;
}

export function canTrackPublicPresence(
  user: { id: string } | null | undefined,
  profile: RightPanelUserProfileDTO | null | undefined
): boolean {
  if (!user?.id || !profile) return false;
  if (profile.id !== user.id) return false;
  return profile.profileVisibility === "public";
}

export function filterPublicPresenceState(
  presenceState: Record<string, PresencePayload[]>,
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
    }
  >();
  const blockedSet = options?.blockedSet;
  const knownPrivateUserIds = options?.knownPrivateUserIds;

  for (const entries of Object.values(presenceState)) {
    for (const item of entries) {
      if (!item.userId || !item.username) continue;
      if (item.isPublicProfile !== true) continue;
      if (blockedSet?.has(item.userId)) continue;
      if (knownPrivateUserIds?.has(item.userId)) continue;
      nextMap.set(item.userId, {
        userId: item.userId,
        username: item.username,
        displayName: item.displayName || item.username,
        avatarUrl: item.avatarUrl ?? null,
        isPublicProfile: true,
      });
    }
  }
  return nextMap;
}

function SearchParamObserver({
  onSearchChange,
}: {
  onSearchChange: (search: string) => void;
}) {
  const searchParams = useSearchParams();
  const serialized = searchParams.toString();

  useEffect(() => {
    onSearchChange(serialized ? `?${serialized}` : "");
  }, [serialized, onSearchChange]);

  return null;
}

export default function RightPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    user,
    rightOpen,
    closeRight,
    publicOnlinePresenceMap,
    isUserOnline,
  } = useShell();

  const panelRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const prevRightOpenRef = useRef<boolean>(rightOpen);
  const userInitiatedToggleRef = useRef<boolean>(false);
  const lastFetchedAtRef = useRef<number>(0);
  const lastFetchedUserIdRef = useRef<string | null | undefined>(undefined);

  const [currentSearch, setCurrentSearch] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<RightPanelUserProfileDTO | null>(null);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [friends, setFriends] = useState<RightPanelCommunityMemberDTO[]>([]);
  const [incomingFriendRequestsCount, setIncomingFriendRequestsCount] =
    useState<number>(0);
  const [activeMembers, setActiveMembers] = useState<
    RightPanelCommunityMemberDTO[]
  >([]);
  const [watchRooms, setWatchRooms] = useState<RightPanelWatchRoomDTO[]>([]);
  const [trendingDiscussions, setTrendingDiscussions] = useState<
    RightPanelTrendingDiscussionDTO[]
  >([]);

  // Join Watch Together party state
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const currentUserId = user?.id ?? null;

  const blockedSet = useMemo(() => new Set(blockedUserIds), [blockedUserIds]);

  const knownPrivateUserIds = useMemo(() => {
    const set = new Set<string>();
    if (profile?.profileVisibility === "private") {
      set.add(profile.id);
    }
    for (const m of activeMembers) {
      if (!m.isPublicProfile) set.add(m.id);
    }
    for (const f of friends) {
      if (!f.isPublicProfile) set.add(f.id);
    }
    return set;
  }, [profile, activeMembers, friends]);

  const fetchPanelData = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (
        !force &&
        lastFetchedUserIdRef.current === currentUserId &&
        now - lastFetchedAtRef.current < STALE_MS &&
        lastFetchedAtRef.current > 0
      ) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res: RightPanelDataResponse = await getRightPanelDataAction();
        if (!res.success) {
          setError(res.error || "Unable to load community activity right now.");
          return;
        }

        setProfile(res.currentUserProfile);
        setBlockedUserIds(res.blockedUserIds);
        setFriends(res.friends);
        setIncomingFriendRequestsCount(res.incomingFriendRequestsCount ?? 0);
        setActiveMembers(res.activeMembers);
        setWatchRooms(res.watchRooms);
        setTrendingDiscussions(res.trendingDiscussions);
        lastFetchedAtRef.current = Date.now();
        lastFetchedUserIdRef.current = currentUserId;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load community activity right now."
        );
      } finally {
        setLoading(false);
      }
    },
    [currentUserId]
  );

  // Clear cached user-specific state immediately when authentication identity changes
  useEffect(() => {
    if (
      lastFetchedUserIdRef.current !== undefined &&
      lastFetchedUserIdRef.current !== currentUserId
    ) {
      setProfile(null);
      setBlockedUserIds([]);
      setFriends([]);
      setIncomingFriendRequestsCount(0);
      setActiveMembers([]);
      setWatchRooms([]);
      setTrendingDiscussions([]);
      setJoinError(null);
      lastFetchedAtRef.current = 0;
      lastFetchedUserIdRef.current = undefined;

      if (rightOpen) {
        void fetchPanelData(true);
      }
    }
  }, [currentUserId, rightOpen, fetchPanelData]);

  // Fetch data when panel opens
  useEffect(() => {
    if (!rightOpen) return;
    void fetchPanelData(false);
  }, [rightOpen, fetchPanelData]);

  // Synchronize Watch Together rooms and Friends when actions dispatch an update
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleDrawerDataUpdated = () => {
      lastFetchedAtRef.current = 0;
      if (rightOpen) {
        void fetchPanelData(true);
      }
    };
    window.addEventListener(
      "nayozu:watch-rooms-updated",
      handleDrawerDataUpdated
    );
    window.addEventListener("nayozu:friends-updated", handleDrawerDataUpdated);
    return () => {
      window.removeEventListener(
        "nayozu:watch-rooms-updated",
        handleDrawerDataUpdated
      );
      window.removeEventListener(
        "nayozu:friends-updated",
        handleDrawerDataUpdated
      );
    };
  }, [rightOpen, fetchPanelData]);

  // Track clicks on any [data-right-panel-trigger="true"] so focus restoration knows which trigger opened/closed the panel
  useEffect(() => {
    const handleTriggerClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest<HTMLElement>(
        '[data-right-panel-trigger="true"]'
      );
      if (trigger) {
        lastTriggerRef.current = trigger;
        userInitiatedToggleRef.current = true;
      }
    };

    document.addEventListener("click", handleTriggerClick, true);
    return () => {
      document.removeEventListener("click", handleTriggerClick, true);
    };
  }, []);

  const restoreFocusToTrigger = useCallback(() => {
    if (
      lastTriggerRef.current &&
      document.body.contains(lastTriggerRef.current)
    ) {
      lastTriggerRef.current.focus();
      return;
    }
    const fallbackTrigger = document.querySelector<HTMLElement>(
      '[data-right-panel-trigger="true"]'
    );
    fallbackTrigger?.focus();
  }, []);

  // Escape key & focus isolation management
  useEffect(() => {
    const wasOpen = prevRightOpenRef.current;
    prevRightOpenRef.current = rightOpen;

    if (!rightOpen) {
      // Ensure focus is never trapped inside an invisible/inert drawer when it closes
      if (
        wasOpen &&
        typeof document !== "undefined" &&
        panelRef.current &&
        document.activeElement instanceof HTMLElement &&
        panelRef.current.contains(document.activeElement)
      ) {
        restoreFocusToTrigger();
      }
      return;
    }

    let focusTimer: number | undefined;
    if (userInitiatedToggleRef.current) {
      userInitiatedToggleRef.current = false;
      focusTimer = window.setTimeout(() => {
        closeBtnRef.current?.focus();
      }, 50);
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRight();
        restoreFocusToTrigger();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      if (focusTimer !== undefined) {
        window.clearTimeout(focusTimer);
      }
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [rightOpen, closeRight, restoreFocusToTrigger]);

  // Close when clicking outside the drawer on mobile/tablet ONLY (and outside any drawer trigger button)
  useEffect(() => {
    if (!rightOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      const isDesktopViewport =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(min-width: 1024px)").matches;

      const isInsidePanel = Boolean(
        panelRef.current && panelRef.current.contains(target)
      );

      let isInsideTrigger = false;
      if (
        target instanceof Element &&
        target.closest('[data-right-panel-trigger="true"]')
      ) {
        isInsideTrigger = true;
      } else {
        const triggers = document.querySelectorAll(
          '[data-right-panel-trigger="true"]'
        );
        for (const trigger of triggers) {
          if (trigger.contains(target)) {
            isInsideTrigger = true;
            break;
          }
        }
      }

      if (
        shouldCloseDrawerOnOutsidePointerDown({
          rightOpen,
          isDesktopViewport,
          isInsidePanel,
          isInsideTrigger,
        })
      ) {
        closeRight();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [rightOpen, closeRight]);

  // Prevent background scrolling when mobile/tablet overlay drawer is open
  useEffect(() => {
    if (!rightOpen) return;
    const isMobileOrTablet = window.matchMedia("(max-width: 1023px)").matches;
    if (!isMobileOrTablet) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [rightOpen]);

  const closeIfMobile = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      closeRight();
    }
  }, [closeRight]);

  // Resolved user identity for authenticated card
  const userName =
    profile?.displayName ||
    (user?.user_metadata?.display_name as string | undefined) ||
    profile?.username ||
    (user?.user_metadata?.username as string | undefined) ||
    user?.email?.split("@")[0] ||
    "Member";

  const userHandle =
    profile?.username ||
    (user?.user_metadata?.username as string | undefined) ||
    user?.email?.split("@")[0] ||
    null;

  const avatarUrl =
    profile?.avatarUrl ||
    (user?.user_metadata?.avatar_url as string | undefined) ||
    null;

  const userInitials = (userHandle || userName || "U")
    .slice(0, 2)
    .toUpperCase();

  // Auth links with redirect back to current route + query parameters when appropriate
  const authRedirectParam = useMemo(() => {
    return buildGuestAuthRedirectParam(pathname, currentSearch);
  }, [pathname, currentSearch]);

  // Combine real presence members with active community members (excluding current user, private profiles, and blocked users)
  const displayedCommunityMembers = useMemo(() => {
    const merged = new Map<
      string,
      RightPanelCommunityMemberDTO & { isOnline: boolean }
    >();

    // First include any confirmed-public user currently online via global shell Realtime presence
    for (const [uid, pres] of publicOnlinePresenceMap.entries()) {
      if (
        uid === currentUserId ||
        blockedSet.has(uid) ||
        knownPrivateUserIds.has(uid) ||
        pres.isPublicProfile !== true
      ) {
        continue;
      }
      merged.set(uid, {
        id: uid,
        username: pres.username,
        displayName: pres.displayName,
        avatarUrl: pres.avatarUrl,
        isPublicProfile: true,
        recentActivity: "Online now",
        lastActiveAt: pres.onlineAt || new Date().toISOString(),
        isOnline: true,
      });
    }

    // Enrich or append active public community members from database
    for (const member of activeMembers) {
      if (
        member.id === currentUserId ||
        blockedSet.has(member.id) ||
        !member.isPublicProfile
      ) {
        merged.delete(member.id);
        continue;
      }
      const existing = merged.get(member.id);
      if (existing) {
        merged.set(member.id, {
          ...member,
          isPublicProfile: true,
          isOnline: true,
          recentActivity: member.recentActivity || "Online now",
        });
      } else {
        merged.set(member.id, {
          ...member,
          isPublicProfile: true,
          isOnline: false,
        });
      }
    }

    return Array.from(merged.values()).sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
      const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
      return tb - ta;
    });
  }, [
    publicOnlinePresenceMap,
    activeMembers,
    currentUserId,
    blockedSet,
    knownPrivateUserIds,
  ]);

  const onlineFriends = useMemo(() => {
    return friends
      .filter((f) => !blockedSet.has(f.id))
      .map((f) => ({
        ...f,
        isOnline: isUserOnline(f.id, {
          isPublicProfile: f.isPublicProfile,
          isAcceptedFriend: true,
          isBlocked: false,
        }),
      }))
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
        const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
        return tb - ta;
      });
  }, [friends, blockedSet, isUserOnline]);

  const onlineFriendsCount = useMemo(
    () => onlineFriends.filter((f) => f.isOnline).length,
    [onlineFriends]
  );

  const handleJoinWatchRoom = async (room: RightPanelWatchRoomDTO) => {
    setJoinError(null);
    setJoiningRoomId(room.id);

    try {
      const verifyRes = await verifyWatchRoomAccessAction({
        roomId: room.id,
      });

      if (!verifyRes.authorized) {
        setJoinError(
          verifyRes.error || "This watch party is no longer available."
        );
        void fetchPanelData(true);
        return;
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("nayozu:watch-rooms-updated"));
      }
      closeRight();
      router.push(`/watch-together?room=${encodeURIComponent(room.id)}`);
    } catch {
      setJoinError("Could not join watch party. Please try again.");
    } finally {
      setJoiningRoomId(null);
    }
  };

  return (
    <>
      <Suspense fallback={null}>
        <SearchParamObserver onSearchChange={setCurrentSearch} />
      </Suspense>

      {/* Desktop flex layout spacer: reserves exact drawer width when open so main content is not obscured */}
      <div
        data-right-panel-spacer="true"
        aria-hidden="true"
        className={`hidden lg:block shrink-0 transition-[width] duration-300 ease-in-out ${
          rightOpen ? "lg:w-80 xl:w-[340px]" : "lg:w-0"
        }`}
      />

      {/* Mobile & Tablet Backdrop overlay (hidden on desktop >= 1024px so desktop drawer never dims the entire app) */}
      {rightOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={closeRight}
          aria-hidden="true"
        />
      )}

      {/* Slide-out Community & Activity Drawer */}
      <aside
        ref={panelRef}
        id="community-activity-panel"
        aria-label="Community & Activity side panel"
        aria-hidden={!rightOpen}
        inert={!rightOpen ? true : undefined}
        className={`fixed inset-y-0 right-0 lg:top-16 lg:bottom-auto lg:h-[calc(100vh-4rem)] z-50 lg:z-40 w-full max-w-[100vw] sm:w-80 md:w-[340px] lg:w-80 xl:w-[340px] overflow-y-auto overflow-x-hidden overscroll-contain border-l border-[#1a1f30] bg-[#0b0e17] p-5 pb-24 sm:pb-6 transition-[transform,visibility] duration-300 ease-in-out ${
          rightOpen
            ? "translate-x-0 visible pointer-events-auto shadow-2xl shadow-black/70"
            : "translate-x-full invisible pointer-events-none"
        } flex flex-col gap-5`}
      >
        {/* Top Header with Refresh & Close Buttons */}
        <div className="flex items-center justify-between pb-2 border-b border-white/5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-white text-sm truncate">
              Community &amp; Activity
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void fetchPanelData(true)}
              disabled={loading}
              aria-label="Refresh community activity"
              title="Refresh community activity"
              className="text-zinc-400 hover:text-white h-8 w-8 rounded-lg"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`}
              />
            </Button>
            <Button
              ref={closeBtnRef}
              type="button"
              variant="ghost"
              size="icon"
              onClick={closeRight}
              aria-label="Close side panel"
              title="Close side panel"
              className="text-zinc-400 hover:text-white h-8 w-8 rounded-lg"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Error Banner if initial load failed */}
        {error && (
          <div
            role="alert"
            className="flex items-start justify-between gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200"
          >
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed break-words">{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void fetchPanelData(true)}
              className="shrink-0 font-semibold text-rose-300 hover:text-white underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Guest Welcome Card / Authenticated User Card */}
        {user ? (
          <section
            aria-label="Your account summary"
            className="rounded-2xl border border-[#1c2236] bg-[#121624] p-4"
          >
            <div className="flex items-center gap-3">
              <Link
                href={userHandle ? `/u/${encodeURIComponent(userHandle)}` : "/profile"}
                onClick={closeIfMobile}
                className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-primary/40 bg-[#1a2035] flex items-center justify-center text-sm font-bold text-primary"
              >
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={userName}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                ) : (
                  <span>{userInitials}</span>
                )}
                <span
                  title="Online"
                  className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[#121624]"
                />
              </Link>
              <div className="flex-1 min-w-0">
                <h4 className="truncate text-sm font-semibold text-white">
                  {userName}
                </h4>
                {userHandle && (
                  <p className="truncate text-[11px] text-zinc-400">
                    @{userHandle}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="w-full border-[#232a42] bg-[#161b2d] text-xs hover:bg-[#1f263e] hover:text-white"
              >
                <Link href="/profile" onClick={closeIfMobile}>
                  My Profile
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="w-full border-[#232a42] bg-[#161b2d] text-xs hover:bg-[#1f263e] hover:text-white"
              >
                <Link href="/library" onClick={closeIfMobile}>
                  My Library
                </Link>
              </Button>
            </div>
          </section>
        ) : (
          <section
            aria-label="Welcome to Nayozu"
            className="rounded-2xl border border-[#1c2236] bg-[#121624] p-4 space-y-3"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/30">
                <LogIn className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-white">
                  Welcome to Nayozu
                </h4>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Sign in to track your anime &amp; manga library, join discussions, and watch with friends.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                asChild
                size="sm"
                className="w-full bg-primary text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                <Link href={`/login${authRedirectParam}`} onClick={closeRight}>
                  Sign in
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="w-full border-[#232a42] bg-[#161b2d] text-xs hover:bg-[#1f263e] hover:text-white"
              >
                <Link href={`/register${authRedirectParam}`} onClick={closeRight}>
                  Get started
                </Link>
              </Button>
            </div>
          </section>
        )}

        {/* Friends Online Section */}
        <section aria-label="Friends Online" className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <Users className="h-3.5 w-3.5 text-zinc-400" />
              <span>Friends Online</span>
              {user && onlineFriends.length > 0 && (
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.2 text-[10px] font-bold text-emerald-300">
                  {onlineFriendsCount}/{onlineFriends.length}
                </span>
              )}
            </div>
            <Link
              href={user ? "/profile?tab=friends" : "/community"}
              onClick={closeIfMobile}
              className="text-zinc-400 hover:text-white flex items-center transition-colors"
            >
              See All <ChevronRight className="h-3 w-3 ml-0.5" />
            </Link>
          </div>

          {user && incomingFriendRequestsCount > 0 && (
            <Link
              href="/profile?tab=friends&subtab=incoming"
              onClick={closeIfMobile}
              className="flex items-center justify-between gap-2 rounded-xl border border-primary/35 bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/15 transition-colors"
            >
              <span className="font-semibold">
                {incomingFriendRequestsCount} pending friend request
                {incomingFriendRequestsCount === 1 ? "" : "s"}
              </span>
              <span className="text-[11px] font-bold underline">Review</span>
            </Link>
          )}

          {loading && activeMembers.length === 0 && onlineFriends.length === 0 ? (
            <div className="space-y-2.5" aria-label="Loading friends activity">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 rounded-xl border border-[#1c2236]/60 bg-[#121624]/60 p-2.5 animate-pulse"
                >
                  <div className="h-8 w-8 shrink-0 rounded-full bg-white/10" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-24 rounded bg-white/10" />
                    <div className="h-2.5 w-36 rounded bg-white/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : !user ? (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-[#1c2236] bg-[#121624] p-3 text-xs text-zinc-400">
                <p className="font-medium text-zinc-200">
                  Sign in to see your friends
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-400 leading-relaxed">
                  Connect with other members to see when friends are online or hosting watch parties.
                </p>
              </div>

              {displayedCommunityMembers.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Active in Community
                  </p>
                  {displayedCommunityMembers.slice(0, 3).map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 rounded-xl border border-transparent px-1.5 py-1 hover:border-[#1c2236] hover:bg-[#121624] transition-colors"
                    >
                      <Link
                        href={`/u/${encodeURIComponent(member.username)}`}
                        onClick={closeIfMobile}
                        className="relative h-8 w-8 shrink-0 rounded-full overflow-hidden bg-primary/15 border border-white/10 flex items-center justify-center text-[11px] font-bold text-primary"
                      >
                        {member.avatarUrl ? (
                          <Image
                            src={member.avatarUrl}
                            alt={member.username}
                            fill
                            sizes="32px"
                            className="object-cover"
                          />
                        ) : (
                          <span>
                            {member.username.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        {member.isOnline && (
                          <span
                            title="Online now"
                            className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-[#0b0e17]"
                          />
                        )}
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/u/${encodeURIComponent(member.username)}`}
                          onClick={closeIfMobile}
                          className="block truncate text-xs font-medium text-white hover:text-primary transition-colors"
                        >
                          {member.displayName || member.username}
                        </Link>
                        {member.recentActivity && (
                          <p className="truncate text-[11px] text-zinc-400">
                            {member.recentActivity}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : onlineFriends.length > 0 ? (
            <div className="space-y-2">
              {onlineFriends.slice(0, 6).map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center gap-3 rounded-xl border border-transparent px-1.5 py-1 hover:border-[#1c2236] hover:bg-[#121624] transition-colors"
                >
                  <Link
                    href={`/u/${encodeURIComponent(friend.username)}`}
                    onClick={closeIfMobile}
                    className="relative h-8 w-8 shrink-0 rounded-full overflow-hidden bg-primary/15 border border-white/10 flex items-center justify-center text-[11px] font-bold text-primary"
                  >
                    {friend.avatarUrl ? (
                      <Image
                        src={friend.avatarUrl}
                        alt={friend.username}
                        fill
                        sizes="32px"
                        className="object-cover"
                      />
                    ) : (
                      <span>{friend.username.slice(0, 2).toUpperCase()}</span>
                    )}
                    <span
                      title={friend.isOnline ? "Online now" : "Offline"}
                      className={`absolute bottom-0 right-0 h-2 w-2 rounded-full ring-2 ring-[#0b0e17] ${
                        friend.isOnline ? "bg-emerald-500" : "bg-zinc-600"
                      }`}
                    />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/u/${encodeURIComponent(friend.username)}`}
                      onClick={closeIfMobile}
                      className="block truncate text-xs font-medium text-white hover:text-primary transition-colors"
                    >
                      {friend.displayName || friend.username}
                    </Link>
                    <p className="truncate text-[11px] text-zinc-400">
                      {friend.recentActivity ||
                        (friend.isOnline ? "Online now" : "Offline")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-[#1c2236] bg-[#121624] p-3 text-xs text-zinc-400 space-y-2.5">
                <div>
                  <p className="font-medium text-zinc-200">
                    No friends connected yet
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-400 leading-relaxed">
                    Add friends to see when they are online or hosting Watch Together parties.
                  </p>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="w-full h-8 border-[#232a42] bg-[#161b2d] text-xs font-semibold text-zinc-200 hover:bg-[#1f263e] hover:text-white"
                >
                  <Link
                    href="/profile?tab=friends&subtab=search"
                    onClick={closeIfMobile}
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1.5 text-primary" />
                    Find Friends
                  </Link>
                </Button>
              </div>

              {displayedCommunityMembers.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Active Community Members
                  </p>
                  {displayedCommunityMembers.slice(0, 4).map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 rounded-xl border border-transparent px-1.5 py-1 hover:border-[#1c2236] hover:bg-[#121624] transition-colors"
                    >
                      <Link
                        href={`/u/${encodeURIComponent(member.username)}`}
                        onClick={closeIfMobile}
                        className="relative h-8 w-8 shrink-0 rounded-full overflow-hidden bg-primary/15 border border-white/10 flex items-center justify-center text-[11px] font-bold text-primary"
                      >
                        {member.avatarUrl ? (
                          <Image
                            src={member.avatarUrl}
                            alt={member.username}
                            fill
                            sizes="32px"
                            className="object-cover"
                          />
                        ) : (
                          <span>
                            {member.username.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        {member.isOnline && (
                          <span
                            title="Online now"
                            className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-[#0b0e17]"
                          />
                        )}
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/u/${encodeURIComponent(member.username)}`}
                          onClick={closeIfMobile}
                          className="block truncate text-xs font-medium text-white hover:text-primary transition-colors"
                        >
                          {member.displayName || member.username}
                        </Link>
                        {member.recentActivity && (
                          <p className="truncate text-[11px] text-zinc-400">
                            {member.recentActivity}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Recent Friend Activity (Authenticated Users with Friends) */}
        {user && onlineFriends.length > 0 && (
          <section aria-label="Friend Activity" className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Friend Activity</span>
              </div>
              <Link
                href="/profile?tab=friends&subtab=activity"
                onClick={closeIfMobile}
                className="text-zinc-400 hover:text-white flex items-center transition-colors"
              >
                See All <ChevronRight className="h-3 w-3 ml-0.5" />
              </Link>
            </div>
            <FriendActivityFeed
              compact
              pageSize={3}
              onItemNavigate={closeIfMobile}
            />
          </section>
        )}

        {/* Watch Together Widget */}
        <section aria-label="Watch Together" className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <Tv className="h-3.5 w-3.5 text-primary" />
              <span>Watch Together</span>
            </div>
            <Link
              href="/watch-together"
              onClick={closeIfMobile}
              className="text-zinc-400 hover:text-white flex items-center transition-colors"
            >
              See All <ChevronRight className="h-3 w-3 ml-0.5" />
            </Link>
          </div>

          {joinError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
            >
              <span>{joinError}</span>
              <button
                type="button"
                onClick={() => setJoinError(null)}
                className="text-amber-300 hover:text-white font-semibold"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading && watchRooms.length === 0 ? (
            <div
              className="space-y-2.5"
              aria-label="Loading Watch Together parties"
            >
              {[0, 1].map((idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-xl border border-[#1e253b] bg-[#121626] p-2.5 animate-pulse"
                >
                  <div className="flex items-center gap-2.5 flex-1">
                    <div className="h-11 w-11 shrink-0 rounded-lg bg-white/10" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-32 rounded bg-white/10" />
                      <div className="h-2.5 w-24 rounded bg-white/5" />
                    </div>
                  </div>
                  <div className="h-7 w-12 rounded-lg bg-white/10" />
                </div>
              ))}
            </div>
          ) : watchRooms.length === 0 ? (
            <div className="rounded-xl border border-[#1e253b] bg-[#121626] p-3.5 text-xs space-y-2">
              <div className="flex items-center gap-2 text-zinc-200 font-medium">
                <Tv className="h-4 w-4 text-primary shrink-0" />
                <span>No live public parties right now</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                {user
                  ? "No public Watch Together rooms are currently open. Visit the lobby to start a new room or join with an invite code."
                  : "No public Watch Together rooms are currently open. Open the lobby to check again or join a private room with an invite code."}
              </p>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="w-full h-8 border-[#232a42] bg-[#161b2d] text-xs hover:bg-[#1f263e] hover:text-white"
              >
                <Link href="/watch-together" onClick={closeIfMobile}>
                  {user ? "Open Watch Together Lobby" : "Browse Watch Together"}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {watchRooms.map((room) => {
                const isJoining = joiningRoomId === room.id;
                const episodeLabel = room.totalEpisodes
                  ? `Ep ${room.episodeNumber}/${room.totalEpisodes}`
                  : `Ep ${room.episodeNumber}`;
                return (
                  <div
                    key={room.id}
                    className="flex items-center justify-between gap-2.5 rounded-xl border border-[#1e253b] bg-[#121626] p-2.5 transition-colors hover:border-[#2a3454]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[#1a2035] border border-white/10 flex items-center justify-center">
                        {room.animeCover ? (
                          <Image
                            src={room.animeCover}
                            alt={room.animeTitle}
                            fill
                            sizes="44px"
                            className="object-cover"
                          />
                        ) : (
                          <Tv className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide shrink-0 ${
                              room.status === "live"
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                            }`}
                          >
                            {room.status === "live" ? (
                              <Radio className="h-2.5 w-2.5" />
                            ) : (
                              <Clock className="h-2.5 w-2.5" />
                            )}
                            {room.status === "live" ? "Live" : "Intermission"}
                          </span>
                          <p
                            className="truncate text-xs font-semibold text-white"
                            title={`${room.roomTitle} (${room.animeTitle} – ${episodeLabel})`}
                          >
                            {room.roomTitle}
                          </p>
                        </div>
                        <p
                          className="truncate text-[11px] text-zinc-300 mt-0.5"
                          title={`${room.animeTitle} · ${episodeLabel}`}
                        >
                          {room.animeTitle} · {episodeLabel}
                        </p>
                        <p className="truncate text-[11px] text-zinc-400 mt-0.5">
                          Hosted by{" "}
                          {room.host.isPublicProfile ? (
                            <Link
                              href={`/u/${encodeURIComponent(room.host.username)}`}
                              onClick={closeIfMobile}
                              className="text-zinc-300 hover:text-primary font-medium"
                            >
                              @{room.host.username}
                            </Link>
                          ) : (
                            <span className="text-zinc-300 font-medium">
                              @{room.host.username}
                            </span>
                          )}{" "}
                          · 👥 {room.participantCount}/{room.maxParticipants} ·{" "}
                          <span className="uppercase">{room.language}</span>
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isJoining}
                      onClick={() => void handleJoinWatchRoom(room)}
                      className="h-7 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:brightness-110"
                    >
                      {isJoining ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Join"
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Trending in Community */}
        <section aria-label="Trending in Community" className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <MessageSquare className="h-3.5 w-3.5 text-zinc-400" />
              <span>Trending in Community</span>
            </div>
            <Link
              href="/community"
              onClick={closeIfMobile}
              className="text-zinc-400 hover:text-white flex items-center transition-colors"
            >
              See All <ChevronRight className="h-3 w-3 ml-0.5" />
            </Link>
          </div>

          {loading && trendingDiscussions.length === 0 ? (
            <div
              className="space-y-2.5"
              aria-label="Loading trending discussions"
            >
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-[#1c2236] bg-[#121624] p-3 space-y-2 animate-pulse"
                >
                  <div className="h-3.5 w-4/5 rounded bg-white/10" />
                  <div className="h-2.5 w-1/2 rounded bg-white/5" />
                </div>
              ))}
            </div>
          ) : trendingDiscussions.length === 0 ? (
            <div className="rounded-xl border border-[#1c2236] bg-[#121624] p-3.5 text-xs space-y-2">
              <div className="flex items-center gap-2 text-zinc-200 font-medium">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <span>No trending discussions yet</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Be the first to start a discussion or ask a question in the Nayozu community hub.
              </p>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="w-full h-8 border-[#232a42] bg-[#161b2d] text-xs hover:bg-[#1f263e] hover:text-white"
              >
                <Link href="/community" onClick={closeIfMobile}>
                  Explore Community
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {trendingDiscussions.map((disc) => {
                const replyLabel =
                  disc.replyCount === 1
                    ? "1 reply"
                    : `${disc.replyCount} replies`;
                const relativeTime = formatDistanceToNow(
                  new Date(disc.latestActivityAt),
                  { addSuffix: true }
                );

                return (
                  <Link
                    key={disc.id}
                    href={`/community?discussion=${encodeURIComponent(disc.id)}#discussion-${encodeURIComponent(disc.id)}`}
                    onClick={closeIfMobile}
                    className="block rounded-xl border border-[#1c2236] bg-[#121624] p-3 hover:border-[#2a3350] hover:bg-[#151a2b] transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                          disc.category === "question"
                            ? "bg-sky-500/15 text-sky-400"
                            : "bg-primary/15 text-primary"
                        }`}
                      >
                        {disc.category}
                      </span>
                      {disc.mediaTitle && (
                        <span className="truncate text-[10px] text-zinc-400">
                          · {disc.mediaTitle}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-white line-clamp-2 leading-snug">
                      {disc.title}
                    </p>
                    <p className="mt-1.5 text-[11px] text-zinc-400 flex items-center gap-1.5 flex-wrap">
                      <span>{replyLabel}</span>
                      <span>·</span>
                      <span>{relativeTime}</span>
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </aside>
    </>
  );
}
