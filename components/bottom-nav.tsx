"use client";

import Link from "next/link";
import { Home, Film, BookOpen, Heart, Compass } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AUTH_ENABLED } from "@/lib/features";

export default function BottomNav() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(AUTH_ENABLED);

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
      } catch (err) {
        console.error("Error fetching bottom nav user:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, []);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-sm px-3 py-2 flex justify-around items-center z-50">
      <Link href="/" className="flex flex-col items-center text-xs font-medium text-muted-foreground hover:text-foreground">
        <Home className="mb-1 h-4 w-4" />
        <span>Home</span>
      </Link>
      <Link href="/anime" className="flex flex-col items-center text-xs font-medium text-muted-foreground hover:text-foreground">
        <Film className="mb-1 h-4 w-4" />
        <span>Anime</span>
      </Link>
      <Link href="/manga" className="flex flex-col items-center text-xs font-medium text-muted-foreground hover:text-foreground">
        <BookOpen className="mb-1 h-4 w-4" />
        <span>Manga</span>
      </Link>
      {AUTH_ENABLED && user && (
        <Link href="/library" className="flex flex-col items-center text-xs font-medium text-muted-foreground hover:text-foreground">
          <Heart className="mb-1 h-4 w-4" />
          <span>Library</span>
        </Link>
      )}
      <Link href="/discover" className="flex flex-col items-center text-xs font-medium text-muted-foreground hover:text-foreground">
        <Compass className="mb-1 h-4 w-4" />
        <span>Discover</span>
      </Link>
    </nav>
  );
}
