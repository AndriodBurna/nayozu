"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  AtSign,
  CheckCircle2,
  Eye,
  EyeOff,
  Flame,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  registerUserAction,
  resendVerificationEmailAction,
} from "@/lib/actions/authActions";
import { useShell } from "@/components/shell-context";

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useShell();
  const nextPath = searchParams?.get("next") || "/";

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [resendFeedback, setResendFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isResending, setIsResending] = useState(false);

  const handleSignUp = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;

    setError(null);
    setResendFeedback(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    startTransition(async () => {
      const res = await registerUserAction({
        email,
        username,
        displayName: username,
        password,
        confirmPassword,
        next: nextPath,
      });

      if (!res.success) {
        setError(res.error || "Unable to create account.");
        return;
      }

      if (res.requiresEmailConfirmation) {
        setConfirmationRequired(true);
        setConfirmationMessage(
          res.message ||
            "Please check your email inbox and click the confirmation link to activate your account."
        );
        return;
      }

      await refreshUser();
      router.push(res.redirectTo || "/");
      router.refresh();
    });
  };

  const handleResend = async () => {
    if (isResending || !email.trim()) return;
    setIsResending(true);
    setError(null);
    setResendFeedback(null);

    try {
      const res = await resendVerificationEmailAction({ email });
      if (!res.success) {
        setError(res.error || "Failed to resend verification email.");
      } else {
        setResendFeedback(
          res.message || "Verification email resent! Please check your inbox."
        );
      }
    } finally {
      setIsResending(false);
    }
  };

  if (confirmationRequired) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <div className="relative overflow-hidden rounded-3xl border border-[#1e253d] bg-[#101422] p-6 sm:p-8 shadow-2xl text-center space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-white">
              Verify your email
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              {confirmationMessage}
            </p>
            <p className="text-xs text-zinc-500">
              Sent to <strong className="text-zinc-300">{email}</strong>
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5 text-left text-xs text-red-200"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {resendFeedback && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-left text-xs text-emerald-200"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>{resendFeedback}</span>
            </div>
          )}

          <div className="flex flex-col gap-2.5 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isResending}
              onClick={handleResend}
              className="h-10 w-full rounded-xl border-[#232a42] bg-[#151a2a] text-xs font-semibold text-zinc-200 hover:bg-[#1c2338]"
            >
              {isResending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Resend confirmation email
                </>
              )}
            </Button>

            <Button
              asChild
              className="h-10 w-full rounded-xl bg-primary text-xs font-bold text-primary-foreground"
            >
              <Link href="/login">Continue to Sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="relative overflow-hidden rounded-3xl border border-[#1e253d] bg-[#101422] p-6 sm:p-8 shadow-2xl">
        <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/15 blur-3xl" />

        {/* Header */}
        <div className="relative mb-6 flex flex-col items-center text-center">
          <Link href="/" className="mb-4 inline-flex items-center gap-2.5 group">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-transform group-hover:scale-105">
              <Flame className="h-5 w-5 fill-current" />
            </div>
            <span className="text-xl font-extrabold tracking-tight text-white">
              NAYOZU
            </span>
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            Create your account
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-zinc-400">
            Track your anime &amp; manga progress, build your library, and join the community
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-200"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <form onSubmit={handleSignUp} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="register-email" className="text-xs font-semibold text-zinc-300">
              Email address
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                id="register-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                disabled={isPending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 rounded-xl border-[#232a42] bg-[#151a2a] pl-10 text-sm text-white placeholder:text-zinc-500 focus-visible:ring-primary"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="register-username" className="text-xs font-semibold text-zinc-300">
              Username
            </Label>
            <div className="relative">
              <AtSign className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                id="register-username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="Choose a unique handle"
                required
                minLength={3}
                maxLength={30}
                disabled={isPending}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 rounded-xl border-[#232a42] bg-[#151a2a] pl-10 text-sm text-white placeholder:text-zinc-500 focus-visible:ring-primary"
              />
            </div>
            <p className="text-[11px] text-zinc-500">
              3–30 characters (letters, numbers, underscores, or hyphens).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="register-password" className="text-xs font-semibold text-zinc-300">
              Password
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                id="register-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                required
                minLength={8}
                maxLength={128}
                disabled={isPending}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-xl border-[#232a42] bg-[#151a2a] pl-10 pr-10 text-sm text-white placeholder:text-zinc-500 focus-visible:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="register-confirm-password" className="text-xs font-semibold text-zinc-300">
              Confirm Password
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                id="register-confirm-password"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter your password"
                required
                minLength={8}
                maxLength={128}
                disabled={isPending}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-11 rounded-xl border-[#232a42] bg-[#151a2a] pl-10 pr-10 text-sm text-white placeholder:text-zinc-500 focus-visible:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={isPending}
            className="mt-2 h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110 transition-all"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>

        <div className="mt-6 border-t border-white/5 pt-5 text-center text-xs text-zinc-400">
          Already have an account?{" "}
          <Link
            href={
              nextPath && nextPath !== "/"
                ? `/login?next=${encodeURIComponent(nextPath)}`
                : "/login"
            }
            className="font-semibold text-primary hover:underline"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
