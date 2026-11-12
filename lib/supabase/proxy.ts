import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

// Pages that strictly redirect unauthenticated visitors to /login.
// Note: Public discovery pages (/, /anime, /manga, /series, /movies, /coming-soon, /calendar, /discover, /search)
// remain accessible to signed-out visitors.
const PROTECTED_PATHS = [
  "/library",
  "/watchlist",
  "/reading-list",
  "/history",
  "/favorites",
  "/profile",
  "/settings",
  "/moderation",
  "/admin",
  "/protected",
];

const AUTH_GUEST_ONLY_PATHS = ["/login", "/register", "/auth/login", "/auth/sign-up"];

const DISALLOWED_REDIRECT_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/auth/login",
  "/auth/sign-up",
  "/auth/forgot-password",
  "/auth/error",
];

const isProtectedPath = (pathname: string) =>
  PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const isAuthGuestOnlyPath = (pathname: string) =>
  AUTH_GUEST_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function sanitizeRedirectPath(rawNext: string | null | undefined, fallback = "/"): string {
  if (!rawNext || typeof rawNext !== "string") return fallback;
  const trimmed = rawNext.trim();
  // Reject control characters, non-leading "/", protocol-relative "//", or backslash "/\"
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

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Verify identity server-side and refresh session tokens via getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Redirect unauthenticated users away from protected routes to /login
  if (!user && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Redirect already-authenticated users away from login/register to their destination
  if (user && isAuthGuestOnlyPath(pathname)) {
    const nextParam = sanitizeRedirectPath(request.nextUrl.searchParams.get("next"), "/");
    const url = request.nextUrl.clone();
    url.pathname = nextParam;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
