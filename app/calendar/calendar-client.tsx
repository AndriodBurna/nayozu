"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Globe,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Tv,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchCalendarWeekAction,
  type CalendarScheduleItem,
  type CalendarWeekResult,
} from "./actions";

interface CalendarClientProps {
  initialWeekStartIso: string; // YYYY-MM-DD (Monday of initial week)
  initialSelectedDateIso: string; // YYYY-MM-DD (Today)
  initialData: CalendarWeekResult;
}

/** Format a Date or UNIX timestamp into YYYY-MM-DD in a target IANA timezone. */
function toDateKeyInTz(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value ?? "2026";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Parse YYYY-MM-DD into a UTC noon Date object to step days safely without DST drift. */
function parseIsoDateNoonUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1, 12, 0, 0));
}

function addDaysIso(iso: string, days: number): string {
  const dt = parseIsoDateNoonUtc(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Get the Monday YYYY-MM-DD for the week containing `isoDate`. */
function getMondayOfIsoWeek(isoDate: string): string {
  const dt = parseIsoDateNoonUtc(isoDate);
  const day = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const diffToMon = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diffToMon);
  return dt.toISOString().slice(0, 10);
}

function formatDayHeader(isoDate: string): {
  weekdayShort: string;
  weekdayLong: string;
  monthDay: string;
  fullLabel: string;
} {
  const dt = parseIsoDateNoonUtc(isoDate);
  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(dt);
  const weekdayLong = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
  }).format(dt);
  const monthDay = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(dt);
  const fullLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dt);
  return { weekdayShort, weekdayLong, monthDay, fullLabel };
}

function formatReleaseTime(airingAtSeconds: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(airingAtSeconds * 1000));
  } catch {
    return new Date(airingAtSeconds * 1000).toISOString().slice(11, 16) + " UTC";
  }
}

function formatReleaseDateShort(airingAtSeconds: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(airingAtSeconds * 1000));
  } catch {
    return new Date(airingAtSeconds * 1000).toISOString().slice(0, 10);
  }
}

function formatRelativeAiring(airingAtSeconds: number, nowSeconds: number): {
  aired: boolean;
  label: string;
} {
  const diff = airingAtSeconds - nowSeconds;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const mins = Math.floor((abs % 3600) / 60);

  if (diff <= 0) {
    if (days > 0) return { aired: true, label: `Aired ${days}d ${hours}h ago` };
    if (hours > 0) return { aired: true, label: `Aired ${hours}h ${mins}m ago` };
    return { aired: true, label: `Aired ${Math.max(mins, 1)}m ago` };
  }

  if (days > 0) return { aired: false, label: `Airs in ${days}d ${hours}h` };
  if (hours > 0) return { aired: false, label: `Airs in ${hours}h ${mins}m` };
  return { aired: false, label: `Airs in ${Math.max(mins, 1)}m` };
}

export default function CalendarClient({
  initialWeekStartIso,
  initialSelectedDateIso,
  initialData,
}: CalendarClientProps) {
  // View & Date State
  const [viewMode, setViewMode] = useState<"weekly" | "daily">("weekly");
  const [weekStartIso, setWeekStartIso] = useState(initialWeekStartIso);
  const [selectedDateIso, setSelectedDateIso] = useState(initialSelectedDateIso);
  const [todayIso, setTodayIso] = useState(initialSelectedDateIso);

  // Timezone State (detect user's local IANA timezone on mount, allow switching to JST or UTC)
  const [detectedTz, setDetectedTz] = useState<string>("UTC");
  const [tzMode, setTzMode] = useState<"local" | "Asia/Tokyo" | "UTC">("local");
  const [nowSeconds, setNowSeconds] = useState<number>(() =>
    Math.floor(Date.now() / 1000)
  );

  useEffect(() => {
    try {
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (localTz) {
        setDetectedTz(localTz);
        setTodayIso(toDateKeyInTz(new Date(), localTz));
      }
    } catch {}

    const timer = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const activeTimeZone =
    tzMode === "local" ? detectedTz : tzMode === "Asia/Tokyo" ? "Asia/Tokyo" : "UTC";

  // Schedule Data State
  const [scheduleData, setScheduleData] = useState<CalendarWeekResult>(initialData);
  const [isPending, startTransition] = useTransition();

  // Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [airingFilter, setAiringFilter] = useState<"all" | "upcoming" | "aired">(
    "all"
  );
  const [catalogOnly, setCatalogOnly] = useState(false);

  // 7 days of the active week (Monday -> Sunday)
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, idx) => {
      const iso = addDaysIso(weekStartIso, idx);
      return {
        iso,
        ...formatDayHeader(iso),
      };
    });
  }, [weekStartIso]);

  // Load week from server when weekStartIso changes
  const loadWeek = (targetMondayIso: string) => {
    const startDt = parseIsoDateNoonUtc(targetMondayIso);
    startDt.setUTCHours(0, 0, 0, 0);
    const startUnix = Math.floor(startDt.getTime() / 1000);
    const endUnix = startUnix + 7 * 86400;

    startTransition(async () => {
      const res = await fetchCalendarWeekAction({ startUnix, endUnix });
      setScheduleData(res);
    });
  };

  const handleSelectDate = (targetIso: string) => {
    setSelectedDateIso(targetIso);
    const targetMonday = getMondayOfIsoWeek(targetIso);
    if (targetMonday !== weekStartIso) {
      setWeekStartIso(targetMonday);
      loadWeek(targetMonday);
    }
  };

  const handleStepDate = (deltaDays: number) => {
    if (viewMode === "weekly") {
      const nextMonday = addDaysIso(weekStartIso, deltaDays);
      const nextSelected = addDaysIso(selectedDateIso, deltaDays);
      setWeekStartIso(nextMonday);
      setSelectedDateIso(nextSelected);
      loadWeek(nextMonday);
    } else {
      const nextSelected = addDaysIso(selectedDateIso, deltaDays);
      handleSelectDate(nextSelected);
    }
  };

  const handleJumpToday = () => {
    const currentToday = toDateKeyInTz(new Date(), activeTimeZone);
    setTodayIso(currentToday);
    handleSelectDate(currentToday);
  };

  // Filter and group schedule items by day in `activeTimeZone`
  const filteredItems = useMemo(() => {
    return scheduleData.items.filter((item) => {
      if (catalogOnly && !item.inCatalog) return false;
      if (airingFilter === "upcoming" && item.airingAt <= nowSeconds) return false;
      if (airingFilter === "aired" && item.airingAt > nowSeconds) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchTitle =
          item.title.toLowerCase().includes(q) ||
          item.titleRomaji.toLowerCase().includes(q);
        const matchGenre = item.genres.some((g) => g.toLowerCase().includes(q));
        if (!matchTitle && !matchGenre) return false;
      }
      return true;
    });
  }, [scheduleData.items, catalogOnly, airingFilter, nowSeconds, searchQuery]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarScheduleItem[]>();
    for (const day of weekDays) {
      map.set(day.iso, []);
    }
    for (const item of filteredItems) {
      const dayKey = toDateKeyInTz(new Date(item.airingAt * 1000), activeTimeZone);
      const bucket = map.get(dayKey);
      if (bucket) {
        bucket.push(item);
      }
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.airingAt - b.airingAt);
    }
    return map;
  }, [filteredItems, weekDays, activeTimeZone]);

  const totalWeekEpisodes = useMemo(() => {
    let sum = 0;
    for (const [, list] of itemsByDay) sum += list.length;
    return sum;
  }, [itemsByDay]);

  const selectedDayItems = itemsByDay.get(selectedDateIso) ?? [];
  const selectedDayInfo = formatDayHeader(selectedDateIso);
  const weekRangeLabel = `${weekDays[0]?.monthDay ?? ""} – ${
    weekDays[6]?.monthDay ?? ""
  }, ${weekStartIso.slice(0, 4)}`;

  return (
    <div className="space-y-7 pb-12">
      {/* Header Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1e253d] bg-gradient-to-br from-[#13182b] via-[#101423] to-[#0b0e17] p-6 md:p-8">
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 border border-primary/30 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                <CalendarIcon className="h-3.5 w-3.5" /> Anime Release Calendar
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                <Globe className="h-3 w-3 text-primary" />
                Timezone: <strong className="text-white">{activeTimeZone}</strong>
              </span>
            </div>

            <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-white">
              Simulcast & Airing Schedule
            </h1>
            <p className="text-xs md:text-sm text-zinc-300 leading-relaxed">
              Track upcoming and recently aired anime episodes with verified broadcast
              timestamps converted to your active timezone. Click any title to open its
              Nayozu detail page.
            </p>
          </div>

          {/* View Mode & Timezone Switcher */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div
              role="group"
              aria-label="Calendar view mode"
              className="inline-flex rounded-xl border border-[#1e253d] bg-[#0d111c] p-1"
            >
              <button
                type="button"
                onClick={() => setViewMode("weekly")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  viewMode === "weekly"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Weekly View
              </button>
              <button
                type="button"
                onClick={() => setViewMode("daily")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  viewMode === "daily"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <List className="h-3.5 w-3.5" />
                Daily View
              </button>
            </div>

            <select
              aria-label="Select Timezone"
              value={tzMode}
              onChange={(e) =>
                setTzMode(
                  e.target.value === "Asia/Tokyo"
                    ? "Asia/Tokyo"
                    : e.target.value === "UTC"
                      ? "UTC"
                      : "local"
                )
              }
              className="h-9 rounded-xl border border-[#1e253d] bg-[#0d111c] px-3 text-xs font-medium text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <option value="local">Local Time ({detectedTz})</option>
              <option value="Asia/Tokyo">Japan Time (Asia/Tokyo · JST)</option>
              <option value="UTC">Coordinated Universal Time (UTC)</option>
            </select>
          </div>
        </div>
      </section>

      {/* Date Navigation & Filter Controls Bar */}
      <div className="flex flex-col gap-4 rounded-2xl border border-[#1b2238] bg-[#121624] p-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Date Navigation */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleStepDate(viewMode === "weekly" ? -7 : -1)}
            aria-label={viewMode === "weekly" ? "Previous week" : "Previous day"}
            className="h-9 px-3 text-xs"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            {viewMode === "weekly" ? "Prev Week" : "Prev Day"}
          </Button>

          <Button
            type="button"
            variant={selectedDateIso === todayIso ? "default" : "outline"}
            size="sm"
            disabled={isPending}
            onClick={handleJumpToday}
            className="h-9 px-3.5 text-xs font-semibold"
          >
            Today
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleStepDate(viewMode === "weekly" ? 7 : 1)}
            aria-label={viewMode === "weekly" ? "Next week" : "Next day"}
            className="h-9 px-3 text-xs"
          >
            {viewMode === "weekly" ? "Next Week" : "Next Day"}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>

          <input
            type="date"
            aria-label="Jump to date"
            value={selectedDateIso}
            onChange={(e) => {
              if (e.target.value) handleSelectDate(e.target.value);
            }}
            className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground"
          />

          <span className="text-xs font-semibold text-zinc-200 pl-1">
            {viewMode === "weekly" ? weekRangeLabel : selectedDayInfo.fullLabel}
          </span>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full sm:w-52">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by title or genre..."
              className="h-9 pl-8 text-xs"
            />
          </div>

          <select
            aria-label="Filter by airing state"
            value={airingFilter}
            onChange={(e) =>
              setAiringFilter(
                e.target.value === "upcoming"
                  ? "upcoming"
                  : e.target.value === "aired"
                    ? "aired"
                    : "all"
              )
            }
            className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground"
          >
            <option value="all">All (Upcoming & Aired)</option>
            <option value="upcoming">Upcoming Only</option>
            <option value="aired">Recently Aired Only</option>
          </select>

          <button
            type="button"
            onClick={() => setCatalogOnly((prev) => !prev)}
            className={`h-9 rounded-lg border px-3 text-xs font-medium transition-colors ${
              catalogOnly
                ? "border-primary bg-primary/15 text-primary"
                : "border-[#232a42] bg-[#0e1220] text-zinc-400 hover:text-white"
            }`}
          >
            {catalogOnly ? "✓ Seeded Catalog Only" : "All Simulcasts"}
          </button>
        </div>
      </div>

      {/* 7-Day Week Strip (Interactive in both Weekly and Daily views) */}
      <nav
        aria-label="Days of the selected week"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
      >
        {weekDays.map((day) => {
          const count = itemsByDay.get(day.iso)?.length ?? 0;
          const isToday = day.iso === todayIso;
          const isSelected = day.iso === selectedDateIso;

          return (
            <button
              key={day.iso}
              type="button"
              onClick={() => {
                setSelectedDateIso(day.iso);
                if (viewMode === "weekly") {
                  setViewMode("daily");
                }
              }}
              aria-current={isSelected ? "date" : undefined}
              className={`flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-all ${
                isSelected && viewMode === "daily"
                  ? "border-primary bg-primary/15 shadow-md shadow-primary/10"
                  : isToday
                    ? "border-primary/50 bg-[#141a2e]"
                    : "border-[#1b2238] bg-[#121624] hover:border-primary/40"
              }`}
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  {day.weekdayShort}
                </span>
                {isToday && (
                  <span className="rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">
                    Today
                  </span>
                )}
              </div>
              <span className="mt-1 text-sm font-semibold text-white">
                {day.monthDay}
              </span>
              <span className="mt-1.5 text-[11px] text-zinc-400">
                {count} {count === 1 ? "episode" : "episodes"}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Provider Limitation / Fallback Notice */}
      {scheduleData.limitationNotice && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{scheduleData.limitationNotice}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadWeek(weekStartIso)}
            className="shrink-0 h-8 text-xs"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry Live Schedule
          </Button>
        </div>
      )}

      {/* Error State */}
      {scheduleData.error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center space-y-3">
          <AlertCircle className="mx-auto h-9 w-9 text-red-400" />
          <p className="text-sm font-medium text-white">{scheduleData.error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadWeek(weekStartIso)}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : isPending ? (
        <div
          className="rounded-2xl border border-[#1b2238] bg-[#121624] py-20 flex flex-col items-center justify-center gap-3"
          role="status"
        >
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-zinc-300">
            Loading episode release schedule for {weekRangeLabel}...
          </p>
        </div>
      ) : scheduleData.providerMode === "catalog_fallback" ? (
        /* Honest Offline Catalog Releasing Fallback */
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">
              Currently Airing Series (Local Catalog)
            </h2>
            <span className="text-xs text-zinc-400">
              {scheduleData.fallbackItems.length} series
            </span>
          </div>

          {scheduleData.fallbackItems.length === 0 ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624] py-14 text-center text-sm text-zinc-400">
              No currently releasing anime found in the local catalog.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {scheduleData.fallbackItems.map((item) => (
                <Link
                  key={item.externalId}
                  href={`/anime/${item.slug}`}
                  className="group flex gap-3.5 rounded-2xl border border-[#1c233a] bg-[#121624] p-3.5 hover:border-primary/50 transition-all"
                >
                  <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-xl bg-[#181d30]">
                    {item.coverImage ? (
                      <Image
                        src={item.coverImage}
                        alt={item.title}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Badge
                      variant="outline"
                      className="text-[10px] border-emerald-500/30 text-emerald-400"
                    >
                      Currently Releasing
                    </Badge>
                    <h3 className="truncate text-sm font-bold text-white group-hover:text-primary transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {[item.format, item.season, item.year]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Exact broadcast time not stored in local DB
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : viewMode === "daily" ? (
        /* ============================================================== */
        /* DAILY SCHEDULE VIEW                                            */
        /* ============================================================== */
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2238] pb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white">
                {selectedDayInfo.fullLabel}
              </h2>
              {selectedDateIso === todayIso && (
                <Badge className="bg-primary text-primary-foreground">Today</Badge>
              )}
            </div>
            <span className="text-xs text-zinc-400">
              {selectedDayItems.length}{" "}
              {selectedDayItems.length === 1 ? "episode" : "episodes"} scheduled (
              {activeTimeZone})
            </span>
          </div>

          {selectedDayItems.length === 0 ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-16 px-4 text-center space-y-3">
              <CalendarIcon className="mx-auto h-8 w-8 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-300">
                No anime episodes scheduled for {selectedDayInfo.fullLabel} matching
                your current filters.
              </p>
              <div className="flex items-center justify-center gap-2">
                {(searchQuery || airingFilter !== "all" || catalogOnly) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearchQuery("");
                      setAiringFilter("all");
                      setCatalogOnly(false);
                    }}
                  >
                    Clear Filters
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setViewMode("weekly")}
                  className="bg-primary text-primary-foreground"
                >
                  View Full Week
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {selectedDayItems.map((item) => (
                <ScheduleEpisodeCard
                  key={item.id}
                  item={item}
                  timeZone={activeTimeZone}
                  nowSeconds={nowSeconds}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        /* ============================================================== */
        /* WEEKLY SCHEDULE VIEW                                           */
        /* ============================================================== */
        <div className="space-y-8">
          {totalWeekEpisodes === 0 ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-16 px-4 text-center space-y-3">
              <CalendarIcon className="mx-auto h-8 w-8 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-300">
                No scheduled episodes found for {weekRangeLabel} matching your
                current filters.
              </p>
              <div className="flex items-center justify-center gap-2">
                {(searchQuery || airingFilter !== "all" || catalogOnly) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearchQuery("");
                      setAiringFilter("all");
                      setCatalogOnly(false);
                    }}
                  >
                    Reset Filters
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={handleJumpToday}
                  className="bg-primary text-primary-foreground"
                >
                  Jump to Current Week
                </Button>
              </div>
            </div>
          ) : (
            weekDays.map((day) => {
              const dayItems = itemsByDay.get(day.iso) ?? [];
              const isToday = day.iso === todayIso;

              return (
                <section
                  key={day.iso}
                  aria-label={day.fullLabel}
                  className="space-y-3.5"
                >
                  <div className="flex items-center justify-between border-b border-[#1b2238] pb-2.5">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-lg font-bold text-white">
                        {day.weekdayLong}
                      </h2>
                      <span className="text-xs font-medium text-zinc-400">
                        {day.monthDay}
                      </span>
                      {isToday && (
                        <Badge className="bg-primary text-primary-foreground text-[10px]">
                          Today
                        </Badge>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDateIso(day.iso);
                        setViewMode("daily");
                      }}
                      className="text-xs font-semibold text-zinc-400 hover:text-primary transition-colors"
                    >
                      {dayItems.length}{" "}
                      {dayItems.length === 1 ? "episode" : "episodes"} · Focus Day →
                    </button>
                  </div>

                  {dayItems.length === 0 ? (
                    <p className="rounded-xl border border-[#171d30] bg-[#101422] px-4 py-4 text-xs text-zinc-500">
                      No episodes matching current filters on {day.weekdayLong}.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                      {dayItems.map((item) => (
                        <ScheduleEpisodeCard
                          key={item.id}
                          item={item}
                          timeZone={activeTimeZone}
                          nowSeconds={nowSeconds}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ScheduleEpisodeCard({
  item,
  timeZone,
  nowSeconds,
}: {
  item: CalendarScheduleItem;
  timeZone: string;
  nowSeconds: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const timeStr = formatReleaseTime(item.airingAt, timeZone);
  const dateStr = formatReleaseDateShort(item.airingAt, timeZone);
  const relative = formatRelativeAiring(item.airingAt, nowSeconds);
  const scoreFormatted =
    item.averageScore && item.averageScore > 0
      ? (item.averageScore / 10).toFixed(1)
      : null;

  return (
    <Link
      href={`/anime/${item.slug}`}
      className="group flex gap-3.5 rounded-2xl border border-[#1c233a] bg-[#121624] p-3.5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
    >
      {/* Artwork Poster */}
      <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#181d30]">
        {item.coverImage && !imgFailed ? (
          <Image
            src={item.coverImage}
            alt={item.title}
            fill
            sizes="80px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-zinc-500">
            No Image
          </div>
        )}
      </div>

      {/* Episode & Release Metadata */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="space-y-1.5">
          {/* Top Badges: Time + Episode */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-2 py-0.5 text-[11px] font-bold text-primary">
              <Clock className="h-3 w-3" />
              {timeStr}
            </span>

            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
              Ep {item.episode}
              {item.totalEpisodes ? ` / ${item.totalEpisodes}` : ""}
            </span>
          </div>

          {/* Title */}
          <h3 className="line-clamp-1 text-sm font-bold text-white group-hover:text-primary transition-colors">
            {item.title}
          </h3>

          {/* Format, Date, Score */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
            <span>{dateStr}</span>
            {item.format && (
              <span>
                • {item.format === "TV_SHORT" ? "TV Short" : item.format}
              </span>
            )}
            {scoreFormatted && (
              <span className="inline-flex items-center gap-0.5 font-semibold text-amber-400">
                • <Star className="h-3 w-3 fill-amber-400 stroke-none" />{" "}
                {scoreFormatted}
              </span>
            )}
          </div>
        </div>

        {/* Bottom Status Row */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium ${
              relative.aired ? "text-emerald-400" : "text-amber-300"
            }`}
          >
            {relative.aired ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {relative.label}
          </span>

          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-400 group-hover:text-primary transition-colors">
            {item.inCatalog ? (
              <>
                <Tv className="h-3 w-3 text-primary" /> In Catalog
              </>
            ) : (
              <>
                Details <ExternalLink className="h-2.5 w-2.5" />
              </>
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}
