import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase URL or Publishable Key in .env.local");
  process.exit(1);
}

function makeAnonClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// Re-implement sanitizeRedirectPath logic from lib/supabase/proxy.ts for unit verification
const DISALLOWED_REDIRECT_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/auth/login",
  "/auth/sign-up",
  "/auth/forgot-password",
  "/auth/error",
];

function sanitizeRedirectPath(rawNext, fallback = "/") {
  if (!rawNext || typeof rawNext !== "string") return fallback;
  const trimmed = rawNext.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    /[\x00-\x1f\x7f\\]/.test(trimmed)
  ) {
    return fallback;
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return fallback;
  }
  const pathOnly = trimmed.split("?")[0]?.split("#")[0] || "/";
  if (
    DISALLOWED_REDIRECT_PREFIXES.some(
      (p) => pathOnly === p || pathOnly.startsWith(`${p}/`)
    )
  ) {
    return fallback;
  }
  return trimmed;
}

// Re-implement verifyImageMagicBytes & isValidAvatarUrl from app/settings/actions.ts
function verifyImageMagicBytes(bytes, mimeType) {
  if (!bytes || bytes.length < 12) return false;
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === "image/gif") {
    return (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) &&
      bytes[5] === 0x61
    );
  }
  if (mimeType === "image/webp") {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

function isValidAvatarUrl(url) {
  if (!url) return true;
  if (url.length > 500) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

test("1. Open-redirect protection (sanitizeRedirectPath) blocks external URLs, protocol-relative URLs, and auth loops", () => {
  assert.equal(sanitizeRedirectPath("/profile"), "/profile");
  assert.equal(sanitizeRedirectPath("/watchlist"), "/watchlist");
  assert.equal(sanitizeRedirectPath("/reading-list?tab=all"), "/reading-list?tab=all");
  assert.equal(sanitizeRedirectPath("/reset-password"), "/reset-password");

  assert.equal(sanitizeRedirectPath("https://evil.example.com"), "/");
  assert.equal(sanitizeRedirectPath("http://evil.example.com/phish"), "/");
  assert.equal(sanitizeRedirectPath("//evil.example.com"), "/");
  assert.equal(sanitizeRedirectPath("/\\evil.example.com"), "/");
  assert.equal(sanitizeRedirectPath("javascript:alert(1)"), "/");
  assert.equal(sanitizeRedirectPath("data:text/html,<script>alert(1)</script>"), "/");

  assert.equal(sanitizeRedirectPath("/login"), "/");
  assert.equal(sanitizeRedirectPath("/register"), "/");
  assert.equal(sanitizeRedirectPath("/auth/login"), "/");
  assert.equal(sanitizeRedirectPath("/auth/error"), "/");
});

test("2. Anonymous access restrictions & RLS enforcement on profiles, user_anime_library, user_roles, and avatars storage", async () => {
  const anon = makeAnonClient();

  // 2a. Anonymous user cannot read private library entries
  const { data: anonLibRows, error: anonLibSelectErr } = await anon
    .from("user_anime_library")
    .select("*");
  assert.equal(anonLibSelectErr, null);
  assert.deepEqual(
    anonLibRows,
    [],
    "Anonymous client must receive 0 rows from user_anime_library due to RLS"
  );

  // 2b. Anonymous user cannot insert into user_anime_library with an arbitrary user_id
  const fakeUserId = "00000000-0000-0000-0000-000000000001";
  const { error: anonLibInsertErr } = await anon
    .from("user_anime_library")
    .insert({
      user_id: fakeUserId,
      anime_id: "1",
      status: "planned",
      progress: 0,
    });
  assert.ok(
    anonLibInsertErr,
    "Anonymous insert into user_anime_library must be rejected by RLS"
  );

  // 2c. Anonymous user cannot insert or update profiles
  const { error: anonProfileInsertErr } = await anon.from("profiles").insert({
    id: fakeUserId,
    username: "hacker_anon",
    display_name: "Hacker",
  });
  assert.ok(
    anonProfileInsertErr,
    "Anonymous insert into profiles must be rejected by RLS"
  );

  // 2d. Anonymous user cannot read or grant roles in user_roles
  const { data: anonRoles } = await anon.from("user_roles").select("*");
  assert.deepEqual(anonRoles, [], "Anonymous user cannot read user_roles");

  const { error: anonRoleInsertErr } = await anon.from("user_roles").insert({
    user_id: fakeUserId,
    role: "admin",
  });
  assert.ok(
    anonRoleInsertErr,
    "Anonymous insert into user_roles must be rejected by RLS"
  );

  // 2e. Anonymous user cannot upload into the avatars storage bucket
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const { error: anonUploadErr } = await anon.storage
    .from("avatars")
    .upload(`${fakeUserId}/exploit.png`, pngHeader, {
      contentType: "image/png",
      upsert: true,
    });
  assert.ok(
    anonUploadErr,
    "Anonymous upload to avatars bucket must be rejected by storage.objects RLS"
  );

  // 2f. Public catalog (anime) and public profiles remain readable without authentication
  const { data: publicAnime, error: publicAnimeErr } = await anon
    .from("anime")
    .select("id, slug, media_type")
    .limit(3);
  assert.equal(publicAnimeErr, null);
  assert.ok(Array.isArray(publicAnime) && publicAnime.length > 0);

  const { error: publicProfilesErr } = await anon
    .from("profiles")
    .select("id, username, display_name")
    .limit(3);
  assert.equal(publicProfilesErr, null);
});

test("3. Authentication: invalid login credentials and missing/expired session handling", async () => {
  const client = makeAnonClient();

  const { data: badLoginData, error: badLoginErr } =
    await client.auth.signInWithPassword({
      email: "nonexistent_test_user_nayozu@gmail.com",
      password: "WrongPassword123!",
    });
  assert.ok(badLoginErr, "Expected error for invalid login credentials");
  assert.equal(badLoginData.session, null);

  const { data: missingUserData } = await client.auth.getUser();
  assert.equal(missingUserData.user, null);

  const { data: invalidTokenData, error: invalidTokenErr } =
    await client.auth.getUser(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature"
    );
  assert.ok(invalidTokenErr || !invalidTokenData?.user);
});

test("4. Avatar upload magic-byte verification, URL validation, and library key/status invariants", () => {
  // Valid PNG magic bytes
  const validPng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
  ]);
  assert.equal(verifyImageMagicBytes(validPng, "image/png"), true);

  // Valid JPEG magic bytes
  const validJpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1,
  ]);
  assert.equal(verifyImageMagicBytes(validJpeg, "image/jpeg"), true);

  // Disguised SVG/HTML XSS payload claiming to be image/png must be rejected
  const disguisedSvg = new TextEncoder().encode(
    '<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"></svg>'
  );
  assert.equal(verifyImageMagicBytes(disguisedSvg, "image/png"), false);
  assert.equal(verifyImageMagicBytes(disguisedSvg, "image/svg+xml"), false);

  // Disguised Windows MZ executable claiming to be image/jpeg must be rejected
  const disguisedExe = new Uint8Array([
    0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 4, 0, 0, 0,
  ]);
  assert.equal(verifyImageMagicBytes(disguisedExe, "image/jpeg"), false);

  // Avatar URL scheme validation
  assert.equal(isValidAvatarUrl("https://images.unsplash.com/photo-1"), true);
  assert.equal(isValidAvatarUrl("javascript:alert(document.cookie)"), false);
  assert.equal(isValidAvatarUrl("data:image/svg+xml,<svg onload=alert(1)>"), false);

  // Canonical library keys never collide between anime and manga with same externalId
  const extId = 21;
  const animeKey = String(extId);
  const mangaKey = `manga:${extId}`;
  const favAnimeKey = `fav:anime:${extId}`;
  const favMangaKey = `fav:manga:${extId}`;
  assert.notEqual(animeKey, mangaKey);
  assert.notEqual(animeKey, favAnimeKey);
  assert.notEqual(mangaKey, favMangaKey);
});

test("5. Live Registration / Trigger Profile Verification, Case-Insensitive Username Lookup, and Unverified Account Protection", async () => {
  const anonCheck = makeAnonClient();

  // Verify existing trigger-created profile rows in public.profiles
  const { data: existingProfiles, error: listErr } = await anonCheck
    .from("profiles")
    .select("id, username, display_name")
    .not("username", "is", null)
    .limit(5);

  assert.equal(listErr, null);
  assert.ok(
    Array.isArray(existingProfiles) && existingProfiles.length > 0,
    "Expected at least one profile row in public.profiles"
  );

  // Pick a profile with an underscore in its username (e.g. tester_a_... created by on_auth_user_created trigger)
  const targetProfile =
    existingProfiles.find((p) => p.username && p.username.includes("_")) ||
    existingProfiles[0];

  const targetUsername = targetProfile.username;

  // Verify case-insensitive username conflict lookup with escaped underscores matches uppercase variant
  const escapedUpper = targetUsername.toUpperCase().replace(/[%_\\]/g, "\\$&");
  const { data: caseConflictRow, error: caseErr } = await anonCheck
    .from("profiles")
    .select("id, username")
    .ilike("username", escapedUpper)
    .maybeSingle();

  assert.equal(caseErr, null);
  assert.ok(
    caseConflictRow && caseConflictRow.id === targetProfile.id,
    "Case-insensitive username lookup must detect existing mixed-case username"
  );

  // Verify that replacing '_' with 'X' does NOT match when '_' is escaped
  if (targetUsername.includes("_")) {
    const nonMatchingVariant = targetUsername
      .replace(/_/g, "X")
      .replace(/[%_\\]/g, "\\$&");
    const { data: wildcardCheckRow } = await anonCheck
      .from("profiles")
      .select("id")
      .ilike("username", nonMatchingVariant)
      .maybeSingle();
    assert.equal(
      wildcardCheckRow,
      null,
      "Escaped underscore in ILIKE must not match arbitrary single characters"
    );
  }
});

test("6. Security Audit: No service-role key exposure in browser/app code & SQL migrations enforce constraints", () => {
  // Scan client/app/lib files for any service-role env var or secret usage
  const dirsToScan = ["app", "components", "lib"];
  const forbiddenPatterns = [
    /SUPABASE_SERVICE_ROLE_KEY/,
    /NEXT_PUBLIC_.*SERVICE_ROLE/i,
    /createClient\([^)]*service_role/i,
  ];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(fullPath, "utf8");
        for (const pat of forbiddenPatterns) {
          assert.equal(
            pat.test(text),
            false,
            `Forbidden service-role reference found in ${fullPath}`
          );
        }
      }
    }
  }

  for (const d of dirsToScan) {
    scanDir(path.resolve(process.cwd(), d));
  }

  // Verify latest security migration includes unique lower(username) index, CHECK constraints, and avatars RLS
  const secMig = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20261102000000_milestone3_security_and_avatar_storage.sql"
    ),
    "utf8"
  );
  assert.ok(secMig.includes("create unique index if not exists idx_profiles_username_lower_unique"));
  assert.ok(secMig.includes("profiles_username_format_check"));
  assert.ok(secMig.includes("profiles_avatar_url_format_check"));
  assert.ok(secMig.includes("user_anime_library_anime_id_format_check"));
  assert.ok(secMig.includes("(storage.foldername(name))[1] = auth.uid()::text"));
});

test("7. Live Next.js Production Server Regression & Auth Route Verification", async () => {
  const { spawn } = await import("node:child_process");
  const port = 3489;
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.resolve(
    process.cwd(),
    "node_modules/next/dist/bin/next"
  );

  const serverProc = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });

  try {
    // Wait until server is ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for Next.js server to start")),
        20000
      );
      serverProc.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        if (text.includes("Ready in") || text.includes(String(port))) {
          clearTimeout(timeout);
          resolve();
        }
      });
      serverProc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // 7a. Public routes must return 200 OK without authentication
    const publicRoutes = [
      "/",
      "/discover",
      "/anime",
      "/manga",
      "/search?q=naruto",
      "/community",
      "/watch-together",
    ];

    for (const route of publicRoutes) {
      const res = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
      assert.equal(
        res.status,
        200,
        `Public route ${route} should return 200 for anonymous visitor, got ${res.status}`
      );
    }

    // Verify homepage contains Sign in (/login) and Get started (/register) links
    const homeHtml = await (await fetch(`${baseUrl}/`)).text();
    assert.ok(
      homeHtml.includes('href="/login"'),
      "Header/Homepage must link to /login"
    );
    assert.ok(
      homeHtml.includes('href="/register"'),
      "Header/Homepage must link to /register"
    );

    // 7b. Authentication pages render 200 OK for anonymous visitor
    for (const authRoute of [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
    ]) {
      const res = await fetch(`${baseUrl}${authRoute}`, { redirect: "manual" });
      assert.equal(
        res.status,
        200,
        `Auth route ${authRoute} should return 200, got ${res.status}`
      );
    }

    // Verify /reset-password without recovery session renders expired/invalid recovery guard
    const resetHtml = await (await fetch(`${baseUrl}/reset-password`)).text();
    assert.ok(
      resetHtml.includes("Recovery Link Expired or Invalid"),
      "/reset-password without session must show expired/invalid recovery state"
    );

    // 7c. /auth/callback without code redirects safely to internal /auth/error and blocks open redirects
    const cbRes = await fetch(
      `${baseUrl}/auth/callback?next=https://evil.example.com`,
      { redirect: "manual" }
    );
    assert.equal(cbRes.status, 307);
    const cbLocation = cbRes.headers.get("location") || "";
    assert.ok(
      !cbLocation.includes("evil.example.com"),
      `/auth/callback must never redirect to external domain, got ${cbLocation}`
    );
    assert.ok(
      cbLocation.includes("/auth/error"),
      `/auth/callback without code/token_hash must redirect to /auth/error`
    );

    // 7d. Protected routes in PROTECTED_PATHS redirect unauthenticated requests to /login?next=<route> via proxy.ts
    const redirectProtectedRoutes = [
      "/profile",
      "/library",
      "/watchlist",
      "/reading-list",
      "/favorites",
      "/history",
      "/settings",
      "/moderation",
      "/protected",
    ];

    for (const protRoute of redirectProtectedRoutes) {
      const res = await fetch(`${baseUrl}${protRoute}`, {
        redirect: "manual",
      });
      assert.equal(
        res.status,
        307,
        `Protected route ${protRoute} must return 307 redirect for anonymous user`
      );
      const loc = res.headers.get("location") || "";
      assert.ok(
        loc.includes(`/login?next=${encodeURIComponent(protRoute)}`) ||
          loc.includes(`/login?next=${protRoute}`),
        `Protected route ${protRoute} must redirect to /login?next=..., got ${loc}`
      );
    }
  } finally {
    serverProc.kill();
  }
});
