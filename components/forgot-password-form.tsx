"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Flame,
  Loader2,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "@/lib/actions/authActions";

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleForgotPassword = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;

    setError(null);
    setSuccessMessage(null);

    startTransition(async () => {
      const res = await requestPasswordResetAction({ email });
      if (!res.success) {
        setError(res.error || "Unable to send password reset email.");
        return;
      }

      setSuccessMessage(
        res.message ||
          "If an account exists for that email, we have sent password reset instructions."
      );
    });
  };

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
            Reset your password
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-zinc-400">
            Enter your account email and we&apos;ll send you a secure recovery link
          </p>
        </div>

        {successMessage ? (
          <div className="space-y-5 text-center">
            <div
              role="status"
              className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-xs sm:text-sm text-emerald-200"
            >
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              <div className="space-y-1">
                <p className="font-bold text-white">Check your email</p>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {successMessage}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSuccessMessage(null)}
                className="h-10 w-full rounded-xl border-[#232a42] bg-[#151a2a] text-xs font-semibold text-zinc-200 hover:bg-[#1c2338]"
              >
                Send to a different email
              </Button>
              <Button
                asChild
                className="h-10 w-full rounded-xl bg-primary text-xs font-bold text-primary-foreground"
              >
                <Link href="/login">Return to Sign in</Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-200"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            <form onSubmit={handleForgotPassword} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="forgot-email" className="text-xs font-semibold text-zinc-300">
                  Email address
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    id="forgot-email"
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

              <Button
                type="submit"
                disabled={isPending}
                className="h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110 transition-all"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending recovery link...
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>

            <div className="mt-6 border-t border-white/5 pt-5 text-center text-xs text-zinc-400">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 font-semibold text-zinc-300 hover:text-primary transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
