"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Check, AlertCircle, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { AUTH_ENABLED } from "@/lib/features";
import {
  type VideoEpisode,
  isAllowedEmbedUrl,
} from "@/lib/providers/mediaProviderAdapter";

interface MediaPlayerProps {
  animeId: string; // external_id as string
  title: string;
  episodes: VideoEpisode[];
  initialProgress?: number;
  userId?: string | null;
}

export default function MediaPlayer({
  animeId,
  title,
  episodes,
  initialProgress = 0,
  userId,
}: MediaPlayerProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [activeEpisodeIndex, setActiveEpisodeIndex] = useState(() => {
    if (initialProgress > 0 && initialProgress <= episodes.length) {
      return initialProgress - 1;
    }
    return 0;
  });

  const [progress, setProgress] = useState(initialProgress);
  const [loading, setLoading] = useState(true);
  const [savingProgress, setSavingProgress] = useState(false);
  const [hasError, setHasError] = useState(false);

  const activeEpisode = episodes[activeEpisodeIndex] || episodes[0];

  if (!activeEpisode) {
    return null;
  }

  const isValidUrl = isAllowedEmbedUrl(activeEpisode.embedUrl);

  const handleEpisodeChange = async (index: number) => {
    setActiveEpisodeIndex(index);
    setLoading(true);
    setHasError(false);

    const epNum = episodes[index]?.number;
    if (AUTH_ENABLED && epNum && epNum > progress && userId) {
      await updateProgress(epNum);
    }
  };

  const updateProgress = async (newProgress: number) => {
    if (!AUTH_ENABLED) return;

    if (!userId) {
      setProgress(newProgress);
      return;
    }

    setSavingProgress(true);
    try {
      const isCompleted = newProgress >= episodes.length;
      await supabase.from("user_anime_library").upsert(
        {
          user_id: userId,
          anime_id: animeId,
          progress: newProgress,
          status: isCompleted ? "completed" : "watching",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,anime_id" }
      );
      setProgress(newProgress);
    } catch (err) {
      console.error("Failed to update watching progress:", err);
    } finally {
      setSavingProgress(false);
    }
  };

  const toggleCurrentWatched = async () => {
    if (!AUTH_ENABLED) return;

    if (!userId) {
      router.push("/auth/login");
      return;
    }
    const isWatched = progress >= activeEpisode.number;
    const targetProgress = isWatched
      ? Math.max(0, activeEpisode.number - 1)
      : activeEpisode.number;
    await updateProgress(targetProgress);
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6 shadow-sm">
      {/* Header bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">Watch on NAYOZU</h2>
            {activeEpisode.isDemo ? (
              <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10">
                Demo Playback
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10">
                Official Stream
              </Badge>
            )}
          </div>
          {activeEpisode.credit && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Official upload by {activeEpisode.credit}
            </p>
          )}
        </div>

        {/* Progress tracker - hidden when AUTH_ENABLED is false */}
        {AUTH_ENABLED && (
          <div className="flex items-center gap-2">
            <Button
              variant={progress >= activeEpisode.number ? "default" : "outline"}
              size="sm"
              onClick={toggleCurrentWatched}
              disabled={savingProgress}
              className="text-xs"
            >
              {savingProgress ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : progress >= activeEpisode.number ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {progress >= activeEpisode.number ? "Watched" : "Mark as Watched"}
            </Button>
          </div>
        )}
      </div>

      {/* Demo content notice */}
      {activeEpisode.isDemo && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Demonstration Mode: </span>
            This title uses a demo stream for player layout testing.
            Commercial streaming requires configuring{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">official_video_id</code>{" "}
            in Supabase.
          </div>
        </div>
      )}

      {/* Video Player Screen */}
      <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-black shadow-lg">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 text-muted-foreground backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
            <p className="text-xs">Loading player stream...</p>
          </div>
        )}

        {!isValidUrl || hasError ? (
          <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-muted-foreground">
            <AlertCircle className="mb-2 h-8 w-8 text-destructive" />
            <p className="text-sm font-semibold text-foreground">Video Stream Unavailable</p>
            <p className="mt-1 text-xs max-w-md">
              The embed URL failed security domain validation or the provider has disabled third-party embedding.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setHasError(false);
                setLoading(true);
              }}
              className="mt-4"
            >
              Retry Playback
            </Button>
          </div>
        ) : (
          <iframe
            key={activeEpisode.embedUrl}
            src={activeEpisode.embedUrl}
            title={`${title} - Official Video`}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setHasError(true);
            }}
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
      </div>

      {/* Episode selector tabs: only shown when more than 1 episode exists */}
      {episodes.length > 1 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Episodes</span>
            {AUTH_ENABLED && (
              <span className="text-xs text-muted-foreground">
                {progress} of {episodes.length} watched
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {episodes.map((ep, idx) => {
              const isActive = idx === activeEpisodeIndex;
              const isWatched = progress >= ep.number;
              return (
                <button
                  key={ep.id}
                  onClick={() => handleEpisodeChange(idx)}
                  className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background hover:bg-muted text-muted-foreground"
                  }`}
                >
                  <div className="flex w-full items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">Ep {ep.number}</span>
                    {AUTH_ENABLED && isWatched && <Check className="h-3 w-3 text-emerald-500" />}
                  </div>
                  <span className="mt-1 line-clamp-1 text-[11px]">
                    {ep.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
