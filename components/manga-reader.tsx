"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Layers,
  Maximize2,
  Minimize2,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { AUTH_ENABLED } from "@/lib/features";
import type { MangaChapter } from "@/lib/providers/mediaProviderAdapter";

interface MangaReaderProps {
  animeId: string; // external_id as string
  title: string;
  chapters: MangaChapter[];
  initialProgress?: number;
  userId?: string | null;
}

export default function MangaReader({
  animeId,
  title,
  chapters,
  initialProgress = 0,
  userId,
}: MangaReaderProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [activeChapterIndex, setActiveChapterIndex] = useState(() => {
    if (initialProgress > 0 && initialProgress <= chapters.length) {
      return initialProgress - 1;
    }
    return 0;
  });

  const [activePage, setActivePage] = useState(1);
  const [readingMode, setReadingMode] = useState<"vertical" | "paged">("vertical");
  const [progress, setProgress] = useState(initialProgress);
  const [savingProgress, setSavingProgress] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const currentChapter = chapters[activeChapterIndex] || chapters[0];

  useEffect(() => {
    setActivePage(1);
  }, [activeChapterIndex]);

  useEffect(() => {
    if (readingMode !== "paged") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "d") {
        handleNextPage();
      } else if (e.key === "ArrowLeft" || e.key === "a") {
        handlePrevPage();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [readingMode, activePage, currentChapter]);

  if (!currentChapter) {
    return null;
  }

  const updateProgress = async (newChapterNumber: number) => {
    if (!AUTH_ENABLED) return;

    if (!userId) {
      setProgress(newChapterNumber);
      return;
    }

    setSavingProgress(true);
    try {
      const isCompleted = newChapterNumber >= chapters.length;
      await supabase.from("user_anime_library").upsert(
        {
          user_id: userId,
          anime_id: animeId,
          progress: newChapterNumber,
          status: isCompleted ? "completed" : "watching",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,anime_id" }
      );
      setProgress(newChapterNumber);
    } catch (err) {
      console.error("Failed to update reading progress:", err);
    } finally {
      setSavingProgress(false);
    }
  };

  const handleNextChapter = () => {
    if (activeChapterIndex < chapters.length - 1) {
      const nextIdx = activeChapterIndex + 1;
      setActiveChapterIndex(nextIdx);
      if (AUTH_ENABLED && chapters[nextIdx].number > progress && userId) {
        updateProgress(chapters[nextIdx].number);
      }
    }
  };

  const handlePrevChapter = () => {
    if (activeChapterIndex > 0) {
      setActiveChapterIndex(activeChapterIndex - 1);
    }
  };

  const handleNextPage = () => {
    if (activePage < currentChapter.pages.length) {
      setActivePage((p) => p + 1);
    } else {
      handleNextChapter();
    }
  };

  const handlePrevPage = () => {
    if (activePage > 1) {
      setActivePage((p) => p - 1);
    } else {
      handlePrevChapter();
    }
  };

  const toggleMarkRead = async () => {
    if (!AUTH_ENABLED) return;

    if (!userId) {
      router.push("/auth/login");
      return;
    }
    const isRead = progress >= currentChapter.number;
    const targetProgress = isRead
      ? Math.max(0, currentChapter.number - 1)
      : currentChapter.number;
    await updateProgress(targetProgress);
  };

  return (
    <div
      className={`flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6 shadow-sm transition-all ${
        isFullScreen ? "fixed inset-0 z-50 overflow-y-auto bg-background p-6" : ""
      }`}
    >
      {/* Reader Controls Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">Read on NAYOZU</h2>
            {currentChapter.isDemo ? (
              <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10">
                Demo Reader
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10">
                Authorized Chapter
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {currentChapter.title} &middot; {currentChapter.scanlationGroup || "Official"}
          </p>
        </div>

        {/* View Mode & Actions Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Reading mode toggle */}
          <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs">
            <button
              onClick={() => setReadingMode("vertical")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors ${
                readingMode === "vertical"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ScrollText className="h-3.5 w-3.5" />
              <span>Webtoon</span>
            </button>
            <button
              onClick={() => setReadingMode("paged")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors ${
                readingMode === "paged"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Paged</span>
            </button>
          </div>

          {/* Mark read button - hidden when AUTH_ENABLED is false */}
          {AUTH_ENABLED && (
            <Button
              variant={progress >= currentChapter.number ? "default" : "outline"}
              size="sm"
              onClick={toggleMarkRead}
              disabled={savingProgress}
              className="text-xs"
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {progress >= currentChapter.number ? "Read" : "Mark as Read"}
            </Button>
          )}

          {/* Fullscreen toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsFullScreen(!isFullScreen)}
            title={isFullScreen ? "Exit Fullscreen" : "Fullscreen Reader"}
          >
            {isFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Demo Notice */}
      {currentChapter.isDemo && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Demonstration Reader: </span>
            This title uses demo panels for reader layout testing.
          </div>
        </div>
      )}

      {/* Chapter Selection Bar */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 p-2 text-xs">
        <Button
          variant="ghost"
          size="sm"
          disabled={activeChapterIndex <= 0}
          onClick={handlePrevChapter}
          className="h-8 gap-1 text-xs"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Prev Chapter</span>
        </Button>

        <select
          value={activeChapterIndex}
          onChange={(e) => setActiveChapterIndex(Number(e.target.value))}
          className="h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {chapters.map((ch, idx) => (
            <option key={ch.id} value={idx}>
              Chapter {ch.number} {AUTH_ENABLED && progress >= ch.number ? "✓" : ""}
            </option>
          ))}
        </select>

        <Button
          variant="ghost"
          size="sm"
          disabled={activeChapterIndex >= chapters.length - 1}
          onClick={handleNextChapter}
          className="h-8 gap-1 text-xs"
        >
          <span>Next Chapter</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Reader Viewport */}
      {readingMode === "vertical" ? (
        /* Vertical Continuous Scroll (Webtoon / Manhwa Style) */
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-neutral-950 p-2 sm:p-4 max-w-3xl mx-auto w-full">
          {currentChapter.pages.map((pageUrl, pIdx) => (
            <div key={`${currentChapter.id}-p${pIdx + 1}`} className="w-full flex flex-col items-center">
              <div className="relative w-full max-w-2xl overflow-hidden rounded shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pageUrl}
                  alt={`Page ${pIdx + 1}`}
                  loading="lazy"
                  className="w-full h-auto block"
                />
              </div>
              <span className="text-[10px] text-muted-foreground/60 py-1">
                {pIdx + 1} / {currentChapter.pages.length}
              </span>
            </div>
          ))}

          {/* End of Chapter Action */}
          <div className="w-full text-center py-6 border-t border-border mt-4 flex flex-col items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              End of Chapter {currentChapter.number}
            </p>
            {activeChapterIndex < chapters.length - 1 ? (
              <Button onClick={handleNextChapter} size="sm">
                Next Chapter ({activeChapterIndex + 2})
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">You are up to date with the latest chapter!</p>
            )}
          </div>
        </div>
      ) : (
        /* Single-Page Reader (Traditional Manga Paged Style) */
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-neutral-950 p-4 max-w-2xl mx-auto w-full">
          <div className="relative w-full aspect-[2/3] max-w-xl flex items-center justify-center overflow-hidden rounded bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentChapter.pages[activePage - 1]}
              alt={`Page ${activePage}`}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          {/* Paged Navigation Bar */}
          <div className="flex items-center justify-between w-full max-w-md pt-2 text-xs">
            <Button
              variant="outline"
              size="sm"
              disabled={activePage <= 1}
              onClick={handlePrevPage}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Previous</span>
            </Button>
            <span className="text-muted-foreground font-medium">
              Page {activePage} of {currentChapter.pages.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={activePage >= currentChapter.pages.length && activeChapterIndex >= chapters.length - 1}
              onClick={handleNextPage}
              className="gap-1"
            >
              <span>{activePage >= currentChapter.pages.length ? "Next Chapter" : "Next"}</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
