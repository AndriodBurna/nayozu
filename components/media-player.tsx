"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  Server,
  Subtitles,
  Tv,
  Languages,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { AUTH_ENABLED, ENABLE_ANIMESDK } from "@/lib/features";
import {
  type VideoEpisode,
  isAllowedEmbedUrl,
} from "@/lib/providers/mediaProviderAdapter";
import {
  ANIMESDK_PROVIDERS,
  type SdkStreamData,
  type SdkEpisodeUnit,
  type SdkSubtitle,
} from "@/lib/services/animeSdkService";

interface MediaPlayerProps {
  animeId: string; // external_id as string (AniList ID on detail pages)
  title: string;
  episodes: VideoEpisode[];
  initialProgress?: number;
  userId?: string | null;
  initialProvider?: string;
  initialLanguage?: "sub" | "dub";
}

export default function MediaPlayer({
  animeId,
  title,
  episodes,
  initialProgress = 0,
  userId,
  initialProvider,
  initialLanguage = "sub",
}: MediaPlayerProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  // Has official video provided from database?
  const hasOfficialStream = episodes.length > 0;

  // Selected provider: "official", "auto", or a specific Anivexa / AnimeSDK provider ID
  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    if (initialProvider) return initialProvider;
    if (hasOfficialStream) return "official";
    return ENABLE_ANIMESDK ? "auto" : "official";
  });

  // Audio language: "sub" | "dub"
  const [selectedLanguage, setSelectedLanguage] = useState<"sub" | "dub">(initialLanguage);

  // Providers list & health status from /api/anime-sdk/providers
  const [sdkServerOnline, setSdkServerOnline] = useState<boolean | null>(null);
  const [providerList, setProviderList] = useState<
    Array<{ id: string; name: string; label: string; available: boolean; status: string; emaSeconds?: number }>
  >([]);

  // State for AnimeSDK/Anivexa stream resolution
  const [sdkLoading, setSdkLoading] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [resolvedProvider, setResolvedProvider] = useState<string | null>(null);
  const [sdkEpisodes, setSdkEpisodes] = useState<SdkEpisodeUnit[]>([]);
  const [sdkActiveUnit, setSdkActiveUnit] = useState<SdkEpisodeUnit | null>(null);
  const [sdkStream, setSdkStream] = useState<SdkStreamData | null>(null);

  // Official stream episode index
  const [officialEpIndex, setOfficialEpIndex] = useState(() => {
    if (initialProgress > 0 && initialProgress <= episodes.length) {
      return initialProgress - 1;
    }
    return 0;
  });

  // Common playback state
  const [progress, setProgress] = useState(initialProgress);
  const [savingProgress, setSavingProgress] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const [hlsLoading, setHlsLoading] = useState(false);
  const [hlsError, setHlsError] = useState<string | null>(null);

  // Video element and HLS instance ref
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null);

  // One card per episode number (the full list is kept for sibling fallback)
  const uniqueSdkEpisodes = sdkEpisodes.filter(
    (ep, i, arr) => arr.findIndex((e) => e.number === ep.number) === i
  );

  // Active official episode (if official stream is selected)
  const activeOfficialEp = episodes[officialEpIndex] || episodes[0];

  // 1. Fetch providers and server status when enabled
  useEffect(() => {
    if (!ENABLE_ANIMESDK) return;

    let cancelled = false;
    async function checkHealth() {
      try {
        const res = await fetch("/api/anime-sdk/providers", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setSdkServerOnline(Boolean(data.serverOnline));
            if (Array.isArray(data.providers)) {
              setProviderList(data.providers);
            }
          }
        } else {
          if (!cancelled) setSdkServerOnline(false);
        }
      } catch {
        if (!cancelled) setSdkServerOnline(false);
      }
    }

    checkHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Resolve stream when provider is "auto" or an Anivexa/AnimeSDK provider ID
  const resolveSdk = useCallback(
    async (provId: string, epNum = 1, lang: "sub" | "dub" = selectedLanguage) => {
      if (!ENABLE_ANIMESDK) return;

      setSdkLoading(true);
      setSdkError(null);
      setHlsError(null);
      setHlsLoading(false);
      setSdkStream(null);
      setResolvedProvider(null);
      setSdkEpisodes([]);
      setSdkActiveUnit(null);

      try {
        const params = new URLSearchParams({
          title,
          provider: provId,
          episode: String(epNum),
          language: lang,
        });
        if (animeId && /^\d+$/.test(animeId)) {
          params.set("anilistId", animeId);
        }

        const url = `/api/anime-sdk/resolve?${params.toString()}`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json();

        if (data.success && data.stream) {
          setResolvedProvider(data.provider || provId);
          setSdkEpisodes(Array.isArray(data.episodes) ? data.episodes : []);
          setSdkActiveUnit(data.activeEpisode || null);
          setSdkStream(data.stream);
        } else {
          setSdkError(
            data.error ||
              `Could not resolve ${lang.toUpperCase()} stream with ${
                provId === "auto" ? "any available provider" : provId
              }.`
          );
          setSdkStream(null);
        }
      } catch (err) {
        setSdkError(
          err instanceof Error
            ? err.message
            : "Failed to communicate with streaming resolution service."
        );
        setSdkStream(null);
      } finally {
        setSdkLoading(false);
      }
    },
    [title, animeId, selectedLanguage]
  );

  // Trigger resolution when provider or language changes
  useEffect(() => {
    if (selectedProvider !== "official" && ENABLE_ANIMESDK) {
      const targetEp = sdkActiveUnit?.number || 1;
      resolveSdk(selectedProvider, targetEp, selectedLanguage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider, selectedLanguage, title, animeId]);

  // 3. Switch episode within AnimeSDK/Anivexa
  const handleSdkEpisodeSelect = async (unit: SdkEpisodeUnit) => {
    if (!resolvedProvider) return;
    setSdkActiveUnit(unit);
    setHlsLoading(true);
    setHlsError(null);

    const candidates = [
      unit,
      ...sdkEpisodes.filter((u) => u.number === unit.number && u.id !== unit.id),
    ];
    let lastError = "Failed to load stream for this episode.";
    let loaded = false;

    for (const candidate of candidates) {
      try {
        const url = `/api/anime-sdk/stream?provider=${encodeURIComponent(
          resolvedProvider
        )}&unitId=${encodeURIComponent(candidate.id)}&language=${encodeURIComponent(
          selectedLanguage
        )}`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json();
        if (data.success && data.stream) {
          setSdkStream(data.stream);
          setSdkActiveUnit(candidate);
          loaded = true;
          break;
        }
        lastError = data.error || lastError;
      } catch (err) {
        lastError = err instanceof Error ? err.message : lastError;
      }
    }

    if (!loaded) setHlsError(lastError);
    setHlsLoading(false);

    if (AUTH_ENABLED && unit.number > progress && userId) {
      await updateProgress(unit.number, uniqueSdkEpisodes.length);
    }
  };

  // 4. Attach HLS.js (or native MP4/HLS) to <video> when stream URL updates
  const primaryStreamItem = sdkStream?.streams?.[0];
  const streamSourceUrl = primaryStreamItem?.sourceUrl;
  const isDirectMp4 = primaryStreamItem?.isHLS === false;

  useEffect(() => {
    if (selectedProvider === "official" || !streamSourceUrl || !videoRef.current) {
      setHlsLoading(false);
      return;
    }

    const currentSourceUrl = streamSourceUrl;
    const videoEl = videoRef.current;
    setHlsLoading(true);
    setHlsError(null);

    let isSubscribed = true;

    async function initPlayback() {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      // Direct MP4 stream support (returned by some Anivexa providers like animegg / mkissa / anibd)
      if (isDirectMp4) {
        videoEl.src = currentSourceUrl;
        const onLoaded = () => {
          if (isSubscribed) setHlsLoading(false);
        };
        const onError = () => {
          if (isSubscribed) {
            setHlsLoading(false);
            setHlsError("Playback failed on direct MP4 stream.");
          }
        };
        videoEl.addEventListener("loadedmetadata", onLoaded, { once: true });
        videoEl.addEventListener("error", onError, { once: true });
        return;
      }

      const HlsModule = (await import("hls.js")).default;
      if (!currentSourceUrl || !videoEl || !isSubscribed) return;

      if (HlsModule.isSupported()) {
        const hls = new HlsModule({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
        });
        hlsRef.current = hls;

        hls.loadSource(currentSourceUrl);
        hls.attachMedia(videoEl);

        hls.on(HlsModule.Events.MANIFEST_PARSED, () => {
          if (isSubscribed) setHlsLoading(false);
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hls.on(HlsModule.Events.ERROR, (_event: string, data: any) => {
          if (data.fatal) {
            console.error("[HLS.js Fatal Error]", {
              type: data.type,
              details: data.details,
              fatal: data.fatal,
              url: data.url,
              response: data.response,
              error: data.error?.message,
              reason: data.reason,
            });

            if (isSubscribed) {
              setHlsLoading(false);
              setHlsError(
                `Playback failed: ${data.details ?? data.type ?? "Unknown HLS error"}`
              );
            }
          }
        });
      } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        videoEl.src = currentSourceUrl;
        videoEl.addEventListener(
          "loadedmetadata",
          () => {
            if (isSubscribed) setHlsLoading(false);
          },
          { once: true }
        );
        videoEl.addEventListener(
          "error",
          () => {
            if (isSubscribed) {
              setHlsLoading(false);
              setHlsError("Playback error on native video player.");
            }
          },
          { once: true }
        );
      } else {
        if (isSubscribed) {
          setHlsLoading(false);
          setHlsError("Your browser does not support HLS video streaming.");
        }
      }
    }

    initPlayback();

    return () => {
      isSubscribed = false;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [selectedProvider, streamSourceUrl, isDirectMp4]);

  // Update progress helper
  const updateProgress = async (newProgress: number, totalEpisodes: number) => {
    if (!AUTH_ENABLED) return;

    if (!userId) {
      setProgress(newProgress);
      return;
    }

    setSavingProgress(true);
    try {
      const isCompleted = newProgress >= totalEpisodes;
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

  // Official stream episode change handler
  const handleOfficialEpChange = async (index: number) => {
    setOfficialEpIndex(index);
    setIframeLoading(true);
    setIframeError(false);

    const epNum = episodes[index]?.number;
    if (AUTH_ENABLED && epNum && epNum > progress && userId) {
      await updateProgress(epNum, episodes.length);
    }
  };

  const isOfficial = selectedProvider === "official";
  const isValidOfficialUrl =
    isOfficial && activeOfficialEp
      ? isAllowedEmbedUrl(activeOfficialEp.embedUrl)
      : false;

  const currentEpNumber = isOfficial
    ? activeOfficialEp?.number || 1
    : sdkActiveUnit?.number || 1;

  const totalEpCount = isOfficial ? episodes.length : uniqueSdkEpisodes.length;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6 shadow-sm">
      {/* Header Bar with Title, Badges, Audio Toggle, and Provider Selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">Watch on NAYOZU</h2>

            {/* Provider indicator badge */}
            {isOfficial ? (
              activeOfficialEp?.isDemo ? (
                <Badge
                  variant="outline"
                  className="text-amber-500 border-amber-500/30 bg-amber-500/10"
                >
                  Demo Playback
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                >
                  Official Stream
                </Badge>
              )
            ) : (
              <Badge
                variant="outline"
                className="text-sky-400 border-sky-400/30 bg-sky-500/10"
              >
                {resolvedProvider ? `Stream — ${resolvedProvider}` : "Anivexa / Kuhi"}
              </Badge>
            )}

            {!isOfficial && (
              <Badge variant="secondary" className="text-[10px] uppercase">
                {selectedLanguage}
              </Badge>
            )}

            {/* Server status indicator */}
            {ENABLE_ANIMESDK && sdkServerOnline === false && (
              <Badge
                variant="destructive"
                className="text-[10px] uppercase tracking-wider"
              >
                SDK Server Offline
              </Badge>
            )}
          </div>

          {/* Credits / Metadata */}
          {isOfficial && activeOfficialEp?.credit && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Official upload by {activeOfficialEp.credit}
            </p>
          )}
          {!isOfficial && resolvedProvider && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Playing via {resolvedProvider} ({selectedLanguage.toUpperCase()}) •{" "}
              {uniqueSdkEpisodes.length} episodes available
            </p>
          )}
        </div>

        {/* Right side: Sub/Dub Toggle, Provider Selector & Progress Tracker */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Sub / Dub Audio Toggle */}
          {ENABLE_ANIMESDK && !isOfficial && (
            <div className="inline-flex items-center rounded-md border border-input bg-background p-0.5 text-xs">
              <Languages className="h-3.5 w-3.5 text-muted-foreground ml-1.5 mr-1" />
              <button
                type="button"
                onClick={() => setSelectedLanguage("sub")}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  selectedLanguage === "sub"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                SUB
              </button>
              <button
                type="button"
                onClick={() => setSelectedLanguage("dub")}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  selectedLanguage === "dub"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                DUB
              </button>
            </div>
          )}

          {/* In-Player Provider Selector */}
          {ENABLE_ANIMESDK && (
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="provider-select"
                className="text-xs text-muted-foreground flex items-center gap-1"
              >
                <Tv className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Provider:</span>
              </label>
              <select
                id="provider-select"
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {/* Auto provider */}
                <option value="auto">Auto (Fastest Race)</option>

                {/* Official video if configured */}
                {hasOfficialStream && (
                  <option value="official">Official Stream (YouTube)</option>
                )}

                {/* Anivexa + AnimeSDK providers */}
                {ANIMESDK_PROVIDERS.filter((p) => p.id !== "auto").map((p) => {
                  const meta = providerList.find((item) => item.id === p.id);
                  const isAvailable = meta ? meta.available : true;
                  return (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={meta ? !isAvailable : false}
                    >
                      {p.label}
                      {meta?.emaSeconds ? ` (${meta.emaSeconds.toFixed(1)}s)` : ""}
                      {meta && !meta.available ? " (Offline)" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Progress tracker button (only when AUTH_ENABLED) */}
          {AUTH_ENABLED && (
            <Button
              variant={progress >= currentEpNumber ? "default" : "outline"}
              size="sm"
              onClick={async () => {
                if (!userId) {
                  router.push("/auth/login");
                  return;
                }
                const isWatched = progress >= currentEpNumber;
                const target = isWatched
                  ? Math.max(0, currentEpNumber - 1)
                  : currentEpNumber;
                await updateProgress(target, totalEpCount);
              }}
              disabled={savingProgress}
              className="text-xs h-8"
            >
              {savingProgress ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : progress >= currentEpNumber ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {progress >= currentEpNumber ? "Watched" : "Mark as Watched"}
            </Button>
          )}
        </div>
      </div>

      {/* Offline server advisory notice */}
      {ENABLE_ANIMESDK && !isOfficial && sdkServerOnline === false && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500">
          <Server className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Streaming Server Offline: </span>
            The unified streaming server is not currently running on port 4000.
            To enable in-site playback, run:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              npm run sdk:server
            </code>
          </div>
        </div>
      )}

      {/* Video Player Display Screen */}
      <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-black shadow-lg">
        {/* Loading overlay for official iframe */}
        {isOfficial && iframeLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 text-muted-foreground backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
            <p className="text-xs">Loading player stream...</p>
          </div>
        )}

        {/* Loading overlay for AnimeSDK/Anivexa resolution / HLS */}
        {!isOfficial && (sdkLoading || hlsLoading) && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 text-muted-foreground backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
            <p className="text-xs">
              {sdkLoading
                ? `Racing providers for ${
                    selectedProvider === "auto"
                      ? "fastest stream"
                      : selectedProvider
                  } (${selectedLanguage.toUpperCase()})...`
                : "Buffering video stream..."}
            </p>
          </div>
        )}

        {/* CASE A: Official Stream (YouTube IFrame) */}
        {isOfficial && (
          <>
            {!isValidOfficialUrl || iframeError ? (
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-muted-foreground">
                <AlertCircle className="mb-2 h-8 w-8 text-destructive" />
                <p className="text-sm font-semibold text-foreground">
                  Video Stream Unavailable
                </p>
                <p className="mt-1 text-xs max-w-md">
                  The embed URL failed security domain validation or the provider
                  has disabled third-party embedding.
                </p>
                {ENABLE_ANIMESDK && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setSelectedProvider("auto")}
                    className="mt-4 text-xs"
                  >
                    Try Anivexa / AnimeSDK Providers
                  </Button>
                )}
              </div>
            ) : (
              <iframe
                key={activeOfficialEp.embedUrl}
                src={activeOfficialEp.embedUrl}
                title={`${title} - Official Video`}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                onLoad={() => setIframeLoading(false)}
                onError={() => {
                  setIframeLoading(false);
                  setIframeError(true);
                }}
                className="absolute inset-0 h-full w-full border-0"
              />
            )}
          </>
        )}

        {/* CASE B: Anivexa / AnimeSDK Stream (HTML5 Video + HLS.js / MP4) */}
        {!isOfficial && (
          <>
            {sdkError || hlsError ? (
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-muted-foreground">
                <AlertCircle className="mb-2 h-8 w-8 text-destructive" />
                <p className="text-sm font-semibold text-foreground">
                  Playback Resolution Failed
                </p>
                <p className="mt-1 text-xs max-w-md text-muted-foreground">
                  {sdkError || hlsError}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      resolveSdk(selectedProvider, currentEpNumber, selectedLanguage)
                    }
                    className="text-xs"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Retry Playback
                  </Button>
                  {selectedLanguage === "dub" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedLanguage("sub")}
                      className="text-xs"
                    >
                      Try SUB Audio
                    </Button>
                  )}
                  {selectedProvider !== "auto" && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setSelectedProvider("auto")}
                      className="text-xs"
                    >
                      Switch to Auto Race
                    </Button>
                  )}
                  {hasOfficialStream && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedProvider("official")}
                      className="text-xs"
                    >
                      Use Official Stream
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <video
                ref={videoRef}
                controls
                playsInline
                crossOrigin="anonymous"
                className="absolute inset-0 h-full w-full bg-black object-contain"
              >
                {/* Subtitle tracks */}
                {primaryStreamItem?.subtitles?.map((sub: SdkSubtitle, idx: number) => (
                  <track
                    key={sub.url}
                    kind="subtitles"
                    src={sub.url}
                    srcLang={sub.language}
                    label={sub.label}
                    default={idx === 0}
                  />
                ))}
              </video>
            )}
          </>
        )}
      </div>

      {/* Subtitle Track Quick Selector (if subtitles returned) */}
      {!isOfficial && primaryStreamItem?.subtitles && primaryStreamItem.subtitles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Subtitles className="h-3.5 w-3.5 text-foreground" />
          <span className="font-medium text-foreground">Subtitles:</span>
          <div className="flex flex-wrap gap-1.5">
            {primaryStreamItem.subtitles.map((sub: SdkSubtitle, idx: number) => (
              <Badge
                key={`${sub.language}-${idx}`}
                variant="secondary"
                className="cursor-pointer text-[11px] font-normal hover:bg-secondary/80"
              >
                {sub.label}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Episode selector tabs: for Official stream */}
      {isOfficial && episodes.length > 1 && (
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
              const isActive = idx === officialEpIndex;
              const isWatched = progress >= ep.number;
              return (
                <button
                  key={ep.id}
                  onClick={() => handleOfficialEpChange(idx)}
                  className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background hover:bg-muted text-muted-foreground"
                  }`}
                >
                  <div className="flex w-full items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">Ep {ep.number}</span>
                    {AUTH_ENABLED && isWatched && (
                      <Check className="h-3 w-3 text-emerald-500" />
                    )}
                  </div>
                  <span className="mt-1 line-clamp-1 text-[11px]">{ep.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Episode selector tabs: for Anivexa / AnimeSDK stream */}
      {!isOfficial && uniqueSdkEpisodes.length > 1 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              Episodes ({uniqueSdkEpisodes.length})
            </span>
            {AUTH_ENABLED && (
              <span className="text-xs text-muted-foreground">
                {progress} of {uniqueSdkEpisodes.length} watched
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-60 overflow-y-auto pr-1">
            {uniqueSdkEpisodes.map((ep) => {
              const isActive = sdkActiveUnit?.number === ep.number;
              const isWatched = progress >= ep.number;
              return (
                <button
                  key={ep.id}
                  onClick={() => handleSdkEpisodeSelect(ep)}
                  className={`flex flex-col items-start rounded-lg border p-2 text-left transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background hover:bg-muted text-muted-foreground"
                  }`}
                >
                  <div className="flex w-full items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">Ep {ep.number}</span>
                    {AUTH_ENABLED && isWatched && (
                      <Check className="h-3 w-3 text-emerald-500" />
                    )}
                  </div>
                  <span className="mt-0.5 line-clamp-1 text-[10px]">{ep.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
