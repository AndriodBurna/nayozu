import {
  Bookmark, BookMarked, BookOpen, BookText, CalendarDays, Clapperboard,
  Compass, Heart, History, Home, MonitorPlay, Settings, Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** false = page not built yet, so the link is hidden (no dead links). Flip to true when it exists. */
  ready: boolean;
  /** true = only shown to signed-in users */
  auth?: boolean;
}

export const NAV_MAIN: NavItem[] = [
  { label: "Home", href: "/", icon: Home, ready: true },
  { label: "Anime", href: "/anime", icon: Clapperboard, ready: true },
  { label: "Manga", href: "/manga", icon: BookOpen, ready: true },
  { label: "Manhwa", href: "/manhwa", icon: BookText, ready: false },
  { label: "Discover", href: "/discover", icon: Compass, ready: true },
  { label: "Community", href: "/community", icon: Users, ready: false },
  { label: "Watch Together", href: "/watch-together", icon: MonitorPlay, ready: false },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, ready: false },
];

// "My library" group: only appears for signed-in users
export const NAV_LIBRARY: NavItem[] = [
  { label: "Watchlist", href: "/watchlist", icon: Bookmark, ready: false, auth: true },
  { label: "Reading List", href: "/reading-list", icon: BookMarked, ready: false, auth: true },
  { label: "History", href: "/history", icon: History, ready: false, auth: true },
  { label: "Favorites", href: "/favorites", icon: Heart, ready: false, auth: true },
];

export const NAV_SETTINGS: NavItem = {
  label: "Settings", href: "/settings", icon: Settings, ready: false, auth: true,
};