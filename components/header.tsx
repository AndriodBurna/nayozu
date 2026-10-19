"use client";

import SearchBar from "./search-bar";
import { ThemeSwitcher } from "./theme-switcher";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ChevronDown, Shield, User as UserIcon } from "lucide-react";
import { AUTH_ENABLED } from "@/lib/features";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserProfile {
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
}

export default function Header() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null); // 'moderator' | 'admin' | null
  const [loading, setLoading] = useState(AUTH_ENABLED);

  const handleSearchSubmit = (query: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (query.trim()) {
      params.set("search", query.trim());
    } else {
      params.delete("search");
    }
    router.push(`/anime?${params.toString()}`);
  };

  useEffect(() => {
    if (!AUTH_ENABLED) {
      setLoading(false);
      return;
    }

    async function fetchUser() {
      setLoading(true);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setUser(user);

        if (user) {
          // Fetch profile details
          const { data: profileData } = await supabase
            .from("profiles")
            .select("username, display_name, avatar_url")
            .eq("id", user.id)
            .maybeSingle();

          if (profileData) {
            setProfile(profileData);
          }

          // Fetch user role
          const { data: roleData } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .maybeSingle();

          if (roleData) {
            setUserRole(roleData.role);
          } else {
            setUserRole(null);
          }
        } else {
          setProfile(null);
          setUserRole(null);
        }
      } catch (err) {
        console.error("Error fetching header auth info:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setUserRole(null);
    router.push("/");
    router.refresh();
  };

  const displayName =
    profile?.display_name ||
    profile?.username ||
    user?.email?.split("@")[0] ||
    "Account";

  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header className="flex items-center justify-between border-b border-border bg-background/95 backdrop-blur px-6 py-4 md:px-8">
      <div className="flex items-center space-x-3">
        <Link href="/" className="text-xl font-extrabold tracking-wide hover:opacity-90">
          NAYO<span className="text-primary">ZU</span>
        </Link>
      </div>

      <div className="hidden md:flex items-center space-x-4">
        <SearchBar onSubmit={handleSearchSubmit} />
        <ThemeSwitcher />
      </div>

      <div className="flex items-center space-x-3">
        {!AUTH_ENABLED ? null : loading ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary animate-pulse text-xs">
            ...
          </div>
        ) : !user ? (
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/auth/login">Sign In</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth/sign-up">Register</Link>
            </Button>
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center space-x-2 text-sm text-muted-foreground hover:text-foreground focus:outline-none"
              >
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={displayName}
                    className="w-8 h-8 rounded-full object-cover border"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary/20 text-primary font-semibold flex items-center justify-center text-xs">
                    {initial}
                  </div>
                )}
                <span className="hidden md:inline font-medium text-foreground">
                  {displayName}
                </span>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Signed in as <span className="font-semibold text-foreground">{displayName}</span>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile" className="cursor-pointer flex items-center gap-2">
                  <UserIcon className="w-4 h-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/library" className="cursor-pointer flex items-center gap-2">
                  Library
                </Link>
              </DropdownMenuItem>
              {userRole && (userRole === "moderator" || userRole === "admin") && (
                <DropdownMenuItem asChild>
                  <Link href="/admin/moderation" className="cursor-pointer flex items-center gap-2 text-primary">
                    <Shield className="w-4 h-4" />
                    Moderation
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}