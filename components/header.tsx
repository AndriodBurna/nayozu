"use client";

import SearchBar from "./search-bar";
import { ThemeSwitcher } from "./theme-switcher";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { UserCircle } from "lucide-react";

export default function Header() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null); // 'moderator' | 'admin' | null
  const [loading, setLoading] = useState(true);

  const handleSearchSubmit = (query: string) => {
    if (query.trim()) {
      // Update the search query parameter, preserving other parameters if needed
      const params = new URLSearchParams(searchParams.toString());
      params.set("search", query.trim());
      // We want to navigate to /anime with the updated search params
      router.push(`/anime?${params.toString()}`);
    } else {
      // If query is empty, we can remove the search param
      const params = new URLSearchParams(searchParams.toString());
      params.delete("search");
      router.push(`/anime?${params.toString()}`);
    }
  };

  // Fetch user data and role
  useEffect(() => {
    async function fetchUser() {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        // Fetch user role
        const { data: roleData, error: roleError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (!roleError && roleData) {
          setUserRole(roleData.role);
        } else {
          setUserRole(null);
        }
      } else {
        setUserRole(null);
      }

      setLoading(false);
    }

    fetchUser();
  }, []);

  if (loading) {
    return (
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4 md:px-8">
        <div className="flex items-center space-x-3">
          <h1 className="text-xl font-extrabold tracking-wide">
            NAYO<span className="text-[#7047F5]">ZU</span>
          </h1>
        </div>
        <div className="hidden md:flex items-center space-x-4">
          <SearchBar onSubmit={handleSearchSubmit} />
          <ThemeSwitcher />
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-gray-500">
            Loading...
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="flex items-center justify-between border-b border-white/10 px-6 py-4 md:px-8">
      <div className="flex items-center space-x-3">
        <h1 className="text-xl font-extrabold tracking-wide">
          NAYO<span className="text-[#7047F5]">ZU</span>
        </h1>
      </div>
      <div className="hidden md:flex items-center space-x-4">
        <SearchBar onSubmit={handleSearchSubmit} />
        <ThemeSwitcher />
      </div>
      <div className="flex items-center space-x-3">
        {!user ? (
          <>
            <a
              href="/auth/login"
              className="text-sm text-gray-300 hover:text-white mr-3"
            >
              Sign In
            </a>
            <a
              href="/auth/sign-up"
              className="text-sm text-gray-300 hover:text-white"
            >
              Register
            </a>
          </>
        ) : (
          <div className="relative">
            <button
              className="flex items-center space-x-2 text-sm text-gray-300 hover:text-white"
              onClick={(e) => {
                e.preventDefault();
                // Toggle a simple menu (we'll use a simple approach for now)
                const menu = document.getElementById("user-menu");
                if (menu) {
                  menu.classList.toggle("hidden");
                }
              }}
            >
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt="Avatar"
                  className="w-8 h-8 rounded-full"
                />
                ) : (
                <div className="w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center text-white">
                  {user.username?.charAt(0) ?? "?"}
                </div>
              )}
              <span className="hidden md:inline">
                {user.display_name || user.username}
              </span>
              <svg
                className="w-4 h-4 ml-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {/* Simple dropdown menu */}
            <div id="user-menu" className="absolute right-0 mt-2 w-56 bg-[#101827/80] rounded-lg shadow-lg z-20 hidden">
              <div className="py-2">
                <Link
                  href="/profile"
                  className="block px-4 py-2 text-sm text-gray-300 hover:bg-[#101827/60] hover:text-white"
                >
                  Profile
                </Link>
                <Link
                  href="/library"
                  className="block px-4 py-2 text-sm text-gray-300 hover:bg-[#101827/60] hover:text-white"
                >
                  Library
                </Link>
                {/* Moderation link - only for moderators and admins */}
                {userRole && (userRole === "moderator" || userRole === "admin") && (
                  <Link
                    href="/admin/moderation"
                    className="block px-4 py-2 text-sm text-gray-300 hover:bg-[#101827/60] hover:text-white"
                  >
                    Moderation
                  </Link>
                )}
                <button
                  onClick={async () => {
                    const supabase = createClient();
                    await supabase.auth.signOut();
                    router.push("/");
                  }}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-[#101827/60] hover:text-white"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}