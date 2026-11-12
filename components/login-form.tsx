"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
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
  loginUserAction,
  resendVerificationEmailAction,
} from "@/lib/actions/authActions";
import { useShell } from "@/components/shell-context";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useShell();
  const nextPath = searchParams?.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isUnverified, setIsUnverified] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isResending, setIsResending] = useState(false);

  const handleLogin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;

    setError(null);
    setSuccessMsg(null);
    setIsUnverified(false);

    startTransition(async () => {
      const res = await loginUserAction({
        email,
        password,
        next: nextPath,
      });

      if (!res.success) {
        setError(res.error || "Sign-in failed. Please check your credentials.");
        setIsUnverified(Boolean(res.unverifiedEmail));
        return;
      }

      setSuccessMsg(res.message || "Signed in! Redirecting...");
      await refreshUser();
      router.push(res.redirectTo || "/");
      router.refresh();
    });
  };

  const handleResendConfirmation = async () => {
    if (isResending || !email.trim()) return;
    setIsResending(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await resendVerificationEmailAction({ email });
      if (!res.success) {
        setError(res.error || "Could not resend confirmation email.");
      } else {
        setSuccessMsg(
          res.message || "Confirmation email sent! Please check your inbox."
        );
        setIsUnverified(false);
      }
    } finally {
      setIsResending(false);
    }
  };

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
            Welcome back
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-zinc-400">
            Sign in to access your Watchlist, Reading List, and community profile
          </p>
        </div>

        {/* Status Banners */}
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-200 space-y-2.5"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
            {isUnverified && (
              <div className="pl-6">
                <button
                  type="button"
                  disabled={isResending}
                  onClick={handleResendConfirmation}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {isResending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Resend verification email
                </button>
              </div>
            )}
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="mb-5 flex items-start gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
            <span className="leading-relaxed">{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="login-email" className="text-xs font-semibold text-zinc-300">
              Email address
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                id="login-email"
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password" className="text-xs font-semibold text-zinc-300">
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
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

          <Button
            type="submit"
            disabled={isPending}
            className="h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110 transition-all"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <div className="mt-6 border-t border-white/5 pt-5 text-center text-xs text-zinc-400">
          Don&apos;t have a Nayozu account?{" "}
          <Link
            href={
              nextPath && nextPath !== "/"
                ? `/register?next=${encodeURIComponent(nextPath)}`
                : "/register"
            }
            className="font-semibold text-primary hover:underline"
          >
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}
