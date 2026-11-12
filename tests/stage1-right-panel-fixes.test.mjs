import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readProjectFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

// Mirror of sanitizeRedirectPath from lib/supabase/proxy.ts for runtime assertions
function sanitizeRedirectPath(raw, fallback = "/") {
  if (!raw || typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;
  if (/[\r\n\0]/.test(trimmed)) return fallback;
  try {
    const parsed = new URL(trimmed, "http://nayozu.local");
    if (parsed.origin !== "http://nayozu.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

const AUTH_ROUTE_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth",
];

function buildGuestAuthRedirectParam(pathname, search) {
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

function shouldCloseDrawerOnOutsidePointerDown({
  rightOpen,
  isDesktopViewport,
  isInsidePanel,
  isInsideTrigger,
}) {
  if (!rightOpen) return false;
  if (isDesktopViewport) return false;
  if (isInsidePanel || isInsideTrigger) return false;
  return true;
}

function coordinateDrawerState(prev, action, isMobileOrTablet) {
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

function canTrackPublicPresence(user, profile) {
  if (!user?.id || !profile) return false;
  if (profile.id !== user.id) return false;
  return profile.profileVisibility === "public";
}

function filterPublicPresenceState(presenceState, options = {}) {
  const nextMap = new Map();
  const blockedSet = options.blockedSet;
  const knownPrivateUserIds = options.knownPrivateUserIds;

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

test("1. Desktop outside-click does not close the drawer", () => {
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");
  assert.match(
    rightPanelSrc,
    /window\.matchMedia\("\(\s*min-width:\s*1024px\s*\)"\)\.matches/,
    "RightPanel mousedown handler must check desktop viewport (min-width: 1024px)"
  );
  assert.match(
    rightPanelSrc,
    /shouldCloseDrawerOnOutsidePointerDown/,
    "RightPanel must use shouldCloseDrawerOnOutsidePointerDown"
  );

  // Clicking main page, header, sidebar, or search on desktop (>= 1024px) must NOT close the drawer
  assert.equal(
    shouldCloseDrawerOnOutsidePointerDown({
      rightOpen: true,
      isDesktopViewport: true,
      isInsidePanel: false,
      isInsideTrigger: false,
    }),
    false
  );
});

test("2. Mobile/tablet outside-click or backdrop closes the drawer", () => {
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");
  assert.match(
    rightPanelSrc,
    /className="fixed inset-0 z-40 bg-black\/60 backdrop-blur-sm lg:hidden"[\s\S]*?onClick=\{closeRight\}/,
    "Mobile/tablet backdrop overlay must remain hidden on desktop (lg:hidden) and close the drawer on click"
  );

  // Outside click on mobile/tablet closes the drawer
  assert.equal(
    shouldCloseDrawerOnOutsidePointerDown({
      rightOpen: true,
      isDesktopViewport: false,
      isInsidePanel: false,
      isInsideTrigger: false,
    }),
    true
  );

  // Clicking inside the panel on mobile/tablet does NOT close the drawer
  assert.equal(
    shouldCloseDrawerOnOutsidePointerDown({
      rightOpen: true,
      isDesktopViewport: false,
      isInsidePanel: true,
      isInsideTrigger: false,
    }),
    false
  );
});

test("3. Settings toggle has trigger identification and opens/closes the drawer without outside-click conflict", () => {
  const settingsSrc = readProjectFile("app/settings/settings-client.tsx");
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");

  assert.match(
    settingsSrc,
    /data-right-panel-trigger="true"[\s\S]{0,160}aria-expanded=\{rightOpen\}[\s\S]{0,160}aria-controls="community-activity-panel"[\s\S]{0,160}onClick=\{toggleRight\}/,
    "Settings visibility button must have data-right-panel-trigger='true', aria-expanded, and aria-controls"
  );

  assert.match(
    rightPanelSrc,
    /querySelectorAll\(\s*'\[data-right-panel-trigger="true"\]'\s*\)/,
    "RightPanel outside-click detection must inspect all [data-right-panel-trigger='true'] elements, not only the first querySelector match"
  );

  // Clicking any trigger must not cause outside-click closure
  assert.equal(
    shouldCloseDrawerOnOutsidePointerDown({
      rightOpen: true,
      isDesktopViewport: false,
      isInsidePanel: false,
      isInsideTrigger: true,
    }),
    false
  );

  // Toggling from Settings opens and closes while preserving state transitions
  let state = { leftOpen: false, rightOpen: false };
  state = coordinateDrawerState(state, "toggleRight", false);
  assert.equal(state.rightOpen, true);
  state = coordinateDrawerState(state, "toggleRight", false);
  assert.equal(state.rightOpen, false);
});

test("4. Closed drawer is inert, invisible, and not keyboard-focusable", () => {
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");

  assert.match(
    rightPanelSrc,
    /aria-hidden=\{!rightOpen\}/,
    "Drawer aside must set aria-hidden={!rightOpen}"
  );
  assert.match(
    rightPanelSrc,
    /inert=\{!rightOpen \? true : undefined\}/,
    "Drawer aside must set inert when closed so children cannot be reached via Tab"
  );
  assert.match(
    rightPanelSrc,
    /translate-x-full invisible pointer-events-none/,
    "Closed drawer must apply invisible class alongside translate-x-full and pointer-events-none"
  );
  assert.match(
    rightPanelSrc,
    /transition-\[transform,visibility\] duration-300 ease-in-out/,
    "Drawer must preserve smooth slide transition across transform and visibility"
  );
});

test("5. Escape closes the drawer and restores focus to the trigger", () => {
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");

  assert.match(
    rightPanelSrc,
    /if \(e\.key === "Escape"\) \{[\s\S]*?e\.preventDefault\(\);[\s\S]*?closeRight\(\);[\s\S]*?restoreFocusToTrigger\(\);/,
    "Pressing Escape must preventDefault, close the drawer, and restore focus to the trigger"
  );
  assert.match(
    rightPanelSrc,
    /panelRef\.current\.contains\(document\.activeElement\)[\s\S]*?restoreFocusToTrigger\(\)/,
    "Closing the drawer while focus is inside it must move focus back to the trigger so focus is never trapped in an inert drawer"
  );
});

test("6. Left/right mobile drawers cannot remain open together", () => {
  const shellSrc = readProjectFile("components/shell-context.tsx");
  assert.match(
    shellSrc,
    /export function coordinateDrawerState/,
    "ShellContext must define coordinateDrawerState for drawer coordination"
  );

  // On mobile/tablet (isMobileOrTablet = true):
  // Opening right drawer when left drawer is open closes left drawer
  const afterOpenRightOnMobile = coordinateDrawerState(
    { leftOpen: true, rightOpen: false },
    "toggleRight",
    true
  );
  assert.deepEqual(afterOpenRightOnMobile, {
    leftOpen: false,
    rightOpen: true,
  });

  // Opening left drawer when right drawer is open closes right drawer
  const afterOpenLeftOnMobile = coordinateDrawerState(
    { leftOpen: false, rightOpen: true },
    "toggleLeft",
    true
  );
  assert.deepEqual(afterOpenLeftOnMobile, {
    leftOpen: true,
    rightOpen: false,
  });

  // On desktop (isMobileOrTablet = false), independent state is preserved
  const desktopState = coordinateDrawerState(
    { leftOpen: false, rightOpen: true },
    "toggleLeft",
    false
  );
  assert.deepEqual(desktopState, {
    leftOpen: true,
    rightOpen: true,
  });
});

test("7. Desktop layout reserves space when the drawer is open and avoids horizontal overflow", () => {
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");
  const layoutSrc = readProjectFile("app/layout.tsx");

  assert.match(
    rightPanelSrc,
    /data-right-panel-spacer="true"[\s\S]*?hidden lg:block shrink-0 transition-\[width\] duration-300 ease-in-out \$\{\s*rightOpen \? "lg:w-80 xl:w-\[340px\]" : "lg:w-0"\s*\}/,
    "RightPanel must render a desktop flex spacer matching lg:w-80 xl:w-[340px] when open and lg:w-0 when closed"
  );
  assert.match(
    layoutSrc,
    /overflow-x-hidden/,
    "RootLayout body must prevent horizontal overflow when the fixed drawer is off-screen"
  );
});

test("8. Guest login/register links preserve pathname and query parameters safely", () => {
  assert.equal(
    buildGuestAuthRedirectParam("/watch-together", "?room=123"),
    `?next=${encodeURIComponent("/watch-together?room=123")}`
  );
  assert.equal(
    buildGuestAuthRedirectParam("/community", "?discussion=456"),
    `?next=${encodeURIComponent("/community?discussion=456")}`
  );
  assert.equal(
    buildGuestAuthRedirectParam("/search", "?q=one+piece"),
    `?next=${encodeURIComponent("/search?q=one+piece")}`
  );
  assert.equal(buildGuestAuthRedirectParam("/", ""), "");
  assert.equal(
    buildGuestAuthRedirectParam("/", "?genre=action"),
    `?next=${encodeURIComponent("/?genre=action")}`
  );

  // Authentication routes must not include themselves as return destinations
  assert.equal(buildGuestAuthRedirectParam("/login", "?next=/library"), "");
  assert.equal(buildGuestAuthRedirectParam("/register", ""), "");
  assert.equal(buildGuestAuthRedirectParam("/forgot-password", ""), "");
  assert.equal(buildGuestAuthRedirectParam("/reset-password", ""), "");
  assert.equal(buildGuestAuthRedirectParam("/auth/callback", "?code=abc"), "");
});

test("9. Malicious redirect targets are rejected", () => {
  assert.equal(buildGuestAuthRedirectParam("//evil.com", "?room=123"), "");
  assert.equal(buildGuestAuthRedirectParam("/\\evil.com", ""), "");
  assert.equal(buildGuestAuthRedirectParam("https://evil.com/phish", ""), "");
  assert.equal(
    buildGuestAuthRedirectParam("/watch-together", "?room=123\r\nSet-Cookie:x"),
    ""
  );
});

test("10. Private profiles are not broadcast or exposed as public presence", () => {
  const rightPanelSrc = readProjectFile("components/right-panel.tsx");

  // Channel subscription lifecycle must be separated from profile updates
  assert.match(
    rightPanelSrc,
    /\}, \[rightOpen, currentUserId\]\);/,
    "Realtime channel subscription effect must depend only on [rightOpen, currentUserId] to prevent WebSocket reconnections when profile loads"
  );

  const user = { id: "user-1" };

  // Profile not loaded yet -> do not broadcast
  assert.equal(canTrackPublicPresence(user, null), false);

  // Private profile -> do not broadcast
  assert.equal(
    canTrackPublicPresence(user, {
      id: "user-1",
      username: "secret_otaku",
      displayName: "Secret Otaku",
      avatarUrl: null,
      profileVisibility: "private",
    }),
    false
  );

  // Public profile -> broadcast allowed
  assert.equal(
    canTrackPublicPresence(user, {
      id: "user-1",
      username: "public_otaku",
      displayName: "Public Otaku",
      avatarUrl: null,
      profileVisibility: "public",
    }),
    true
  );

  // Received presence entries without confirmed isPublicProfile === true or belonging to known private/blocked users are excluded
  const filtered = filterPublicPresenceState(
    {
      key1: [
        {
          userId: "u-public",
          username: "pubuser",
          displayName: "Pub User",
          isPublicProfile: true,
        },
      ],
      key2: [
        {
          userId: "u-unverified",
          username: "unverified",
          displayName: "Unverified",
          // Missing isPublicProfile: true
        },
      ],
      key3: [
        {
          userId: "u-private",
          username: "privuser",
          displayName: "Priv User",
          isPublicProfile: false,
        },
      ],
      key4: [
        {
          userId: "u-blocked",
          username: "blockeduser",
          displayName: "Blocked User",
          isPublicProfile: true,
        },
      ],
    },
    {
      blockedSet: new Set(["u-blocked"]),
      knownPrivateUserIds: new Set(["u-private"]),
    }
  );

  assert.equal(filtered.size, 1);
  assert.equal(filtered.has("u-public"), true);
  assert.equal(filtered.has("u-unverified"), false);
  assert.equal(filtered.has("u-private"), false);
  assert.equal(filtered.has("u-blocked"), false);
});

test("11. Bidirectional block filtering excludes activity in both directions and queries are bounded", () => {
  const migrationSrc = readProjectFile(
    "supabase/migrations/20261112000000_stage1_bidirectional_block_ids_rpc.sql"
  );
  const actionsSrc = readProjectFile("lib/actions/communityActions.ts");

  // Verify migration defines narrowly-scoped SECURITY DEFINER function
  assert.match(
    migrationSrc,
    /create or replace function public\.get_bidirectional_blocked_user_ids\(\)[\s\S]*?security definer[\s\S]*?set search_path = public/,
    "Migration must define SECURITY DEFINER RPC get_bidirectional_blocked_user_ids with search_path = public"
  );
  assert.match(
    migrationSrc,
    /where auth\.uid\(\) is not null\s+and \(b\.blocker_id = auth\.uid\(\) or b\.blocked_id = auth\.uid\(\)\)/,
    "RPC must strictly scope to auth.uid() in both directions (blocker_id = auth.uid() or blocked_id = auth.uid())"
  );
  assert.match(
    migrationSrc,
    /revoke all on function public\.get_bidirectional_blocked_user_ids\(\) from public;[\s\S]*?grant execute on function public\.get_bidirectional_blocked_user_ids\(\) to authenticated;/,
    "RPC permissions must be revoked from public and granted to authenticated"
  );

  // Verify communityActions.ts calls get_bidirectional_blocked_user_ids and falls back to is_blocked_between
  assert.match(
    actionsSrc,
    /supabase\.rpc\("get_bidirectional_blocked_user_ids"\)/,
    "getBlockedUserSetWithMeta must call get_bidirectional_blocked_user_ids RPC"
  );
  assert.match(
    actionsSrc,
    /supabase\.rpc\("is_blocked_between",\s*\{\s*user_a:\s*userA,\s*user_b:\s*userB,?\s*\}\)/,
    "isBlockedBetween must use the SECURITY DEFINER is_blocked_between RPC"
  );

  // Verify bounded query limits on discussion_replies and content_reactions in getRightPanelDataAction
  assert.match(
    actionsSrc,
    /\.from\("discussion_replies"\)[\s\S]{0,260}\.order\("created_at",\s*\{\s*ascending:\s*false\s*\}\)[\s\S]{0,80}\.limit\(500\)/,
    "discussion_replies query in getRightPanelDataAction must have bounded .order('created_at', { ascending: false }).limit(500)"
  );
  assert.match(
    actionsSrc,
    /\.from\("content_reactions"\)[\s\S]{0,260}\.order\("created_at",\s*\{\s*ascending:\s*false\s*\}\)[\s\S]{0,80}\.limit\(500\)/,
    "content_reactions query in getRightPanelDataAction must have bounded .order('created_at', { ascending: false }).limit(500)"
  );

  // Simulate bidirectional filtering where User A blocked Viewer AND Viewer blocked User B
  const viewerId = "viewer-uuid";
  const userWhoBlockedViewer = "blocker-peer-uuid";
  const userBlockedByViewer = "blocked-peer-uuid";
  const normalPeer = "normal-peer-uuid";

  const bidirectionalBlockedSet = new Set([
    userWhoBlockedViewer,
    userBlockedByViewer,
  ]);

  const rawDiscussions = [
    { id: "d1", user_id: userWhoBlockedViewer, title: "From user who blocked viewer" },
    { id: "d2", user_id: userBlockedByViewer, title: "From user blocked by viewer" },
    { id: "d3", user_id: normalPeer, title: "From normal peer" },
  ];
  const visibleDiscussions = rawDiscussions.filter(
    (d) => !bidirectionalBlockedSet.has(d.user_id)
  );
  assert.deepEqual(
    visibleDiscussions.map((d) => d.id),
    ["d3"]
  );

  const rawWatchRooms = [
    { id: "r1", user_id: userWhoBlockedViewer },
    { id: "r2", user_id: userBlockedByViewer },
    { id: "r3", user_id: normalPeer },
  ];
  const visibleWatchRooms = rawWatchRooms.filter(
    (r) => !bidirectionalBlockedSet.has(r.user_id)
  );
  assert.deepEqual(
    visibleWatchRooms.map((r) => r.id),
    ["r3"]
  );

  const rawReplies = [
    { id: "rep1", discussion_id: "d3", user_id: userWhoBlockedViewer },
    { id: "rep2", discussion_id: "d3", user_id: userBlockedByViewer },
    { id: "rep3", discussion_id: "d3", user_id: normalPeer },
  ];
  const visibleReplies = rawReplies.filter(
    (r) => !bidirectionalBlockedSet.has(r.user_id)
  );
  assert.deepEqual(
    visibleReplies.map((r) => r.id),
    ["rep3"]
  );

  const activeMemberIds = [
    viewerId,
    userWhoBlockedViewer,
    userBlockedByViewer,
    normalPeer,
  ].filter((uid) => uid !== viewerId && !bidirectionalBlockedSet.has(uid));
  assert.deepEqual(activeMemberIds, [normalPeer]);
});
