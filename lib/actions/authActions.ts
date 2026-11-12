"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRedirectPath } from "@/lib/supabase/proxy";

export interface AuthActionResult {
  success: boolean;
  error?: string;
  message?: string;
  requiresEmailConfirmation?: boolean;
  unverifiedEmail?: boolean;
  redirectTo?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;

function mapSafeAuthError(rawMessage: string | undefined, fallback: string): string {
  if (!rawMessage) return fallback;
  const lower = rawMessage.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Invalid email or password. Please check your credentials and try again.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email address before signing in. Check your inbox for the verification link.";
  }
  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "An account with this email already exists. Try signing in or resetting your password.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("over_email_send_rate_limit") || lower.includes("for security purposes")) {
    return "Too many requests in a short period. Please wait a minute before trying again.";
  }
  if (lower.includes("same_password") || lower.includes("different from the old password")) {
    return "Your new password must be different from your current password.";
  }
  if (lower.includes("weak_password") || lower.includes("password should be")) {
    return "Password does not meet security requirements. Please use at least 8 characters.";
  }
  if (lower.includes("session_not_found") || lower.includes("auth session missing")) {
    return "Your password recovery session has expired or is invalid. Please request a new reset link.";
  }
  return fallback;
}

async function getAppOrigin(): Promise<string> {
  try {
    const hdrs = await headers();
    const origin = hdrs.get("origin");
    if (origin && /^https?:\/\//.test(origin)) {
      return origin.replace(/\/$/, "");
    }
    const host = hdrs.get("x-forwarded-host") || hdrs.get("host");
    const proto = hdrs.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
    if (host) {
      return `${proto}://${host}`;
    }
  } catch {
    // Fallback
  }
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

/**
 * Server-validated user registration with email, password, confirmPassword, and username.
 */
export async function registerUserAction(input: {
  email: string;
  username: string;
  displayName?: string;
  password: string;
  confirmPassword: string;
  next?: string | null;
}): Promise<AuthActionResult> {
  const cleanEmail = (input.email ?? "").trim().toLowerCase();
  const cleanUsername = (input.username ?? "").trim();
  const cleanDisplayName = (input.displayName ?? "").trim() || cleanUsername;
  const password = input.password ?? "";
  const confirmPassword = input.confirmPassword ?? "";

  if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail) || cleanEmail.length > 254) {
    return {
      success: false,
      error: "Please enter a valid email address.",
    };
  }

  if (!USERNAME_REGEX.test(cleanUsername)) {
    return {
      success: false,
      error:
        "Username must be 3–30 characters and contain only letters, numbers, underscores (_), or hyphens (-).",
    };
  }

  if (cleanDisplayName.length < 1 || cleanDisplayName.length > 60) {
    return {
      success: false,
      error: "Display name must be between 1 and 60 characters.",
    };
  }

  if (password.length < 8) {
    return {
      success: false,
      error: "Password must be at least 8 characters long.",
    };
  }

  if (password.length > 128) {
    return {
      success: false,
      error: "Password cannot exceed 128 characters.",
    };
  }

  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return {
      success: false,
      error: "Password must contain at least one letter and one number.",
    };
  }

  if (password !== confirmPassword) {
    return {
      success: false,
      error: "Passwords do not match.",
    };
  }

  const supabase = await createClient();

  // Check if username is already taken in public.profiles (escaping _ so ILIKE treats it literally)
  const escapedUsername = cleanUsername.replace(/[%_\\]/g, "\\$&");
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", escapedUsername)
    .maybeSingle();

  if (existingProfile) {
    return {
      success: false,
      error: `The username @${cleanUsername} is already taken. Please choose another.`,
    };
  }

  const origin = await getAppOrigin();
  const safeNext = sanitizeRedirectPath(input.next, "/");
  const callbackUrl = new URL("/auth/callback", origin);
  if (safeNext !== "/") {
    callbackUrl.searchParams.set("next", safeNext);
  }

  const { data, error: signUpError } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      data: {
        username: cleanUsername,
        display_name: cleanDisplayName,
      },
    },
  });

  if (signUpError) {
    return {
      success: false,
      error: mapSafeAuthError(
        signUpError.message,
        "Unable to complete registration. Please check your details and try again."
      ),
    };
  }

  // Supabase obfuscates duplicate signups when email confirmation is enabled by returning user.identities = []
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return {
      success: false,
      error: "An account with this email already exists. Try signing in or resetting your password.",
    };
  }

  // If a session was immediately established (e.g. auto-confirm enabled in dev/test), ensure profile row is synced
  if (data.session && data.user) {
    const now = new Date().toISOString();
    await supabase.from("profiles").upsert(
      {
        id: data.user.id,
        username: cleanUsername,
        display_name: cleanDisplayName,
        updated_at: now,
      },
      { onConflict: "id" }
    );

    revalidatePath("/", "layout");
    return {
      success: true,
      requiresEmailConfirmation: false,
      redirectTo: safeNext,
      message: "Account created! Redirecting...",
    };
  }

  return {
    success: true,
    requiresEmailConfirmation: true,
    message:
      "Your account has been created! Please check your email inbox and click the confirmation link to activate your account.",
  };
}

/**
 * Server-validated email and password sign-in.
 */
export async function loginUserAction(input: {
  email: string;
  password: string;
  next?: string | null;
}): Promise<AuthActionResult> {
  const cleanEmail = (input.email ?? "").trim().toLowerCase();
  const password = input.password ?? "";

  if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
    return {
      success: false,
      error: "Please enter a valid email address.",
    };
  }

  if (!password) {
    return {
      success: false,
      error: "Please enter your password.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (error) {
    const isUnverified = error.message?.toLowerCase().includes("email not confirmed");
    return {
      success: false,
      unverifiedEmail: isUnverified,
      error: mapSafeAuthError(
        error.message,
        "Sign-in failed. Please verify your email and password."
      ),
    };
  }

  if (!data.user) {
    return {
      success: false,
      error: "Sign-in failed. Please try again.",
    };
  }

  // Ensure profile row exists for this user (defensive self-healing alongside database trigger)
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

  const safeNext = sanitizeRedirectPath(input.next, "/");
  revalidatePath("/", "layout");

  return {
    success: true,
    redirectTo: safeNext,
    message: "Signed in! Redirecting...",
  };
}

/**
 * Resend signup verification email for an unverified account.
 */
export async function resendVerificationEmailAction(input: {
  email: string;
}): Promise<AuthActionResult> {
  const cleanEmail = (input.email ?? "").trim().toLowerCase();
  if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
    return {
      success: false,
      error: "Please enter a valid email address.",
    };
  }

  const supabase = await createClient();
  const origin = await getAppOrigin();
  const callbackUrl = new URL("/auth/callback", origin);

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: cleanEmail,
    options: {
      emailRedirectTo: callbackUrl.toString(),
    },
  });

  if (error) {
    return {
      success: false,
      error: mapSafeAuthError(
        error.message,
        "Could not resend verification email. Please wait a moment and try again."
      ),
    };
  }

  return {
    success: true,
    message: "Verification email sent! Please check your inbox and spam folder.",
  };
}

/**
 * Request a password reset email with a secure callback destination.
 */
export async function requestPasswordResetAction(input: {
  email: string;
}): Promise<AuthActionResult> {
  const cleanEmail = (input.email ?? "").trim().toLowerCase();
  if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
    return {
      success: false,
      error: "Please enter a valid email address.",
    };
  }

  const supabase = await createClient();
  const origin = await getAppOrigin();

  // Route recovery callback through /auth/callback?next=/reset-password
  const callbackUrl = new URL("/auth/callback", origin);
  callbackUrl.searchParams.set("next", "/reset-password");

  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo: callbackUrl.toString(),
  });

  if (error) {
    return {
      success: false,
      error: mapSafeAuthError(
        error.message,
        "Unable to send password reset instructions right now. Please try again shortly."
      ),
    };
  }

  return {
    success: true,
    message:
      "If an account exists for that email address, we have sent a password recovery link. Please check your inbox.",
  };
}

/**
 * Reset password using an active recovery session.
 */
export async function resetPasswordWithRecoveryAction(input: {
  password: string;
  confirmPassword: string;
}): Promise<AuthActionResult> {
  const password = input.password ?? "";
  const confirmPassword = input.confirmPassword ?? "";

  if (password.length < 8) {
    return {
      success: false,
      error: "New password must be at least 8 characters long.",
    };
  }

  if (password.length > 128) {
    return {
      success: false,
      error: "New password cannot exceed 128 characters.",
    };
  }

  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return {
      success: false,
      error: "New password must contain at least one letter and one number.",
    };
  }

  if (password !== confirmPassword) {
    return {
      success: false,
      error: "New password and confirmation password do not match.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error:
        "Your password recovery link has expired or has already been used. Please request a new password reset email.",
    };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password,
  });

  if (updateError) {
    return {
      success: false,
      error: mapSafeAuthError(
        updateError.message,
        "Could not update your password. Please try again or request a new recovery link."
      ),
    };
  }

  revalidatePath("/", "layout");
  return {
    success: true,
    redirectTo: "/profile",
    message: "Your password has been updated.",
  };
}

/**
 * Real server-side Supabase sign-out action.
 */
export async function signOutUserAction(scope: "local" | "global" = "local"): Promise<AuthActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope });

  if (error) {
    return {
      success: false,
      error: mapSafeAuthError(error.message, "Failed to sign out."),
    };
  }

  revalidatePath("/", "layout");
  return {
    success: true,
    redirectTo: "/",
  };
}
