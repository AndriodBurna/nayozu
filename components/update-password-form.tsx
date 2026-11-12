"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Flame,
  KeyRound,
  Loader2,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordWithRecoveryAction } from "@/lib/actions/authActions";
import { useShell } from "@/components/shell-context";

interface UpdatePasswordFormProps extends React.ComponentPropsWithoutRef<"div"> {
  hasSession?: boolean;
  initialError?: string | null;
}

export function UpdatePasswordForm({
  className,
  hasSession = true,
  initialError = null,
  ...props
}: UpdatePasswordFormProps) {
  const router = useRouter();
  const { refreshUser } = useShell();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleUpdatePassword = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;

    setError(null);
    setSuccessMsg(null);

    if (password !== confirmPassword) {
      setError("New password and confirmation password do not match.");
      return;
    }

    startTransition(async () => {
      const res = await resetPasswordWithRecoveryAction({
        password,
        confirmPassword,
      });

      if (!res.success) {
        setError(
          res.error ||
            "Could not update password. Your recovery link may have expired."
        );
        return;
      }

      setSuccessMsg(res.message || "Your password has been updated!");
      await refreshUser();
      router.push(res.redirectTo || "/profile");
      router.refresh();
    });
  };

  if (!hasSession) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <div className="relative overflow-hidden rounded-3xl border border-[#1e253d] bg-[#101422] p-6 sm:p-8 shadow-2xl text-center space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/15 text-amber-400">
            <KeyRound className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-white">
              Recovery Link Expired or Invalid
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              This password reset session is missing, expired, or has already been
              used. Please request a fresh password reset email to continue.
            </p>
          </div>
          <div className="flex flex-col gap-2.5 pt-1">
            <Button
              asChild
              className="h-11 w-full rounded-xl bg-primary text-xs font-bold text-primary-foreground"
            >
              <Link href="/forgot-password">Request New Reset Link</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-10 w-full rounded-xl border-[#232a42] bg-[#151a2a] text-xs font-semibold text-zinc-300"
            >
              <Link href="/login">Back to Sign in</Link>
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
            Set a new password
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-zinc-400">
            Choose a strong password of at least 8 characters for your Nayozu account
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

        {successMsg && (
          <div
            role="status"
            className="mb-5 flex items-start gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
            <span className="leading-relaxed">{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleUpdatePassword} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password" className="text-xs font-semibold text-zinc-300">
              New password
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                id="reset-password"
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
            <Label htmlFor="reset-confirm-password" className="text-xs font-semibold text-zinc-300">
              Confirm new password
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                id="reset-confirm-password"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter your new password"
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
                Updating password...
              </>
            ) : (
              "Save new password"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
