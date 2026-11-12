import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRedirectPath } from "@/lib/supabase/proxy";

const VALID_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function buildRedirect(request: NextRequest, pathname: string, searchParams?: Record<string, string>) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const rawNext = searchParams.get("next");
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // If the auth provider returned an explicit OAuth/OTP error parameter
  if (errorParam || errorDescription) {
    const safeReason =
      errorDescription?.toLowerCase().includes("expired")
        ? "This verification or recovery link has expired. Please request a new one."
        : "Authentication verification failed or the link is no longer valid.";
    return buildRedirect(request, "/auth/error", { error: safeReason });
  }

  const defaultDestination = rawType === "recovery" ? "/reset-password" : "/";
  const safeNext = sanitizeRedirectPath(rawNext, defaultDestination);

  const supabase = await createClient();

  // 1. PKCE Code Exchange Flow (?code=...)
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      const isExpired = error?.message?.toLowerCase().includes("expired");
      return buildRedirect(request, "/auth/error", {
        error: isExpired
          ? "Your verification or recovery link has expired. Please request a new link."
          : "Invalid or already-used authentication code. Please sign in or request a new link.",
      });
    }

    // Ensure profile row exists for newly verified user
    const fallbackUsername =
      (data.user.user_metadata?.username as string | undefined) ||
      data.user.email?.split("@")[0]?.replace(/[^a-zA-Z0-9_-]/g, "_") ||
      `user_${data.user.id.slice(0, 8)}`;

    await supabase.from("profiles").upsert(
      {
        id: data.user.id,
        username: fallbackUsername,
        display_name:
          (data.user.user_metadata?.display_name as string | undefined) ||
          fallbackUsername,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );

    return buildRedirect(request, safeNext);
  }

  // 2. Token Hash OTP Verification Flow (?token_hash=...&type=...)
  if (token_hash && rawType && VALID_OTP_TYPES.includes(rawType as EmailOtpType)) {
    const type = rawType as EmailOtpType;
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (error || !data.user) {
      const isExpired = error?.message?.toLowerCase().includes("expired");
      return buildRedirect(request, "/auth/error", {
        error: isExpired
          ? "Your email verification or password reset link has expired. Please request a new one."
          : "This verification link is invalid or has already been used.",
      });
    }

    const fallbackUsername =
      (data.user.user_metadata?.username as string | undefined) ||
      data.user.email?.split("@")[0]?.replace(/[^a-zA-Z0-9_-]/g, "_") ||
      `user_${data.user.id.slice(0, 8)}`;

    await supabase.from("profiles").upsert(
      {
        id: data.user.id,
        username: fallbackUsername,
        display_name:
          (data.user.user_metadata?.display_name as string | undefined) ||
          fallbackUsername,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );

    return buildRedirect(request, safeNext);
  }

  return buildRedirect(request, "/auth/error", {
    error: "Missing or invalid authentication callback parameters.",
  });
}
