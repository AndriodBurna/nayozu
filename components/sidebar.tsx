import Link from "next/link";
import { Home, Film, Heart, Compass } from "lucide-react";

export default function Sidebar() {
  return (
    <aside className="hidden md:block w-60 border-r border-border p-4">
      <nav className="space-y-1">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-colors"
        >
          <Home className="h-4 w-4" />
          Home
        </Link>
        <Link
          href="/anime"
          className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-colors"
        >
          <Film className="h-4 w-4" />
          Anime
        </Link>
        <Link
          href="/library"
          className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-colors"
        >
          <Heart className="h-4 w-4" />
          Library
        </Link>
        <Link
          href="/anime?sort=popularity"
          className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-colors"
        >
          <Compass className="h-4 w-4" />
          Discover
        </Link>
      </nav>
    </aside>
  );
}