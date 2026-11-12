import { Suspense } from "react";
import Link from "next/link";
import { AlertCircle, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const message =
    params?.error ||
    "The authentication link is invalid, expired, or has already been used.";

  return (
    <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
      {message}
    </p>
  );
}

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <div className="flex min-h-[calc(100vh-10rem)] w-full items-center justify-center py-8 px-4">
      <div className="w-full max-w-md">
        <div className="relative overflow-hidden rounded-3xl border border-[#1e253d] bg-[#101422] p-6 sm:p-8 shadow-2xl text-center space-y-5">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
              <Flame className="h-5 w-5 fill-current" />
            </div>
            <span className="text-xl font-extrabold tracking-tight text-white">
              NAYOZU
            </span>
          </Link>

          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/15 text-red-400">
            <AlertCircle className="h-7 w-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-white">
              Authentication Error
            </h1>
            <Suspense
              fallback={
                <p className="text-xs text-zinc-400">
                  Verifying authentication state...
                </p>
              }
            >
              <ErrorContent searchParams={searchParams} />
            </Suspense>
          </div>

          <div className="flex flex-col gap-2.5 pt-2">
            <Button
              asChild
              className="h-11 w-full rounded-xl bg-primary text-xs font-bold text-primary-foreground"
            >
              <Link href="/login">Go to Sign in</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-10 w-full rounded-xl border-[#232a42] bg-[#151a2a] text-xs font-semibold text-zinc-300"
            >
              <Link href="/forgot-password">Request Password Reset</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
