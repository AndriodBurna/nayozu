import {
  Bookmark,
  BookOpen,
  Calendar,
  Clapperboard,
  Clock,
  Film,
  Glasses,
  Heart,
  History,
  Home,
  Settings,
  Tv,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** false = page not built yet, so the link is hidden in filtered contexts. Flip to true when it exists. */
  ready: boolean;
  /** true = only shown to signed-in users */
  auth?: boolean;
}

export const NAV_MAIN: NavItem[] = [
  { label: "Home", href: "/", icon: Home, ready: true },
  { label: "Anime", href: "/anime", icon: Film, ready: true },
  { label: "Manga", href: "/manga", icon: BookOpen, ready: true },
  { label: "Movies", href: "/movies", icon: Clapperboard, ready: true },
  { label: "Coming Soon", href: "/coming-soon", icon: Clock, ready: true },
  { label: "Community", href: "/community", icon: Users, ready: true },
  { label: "Watch Together", href: "/watch-together", icon: Tv, ready: true },
  { label: "Calendar", href: "/calendar", icon: Calendar, ready: true },
];

/**
 * Deterministic 5-item subset of NAV_MAIN for the mobile bottom navigation bar.
 * Defined statically at module scope so SSR and client hydration always render
 * the exact same items, hrefs, labels, and icons in the same order.
 */
export const NAV_BOTTOM: readonly NavItem[] = NAV_MAIN.slice(0, 5);

// "My library" group
export const NAV_LIBRARY: NavItem[] = [
  { label: "Watchlist", href: "/watchlist", icon: Bookmark, ready: true, auth: true },
  { label: "Reading List", href: "/reading-list", icon: Glasses, ready: true, auth: true },
  { label: "History", href: "/history", icon: History, ready: true, auth: true },
  { label: "Favorites", href: "/favorites", icon: Heart, ready: true, auth: true },
];

export const NAV_SETTINGS: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
  ready: true,
  auth: true,
};
