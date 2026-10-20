"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PanelRight, Search } from "lucide-react";
import SearchBar from "@/components/search-bar";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/shell-context";
import { AUTH_ENABLED } from "@/lib/features";

export default function Header() {
  const router = useRouter();
  const { user, rightOpen, toggleRight } = useShell();
  const initial = (user?.email ?? "?").charAt(0).toUpperCase();

  const handleSearch = (query: string) => {
    const q = query.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:px-6">
      <Link href="/" className="text-xl font-extrabold tracking-tight">
        NAYO<span className="text-primary">ZU</span>
      </Link>

      <div className="flex flex-1 justify-center">
        <SearchBar onSubmit={handleSearch} className="hidden w-full max-w-xl md:flex lg:w-full" />
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <Button asChild variant="ghost" size="icon" className="md:hidden">
          <Link href="/search" aria-label="Search">
            <Search />
          </Link>
        </Button>
        <ThemeSwitcher />
        {AUTH_ENABLED && !user && (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/auth/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth/sign-up">Create account</Link>
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleRight}
          aria-label={rightOpen ? "Hide side panel" : "Show side panel"}
          aria-expanded={rightOpen}
        >
          {user ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {initial}
            </span>
          ) : (
            <PanelRight />
          )}
        </Button>
      </div>
    </header>
  );
}