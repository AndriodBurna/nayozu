import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = { ...loadEnvLocal(), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY =
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function makeAnonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

test("1. Milestone 4 — Route protection & Guest vs Authenticated navigation checks", () => {
  const proxySource = fs.readFileSync(
    path.join(process.cwd(), "lib/supabase/proxy.ts"),
    "utf8"
  );
  for (const requiredRoute of [
    "/library",
    "/watchlist",
    "/reading-list",
    "/history",
    "/favorites",
    "/profile",
    "/settings",
    "/moderation",
    "/admin",
  ]) {
    assert.ok(
      proxySource.includes(`"${requiredRoute}"`),
      `Expected PROTECTED_PATHS in lib/supabase/proxy.ts to include ${requiredRoute}`
    );
  }

  const sidebarSource = fs.readFileSync(
    path.join(process.cwd(), "components/sidebar.tsx"),
    "utf8"
  );
  assert.ok(
    sidebarSource.includes("{user && ("),
    "Expected Sidebar to gate personal screens (My Library, My Activity, Settings) behind authenticated user check"
  );

  const headerSource = fs.readFileSync(
    path.join(process.cwd(), "components/header.tsx"),
    "utf8"
  );
  assert.ok(
    headerSource.includes("{user && ("),
    "Expected Header to gate Notifications bell behind authenticated user check"
  );
});

test("2. Milestone 4 — SQL Migration & Server Action Security Invariants", () => {
  const migrationSql = fs
    .readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20261102010000_milestone4_community_and_moderation.sql"
      ),
      "utf8"
    )
    .toLowerCase();

  // Verify RLS is enabled on all new Milestone 4 UGC and moderation tables
  for (const table of [
    "public.discussions",
    "public.discussion_replies",
    "public.content_reactions",
    "public.user_blocks",
    "public.moderation_logs",
  ]) {
    assert.ok(
      migrationSql.includes(`alter table ${table} enable row level security`),
      `Expected migration to enable RLS on ${table}`
    );
  }

  // Verify self-block prevention constraint
  assert.ok(
    migrationSql.includes("blocker_id <> blocked_id"),
    "Expected self-block prevention constraint on public.user_blocks"
  );

  // Verify unique reaction per user per target constraint
  assert.ok(
    migrationSql.includes("unique (user_id, target_type, target_id)"),
    "Expected UNIQUE (user_id, target_type, target_id) on public.content_reactions"
  );

  // Verify duplicate active report partial unique index
  assert.ok(
    migrationSql.includes("idx_content_reports_active_unique"),
    "Expected partial unique index preventing duplicate active reports"
  );

  // Verify no service_role key exposure in any Milestone 4 client/server files
  const filesToScan = [
    "lib/actions/communityActions.ts",
    "components/community-action-modals.tsx",
    "components/media-reviews-section.tsx",
    "components/comment-list.tsx",
    "app/moderation/page.tsx",
    "app/moderation/moderation-client.tsx",
    "app/u/[username]/page.tsx",
    "app/u/[username]/public-profile-client.tsx",
  ];
  for (const relPath of filesToScan) {
    const content = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
    assert.ok(
      !content.includes("SUPABASE_SERVICE_ROLE_KEY"),
      `File ${relPath} must not reference SUPABASE_SERVICE_ROLE_KEY`
    );
  }
});

test("3. Milestone 4 — Live Supabase Database Tables, RPCs, and Anonymous RLS Enforcement", async () => {
  const anon = makeAnonClient();
  const fakeUserId = "00000000-0000-0000-0000-000000000001";
  const fakeUserId2 = "00000000-0000-0000-0000-000000000002";

  // 3a. Public read of discussions, discussion_replies, content_reactions, anime_reviews, anime_comments succeeds
  const [discRes, replyRes, reactRes, revRes, comRes] = await Promise.all([
    anon
      .from("discussions")
      .select("id, anime_id, media_type, title, is_locked, is_hidden")
      .limit(5),
    anon.from("discussion_replies").select("id, body, is_hidden").limit(5),
    anon.from("content_reactions").select("id, target_type, reaction_type").limit(5),
    anon.from("anime_reviews").select("id, anime_id, is_hidden").limit(5),
    anon
      .from("anime_comments")
      .select("id, anime_id, media_type, episode_number, chapter_number")
      .limit(5),
  ]);

  assert.equal(discRes.error, null, "Public read on discussions should succeed");
  assert.equal(
    replyRes.error,
    null,
    "Public read on discussion_replies should succeed"
  );
  assert.equal(
    reactRes.error,
    null,
    "Public read on content_reactions should succeed"
  );
  assert.equal(revRes.error, null, "Public read on anime_reviews should succeed");
  assert.equal(
    comRes.error,
    null,
    "Public read on anime_comments with episode/chapter columns should succeed"
  );

  // 3b. Anonymous user cannot read private tables (user_blocks, content_reports, user_restrictions, moderation_logs)
  const [blocksRead, reportsRead, restrictRead, logsRead] = await Promise.all([
    anon.from("user_blocks").select("*"),
    anon.from("content_reports").select("*"),
    anon.from("user_restrictions").select("*"),
    anon.from("moderation_logs").select("*"),
  ]);

  assert.deepEqual(
    blocksRead.data,
    [],
    "Anonymous client must receive 0 rows from user_blocks"
  );
  assert.deepEqual(
    reportsRead.data,
    [],
    "Anonymous client must receive 0 rows from content_reports"
  );
  assert.deepEqual(
    restrictRead.data,
    [],
    "Anonymous client must receive 0 rows from user_restrictions"
  );
  assert.deepEqual(
    logsRead.data,
    [],
    "Anonymous client must receive 0 rows from moderation_logs"
  );

  // 3c. Anonymous user cannot insert into any Milestone 4 UGC or moderation table
  const { error: anonDiscErr } = await anon.from("discussions").insert({
    user_id: fakeUserId,
    anime_id: "community",
    media_type: "community",
    category: "discussion",
    title: "Unauthorized guest discussion",
    body: "Should be blocked by RLS",
  });
  assert.ok(anonDiscErr, "Anonymous insert into discussions must be rejected by RLS");

  const { error: anonReplyErr } = await anon.from("discussion_replies").insert({
    discussion_id: fakeUserId,
    user_id: fakeUserId,
    body: "Unauthorized guest reply",
  });
  assert.ok(
    anonReplyErr,
    "Anonymous insert into discussion_replies must be rejected by RLS"
  );

  const { error: anonReactErr } = await anon.from("content_reactions").insert({
    user_id: fakeUserId,
    target_type: "discussion",
    target_id: fakeUserId,
    reaction_type: "like",
  });
  assert.ok(
    anonReactErr,
    "Anonymous insert into content_reactions must be rejected by RLS"
  );

  const { error: anonBlockErr } = await anon.from("user_blocks").insert({
    blocker_id: fakeUserId,
    blocked_id: fakeUserId2,
  });
  assert.ok(anonBlockErr, "Anonymous insert into user_blocks must be rejected by RLS");

  const { error: anonReportErr } = await anon.from("content_reports").insert({
    reporter_id: fakeUserId,
    content_type: "discussion",
    content_id: fakeUserId,
    category: "spam",
    reason: "[spam]",
  });
  assert.ok(
    anonReportErr,
    "Anonymous insert into content_reports must be rejected by RLS"
  );

  const { error: anonRestrictErr } = await anon.from("user_restrictions").insert({
    user_id: fakeUserId,
    restriction_type: "permanent_suspension",
    status: "active",
    reason: "Unauthorized restriction attempt",
  });
  assert.ok(
    anonRestrictErr,
    "Anonymous insert into user_restrictions must be rejected by RLS"
  );

  const { error: anonLogErr } = await anon.from("moderation_logs").insert({
    actor_id: fakeUserId,
    actor_role: "admin",
    action_type: "fake_action",
    target_type: "user",
    target_id: fakeUserId2,
  });
  assert.ok(
    anonLogErr,
    "Anonymous insert into moderation_logs must be rejected by RLS"
  );

  // 3d. Verify live database security functions and profile_visibility column
  const [
    { data: existingProfiles, error: profErr },
    { data: restrictedCheck, error: restRpcErr },
    { data: blockedCheck, error: blockRpcErr },
  ] = await Promise.all([
    anon
      .from("profiles")
      .select("id, username, profile_visibility")
      .not("username", "is", null)
      .limit(1),
    anon.rpc("is_user_actively_restricted", { user_uuid: fakeUserId }),
    anon.rpc("is_blocked_between", {
      user_a: fakeUserId,
      user_b: fakeUserId2,
    }),
  ]);

  assert.equal(profErr, null);
  assert.equal(restRpcErr, null);
  assert.equal(restrictedCheck, false);
  assert.equal(blockRpcErr, null);
  assert.equal(blockedCheck, false);

  if (existingProfiles && existingProfiles.length > 0) {
    assert.ok(
      existingProfiles[0].profile_visibility === "public" ||
        existingProfiles[0].profile_visibility === "private"
    );
  }
});
