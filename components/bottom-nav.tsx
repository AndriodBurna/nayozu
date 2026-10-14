"use client";

import Link from "next/link";
import { Home, Film, Heart, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function BottomNav() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUser() {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    }

    fetchUser();
  }, []);

  if (loading) {
    return (
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-white/10 bg-background/80 backdrop-blur-sm px-3 py-2 flex justify-around items-center z-50">
        <div className="flex flex-col items-center text-sm font-medium text-gray-300">
          <Home className="mb-1 h-4 w-4" />
          <span>Loading</span>
        </div>
      </nav>
    );
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-white/10 bg-background/80 backdrop-blur-sm px-3 py-2 flex justify-around items-center z-50">
      <Link href="/" className="flex flex-col items-center text-sm font-medium text-gray-300 hover:text-white">
        <Home className="mb-1 h-4 w-4" />
        <span>Home</span>
      </Link>
      <Link href="/anime" className="flex flex-col items-center text-sm font-medium text-gray-300 hover:text-white">
        <Film className="mb-1 h-4 w-4" />
        <span>Anime</span>
      </Link>
      {user ? (
        <Link href="/library" className="flex flex-col items-center text-sm font-medium text-gray-300 hover:text-white">
          <Heart className="mb-1 h-4 w-4" />
          <span>Library</span>
        </Link>
      ) : null}
      <Link href="/" className="flex flex-col items-center text-sm font-medium text-gray-300 hover:text-white">
        <MessageSquare className="mb-1 h-4 w-4" />
        <span>Discover</span>
      </Link>
    </nav>
  );
}
